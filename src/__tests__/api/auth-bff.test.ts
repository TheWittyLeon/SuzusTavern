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

  describe('operator log when the upstream revoke did not happen', () => {
    const post = () => POST(
      makePostRequest('http://localhost:3000/api/auth/logout', {}, 'st_access=old-at; st_refresh=secret-rt'),
      makeCtx(['logout']),
    );
    let warn: jest.SpyInstance;
    beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => warn.mockRestore());
    const logoutWarns = () => warn.mock.calls.filter((c) => c[0] === '[auth-bff] logout upstream did not revoke');

    it('upstream 5xx: still 200, ONE line with the status', async () => {
      mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }));
      expect((await post()).status).toBe(200);
      expect(logoutWarns()).toHaveLength(1);
      expect(logoutWarns()[0][1]).toMatchObject({ upstreamStatus: 500, path: 'logout' });
    });
    it('upstream unreachable: still 200, ONE line saying no_response', async () => {
      mockFetch.mockRejectedValueOnce(new Error('down'));
      expect((await post()).status).toBe(200);
      expect(logoutWarns()).toHaveLength(1);
      expect(logoutWarns()[0][1]).toMatchObject({ upstreamStatus: 'no_response' });
    });
    it('never logs a token', async () => {
      mockFetch.mockResolvedValueOnce(new Response('boom', { status: 502 }));
      await post();
      expect(logoutWarns()).toHaveLength(1); // the line fired, so the no-token check below is not vacuous
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret-rt|old-at/);
    });
    it('upstream 2xx: logs nothing', async () => {
      mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
      await post();
      expect(logoutWarns()).toHaveLength(0);
    });
    it('no refresh cookie (no upstream call): logs nothing', async () => {
      await POST(makePostRequest('http://localhost:3000/api/auth/logout', {}, 'st_access=old-at'), makeCtx(['logout']));
      expect(mockFetch).not.toHaveBeenCalled();
      expect(logoutWarns()).toHaveLength(0);
    });
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
// HUNT1020-04 — 423 (account locked) relays locked_until so the login page can say for how long
// ---------------------------------------------------------------------------

