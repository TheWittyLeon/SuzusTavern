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
let refreshInFlight: Promise<boolean> | null = null;

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
 *        - If refresh fails, throw ApiError {status: 401, code: 'unauthorized'}.
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
    try {
      if (!refreshInFlight) {
        refreshInFlight = fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'same-origin',
        }).then((r) => r.ok).finally(() => {
          refreshInFlight = null;
        });
      }
      const refreshOk = await refreshInFlight;
      if (refreshOk) {
        return apiFetch<T>(path, { ...options, _retried: true });
      }
    } catch {
      // refresh network error — fall through to throw 401
    }
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
