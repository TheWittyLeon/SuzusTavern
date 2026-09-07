/**
 * @jest-environment node
 *
 * Tests for src/app/api/admin/auth/[...path]/route.ts (admin auth BFF).
 *
 * TEST-ADMIN-AUTH-BFF-PROXY-UNTESTED (P1, engine-backlog).
 *
 * This route proxies admin signup-management operations (invitations,
 * pending-registration approve/deny) to Authentication-Python. It is the
 * REQUIRED catch-all sibling of admin/flags' optional catch-all — same
 * admin-gate shape (readAccess cookie, dev-only Bearer fallback, /auth/me
 * role check), but with GET/POST/DELETE dispatch across five distinct
 * upstream operations instead of one read-only GET.
 *
 * Covered:
 *   1. Admin gate fails CLOSED — no session, /auth/me failure (network/
 *      non-ok/malformed-JSON), missing role, missing username. Zero or
 *      exactly-one upstream call in every closed case (never the real
 *      admin/invitations|pending-registrations calls).
 *   2. The dev-only Authorization-header fallback is REJECTED in prod
 *      (IS_PROD=true) — an actively-hostile probe for the security
 *      interlock, exercised with the flag both off (dev, header honored)
 *      and on (prod, header ignored) per the adversarial protocol.
 *   3. Path/method dispatch — all five routes forward to the correct
 *      upstream path/method/query/body; unmatched paths (bad id shape,
 *      wrong method, traversal-flavored segments, case mismatch) 404
 *      without ever reaching the upstream.
 *   4. Faithful status pass-through (200/404/409), fetch-reject -> 502,
 *      and non-JSON/empty upstream bodies degrade to `{}` without a 500 —
 *      the dependency-failure-injection cases from the adversarial
 *      protocol (upstream down / malformed / mid-stream-drop-shaped).
 *   5. No token/cookie leakage into the response body or headers.
 */

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();

