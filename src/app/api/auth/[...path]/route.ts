/**
 * Auth BFF — /api/auth/[...path]
 *
 * Single catch-all route that proxies auth operations to Authentication-Python,
 * translating Bearer tokens to/from httpOnly cookies so the browser never
 * touches tokens directly.
 *
 * Allowed paths: register | login | login/verify-2fa | refresh | me | logout |
 *                registration-mode | password-policy | password/change |
 *                request-password-reset | reset-password
 * Everything else returns 404.
 *
 * Security guarantees:
 *   - Never forwards the browser's Cookie header upstream.
 *   - Never copies upstream Set-Cookie back to browser.
 *   - Response bodies to the browser are built from an explicit ALLOW-LIST of
 *     safe keys (user/msg/error/requires_2fa/…), so any token-shaped field the
 *     upstream adds in future (access_token, refresh_token, partial_token,
 *     csrf_*_token, recovery codes, …) is dropped by default rather than leaked.
 *   - Forwards upstream 429 + Retry-After unchanged.
 */
import { NextRequest, NextResponse } from 'next/server';

import { env } from '@/lib/env';
import {
  setAccess,
  setRefresh,
  setPartial,
  clearAll,
  readAccess,
  readRefresh,
  readPartial,
} from '@/lib/auth/cookies';

type Ctx = { params: Promise<{ path: string[] }> };

// ---------------------------------------------------------------------------
// Upstream fetch helper
// ---------------------------------------------------------------------------

interface UpstreamResult {
  res: Response | null;
  durationMs: number;
}

async function fetchUpstream(
  upstreamPath: string,
  init: RequestInit,
  timeoutMs?: number,
): Promise<UpstreamResult> {
  const start = Date.now();
  let controller: AbortController | undefined;
  let signal = init.signal as AbortSignal | undefined;

  if (timeoutMs !== undefined) {
    controller = new AbortController();
    signal = controller.signal;
    setTimeout(() => controller!.abort(), timeoutMs);
  }

  try {
    const res = await fetch(`${env.AUTH_API_URL}/${upstreamPath}`, {
      ...init,
      signal,
    });
    return { res, durationMs: Date.now() - start };
  } catch {
    return { res: null, durationMs: Date.now() - start };
  }
}

/**
 * Build a 429 response from an upstream rate-limited reply. Forwards the
 * upstream Retry-After header AND mirrors its parsed value into the JSON body as
 * `retry_after` (seconds) — the client reads the body (ApiError.body), not the
 * raw headers, so without this the login countdown always falls back to 60s.
 */
function rateLimited(res: Response): NextResponse {
  const retryAfter = res.headers.get('retry-after');
  const headers: HeadersInit = retryAfter ? { 'Retry-After': retryAfter } : {};
  const parsed = retryAfter ? Number.parseInt(retryAfter, 10) : NaN;
  const body =
    Number.isFinite(parsed) && parsed >= 0
      ? { error: 'rate_limited', retry_after: parsed }
      : { error: 'rate_limited' };
  return NextResponse.json(body, { status: 429, headers });
}

// ---------------------------------------------------------------------------
// Body helpers
// ---------------------------------------------------------------------------

/**
 * Allow-list of top-level keys that may be relayed from an upstream auth
 * response to the browser. Anything not in this set (notably any token- or
 * credential-shaped field) is dropped. Safe-by-default: adding a new field
 * upstream cannot leak to client JS unless it is explicitly added here.
 */
const SAFE_BODY_KEYS = new Set<string>([
  'user',          // the public user object (id/username/email/roles/permissions)
  'msg',           // human-readable status (Auth-Python convention)
  'error',         // error code/message
  'error_code',    // structured error identifier, when present
  'errors',        // field-level validation errors, when present
  'requires_2fa',  // login → 2FA branch flag
]);

/**
 * Allow-list for `GET auth/password-policy`. Its keys are pure public config
 * and are deliberately NOT in `SAFE_BODY_KEYS` (which describes auth
 * responses), so this route projects through its own set — same safe-by-
 * default posture, scoped to the one endpoint.
 */
const POLICY_BODY_KEYS = [
  'min_length',
  'max_length',
  'require_uppercase',
  'require_lowercase',
  'require_digit',
  'require_special',
  'history_depth',
] as const;

