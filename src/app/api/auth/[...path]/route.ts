/**
 * Auth BFF — /api/auth/[...path]
 *
 * Single catch-all route that proxies auth operations to Authentication-Python,
 * translating Bearer tokens to/from httpOnly cookies so the browser never
 * touches tokens directly.
 *
 * Allowed paths: register | login | login/verify-2fa | refresh | me | logout
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
    const retryAfter = res.headers.get('retry-after');
    const headers: HeadersInit = retryAfter ? { 'Retry-After': retryAfter } : {};
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers });
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
    const retryAfter = res.headers.get('retry-after');
    const headers: HeadersInit = retryAfter ? { 'Retry-After': retryAfter } : {};
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers });
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
    const retryAfter = res.headers.get('retry-after');
    const headers: HeadersInit = retryAfter ? { 'Retry-After': retryAfter } : {};
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers });
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
    const retryAfter = res.headers.get('retry-after');
    const headers: HeadersInit = retryAfter ? { 'Retry-After': retryAfter } : {};
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers });
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
    const retryAfter = res.headers.get('retry-after');
    const headers: HeadersInit = retryAfter ? { 'Retry-After': retryAfter } : {};
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers });
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
// Dispatch
// ---------------------------------------------------------------------------

const ALLOWED_POST_PATHS = new Set([
  'register',
  'login',
  'login/verify-2fa',
  'refresh',
  'logout',
]);

async function dispatch(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params;
  const joined = path.join('/');

  if (req.method === 'GET' && joined === 'me') {
    return handleMe(req);
  }

  if (req.method === 'POST') {
    if (joined === 'register')       return handleRegister(req);
    if (joined === 'login')          return handleLogin(req);
    if (joined === 'login/verify-2fa') return handleVerify2FA(req);
    if (joined === 'refresh')        return handleRefresh(req);
    if (joined === 'logout')         return handleLogout(req);
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
