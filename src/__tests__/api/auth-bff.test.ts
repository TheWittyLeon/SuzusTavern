/**
 * @jest-environment node
 *
 * Tests for src/app/api/auth/[...path]/route.ts (auth BFF)
 *
 * Covers:
 *   - login-ok sets st_access + st_refresh
 *   - login-2fa sets st_partial only
 *   - verify-2fa swaps partial → access + refresh
 *   - refresh sets new st_access + rotates st_refresh when present
 *   - logout always clears cookies + returns 200 even if upstream throws
 *   - unknown path → 404
 *   - upstream 429 forwards Retry-After
 *
 * Does NOT assert on httpOnly cookie values from JS — inspects NextResponse.cookies
 * (route-handler environment has access to the response cookie jar).
 */

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();

// Mock server-only (imported by cookies.ts)
jest.mock('server-only', () => ({}));

// Mock env
jest.mock('../../lib/env', () => ({
  env: {
    AUTH_API_URL: 'http://auth:5000',
    NEKANOVA_URL: 'http://neko:8080',
    IS_PROD: false,
    PUBLIC_AUTH_URL: null,
  },
}));

beforeAll(() => {
  (global as Record<string, unknown>).fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

// Import after mocks are in place
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST, GET } = require('../../app/api/auth/[...path]/route') as {
  POST: (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => Promise<import('next/server').NextResponse>;
  GET:  (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => Promise<import('next/server').NextResponse>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

function makePostRequest(
  url: string,
  body: Record<string, unknown>,
  cookieHeader?: string,
): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (cookieHeader) headers.set('cookie', cookieHeader);
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function makeGetRequest(url: string, cookieHeader?: string): NextRequest {
  const headers = new Headers();
  if (cookieHeader) headers.set('cookie', cookieHeader);
  return new NextRequest(url, { method: 'GET', headers });
}

function upstreamJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// login — success path
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  it('sets st_access and st_refresh on successful login', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({
        user: { id: 1, username: 'alice', email: null },
        access_token: 'at-value',
        refresh_token: 'rt-value',
      }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/login',
      { username: 'alice', password: 'secret' },
    );
    const res = await POST(req, makeCtx(['login']));

    expect(res.status).toBe(200);

    const body = await res.json() as { kind: string };
    expect(body.kind).toBe('ok');

    // Inspect cookies on the response — not via JS-visible document.cookie
    const accessCookie = res.cookies.get('st_access');
    const refreshCookie = res.cookies.get('st_refresh');
    expect(accessCookie?.value).toBe('at-value');
    expect(refreshCookie?.value).toBe('rt-value');

    // Partial cookie must NOT be set
    const partialCookie = res.cookies.get('st_partial');
    expect(partialCookie).toBeUndefined();
  });

  it('returns {kind:"ok"} and does NOT expose raw tokens in the body', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({
        user: { id: 1, username: 'alice', email: null },
        access_token: 'at-value',
        refresh_token: 'rt-value',
      }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/login',
      { username: 'alice', password: 'secret' },
    );
    const res = await POST(req, makeCtx(['login']));
    const body = await res.json() as Record<string, unknown>;

    expect(body['access_token']).toBeUndefined();
    expect(body['refresh_token']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// login — 2FA path
// ---------------------------------------------------------------------------

describe('POST /api/auth/login (2FA)', () => {
  it('sets only st_partial cookie and returns {kind:"2fa"} when upstream requires 2FA', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({
        partial_token: 'pt-value',
        requires_2fa: true,
      }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/login',
      { username: 'alice', password: 'secret' },
    );
    const res = await POST(req, makeCtx(['login']));

    expect(res.status).toBe(200);
    const body = await res.json() as { kind: string };
    expect(body.kind).toBe('2fa');

    const partialCookie = res.cookies.get('st_partial');
    expect(partialCookie?.value).toBe('pt-value');

    // Access/refresh must NOT be set
    expect(res.cookies.get('st_access')).toBeUndefined();
    expect(res.cookies.get('st_refresh')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// login/verify-2fa
// ---------------------------------------------------------------------------

describe('POST /api/auth/login/verify-2fa', () => {
  it('swaps partial cookie for access+refresh and clears partial', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({
        user: { id: 1, username: 'alice', email: null },
        access_token: 'new-at',
        refresh_token: 'new-rt',
      }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/login/verify-2fa',
      { totp_code: '123456' },
      'st_partial=pt-value',
    );
    const res = await POST(req, makeCtx(['login', 'verify-2fa']));

    expect(res.status).toBe(200);
    const body = await res.json() as { kind: string };
    expect(body.kind).toBe('ok');

    expect(res.cookies.get('st_access')?.value).toBe('new-at');
    expect(res.cookies.get('st_refresh')?.value).toBe('new-rt');
    // Partial should be cleared (cookie deleted)
    const partial = res.cookies.get('st_partial');
    // After clearance, the cookie is deleted — it won't appear with a value
    expect(partial?.value).toBeFalsy();
  });

  it('returns 401 when no st_partial cookie is present', async () => {
    const req = makePostRequest(
      'http://localhost:3000/api/auth/login/verify-2fa',
      { totp_code: '123456' },
    );
    const res = await POST(req, makeCtx(['login', 'verify-2fa']));
    expect(res.status).toBe(401);
    // Upstream should NOT have been called
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// refresh
// ---------------------------------------------------------------------------

describe('POST /api/auth/refresh', () => {
  it('sets new st_access when upstream returns access_token', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({ access_token: 'fresh-at' }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/refresh',
      {},
      'st_refresh=old-rt',
    );
    const res = await POST(req, makeCtx(['refresh']));

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    expect(res.cookies.get('st_access')?.value).toBe('fresh-at');
  });

  it('rotates st_refresh when upstream includes a new refresh_token', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({ access_token: 'fresh-at', refresh_token: 'rotated-rt' }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/refresh',
      {},
      'st_refresh=old-rt',
    );
    const res = await POST(req, makeCtx(['refresh']));

    expect(res.cookies.get('st_access')?.value).toBe('fresh-at');
    expect(res.cookies.get('st_refresh')?.value).toBe('rotated-rt');
  });

  it('returns 401 when no st_refresh cookie present', async () => {
    const req = makePostRequest('http://localhost:3000/api/auth/refresh', {});
    const res = await POST(req, makeCtx(['refresh']));
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe('POST /api/auth/logout', () => {
  it('always returns 200 and clears all cookies even if upstream throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('upstream down'));

    const req = makePostRequest(
      'http://localhost:3000/api/auth/logout',
      {},
      'st_access=old-at; st_refresh=old-rt',
    );
    const res = await POST(req, makeCtx(['logout']));

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 200 and clears cookies even when upstream returns 5xx', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/logout',
      {},
      'st_access=old-at',
    );
    const res = await POST(req, makeCtx(['logout']));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// me
// ---------------------------------------------------------------------------

describe('GET /api/auth/me', () => {
  it('returns user from upstream', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({ user: { id: 1, username: 'alice', email: null } }),
    );

    const req = makeGetRequest(
      'http://localhost:3000/api/auth/me',
      'st_access=valid-at',
    );
    const res = await GET(req, makeCtx(['me']));

    expect(res.status).toBe(200);
    const body = await res.json() as { user: { username: string } };
    expect(body.user.username).toBe('alice');
  });

  it('returns 401 when no st_access cookie present', async () => {
    const req = makeGetRequest('http://localhost:3000/api/auth/me');
    const res = await GET(req, makeCtx(['me']));
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Unknown path
// ---------------------------------------------------------------------------

describe('Unknown path → 404', () => {
  it('returns 404 for an unrecognised POST path', async () => {
    const req = makePostRequest('http://localhost:3000/api/auth/admin', {});
    const res = await POST(req, makeCtx(['admin']));
    expect(res.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 404 for a GET to a non-me path', async () => {
    const req = makeGetRequest('http://localhost:3000/api/auth/sessions');
    const res = await GET(req, makeCtx(['sessions']));
    expect(res.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 429 forwarding
// ---------------------------------------------------------------------------

describe('Upstream 429 forwarding', () => {
  it('forwards 429 status and Retry-After header from upstream', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '60',
        },
      }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/login',
      { username: 'alice', password: 'secret' },
    );
    const res = await POST(req, makeCtx(['login']));

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });
});

// ---------------------------------------------------------------------------
// 429 forwarding — without Retry-After header (branch: retryAfter ? ... : {})
// These cover each handler's ternary for missing Retry-After.
// ---------------------------------------------------------------------------

describe('Upstream 429 without Retry-After header', () => {
  it('register: 429 with no Retry-After still returns 429', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
        // no retry-after header
      }),
    );
    const req = makePostRequest('http://localhost:3000/api/auth/register', { username: 'x', password: 'y' });
    const res = await POST(req, makeCtx(['register']));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeNull();
  });

  it('login: 429 with no Retry-After still returns 429', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const req = makePostRequest('http://localhost:3000/api/auth/login', { username: 'alice', password: 'secret' });
    const res = await POST(req, makeCtx(['login']));
    expect(res.status).toBe(429);
  });

  it('verify-2fa: 429 with no Retry-After still returns 429', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const req = makePostRequest(
      'http://localhost:3000/api/auth/login/verify-2fa',
      { totp_code: '000000' },
      'st_partial=pt-value',
    );
    const res = await POST(req, makeCtx(['login', 'verify-2fa']));
    expect(res.status).toBe(429);
  });

  it('refresh: 429 with no Retry-After still returns 429', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const req = makePostRequest('http://localhost:3000/api/auth/refresh', {}, 'st_refresh=old-rt');
    const res = await POST(req, makeCtx(['refresh']));
    expect(res.status).toBe(429);
  });

  it('me: 429 with no Retry-After still returns 429', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const req = makeGetRequest('http://localhost:3000/api/auth/me', 'st_access=valid-at');
    const res = await GET(req, makeCtx(['me']));
    expect(res.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

describe('POST /api/auth/register', () => {
  it('returns user on successful registration (201)', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({ user: { id: 2, username: 'bob', email: 'bob@x.com' } }, 201),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/register',
      { username: 'bob', password: 'pass' },
    );
    const res = await POST(req, makeCtx(['register']));

    expect(res.status).toBe(201);
    const body = await res.json() as { user: { username: string } };
    expect(body.user.username).toBe('bob');
    // Raw tokens must not appear (register doesn't return them, but belt-and-braces)
    expect(body).not.toHaveProperty('access_token');
    expect(body).not.toHaveProperty('refresh_token');
  });

  it('returns 502 when upstream is unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const req = makePostRequest(
      'http://localhost:3000/api/auth/register',
      { username: 'bob', password: 'pass' },
    );
    const res = await POST(req, makeCtx(['register']));
    expect(res.status).toBe(502);
  });

  it('forwards 429 from register endpoint', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '30' },
      }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/register',
      { username: 'bob', password: 'pass' },
    );
    const res = await POST(req, makeCtx(['register']));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
  });

  it('passes through upstream 422 with safe body', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({ error: 'username_taken' }, 422),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/register',
      { username: 'bob', password: 'pass' },
    );
    const res = await POST(req, makeCtx(['register']));
    expect(res.status).toBe(422);
  });

  it('handles non-JSON body from upstream gracefully on register', async () => {
    // Upstream returns plain text — parseUpstreamBody's json() catch fires
    mockFetch.mockResolvedValueOnce(
      new Response('Internal Server Error', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/register',
      { username: 'bob', password: 'pass' },
    );
    const res = await POST(req, makeCtx(['register']));
    // Should still propagate the upstream status, not throw
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// login — edge cases
// ---------------------------------------------------------------------------

describe('POST /api/auth/login — edge cases', () => {
  it('returns 502 when upstream is unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const req = makePostRequest(
      'http://localhost:3000/api/auth/login',
      { username: 'alice', password: 'secret' },
    );
    const res = await POST(req, makeCtx(['login']));
    expect(res.status).toBe(502);
  });

  it('passes through 401 from upstream (bad credentials)', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({ error: 'invalid_credentials' }, 401),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/login',
      { username: 'alice', password: 'wrong' },
    );
    const res = await POST(req, makeCtx(['login']));
    expect(res.status).toBe(401);
  });

  it('does NOT expose partial_token in the login response body', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({
        partial_token: 'pt-secret',
        requires_2fa: true,
      }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/login',
      { username: 'alice', password: 'secret' },
    );
    const res = await POST(req, makeCtx(['login']));
    const body = await res.json() as Record<string, unknown>;
    expect(body['partial_token']).toBeUndefined();
    expect(body['kind']).toBe('2fa');
  });

  it('falls back to the allow-listed safe body as user when "user" key is absent from login response', async () => {
    // Upstream returns tokens + un-allow-listed fields without a {user: ...} wrapper.
    // safeBody['user'] is undefined → falls back to safeBody, which the allow-list
    // has stripped down to nothing (id/username/email are NOT allow-listed top-level,
    // and tokens are never relayed). The security property is what matters here:
    // tokens never reach the browser and cookies are still set.
    mockFetch.mockResolvedValueOnce(
      upstreamJson({
        id: 99,
        username: 'carol',
        email: 'carol@x.com',
        access_token: 'at-value',
        refresh_token: 'rt-value',
      }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/login',
      { username: 'carol', password: 'secret' },
    );
    const res = await POST(req, makeCtx(['login']));
    expect(res.status).toBe(200);
    const body = await res.json() as { kind: string; user: unknown };
    expect(body.kind).toBe('ok');
    // Fallback body carries no leaked tokens.
    expect(body).not.toHaveProperty('access_token');
    expect(body).not.toHaveProperty('refresh_token');
    expect(body.user).toEqual({});
    // Cookies are still set from the extracted (never-relayed) tokens.
    expect(res.cookies.get('st_access')?.value).toBe('at-value');
    expect(res.cookies.get('st_refresh')?.value).toBe('rt-value');
  });

  it('sets only access cookie when upstream returns access_token without refresh_token', async () => {
    // Edge case: upstream returns only an access token (no refresh) — should still set the cookie
    mockFetch.mockResolvedValueOnce(
      upstreamJson({
        user: { id: 1, username: 'alice', email: null },
        access_token: 'at-only',
      }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/login',
      { username: 'alice', password: 'secret' },
    );
    const res = await POST(req, makeCtx(['login']));
    expect(res.status).toBe(200);
    expect(res.cookies.get('st_access')?.value).toBe('at-only');
    expect(res.cookies.get('st_refresh')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// verify-2fa — edge cases
// ---------------------------------------------------------------------------

describe('POST /api/auth/login/verify-2fa — edge cases', () => {
  it('returns 502 when upstream is unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const req = makePostRequest(
      'http://localhost:3000/api/auth/login/verify-2fa',
      { totp_code: '123456' },
      'st_partial=pt-value',
    );
    const res = await POST(req, makeCtx(['login', 'verify-2fa']));
    expect(res.status).toBe(502);
  });

  it('falls back to allow-listed safe body as user when verify-2fa response lacks "user" key', async () => {
    // upstream returns tokens + un-allow-listed fields but no top-level "user" wrapper
    mockFetch.mockResolvedValueOnce(
      upstreamJson({
        id: 1,
        username: 'alice',
        access_token: 'new-at',
        refresh_token: 'new-rt',
      }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/login/verify-2fa',
      { totp_code: '123456' },
      'st_partial=pt-value',
    );
    const res = await POST(req, makeCtx(['login', 'verify-2fa']));
    expect(res.status).toBe(200);
    const body = await res.json() as { kind: string; user: unknown };
    expect(body.kind).toBe('ok');
    // Tokens are stripped; the allow-listed fallback is empty.
    expect(body).not.toHaveProperty('access_token');
    expect(body).not.toHaveProperty('refresh_token');
    expect(body.user).toEqual({});
    expect(res.cookies.get('st_access')?.value).toBe('new-at');
    expect(res.cookies.get('st_refresh')?.value).toBe('new-rt');
  });

  it('forwards 429 from verify-2fa endpoint', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '45' },
      }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/login/verify-2fa',
      { totp_code: '000000' },
      'st_partial=pt-value',
    );
    const res = await POST(req, makeCtx(['login', 'verify-2fa']));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('45');
  });

  it('passes through 401 from upstream (wrong TOTP)', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({ error: 'invalid_totp' }, 401),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/login/verify-2fa',
      { totp_code: '000000' },
      'st_partial=pt-value',
    );
    const res = await POST(req, makeCtx(['login', 'verify-2fa']));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// refresh — edge cases
// ---------------------------------------------------------------------------

describe('POST /api/auth/refresh — edge cases', () => {
  it('returns 429 when upstream rate-limits the refresh endpoint', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '120' },
      }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/refresh',
      {},
      'st_refresh=old-rt',
    );
    const res = await POST(req, makeCtx(['refresh']));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('120');
  });

  it('returns 502 when upstream is unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const req = makePostRequest(
      'http://localhost:3000/api/auth/refresh',
      {},
      'st_refresh=old-rt',
    );
    const res = await POST(req, makeCtx(['refresh']));
    expect(res.status).toBe(502);
  });

  it('propagates non-ok upstream response on refresh failure', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({ error: 'token_expired' }, 401),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/refresh',
      {},
      'st_refresh=old-rt',
    );
    const res = await POST(req, makeCtx(['refresh']));
    // Non-ok upstream → BFF returns upstream status
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// me — edge cases
// ---------------------------------------------------------------------------

describe('GET /api/auth/me — edge cases', () => {
  it('returns 502 when upstream is unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const req = makeGetRequest(
      'http://localhost:3000/api/auth/me',
      'st_access=valid-at',
    );
    const res = await GET(req, makeCtx(['me']));
    expect(res.status).toBe(502);
  });

  it('forwards 429 from me endpoint', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '10' },
      }),
    );

    const req = makeGetRequest(
      'http://localhost:3000/api/auth/me',
      'st_access=valid-at',
    );
    const res = await GET(req, makeCtx(['me']));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('10');
  });

  it('passes through 401 from upstream (expired access token)', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({ error: 'token_expired' }, 401),
    );

    const req = makeGetRequest(
      'http://localhost:3000/api/auth/me',
      'st_access=expired-at',
    );
    const res = await GET(req, makeCtx(['me']));
    expect(res.status).toBe(401);
  });

  it('does NOT forward the browser Cookie header upstream', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({ user: { id: 1, username: 'alice', email: null } }),
    );

    const headers = new Headers({ cookie: 'st_access=token; other_cookie=secret' });
    const req = new NextRequest('http://localhost:3000/api/auth/me', { method: 'GET', headers });
    await GET(req, makeCtx(['me']));

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    // The BFF passes headers as a plain object {Authorization: '...'} — no cookie key.
    const rawHeaders = init.headers as Record<string, string>;
    const cookieVal = typeof rawHeaders['cookie'] === 'string' ? rawHeaders['cookie'] :
      (rawHeaders instanceof Headers ? (rawHeaders as Headers).get('cookie') : null);
    expect(cookieVal).toBeNull();
    // Authorization must be forwarded as Bearer
    const authVal = typeof rawHeaders['Authorization'] === 'string'
      ? rawHeaders['Authorization']
      : (rawHeaders instanceof Headers ? (rawHeaders as Headers).get('authorization') : '');
    expect(authVal).toContain('Bearer');
  });
});