/**
 * Parse upstream JSON response; return an allow-listed safe body plus the raw
 * token fields (extracted separately, for cookie-setting only — never relayed).
 */
async function parseUpstreamBody(res: Response): Promise<{
  body: Record<string, unknown>;
  accessToken: string | null;
  refreshToken: string | null;
  partialToken: string | null;
}> {
  let raw: Record<string, unknown> = {};
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON body — empty object is fine
  }

  const accessToken =
    typeof raw['access_token'] === 'string' ? raw['access_token'] : null;
  const refreshToken =
    typeof raw['refresh_token'] === 'string' ? raw['refresh_token'] : null;
  const partialToken =
    typeof raw['partial_token'] === 'string' ? raw['partial_token'] : null;

  // Build the browser-facing body from the allow-list only.
  const safeBody: Record<string, unknown> = {};
  for (const key of SAFE_BODY_KEYS) {
    if (key in raw) safeBody[key] = raw[key];
  }

  return { body: safeBody, accessToken, refreshToken, partialToken };
}

// ---------------------------------------------------------------------------
// Route handlers per path
// ---------------------------------------------------------------------------

async function handleRegister(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();
  const { res, durationMs } = await fetchUpstream('auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res) {
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
  }

  if (res.status === 429) {
    return rateLimited(res);
  }

  const { body: safeBody } = await parseUpstreamBody(res);

  if (!res.ok) {
    console.warn('[auth-bff] register upstream error', { upstreamStatus: res.status, durationMs, path: 'register' });
    return NextResponse.json(safeBody, { status: res.status });
  }

  return NextResponse.json(safeBody, { status: res.status });
}

async function handleLogin(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();
  const { res, durationMs } = await fetchUpstream('auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res) {
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
  }

  if (res.status === 429) {
    return rateLimited(res);
  }

  const { body: safeBody, accessToken, refreshToken, partialToken } =
    await parseUpstreamBody(res);

  if (!res.ok) {
    console.warn('[auth-bff] login upstream error', { upstreamStatus: res.status, durationMs, path: 'login' });
    return NextResponse.json(safeBody, { status: res.status });
  }

  const response = NextResponse.json(
    partialToken
      ? { kind: '2fa' }
      : { kind: 'ok', user: safeBody['user'] ?? safeBody },
    { status: res.status },
  );

  if (partialToken) {
    // 2FA required — set only the partial cookie
    setPartial(response.cookies, partialToken);
  } else if (accessToken && refreshToken) {
    setAccess(response.cookies, accessToken);
    setRefresh(response.cookies, refreshToken);
  } else if (accessToken) {
    setAccess(response.cookies, accessToken);
  }

  return response;
}

async function handleVerify2FA(req: NextRequest): Promise<NextResponse> {
  const partial = readPartial(req.cookies);
  if (!partial) {
    return NextResponse.json({ error: 'no_partial_session' }, { status: 401 });
  }

  const body = await req.text();
  const { res, durationMs } = await fetchUpstream('auth/login/verify-2fa', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${partial}`,
    },
    body,
  });

  if (!res) {
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
  }

  if (res.status === 429) {
    return rateLimited(res);
  }

  const { body: safeBody, accessToken, refreshToken } = await parseUpstreamBody(res);

  if (!res.ok) {
    console.warn('[auth-bff] verify-2fa upstream error', { upstreamStatus: res.status, durationMs, path: 'login/verify-2fa' });
    return NextResponse.json(safeBody, { status: res.status });
  }

  const response = NextResponse.json(
    { kind: 'ok', user: safeBody['user'] ?? safeBody },
    { status: res.status },
  );

  // Clear partial, set full session
  setPartial(response.cookies, null);
  if (accessToken) setAccess(response.cookies, accessToken);
  if (refreshToken) setRefresh(response.cookies, refreshToken);

  return response;
}

async function handleRefresh(req: NextRequest): Promise<NextResponse> {
  const refreshToken = readRefresh(req.cookies);
  if (!refreshToken) {
    return NextResponse.json({ error: 'no_refresh_token' }, { status: 401 });
  }

  const { res, durationMs } = await fetchUpstream('auth/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${refreshToken}`,
    },
  });

  if (!res) {
    console.warn('[auth-bff] refresh upstream unavailable', { durationMs, path: 'refresh' });
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
  }

  if (res.status === 429) {
    return rateLimited(res);
  }

  const { accessToken: newAccess, refreshToken: newRefresh } = await parseUpstreamBody(res);

  if (!res.ok) {
    console.warn('[auth-bff] refresh upstream error', { upstreamStatus: res.status, durationMs, path: 'refresh' });
    return NextResponse.json({ error: 'refresh_failed' }, { status: res.status });
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });

  if (newAccess) setAccess(response.cookies, newAccess);
  if (newRefresh) setRefresh(response.cookies, newRefresh);

  return response;
}

