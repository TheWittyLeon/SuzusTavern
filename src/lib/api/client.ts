// src/lib/api/client.ts
//
// Same-origin fetch wrapper with 401→refresh→retry and ApiError normalisation.
// Zero external dependencies.

import type { ApiError, ApiResult } from './types';

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** JSON body — will be stringified. Use `rawBody` for non-JSON. */
  json?: unknown;
  /** Raw body passthrough; mutually exclusive with `json`. */
  rawBody?: BodyInit | null;
  /** AbortSignal — propagates to the underlying fetch. */
  signal?: AbortSignal;
  /** Internal: set when retrying after refresh. Do NOT pass from callers. */
  _retried?: boolean;
}

// Module-level single-flight guard — prevents React-19 strict-mode double-
// refresh storm. If two concurrent 401s both trigger a refresh, the second
// awaits the same promise rather than firing a duplicate request.
let refreshInFlight: Promise<RefreshOutcome> | null = null;

/**
 * TAV-AUTH-DEADBACKEND-AS-DEADSESSION (P1, 2026-08-19) — classifies WHY the
 * silent refresh failed, mirroring `AuthProvider.classifyAuthError`'s
 * philosophy (status 0 / >=500 -> can't-confirm, everything else -> a real
 * answer) at the one call site that historically skipped it: the inline
 * refresh-then-retry inside `apiFetch` itself used to check only `r.ok` and
 * throw a hardcoded `401 unauthorized` no matter WHY refresh failed —
 * collapsing the BFF's `502 {error:'upstream_unavailable'}` (Authentication-
 * Python itself unreachable; the BFF never got to ask whether THIS session
 * is valid) into "your session expired". A dead backend and a dead session
 * need different copy and different next actions from the caller.
 *   - 'ok'             refresh succeeded — retry the original request.
 *   - 'session_dead'   the auth backend DID answer and rejected the refresh
 *                       (401 refresh_failed / no_refresh_token, 403, ...) —
 *                       a CONFIRMED-dead session. Unchanged from before this
 *                       fix; do not weaken this path.
 *   - 'rate_limited'   the BFF itself 429'd the refresh call — not a
 *                       confirmed-dead session either.
 *   - 'unreachable'    the refresh call never got a real answer at all: the
 *                       fetch() to '/api/auth/refresh' threw (network/DNS/
 *                       offline, status 0) or the BFF answered with a 5xx
 *                       (including its own 502 upstream_unavailable). Carries
 *                       the real status/code so the thrown ApiError is
 *                       honest rather than a hardcoded 401.
 */
type RefreshOutcome =
  | { kind: 'ok' }
  | { kind: 'session_dead' }
  | { kind: 'rate_limited' }
  | { kind: 'unreachable'; status: number; code: string };