// ---------------------------------------------------------------------------
// logout — cookie forwarding guard
// ---------------------------------------------------------------------------

describe('POST /api/auth/logout — cookie guard', () => {
  it('does NOT forward Cookie header to upstream logout call', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({ ok: true }),
    );

    const req = makePostRequest(
      'http://localhost:3000/api/auth/logout',
      {},
      'st_access=valid-at; st_refresh=old-rt',
    );
    const res = await POST(req, makeCtx(['logout']));

    expect(res.status).toBe(200);
    if (mockFetch.mock.calls.length > 0) {
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const rawHeaders = init.headers as Record<string, string>;
      // cookie key must not appear in the headers sent upstream
      const cookieVal = rawHeaders['cookie'] ?? null;
      expect(cookieVal).toBeNull();
    }
  });

  // B1 (Kage-CR): upstream /auth/logout is @jwt_required(refresh=True). The BFF
  // must authenticate the upstream call with the REFRESH token so the session is
  // actually revoked server-side — sending the access token would 422 and leave
  // the refresh token valid for its full window.
  it('authenticates the upstream logout with the REFRESH token, not the access token', async () => {
    mockFetch.mockResolvedValueOnce(upstreamJson({ msg: 'logged out' }));

    const req = makePostRequest(
      'http://localhost:3000/api/auth/logout',
      {},
      'st_access=access-jwt; st_refresh=refresh-jwt',
    );
    const res = await POST(req, makeCtx(['logout']));

    expect(res.status).toBe(200);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const rawHeaders = init.headers as Record<string, string>;
    expect(rawHeaders['Authorization']).toBe('Bearer refresh-jwt');
    expect(rawHeaders['Authorization']).not.toContain('access-jwt');
  });

  it('still returns 200 and clears cookies when no refresh cookie is present (skips upstream)', async () => {
    const req = makePostRequest(
      'http://localhost:3000/api/auth/logout',
      {},
      'st_access=access-only',
    );
    const res = await POST(req, makeCtx(['logout']));

    expect(res.status).toBe(200);
    // No refresh token → nothing to revoke upstream → no upstream call made.
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Allow-list response hardening (M3, Kage-CR)
// ---------------------------------------------------------------------------

describe('Response body allow-list', () => {
  it('strips token-shaped fields the upstream might add (csrf/recovery) from /me', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson({
        user: { id: 1, username: 'alice', email: null },
        csrf_refresh_token: 'csrf-secret',
        mfa_recovery_token: 'recovery-secret',
        access_token: 'leaked-at',
      }),
    );

    const req = makeGetRequest('http://localhost:3000/api/auth/me', 'st_access=valid-at');
    const res = await GET(req, makeCtx(['me']));
    const body = await res.json() as Record<string, unknown>;

    expect(body).toHaveProperty('user');
    expect(body).not.toHaveProperty('csrf_refresh_token');
    expect(body).not.toHaveProperty('mfa_recovery_token');
    expect(body).not.toHaveProperty('access_token');
  });
});