async function handleMe(req: NextRequest): Promise<NextResponse> {
  const access = readAccess(req.cookies);
  if (!access) {
    return NextResponse.json({ error: 'no_access_token' }, { status: 401 });
  }

  const { res, durationMs } = await fetchUpstream('auth/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${access}` },
  });

  if (!res) {
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
  }

  if (res.status === 429) {
    return rateLimited(res);
  }

  const { body: safeBody } = await parseUpstreamBody(res);

  if (!res.ok) {
    console.warn('[auth-bff] me upstream error', { upstreamStatus: res.status, durationMs, path: 'me' });
    return NextResponse.json(safeBody, { status: res.status });
  }

  return NextResponse.json(safeBody, { status: res.status });
}

async function handleLogout(req: NextRequest): Promise<NextResponse> {
  // §2.7.3 Logout safety: always clears cookies + returns 200,
  // regardless of upstream outcome.
  //
  // Upstream /auth/logout is `@jwt_required(refresh=True)` — it revokes the
  // refresh-token row keyed by the REFRESH jti and blocks the linked access
  // session. So we must authenticate the upstream call with the REFRESH token,
  // not the access token; sending the access token would 422 and leave the
  // server-side session alive for its full 7-day window.
  const refresh = readRefresh(req.cookies);

  // Best-effort upstream call with 2s timeout — swallow all errors
  if (refresh) {
    await fetchUpstream('auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${refresh}` },
    }, 2000);
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
  clearAll(response.cookies);
  return response;
}

// ---------------------------------------------------------------------------
// Registration mode (public)
// ---------------------------------------------------------------------------

async function handleRegistrationMode(): Promise<NextResponse> {
  const { res } = await fetchUpstream('auth/registration-mode', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res) {
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
  }

  let raw: Record<string, unknown> = {};
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON — fall through
  }

  // Relay the full upstream body (mode, signup_enabled, requires_invite_code,
  // requires_approval, message). None of these are sensitive.
  return NextResponse.json(raw, { status: res.status });
}

/**
 * POST auth/password/change — AUTHENTICATED. Body `{current_password,
 * new_password}`.
 *
 * Upstream REVOKES EVERY SESSION on success (Auth-Python's own documented
 * behaviour), so the cookies this BFF holds are dead the moment it returns
 * 200. We clear them here rather than leaving the browser holding tokens the
 * server has already invalidated — otherwise the next call 401s from a
 * seemingly logged-in UI.
 */
