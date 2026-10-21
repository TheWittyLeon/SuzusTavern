// src/lib/api/client.ts
//
// Same-origin fetch wrapper with 401→refresh→retry and ApiError normalisation.
// Zero external dependencies.

import type { ApiError, ApiResult } from './types';
import { refreshesOn401 } from '@/lib/auth/authRoutes';
import * as authApi from './auth';

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

// ── Session refresh: ONE single-flight owner (HUNT1020-21/-25) ─────────────────────────────────────
//
// refreshSession() is the only caller of the raw `authApi.refresh` transport. apiFetch's 401 branch,
// AuthProvider's silent refresh, its context refresh() and retryAuth() all go through it, so two
// writers can never both present the same refresh token (the upstream rotates on use and answers 401 to
// a reused one, which used to read as "session expired"), and runSignOut() below can wait for the one
// request that may still be rotating the jar before it sends the logout.
//
// TAV-AUTH-DEADBACKEND-AS-DEADSESSION: the outcome carries the REAL HTTP status (+ parsed body) beside
// `ok`: callers must tell "the endpoint rejected this session" from "the endpoint (or the network) is
// unavailable right now", and a 429's `retry_after` must survive to the throw.
export interface RefreshOutcome {
  ok: boolean;
  status: number;
  body: unknown;
}

/** The shared request's own bound. A caller's timeout/abort never reaches it (see refreshSession). */
const REFRESH_TIMEOUT_MS = 10_000;
/** How long a refresh waits for another tab to finish ITS refresh (the lock holder has the same bound). */
const REFRESH_LOCK_WAIT_MS = 15_000;
/** How long logout waits for this tab's in-flight refresh before sending the revoke anyway. */
const SIGN_OUT_REFRESH_WAIT_MS = 6_000;
/** How long logout waits for another tab's refresh (the `st-refresh` lock) before sending anyway. */
const SIGN_OUT_LOCK_WAIT_MS = 3_000;
const REFRESH_LOCK_NAME = 'st-refresh';

const NO_ANSWER: RefreshOutcome = { ok: false, status: 0, body: undefined };
/** Handed out while a sign-out is running: no fetch was made. Classifies as a rejected session. */
const SIGNED_OUT: RefreshOutcome = { ok: false, status: 401, body: { error: 'signed_out' } };

let refreshInFlight: Promise<RefreshOutcome> | null = null;
/** Number of sign-outs currently running (a counter: logout and a retry may overlap). */
let signOutDepth = 0;

/** status 0 / >=500 / 429 = the auth backend is unavailable, not "this session is dead". */
function isUnavailable(status: number): boolean {
  return status === 0 || status >= 500 || status === 429;
}

// debt: tabs without navigator.locks (old Safari, some webviews) get in-tab single-flight only, so two
// such tabs can still race one rotation; the 401-then-/api/auth/me re-check absorbs the loser's 401.
// ceiling: a stale-cookie race window of one refresh round-trip per tab pair. until: every supported
// browser ships navigator.locks.
function locksApi(): LockManager | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