async function attemptRefresh(): Promise<RefreshOutcome> {
  let r: Response;
  try {
    r = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch {
    // The refresh request itself never produced an HTTP response — same
    // "can't confirm" bucket as a 5xx, same (status 0, code 'network')
    // shape this file already uses for a top-level fetch failure below.
    return { kind: 'unreachable', status: 0, code: 'network' };
  }
  if (r.ok) return { kind: 'ok' };
  if (r.status === 429) return { kind: 'rate_limited' };
  if (r.status >= 500) {
    // The BFF answered but never reached Authentication-Python (its own
    // handleRefresh returns 502 {error:'upstream_unavailable'} here) or hit
    // an internal error — either way it did NOT confirm this session is
    // dead. Surface its own status/code rather than a hardcoded 401.
    let code = 'upstream_unavailable';
    try {
      const body = (await r.json()) as Record<string, unknown>;
      if (typeof body?.['error'] === 'string') code = body['error'] as string;
    } catch {
      // non-JSON 5xx body — keep the default code
    }
    return { kind: 'unreachable', status: r.status, code };
  }
  // Any other non-ok status (401 refresh_failed / no_refresh_token, 403, ...)
  // means the auth backend DID answer and rejected the refresh — a
  // confirmed-dead session. Do NOT weaken this path.
  return { kind: 'session_dead' };
}

/** Construct an ApiError without leaking raw text. */
export function makeApiError(
  status: number,
  code: string,
  body?: unknown,
): ApiError {
  const err = new Error(`API error ${status}: ${code}`) as ApiError;
  err.status = status;
  err.code = code;
  if (body !== undefined) err.body = body;
  return err;
}

/**
 * Same-origin fetch wrapper.
 *
 * Behaviour:
 *   1. `path` is resolved as a relative URL — callers pass '/api/dnd/...' style paths.
 *   2. JSON requests: Content-Type 'application/json', body = JSON.stringify(json).
 *   3. `credentials: 'same-origin'` (cookies attach automatically — st_access/st_refresh).
 *   4. On 401 (and not already retried and path != '/api/auth/refresh'):
 *        - POST '/api/auth/refresh' once, same-origin (BFF rotates cookies).
 *        - If refresh succeeds, retry the original request with `_retried = true`.
 *        - If refresh CONFIRMS the session is dead (BFF answered 401/403 —
 *          refresh_failed / no_refresh_token), throw ApiError {status: 401,
 *          code: 'unauthorized'}.
 *        - If refresh could NOT be confirmed either way (network failure, or
 *          a 5xx from the BFF — including its own 502 upstream_unavailable
 *          when Authentication-Python is down), throw the BFF's own
 *          status/code instead (TAV-AUTH-DEADBACKEND-AS-DEADSESSION,
 *          2026-08-19) — never a hardcoded 401. A dead backend is not a dead
 *          session.
 *        - If the BFF rate-limited the refresh call, throw ApiError
 *          {status: 429, code: 'rate_limited'}.
 *   5. On non-2xx: parse JSON if possible, throw ApiError {status, code, body}.
 *   6. On network/abort: throw ApiError {status: 0, code: 'network'|'abort'}.
 *   7. Returns the parsed JSON body, unwrapped.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { json, rawBody, signal, _retried, ...rest } = options;

  const headers = new Headers(rest.headers as HeadersInit | undefined);
  let body: BodyInit | null | undefined;

  if (json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(json);
  } else if (rawBody !== undefined) {
    body = rawBody;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers,
      body,
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw makeApiError(0, 'abort');
    }
    throw makeApiError(0, 'network');
  }

  // 401 → attempt refresh once, then retry
  if (res.status === 401 && !_retried && path !== '/api/auth/refresh') {
    if (!refreshInFlight) {
      refreshInFlight = attemptRefresh().finally(() => {
        refreshInFlight = null;
      });
    }
    const outcome = await refreshInFlight;
    if (outcome.kind === 'ok') {
      return apiFetch<T>(path, { ...options, _retried: true });
    }
    if (outcome.kind === 'unreachable') {
      throw makeApiError(outcome.status, outcome.code);
    }
    if (outcome.kind === 'rate_limited') {
      throw makeApiError(429, 'rate_limited');
    }
    // outcome.kind === 'session_dead' — the real 401 path, unweakened.
    throw makeApiError(401, 'unauthorized');
  }

  if (!res.ok) {
    let errBody: unknown;
    let code = String(res.status);
    try {
      errBody = await res.json();
      if (errBody && typeof errBody === 'object') {
        const e = errBody as Record<string, unknown>;
        if (typeof e['error'] === 'string') code = e['error'];
        else if (typeof e['code'] === 'string') code = e['code'];
      }
    } catch {
      // non-JSON error body — code stays as status string
    }
    throw makeApiError(res.status, code, errBody);
  }

  return res.json() as Promise<T>;
}

/**
 * Envelope-aware wrapper for endpoints that return ApiResult<T>.
 * - On `{success: true, data}` → returns data.
 * - On `{success: false, error}` → throws ApiError {status: HTTP, code: error}.
 */
export async function apiCall<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const result = await apiFetch<ApiResult<T>>(path, options);
  if (result.success) return result.data;
  // A 2xx response carrying `{success:false}` is a business-level error, not a
  // transport error — surface it as 422 (Unprocessable) so error handlers don't
  // mistake it for a successful 200.
  throw makeApiError(422, result.error, result);
}