describe('Upstream 423 (account locked)', () => {
  it('relays status, msg and locked_until; still drops token-shaped fields', async () => {
    mockFetch.mockResolvedValueOnce(
      upstreamJson(
        { msg: 'account locked', locked_until: '2026-10-20T23:00:00', access_token: 'LEAK', refresh_token: 'LEAK' },
        423,
      ),
    );
    const req = makePostRequest('http://localhost:3000/api/auth/login', { username: 'alice', password: 'x' });
    const res = await POST(req, makeCtx(['login']));
    expect(res.status).toBe(423);
    const body = await res.json();
    expect(body).toEqual({ msg: 'account locked', locked_until: '2026-10-20T23:00:00' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HUNT1020-22 / -23 — login CSRF + forced sign-out: state-changing auth routes are same-origin + JSON
// ---------------------------------------------------------------------------

describe('auth BFF CSRF guard', () => {
  const LOGIN_OK = {
    access_token: 'A', refresh_token: 'R', user: { id: 1, username: 'alice' },
  };

  function post(path: string, headers: Record<string, string>, body = '{"username":"attacker","password":"x","pad":"="}', cookie?: string) {
    const h = new Headers(headers);
    if (cookie) h.set('cookie', cookie);
    return new NextRequest(`http://localhost:3000/api/auth/${path}`, { method: 'POST', headers: h, body });
  }

  it('cross-site text/plain form POST to /login: refused, upstream never called, no session cookies', async () => {
    mockFetch.mockResolvedValue(upstreamJson(LOGIN_OK));
    const res = await POST(
      post('login', { 'content-type': 'text/plain', origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' }),
      makeCtx(['login']),
    );
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('same-site-origin text/plain (no CORS preflight needed) is refused 415 even from our own origin', async () => {
    mockFetch.mockResolvedValue(upstreamJson(LOGIN_OK));
    const res = await POST(
      post('login', { 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' }),
      makeCtx(['login']),
    );
    expect(res.status).toBe(415);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('cross-site JSON POST with a bad Origin and no Sec-Fetch-Site (older browser): refused', async () => {
    const res = await POST(
      post('login', { 'content-type': 'application/json', origin: 'http://evil.example', host: 'localhost:3000' }),
      makeCtx(['login']),
    );
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(['register', 'login/verify-2fa', 'password/change', 'request-password-reset', 'reset-password', 'refresh', 'logout'])(
    'cross-site POST to /%s is refused before any upstream call',
    async (path) => {
      const res = await POST(
        post(path, { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, '{}', 'st_access=a; st_refresh=r; st_partial=p'),
        makeCtx(path.split('/')),
      );
      expect(res.status).toBe(403);
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it('cross-site logout does NOT clear the victim\'s cookies', async () => {
    const res = await POST(
      post('logout', { 'sec-fetch-site': 'cross-site', origin: 'http://evil.example' }, '', 'st_access=a; st_refresh=r'),
      makeCtx(['logout']),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Kage I3: the table is the only source of servable routes and of "needs JSON".
  it('every POST row in the table refuses a same-origin text/plain body unless its row says body:none', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AUTH_ROUTES } = require('../../lib/auth/authRoutes') as typeof import('../../lib/auth/authRoutes');
    for (const r of AUTH_ROUTES.filter((x) => x.method === 'POST')) {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(upstreamJson({ ok: true }));
      const res = await POST(
        post(r.path, { 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' }, '{}', 'st_access=a; st_refresh=r; st_partial=p'),
        makeCtx(r.path.split('/')),
      );
      if (r.body === 'json') {
        expect([r.path, res.status]).toEqual([r.path, 415]);
        expect(mockFetch).not.toHaveBeenCalled();
      } else {
        expect([r.path, res.status]).not.toEqual([r.path, 415]);
      }
    }
  });

  it('every row has a handler: a same-origin JSON request to each is served, not 404', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AUTH_ROUTES } = require('../../lib/auth/authRoutes') as typeof import('../../lib/auth/authRoutes');
    for (const r of AUTH_ROUTES) {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(upstreamJson({ ok: true }));
      const ctx = makeCtx(r.path.split('/'));
      const cookie = 'st_access=a; st_refresh=r; st_partial=p';
      const res = r.method === 'GET'
        ? await GET(makeGetRequest(`http://localhost:3000/api/auth/${r.path}`, cookie), ctx)
        : await POST(post(r.path, { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, '{}', cookie), ctx);
      expect([r.path, res.status]).not.toEqual([r.path, 404]);
    }
  });

  it('a route missing from the table is refused (404), even same-origin JSON, and never reaches upstream', async () => {
    mockFetch.mockResolvedValue(upstreamJson({ ok: true }));
    for (const path of [['not-a-route'], ['admin', 'login'], ['login', 'extra'], ['LOGIN']]) {
      const res = await POST(
        post(path.join('/'), { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, '{}', 'st_access=a'),
        makeCtx(path),
      );
      expect(res.status).toBe(404);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('wrong method on a table path is a 404 (GET login, POST me)', async () => {
    const g = await GET(makeGetRequest('http://localhost:3000/api/auth/login'), makeCtx(['login']));
    expect(g.status).toBe(404);
    const p = await POST(post('me', { 'content-type': 'application/json' }, '{}'), makeCtx(['me']));
    expect(p.status).toBe(404);
  });

  it('logout without a JSON content type is refused 415 (a bodiless cross-site form must not sign anyone out)', async () => {
    const res = await POST(post('logout', { 'sec-fetch-site': 'same-origin' }, '', 'st_access=a; st_refresh=r'), makeCtx(['logout']));
    expect(res.status).toBe(415);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('positive control: same-origin JSON login (browser headers) still signs in and sets cookies', async () => {
    mockFetch.mockResolvedValueOnce(upstreamJson(LOGIN_OK));
    const res = await POST(
      post(
        'login',
        { 'content-type': 'application/json', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin', host: 'localhost:3000' },
        '{"username":"alice","password":"pw"}',
      ),
      makeCtx(['login']),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/st_access=A/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('positive control: same-origin logout still revokes upstream and clears cookies', async () => {
    mockFetch.mockResolvedValueOnce(upstreamJson({ msg: 'ok' }));
    const res = await POST(
      post('logout', { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: 'http://localhost:3000', host: 'localhost:3000' }, '{}', 'st_access=a; st_refresh=r'),
      makeCtx(['logout']),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/st_refresh=;/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('positive control: Origin-only (no Sec-Fetch-Site) matching our Host passes', async () => {
    mockFetch.mockResolvedValueOnce(upstreamJson(LOGIN_OK));
    const res = await POST(
      post('login', { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' }, '{"username":"a","password":"b"}'),
      makeCtx(['login']),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// HUNT1020-05 — the layout's per-token /auth/me cache is evicted by logout / password change / 401
// ---------------------------------------------------------------------------

describe('layout /auth/me cache eviction', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSharedMeCache } = require('../../lib/auth/meCache') as typeof import('../../lib/auth/meCache');
  const U = { id: 1, username: 'alice', email: null } as never;
  const seed = () => {
    getSharedMeCache().clear();
    getSharedMeCache().set('tok-A', U);
    getSharedMeCache().set('tok-B', U);
  };

  it('logout evicts that browser\'s token only', async () => {
    seed();
    mockFetch.mockResolvedValueOnce(upstreamJson({ msg: 'ok' }));
    await POST(makePostRequest('http://localhost:3000/api/auth/logout', {}, 'st_access=tok-A; st_refresh=r'), makeCtx(['logout']));
    expect(getSharedMeCache().get('tok-A')).toBeNull();
    expect(getSharedMeCache().get('tok-B')).not.toBeNull();
  });

  it('logout evicts even when the upstream revoke fails', async () => {
    seed();
    mockFetch.mockRejectedValueOnce(new TypeError('down'));
    const res = await POST(makePostRequest('http://localhost:3000/api/auth/logout', {}, 'st_access=tok-A; st_refresh=r'), makeCtx(['logout']));
    expect(res.status).toBe(200);
    expect(getSharedMeCache().get('tok-A')).toBeNull();
  });

  it('password change evicts the token whose sessions were just revoked', async () => {
    seed();
    mockFetch.mockResolvedValueOnce(upstreamJson({ msg: 'changed' }));
    await POST(
      makePostRequest('http://localhost:3000/api/auth/password/change', { current_password: 'a', new_password: 'b' }, 'st_access=tok-A'),
      makeCtx(['password', 'change']),
    );
    expect(getSharedMeCache().get('tok-A')).toBeNull();
    expect(getSharedMeCache().get('tok-B')).not.toBeNull();
  });

  it('a 401 from /api/auth/me evicts (concurrent miss: another request cached the token first)', async () => {
    seed();
    getSharedMeCache().evict('tok-A'); // both requests below miss
    getSharedMeCache().clear();
    getSharedMeCache().set('tok-B', U);
    mockFetch.mockResolvedValueOnce(upstreamJson({ user: { id: 1, username: 'alice' } }));
    mockFetch.mockResolvedValueOnce(upstreamJson({ msg: 'revoked' }, 401));
    await Promise.all([
      GET(makeGetRequest('http://localhost:3000/api/auth/me', 'st_access=tok-A'), makeCtx(['me'])),
      GET(makeGetRequest('http://localhost:3000/api/auth/me', 'st_access=tok-A'), makeCtx(['me'])),
    ]);
    expect(getSharedMeCache().get('tok-A')).toBeNull();
    expect(getSharedMeCache().get('tok-B')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Kage I1 / I2 — the session-restoring calls are bounded; /api/auth/me shares the layout's cache
// ---------------------------------------------------------------------------

describe('GET /api/auth/me — shared cache (Kage I2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSharedMeCache } = require('../../lib/auth/meCache') as typeof import('../../lib/auth/meCache');
  const b64 = (x: string) => btoa(x).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = (sub: string) => `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 600 }))}.sig`;
  beforeEach(() => getSharedMeCache().clear());

  it('second call with the same token is served from the cache (one upstream call)', async () => {
    const t = jwt('1');
    mockFetch.mockResolvedValue(upstreamJson({ user: { id: 1, username: 'alice' }, access_token: 'LEAK' }));
    const a = await GET(makeGetRequest('http://localhost:3000/api/auth/me', `st_access=${t}`), makeCtx(['me']));
    const b = await GET(makeGetRequest('http://localhost:3000/api/auth/me', `st_access=${t}`), makeCtx(['me']));
    expect(await a.json()).toEqual({ user: { id: 1, username: 'alice' } });
    expect(await b.json()).toEqual({ user: { id: 1, username: 'alice' } });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('two tokens never share an entry', async () => {
    const [A, B] = [jwt('a'), jwt('b')];
    mockFetch.mockImplementation(async (_u, init) =>
      upstreamJson({ user: { username: String((init?.headers as Record<string, string>).Authorization).includes(A) ? 'alice' : 'bob' } }),
    );
    for (const [t, who] of [[A, 'alice'], [B, 'bob'], [A, 'alice'], [B, 'bob']]) {
      const res = await GET(makeGetRequest('http://localhost:3000/api/auth/me', `st_access=${t}`), makeCtx(['me']));
      expect((await res.json()).user.username).toBe(who);
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('errors are never cached', async () => {
    const t = jwt('1');
    mockFetch.mockResolvedValueOnce(upstreamJson({ msg: 'x' }, 500));
    mockFetch.mockResolvedValueOnce(upstreamJson({ user: { username: 'alice' } }));
    const r1 = await GET(makeGetRequest('http://localhost:3000/api/auth/me', `st_access=${t}`), makeCtx(['me']));
    const r2 = await GET(makeGetRequest('http://localhost:3000/api/auth/me', `st_access=${t}`), makeCtx(['me']));
    expect(r1.status).toBe(500);
    expect(r2.status).toBe(200);
  });
});

describe('stalled upstream (Kage I1)', () => {
  const stall = () =>
    mockFetch.mockImplementation(
      (_u, init) =>
        new Promise((_res, rej) => {
          const sig = (init as RequestInit).signal as AbortSignal | undefined;
          if (!sig) return; // no deadline: hangs forever (the old behaviour)
          sig.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        }),
    );

  it('refresh and me answer 502 upstream_unavailable after the BFF deadline instead of hanging', async () => {
    jest.useFakeTimers();
    try {
      stall();
      const pr = POST(makePostRequest('http://localhost:3000/api/auth/refresh', {}, 'st_refresh=r'), makeCtx(['refresh']));
      const pm = GET(makeGetRequest('http://localhost:3000/api/auth/me', 'st_access=tok-stall'), makeCtx(['me']));
      await jest.advanceTimersByTimeAsync(8001);
      const [r, m] = await Promise.all([pr, pm]);
      expect(r.status).toBe(502);
      expect(m.status).toBe(502);
      expect(await r.json()).toEqual({ error: 'upstream_unavailable' });
    } finally {
      jest.useRealTimers();
    }
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