/** True iff /api/auth/me answers with a user. `_retried`: a 401 here must never start a refresh. */
async function sessionIsLive(): Promise<boolean> {
  try {
    const data = await apiFetch<{ user?: unknown }>('/api/auth/me', {
      method: 'GET',
      _retried: true,
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    return !!data && typeof data === 'object' && !!data.user;
  } catch {
    return false;
  }
}

async function runRefresh(): Promise<RefreshOutcome> {
  const locks = locksApi();
  const exec = async (): Promise<RefreshOutcome> => {
    // Sign-out began while this refresh waited for the lock: do not start the request.
    if (signOutDepth > 0) return SIGNED_OUT;
    // Another tab may have rotated while we waited: if the (cached, per-token) /me is fine, we are done.
    // Without the lock there is no "waited", so this check only runs inside it. When there is no
    // st_access cookie the BFF answers 401 without an upstream call, so it costs nothing then.
    if (locks && (await sessionIsLive())) return { ok: true, status: 200, body: undefined };
    let outcome: RefreshOutcome;
    try {
      const body = await authApi.refresh(AbortSignal.timeout(REFRESH_TIMEOUT_MS));
      outcome = { ok: true, status: 200, body };
    } catch (e) {
      const { status, code, body } = (e as Partial<ApiError>) ?? {};
      if (code === 'invalid_response') {
        // 2xx with an unreadable body: not the BFF's JSON, so no usable answer (could be an intermediary).
        // Same class as AuthProvider.classifyAuthError gives it: unavailable, retry, not "signed out".
        outcome = NO_ANSWER;
      } else {
        outcome = { ok: false, status: typeof status === 'number' ? status : 0, body };
      }
    }
    // A definitive rejection while /me is fine means another tab won the rotation (the presented token
    // was already spent) and this browser holds a live session: success, not "expired".
    if (!outcome.ok && !isUnavailable(outcome.status) && (await sessionIsLive())) {
      return { ok: true, status: 200, body: undefined };
    }
    return outcome;
  };
  if (!locks) return exec();
  try {
    return await locks.request(
      REFRESH_LOCK_NAME,
      { signal: AbortSignal.timeout(REFRESH_LOCK_WAIT_MS) },
      exec,
    );
  } catch {
    return NO_ANSWER; // lock wait timed out (another tab hung) or the lock API threw
  }
}

/** Resolve with `promise`, or with NO_ANSWER as soon as the CALLER's signal aborts (the shared work goes on). */
function raceSignal(promise: Promise<RefreshOutcome>, signal?: AbortSignal): Promise<RefreshOutcome> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(NO_ANSWER);
  return new Promise((resolve) => {
    const onAbort = () => resolve(NO_ANSWER);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then((v) => {
      signal.removeEventListener('abort', onAbort);
      resolve(v);
    });
  });
}

/**
 * THE session refresh. Never rejects; resolves a RefreshOutcome (status 0 = no answer).
 *   - single flight per tab; concurrent callers share one request;
 *   - across tabs (navigator.locks): serialised on 'st-refresh', with a /api/auth/me re-check first;
 *   - refused (no fetch) while a sign-out is running;
 *   - `opts.signal` only bounds THIS caller's wait. It never aborts the shared request, which keeps
 *     its own REFRESH_TIMEOUT_MS, because other waiters depend on it.
 */
export function refreshSession(opts: { signal?: AbortSignal } = {}): Promise<RefreshOutcome> {
  if (signOutDepth > 0) return Promise.resolve(SIGNED_OUT);
  if (!refreshInFlight) {
    refreshInFlight = runRefresh()
      .catch(() => NO_ANSWER)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return raceSignal(refreshInFlight, opts.signal);
}

/** Test seam: forget any in-flight refresh / sign-out (a test's never-resolving mock would leak into the next). */
export function resetRefreshSessionForTests(): void {
  refreshInFlight = null;
  signOutDepth = 0;
}

/** The ApiError a failed RefreshOutcome becomes (same classification the old inline code carried). */
export function refreshFailureError(r: RefreshOutcome): ApiError {
  return makeApiError(r.status, isUnavailable(r.status) ? 'refresh_unavailable' : 'unauthorized', r.body);
}

/**
 * Run `send` (the logout request) as a sign-out: from this call on refreshSession() starts nothing;
 * any refresh already in flight in this tab is awaited first (bounded), then the `st-refresh` lock is
 * taken (bounded) so another tab's refresh cannot rotate or Set-Cookie around the revoke. The point:
 * the request carries the refresh token the jar holds AFTER any rotation, and no refresh Set-Cookie can
 * land after the clearing one. If a bound expires the revoke is sent anyway (a stuck refresh must not
 * trap the user in a signed-in state); a refresh that outlives its bound could then still land late.
 */
export async function runSignOut<T>(send: () => Promise<T>): Promise<T> {
  signOutDepth += 1; // synchronous: nothing can start a refresh between this call and the revoke
  try {
    const pending = refreshInFlight;
    if (pending) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        pending,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, SIGN_OUT_REFRESH_WAIT_MS);
        }),
      ]);
      clearTimeout(timer);
    }
    const locks = locksApi();
    if (!locks) return await send();
    let granted = false;
    try {
      return await locks.request(
        REFRESH_LOCK_NAME,
        { signal: AbortSignal.timeout(SIGN_OUT_LOCK_WAIT_MS) },
        () => {
          granted = true;
          return send();
        },
      );
    } catch (e) {
      if (granted) throw e; // `send` itself failed: not a lock problem
      return await send(); // lock wait timed out: proceed unserialised
    }
  } finally {
    signOutDepth -= 1;
  }
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
 *   4. On 401 (and not already retried and authRoutes.refreshesOn401(path)):
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
 *   6. On network/abort: throw ApiError {status: 0, code: 'network'|'abort'|'timeout'}.
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
    // AbortSignal.timeout() rejects with TimeoutError: a deadline passed, not a dropped connection.
    // Callers that log or word a failure can now tell the two apart.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw makeApiError(0, 'timeout');
    }
    throw makeApiError(0, 'network');
  }

  // 401 → attempt refresh once, then retry
  if (res.status === 401 && !_retried && refreshesOn401(path)) {
    const refreshResult = await refreshSession();

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
    throw refreshFailureError(refreshResult);
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
