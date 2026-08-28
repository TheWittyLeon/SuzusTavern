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
//
// TAV-AUTH-DEADBACKEND-AS-DEADSESSION: resolves the refresh attempt's REAL
// HTTP status (+ parsed body — Kage-CR item 3) alongside `ok`, not just a
// bare boolean — the caller needs the status to tell "the refresh endpoint
// rejected this session" apart from "the refresh endpoint (or the network)
// is unavailable right now", and needs the body so a 429's `retry_after`
// survives to the throw. A bare boolean threw both away.
let refreshInFlight: Promise<{ ok: boolean; status: number; body: unknown }> | null = null;

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
 *        - If refresh fails with status 0 (network throw), >=500, or 429,
 *          throw ApiError {status: <that status>, code: 'refresh_unavailable',
 *          body: <refresh response body, if any>} — the AUTH BACKEND is
 *          unreachable/unhealthy/rate-limited right now, which is not the
 *          same claim as "this session is dead"
 *          (TAV-AUTH-DEADBACKEND-AS-DEADSESSION). Collapsing every refresh
 *          failure into a hardcoded 401 used to hard-navigate a player off a
 *          perfectly valid session the moment the auth backend blipped.
 *        - Any OTHER refresh failure status (401, 403, 422, ...) throws
 *          ApiError {status: <that status>, code: 'unauthorized', body}: a
 *          genuine session rejection. This mirrors — deliberately, not
 *          independently — AuthProvider.classifyAuthError's own rule (status
 *          0/>=500 -> 'offline', 429 -> 'rate_limited', else -> 'expired').
 *          422 matters here: flask-jwt-extended's DEFAULT error handler
 *          (Authentication-Python registers no custom invalid_token_loader)
 *          answers 422 for an invalid-signature/decode failure — a confirmed
 *          dead session (e.g. a JWT_SECRET rotation mass-emits it), not an
 *          "unavailable" backend.
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
    let refreshResult: { ok: boolean; status: number; body: unknown };
    try {
      if (!refreshInFlight) {
        refreshInFlight = fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'same-origin',
        })
          .then(async (r) => {
            // Kage-CR item 3: read the refresh response body (guarded — a
            // non-JSON/empty body just leaves `parsedBody` undefined). The
            // BFF's own /api/auth/refresh forwards a 429's rate-limit body
            // verbatim (app/api/auth/[...path]/route.ts's rateLimited() sets
            // {error:'rate_limited', retry_after}); without threading it
            // through, login's documented retry_after countdown contract
            // (ApiError.body.retry_after, read by login/page.tsx) silently
            // falls back to a wrong 60s whenever the 429 arrives via THIS
            // internal retry path rather than a direct /api/auth/login 429.
            let parsedBody: unknown;
            try {
              parsedBody = await r.json();
            } catch {
              parsedBody = undefined;
            }
            return { ok: r.ok, status: r.status, body: parsedBody };
          })
          .finally(() => {
            refreshInFlight = null;
          });
      }
      refreshResult = await refreshInFlight;
    } catch {
      // The refresh fetch() itself threw (network down, DNS, aborted, ...).
      // status 0 is client.ts's own network/abort sentinel elsewhere in this
      // file (see the outer fetch() catch above) — reuse it here so
      // AuthProvider's classifyAuthError (status 0 or >=500 → 'offline', not
      // 'expired') can classify this the same way it classifies every other
      // network failure.
      refreshResult = { ok: false, status: 0, body: undefined };
    }

    if (refreshResult.ok) {
      return apiFetch<T>(path, { ...options, _retried: true });
    }

    // TAV-AUTH-DEADBACKEND-AS-DEADSESSION + Kage-CR item 2: INVERTED from an
    // independent 401/403 allow-list to mirror AuthProvider.classifyAuthError's
    // existing rule exactly — status 0/>=500/429 means the AUTH BACKEND is
    // unreachable/unhealthy/rate-limited right now (not the same claim as
    // "this session is dead"); everything else (401, 403, 422, ...) is a
    // real rejection. The old allow-list disagreed with classifyAuthError on
    // 400/404/409/422 — most importantly 422, which flask-jwt-extended's
    // DEFAULT error handler answers for an invalid-signature/decode failure
    // (Authentication-Python registers no custom invalid_token_loader) and
    // is therefore a CONFIRMED dead session, not "unavailable". Carrying the
    // real status+body through lets every existing consumer that narrows on
    // `err.status` (useCatalog's unauthorized-vs-error branch, the play
    // page's dm-narration branch, login's retry_after countdown,
    // AuthProvider's classifyAuthError) do the right thing without any
    // change on their end.
    const refreshUnavailable =
      refreshResult.status === 0 ||
      refreshResult.status >= 500 ||
      refreshResult.status === 429;
    throw makeApiError(
      refreshResult.status,
      refreshUnavailable ? 'refresh_unavailable' : 'unauthorized',
      refreshResult.body,
    );
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

  // TAV-DND-PROXY-JSON-PARSE-500 sibling sweep: the success path was the one
  // remaining unguarded `await res.json()` in the BFF-consuming layer — every
  // BFF route itself now always answers with `NextResponse.json(...)` even on
  // upstream failure, but a non-JSON 2xx (or an empty body) would still throw
  // a raw SyntaxError out of here uncaught, surfacing as an unhandled
  // exception in whatever UI code called `apiFetch`. Guard it the same way as
  // the error branch just above: never let a parse failure escape as a raw
  // throw, always shape it into ApiError.
  try {
    return (await res.json()) as T;
  } catch {
    throw makeApiError(res.status, 'invalid_response');
  }
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