beforeAll(() => {
  (global as Record<string, unknown>).fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

/**
 * Loads the route fresh with a specific IS_PROD value. Mirrors the
 * established `loadX(...)` + `jest.resetModules()` convention (see
 * `src/__tests__/lib/auth-cookies.test.ts`) — IS_PROD gates the dev-only
 * Bearer-header fallback inside `getAdminToken`, so exercising both values
 * requires a fresh module graph per value, not a single static mock.
 */
function loadRoute(isProd: boolean) {
  jest.resetModules();
  jest.mock('../../lib/env', () => ({
    env: {
      AUTH_API_URL: 'http://auth:5000',
      NEKANOVA_URL: 'http://neko:8080',
      PUBLIC_AUTH_URL: null,
      IS_PROD: isProd,
      COOKIE_SECURE: isProd,
      DEPLOY_ENV: isProd ? 'prod' : 'dev',
    },
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../app/api/admin/auth/[...path]/route') as {
    GET: (req: NextRequest, ctx: Ctx) => Promise<import('next/server').NextResponse>;
    POST: (req: NextRequest, ctx: Ctx) => Promise<import('next/server').NextResponse>;
    DELETE: (req: NextRequest, ctx: Ctx) => Promise<import('next/server').NextResponse>;
  };
}

type Ctx = { params: Promise<{ path: string[] }> };

function makeCtx(path: string[]): Ctx {
  return { params: Promise.resolve({ path }) };
}

function makeRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    body?: string;
  } = {},
): NextRequest {
  const headers = new Headers(options.headers ?? {});
  if (options.cookies) {
    const cookieStr = Object.entries(options.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    headers.set('cookie', cookieStr);
  }
  return new NextRequest(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body,
  });
}

/** Mock a successful /auth/me response with the given roles/username. */
function mockAuthMeOk(roles: string[] = ['admin'], username: string | undefined = 'Leon') {
  mockFetch.mockImplementationOnce((url: string) => {
    if (String(url).includes('/auth/me')) {
      return Promise.resolve(
        new Response(JSON.stringify({ user: { id: 1, username, roles } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

function mockAuthMeFailure(status = 401) {
  mockFetch.mockImplementationOnce(() => Promise.resolve(new Response('{}', { status })));
}

function mockAuthMeMalformed() {
  // 200 OK but the body is not valid JSON — a live-payload shape the route's
  // try/catch around `res.json()` must survive without throwing.
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve(
      new Response('<html>not json</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    ),
  );
}

function mockUpstream(status = 200, body: unknown = { ok: true }) {
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

function mockUpstreamNonJson(status = 500) {
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve(new Response('<html>Internal Server Error</html>', { status })),
  );
}

// ---------------------------------------------------------------------------
// 1. Admin gate — fails CLOSED
// ---------------------------------------------------------------------------

describe('Admin gate — fails closed (dev: IS_PROD=false)', () => {
  it('returns 403 with no cookie/token at all, and never calls fetch', async () => {
    const { GET } = loadRoute(false);
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations');
    const res = await GET(req, makeCtx(['invitations']));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe('forbidden');
    expect(body.reason).toBe('not_admin');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 403 when /auth/me rejects the token (401), no upstream call', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeFailure(401);
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      cookies: { st_access: 'bad-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));

    expect(res.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [[authMeUrl]] = mockFetch.mock.calls;
    expect(String(authMeUrl)).toContain('/auth/me');
  });

  it('returns 403 when /auth/me throws (network down), no upstream call, no 500', async () => {
    const { GET } = loadRoute(false);
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')));
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      cookies: { st_access: 'admin-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));

    expect(res.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns 403 when /auth/me returns a non-JSON 200 body, no crash', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeMalformed();
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      cookies: { st_access: 'admin-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));

    expect(res.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns 403 when the session lacks the admin role, no upstream call', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeOk(['user']);
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      cookies: { st_access: 'user-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));

    expect(res.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns 403 when /auth/me omits username even with the admin role', async () => {
    const { GET } = loadRoute(false);
    // Deliberately NOT via mockAuthMeOk(..., undefined) — a default parameter
    // treats an explicit `undefined` argument the same as omitting it, which
    // would silently fall back to 'Leon' and defeat this test. Build the
    // no-username payload directly instead.
    mockFetch.mockImplementationOnce((url: string) => {
      if (String(url).includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 1, roles: ['admin'] } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      cookies: { st_access: 'admin-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));

    expect(res.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('accepts a valid admin session and reaches the upstream (positive control)', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeOk(['admin']);
    mockUpstream(200, { invitations: [], total: 0 });
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      cookies: { st_access: 'admin-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Security interlock — dev-only Bearer fallback, flag OFF and ON
// ---------------------------------------------------------------------------

describe('Dev-only Authorization header fallback — interlock proven both ways', () => {
  it('IS_PROD=false (dev): an Authorization header with no cookie is honored', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeOk(['admin']);
    mockUpstream(200, { invitations: [], total: 0 });
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      headers: { authorization: 'Bearer header-only-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));

    expect(res.status).toBe(200);
    // The token that reached /auth/me must be the header value, not empty.
    const [, authMeInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const authMeHeaders = authMeInit.headers as Record<string, string>;
    expect(authMeHeaders.Authorization).toBe('Bearer header-only-token');
  });

  it('IS_PROD=true (prod): the SAME Authorization header is IGNORED — 403, zero fetch calls', async () => {
    const { GET } = loadRoute(true);
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      headers: { authorization: 'Bearer header-only-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));

    // Actively-hostile probe: an attacker (or a misconfigured test client)
    // supplying a Bearer header in production must be denied BEFORE any
    // network call — fail closed, not fail open.
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('IS_PROD=true (prod): a real cookie session still works normally', async () => {
    const { GET } = loadRoute(true);
    mockAuthMeOk(['admin']);
    mockUpstream(200, { invitations: [], total: 0 });
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      cookies: { st_access: 'admin-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 3. Path/method dispatch — pass-through + adversarial path shapes
// ---------------------------------------------------------------------------

describe('Path/method dispatch', () => {
  it('GET invitations forwards query params to admin/invitations', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeOk(['admin']);
    mockUpstream(200, { invitations: [{ id: 1 }], total: 1 });
    const req = makeRequest(
      'http://localhost:3000/api/admin/auth/invitations?page=2&status=pending',
      { cookies: { st_access: 'admin-token' } },
    );
    const res = await GET(req, makeCtx(['invitations']));

    expect(res.status).toBe(200);
    const [upstreamUrl, upstreamInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(upstreamUrl).toBe('http://auth:5000/admin/invitations?page=2&status=pending');
    expect(upstreamInit.method).toBe('GET');
    expect((upstreamInit.headers as Record<string, string>).Authorization).toBe(
      'Bearer admin-token',
    );
  });

  it('POST invitations forwards the JSON body verbatim', async () => {
    const { POST } = loadRoute(false);
    mockAuthMeOk(['admin']);
    mockUpstream(201, { id: 5 });
    const payload = JSON.stringify({ email: 'new@example.com' });
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      method: 'POST',
      cookies: { st_access: 'admin-token' },
      body: payload,
    });
    const res = await POST(req, makeCtx(['invitations']));

    expect(res.status).toBe(201);
    const [upstreamUrl, upstreamInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(upstreamUrl).toBe('http://auth:5000/admin/invitations');
    expect(upstreamInit.method).toBe('POST');
    expect(upstreamInit.body).toBe(payload);
  });

  it('DELETE invitations/<id> forwards to admin/invitations/<id>', async () => {
    const { DELETE } = loadRoute(false);
    mockAuthMeOk(['admin']);
    // 200 + JSON body here (not 204) — path/method forwarding is this test's
    // concern; the 204-No-Content edge case has its own dedicated test below
    // (and it currently FAILS the route, see that test's comment).
    mockUpstream(200, { deleted: true });
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations/42', {
      method: 'DELETE',
      cookies: { st_access: 'admin-token' },
    });
    const res = await DELETE(req, makeCtx(['invitations', '42']));

    expect(res.status).toBe(200);
    const [upstreamUrl, upstreamInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(upstreamUrl).toBe('http://auth:5000/admin/invitations/42');
    expect(upstreamInit.method).toBe('DELETE');
  });

  it('DELETE invitations/<non-numeric id> 404s WITHOUT reaching the upstream', async () => {
    const { DELETE } = loadRoute(false);
    mockAuthMeOk(['admin']);
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations/abc', {
      method: 'DELETE',
      cookies: { st_access: 'admin-token' },
    });
    const res = await DELETE(req, makeCtx(['invitations', 'abc']));

    expect(res.status).toBe(404);
    // Only the admin-gate's /auth/me call ran.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('GET pending forwards query params to admin/pending-registrations', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeOk(['admin']);
    mockUpstream(200, { pending: [] });
    const req = makeRequest(
      'http://localhost:3000/api/admin/auth/pending?search=foo&created_by=Leon',
      { cookies: { st_access: 'admin-token' } },
    );
    const res = await GET(req, makeCtx(['pending']));

    expect(res.status).toBe(200);
    const [upstreamUrl] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(upstreamUrl).toBe(
      'http://auth:5000/admin/pending-registrations?search=foo&created_by=Leon',
    );
  });

  it('POST pending/<id>/approve forwards to admin/pending-registrations/<id>/approve', async () => {
    const { POST } = loadRoute(false);
    mockAuthMeOk(['admin']);
    mockUpstream(200, { approved: true });
    const req = makeRequest('http://localhost:3000/api/admin/auth/pending/7/approve', {
      method: 'POST',
      cookies: { st_access: 'admin-token' },
    });
    const res = await POST(req, makeCtx(['pending', '7', 'approve']));

    expect(res.status).toBe(200);
    const [upstreamUrl, upstreamInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(upstreamUrl).toBe('http://auth:5000/admin/pending-registrations/7/approve');
    expect(upstreamInit.method).toBe('POST');
  });

  it('POST pending/<id>/deny forwards to admin/pending-registrations/<id>/deny', async () => {
    const { POST } = loadRoute(false);
    mockAuthMeOk(['admin']);
    mockUpstream(200, { denied: true });
    const req = makeRequest('http://localhost:3000/api/admin/auth/pending/9/deny', {
      method: 'POST',
      cookies: { st_access: 'admin-token' },
    });
    const res = await POST(req, makeCtx(['pending', '9', 'deny']));

    expect(res.status).toBe(200);
    const [upstreamUrl] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(upstreamUrl).toBe('http://auth:5000/admin/pending-registrations/9/deny');
  });

  it('an unknown path 404s with a valid admin session, no upstream call', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeOk(['admin']);
    const req = makeRequest('http://localhost:3000/api/admin/auth/nonsense', {
      cookies: { st_access: 'admin-token' },
    });
    const res = await GET(req, makeCtx(['nonsense']));

    expect(res.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('GET on a path only POST supports (invitations/<id> with no DELETE match) 404s', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeOk(['admin']);
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations/42', {
      cookies: { st_access: 'admin-token' },
    });
    const res = await GET(req, makeCtx(['invitations', '42']));

    expect(res.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('a traversal-flavored joined path (pending/../../invitations) 404s, no upstream call', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeOk(['admin']);
    const req = makeRequest('http://localhost:3000/api/admin/auth/x', {
      cookies: { st_access: 'admin-token' },
    });
    const res = await GET(req, makeCtx(['pending', '..', '..', 'invitations']));

    expect(res.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('is case-sensitive — "Invitations" (capital I) does not match "invitations"', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeOk(['admin']);
    const req = makeRequest('http://localhost:3000/api/admin/auth/Invitations', {
      cookies: { st_access: 'admin-token' },
    });
    const res = await GET(req, makeCtx(['Invitations']));

    expect(res.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Faithful status pass-through + dependency-failure injection
// ---------------------------------------------------------------------------

describe('Faithful pass-through + upstream failure injection', () => {
  it('passes through a 200 payload unmodified', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeOk(['admin']);
    const payload = { invitations: [{ id: 1, email: 'a@b.com' }], total: 1 };
    mockUpstream(200, payload);
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      cookies: { st_access: 'admin-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it('passes through a 404 from the upstream (not faked as 200)', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeOk(['admin']);
    mockUpstream(404, { error: 'not_found' });
    const req = makeRequest('http://localhost:3000/api/admin/auth/pending', {
      cookies: { st_access: 'admin-token' },
    });
    const res = await GET(req, makeCtx(['pending']));

    expect(res.status).toBe(404);
  });

  it('passes through a 409 conflict from the upstream (e.g. duplicate invite)', async () => {
    const { POST } = loadRoute(false);
    mockAuthMeOk(['admin']);
    mockUpstream(409, { error: 'already_invited' });
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      method: 'POST',
      cookies: { st_access: 'admin-token' },
      body: JSON.stringify({ email: 'dup@example.com' }),
    });
    const res = await POST(req, makeCtx(['invitations']));

    expect(res.status).toBe(409);
  });

  it('GET: upstream unreachable (fetch rejects) -> 502 upstream_unavailable, no 500', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeOk(['admin']);
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')));
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      cookies: { st_access: 'admin-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('upstream_unavailable');
  });

  it('POST: upstream unreachable also -> 502 (guard applies to mutating calls too)', async () => {
    const { POST } = loadRoute(false);
    mockAuthMeOk(['admin']);
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('ETIMEDOUT')));
    const req = makeRequest('http://localhost:3000/api/admin/auth/pending/1/approve', {
      method: 'POST',
      cookies: { st_access: 'admin-token' },
    });
    const res = await POST(req, makeCtx(['pending', '1', 'approve']));

    expect(res.status).toBe(502);
  });

  it('a non-JSON upstream body degrades to {} while preserving the real status (no 500)', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeOk(['admin']);
    mockUpstreamNonJson(500);
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      cookies: { st_access: 'admin-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({});
  });

  it('a 204 No Content upstream response passes through cleanly with no body (ADMIN-AUTH-BFF-204-THROW fixed)', async () => {
    // Was the KNOWN BUG characterization: proxyToAuth always did
    // `NextResponse.json(raw ?? {}, { status: res.status })`, and for
    // 204/205/304 (body-forbidden statuses — a completely standard shape for
    // a successful DELETE) attaching the `{}` fallback made NextResponse.json's
    // own Response constructor throw synchronously
    // (`/Invalid response status code 204/`), so the route crashed instead of
    // forwarding 204. proxyToAuth now short-circuits those statuses to a bare
    // `new NextResponse(null, { status })` — this test pins the FIX.
    const { DELETE } = loadRoute(false);
    mockAuthMeOk(['admin']);
    mockFetch.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 204 })));
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations/3', {
      method: 'DELETE',
      cookies: { st_access: 'admin-token' },
    });

    const res = await DELETE(req, makeCtx(['invitations', '3']));

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(await res.text()).toBe('');
  });

  it.each([205, 304])(
    'the other body-forbidden statuses (%i) also pass through bare, same as 204',
    async (status) => {
      const { GET } = loadRoute(false);
      mockAuthMeOk(['admin']);
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(new Response(null, { status })),
      );
      const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
        cookies: { st_access: 'admin-token' },
      });

      const res = await GET(req, makeCtx(['invitations']));

      expect(res.status).toBe(status);
      expect(res.body).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// 5. No token/cookie leakage
// ---------------------------------------------------------------------------

describe('Token/cookie leakage', () => {
  it('never exposes the admin session token in a forbidden response body', async () => {
    const { GET } = loadRoute(false);
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      cookies: { st_access: 'super-secret-admin-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));
    const bodyStr = JSON.stringify(await res.json());

    expect(bodyStr).not.toContain('super-secret-admin-token');
  });

  it('never reflects the Authorization header back on a successful response', async () => {
    const { GET } = loadRoute(false);
    mockAuthMeOk(['admin']);
    mockUpstream(200, { invitations: [], total: 0 });
    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      cookies: { st_access: 'admin-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));

    expect(res.headers.get('authorization')).toBeNull();
    const bodyStr = JSON.stringify(await res.json());
    expect(bodyStr).not.toContain('admin-token');
  });
});