async function handlePasswordChange(req: NextRequest): Promise<NextResponse> {
  const access = readAccess(req.cookies);
  if (!access) {
    return NextResponse.json({ error: 'no_access_token' }, { status: 401 });
  }
  const payload = await req.text();
  const { res, durationMs } = await fetchUpstream('auth/password/change', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access}`,
    },
    body: payload,
  });
  if (!res) {
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
  }
  if (res.status === 429) return rateLimited(res);

  const { body: safeBody } = await parseUpstreamBody(res);
  if (!res.ok) {
    console.warn('[auth-bff] password/change upstream error', {
      upstreamStatus: res.status,
      durationMs,
    });
    return NextResponse.json(safeBody, { status: res.status });
  }
  const out = NextResponse.json(safeBody, { status: res.status });
  clearAll(out.cookies); // every session was just revoked upstream
  return out;
}

/**
 * POST auth/request-password-reset — PUBLIC. Body `{email}`.
 *
 * Upstream ALWAYS answers 200 regardless of whether the address exists, to
 * prevent account enumeration. This relay must preserve that: never branch on
 * the outcome, never add a "no such user" path, and never log the email.
 */
async function handleRequestPasswordReset(req: NextRequest): Promise<NextResponse> {
  const payload = await req.text();
  const { res, durationMs } = await fetchUpstream('auth/request-password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  if (!res) {
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
  }
  if (res.status === 429) return rateLimited(res);
  const { body: safeBody } = await parseUpstreamBody(res);
  if (!res.ok) {
    console.warn('[auth-bff] request-password-reset upstream error', {
      upstreamStatus: res.status,
      durationMs,
    });
  }
  return NextResponse.json(safeBody, { status: res.status });
}

/**
 * POST auth/reset-password — PUBLIC. Body `{token, password}`.
 *
 * The token comes from the emailed link, so this is deliberately reachable
 * without a session. Upstream returns `{msg, errors[]}` on a complexity
 * failure and `errors` is already in SAFE_BODY_KEYS, so the field-level
 * messages reach the form intact.
 */
async function handleResetPassword(req: NextRequest): Promise<NextResponse> {
  const payload = await req.text();
  const { res, durationMs } = await fetchUpstream('auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  if (!res) {
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
  }
  if (res.status === 429) return rateLimited(res);
  const { body: safeBody } = await parseUpstreamBody(res);
  if (!res.ok) {
    console.warn('[auth-bff] reset-password upstream error', {
      upstreamStatus: res.status,
      durationMs,
    });
  }
  return NextResponse.json(safeBody, { status: res.status });
}

/**
 * GET auth/password-policy — PUBLIC, no secrets. Relayed so the forms can show
 * the LIVE complexity rules instead of duplicating them client-side and
 * drifting from the server that actually enforces them.
 *
 * Its response keys (`min_length`, `require_digit`, ...) are NOT in
 * SAFE_BODY_KEYS, so this deliberately bypasses `parseUpstreamBody` and
 * forwards the validated shape directly. Safe: the endpoint is public,
 * carries no user data and no credentials.
 */
async function handlePasswordPolicy(): Promise<NextResponse> {
  const { res } = await fetchUpstream('auth/password-policy', { method: 'GET' });
  if (!res) {
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
  }
  if (res.status === 429) return rateLimited(res);
  let raw: Record<string, unknown> = {};
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON — fall through with {} */
  }
  // Projected through its OWN allow-list rather than forwarded raw (Kuro-Sec
  // finding 2). Forwarding raw was safe for today's body, but it silently
  // voided this file's headline guarantee — "any token-shaped field the
  // upstream adds in future is dropped by default" — for one route, and the
  // next reader would have trusted that comment. Safe-by-default restored.
  const body: Record<string, unknown> = {};
  for (const k of POLICY_BODY_KEYS) {
    if (k in raw) body[k] = raw[k];
  }
  return NextResponse.json(body, { status: res.status });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function dispatch(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params;
  const joined = path.join('/');

  if (req.method === 'GET' && joined === 'me') {
    return handleMe(req);
  }

  if (req.method === 'GET' && joined === 'registration-mode') {
    return handleRegistrationMode();
  }

  if (req.method === 'GET' && joined === 'password-policy') {
    return handlePasswordPolicy();
  }

  if (req.method === 'POST') {
    if (joined === 'register')       return handleRegister(req);
    if (joined === 'login')          return handleLogin(req);
    if (joined === 'login/verify-2fa') return handleVerify2FA(req);
    if (joined === 'refresh')        return handleRefresh(req);
    if (joined === 'logout')         return handleLogout(req);
    // Password self-service (AUTH-PASSWORD-SELF-SERVICE). All four upstream
    // endpoints already existed; nothing could reach them because this
    // allow-list is strict-deny and they were never added.
    if (joined === 'password/change')         return handlePasswordChange(req);
    if (joined === 'request-password-reset')  return handleRequestPasswordReset(req);
    if (joined === 'reset-password')          return handleResetPassword(req);
  }

  // Unknown path or wrong method
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return dispatch(req, ctx);
}

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return dispatch(req, ctx);
}
