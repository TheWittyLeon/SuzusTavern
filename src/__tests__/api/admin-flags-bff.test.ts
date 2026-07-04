/**
 * @jest-environment node
 */

/**
 * Tests for src/app/api/admin/flags/[[...path]]/route.ts (admin flags BFF).
 *
 * D2 (sweep, 2026-07-03): the route folder was `[...path]` (required
 * catch-all), which never matches a zero-segment request. The panel calls
 * exactly `/api/admin/flags` (no sub-path) via `listFlags()` — so every
 * request 404'd before it reached the handler. Fixed by switching to
 * `[[...path]]` (optional catch-all).
 *
 * Key invariants covered:
 *   1. GET /api/admin/flags (zero path segments) resolves — NOT a 404 —
 *      when the session is admin. This is the regression test for the bug.
 *   2. Admin gate runs BEFORE any upstream call and fails CLOSED:
 *      - no cookie/token → 403, zero fetch calls
 *      - /auth/me 401 → 403, zero upstream calls
 *      - session without 'admin' role → 403, zero upstream calls
 *   3. Downstream status is passed through faithfully (200, 404, 502) —
 *      the BFF does not fabricate data when the upstream 404s (Auth-Python
 *      /admin/flags is not deployed yet — separate Track-A item).
 *   4. An unknown sub-path still 404s (Phase-1 is read-only, no-subpath only).
 *   5. The admin token/session value never leaks into the response body.
 */

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Optional catch-all context — `path` is `undefined` on a zero-segment match. */
function makeContext(path?: string[]): { params: Promise<{ path?: string[] }> } {
  return { params: Promise.resolve({ path }) };
}

function makeRequest(
  url: string,
  options: { headers?: Record<string, string>; cookies?: Record<string, string> } = {},
): NextRequest {
  const headers = new Headers(options.headers ?? {});
  if (options.cookies) {
    const cookieStr = Object.entries(options.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    headers.set('cookie', cookieStr);
  }
  return new NextRequest(url, { method: 'GET', headers });
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();

beforeAll(() => {
  (global as Record<string, unknown>).fetch = mockFetch;
});

beforeEach(() => {
  process.env.AUTH_API_URL = 'http://localhost:5000';
  mockFetch.mockReset();
});

afterEach(() => {
  delete process.env.AUTH_API_URL;
});

// Import after mocks are set up
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('../../app/api/admin/flags/[[...path]]/route') as {
  GET: (req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) => Promise<import('next/server').NextResponse>;
};

/** Mock a successful /auth/me response with the given roles. */
function mockAuthMeOk(roles: string[] = ['admin']) {
  mockFetch.mockImplementationOnce((url: string) => {
    if (String(url).includes('/auth/me')) {
      return Promise.resolve(
        new Response(JSON.stringify({ user: { id: 1, username: 'Leon', roles } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

function mockAuthMeFailure(status = 401) {
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve(new Response('{}', { status })),
  );
}

function mockUpstreamFlags(status = 200, body: unknown = { flags: [], count: 0, phase: 1 }) {
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// 1. Regression — zero-segment request resolves (the actual D2 bug)
// ---------------------------------------------------------------------------

describe('D2 regression: zero-segment GET /api/admin/flags resolves', () => {
  it('is NOT a 404 when the optional catch-all receives path=undefined', async () => {
    mockAuthMeOk(['admin']);
    mockUpstreamFlags(200, { flags: [{ key: 'foo' }], count: 1, phase: 1 });

    const req = makeRequest('http://localhost:3000/api/admin/flags', {
      cookies: { st_access: 'admin-token' },
    });
    // Exactly what Next.js hands the handler on the base route with the
    // [[...path]] optional catch-all — no `path` key at all.
    const ctx = makeContext(undefined);

    const res = await GET(req, ctx);

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    const body = await res.json() as { count: number };
    expect(body.count).toBe(1);
  });

  it('also resolves when path arrives as an empty array (defensive)', async () => {
    mockAuthMeOk(['admin']);
    mockUpstreamFlags(200, { flags: [], count: 0, phase: 1 });

    const req = makeRequest('http://localhost:3000/api/admin/flags', {
      cookies: { st_access: 'admin-token' },
    });
    const ctx = makeContext([]);

    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 2. Admin gate — fails CLOSED
// ---------------------------------------------------------------------------

describe('Admin gate — fails closed', () => {
  it('returns 403 with no cookie/token at all, and never calls fetch', async () => {
    const req = makeRequest('http://localhost:3000/api/admin/flags');
    const ctx = makeContext(undefined);

    const res = await GET(req, ctx);

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; reason: string };
    expect(body.error).toBe('forbidden');
    expect(body.reason).toBe('not_admin');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 403 when /auth/me rejects the token (401), no upstream call', async () => {
    mockAuthMeFailure(401);

    const req = makeRequest('http://localhost:3000/api/admin/flags', {
      cookies: { st_access: 'bad-token' },
    });
    const ctx = makeContext(undefined);

    const res = await GET(req, ctx);

    expect(res.status).toBe(403);
    // Only the /auth/me check ran — upstream /admin/flags was never called.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [[authMeUrl]] = mockFetch.mock.calls;
    expect(String(authMeUrl)).toContain('/auth/me');
  });

  it('returns 403 when the session lacks the admin role, no upstream call', async () => {
    mockAuthMeOk(['user']);

    const req = makeRequest('http://localhost:3000/api/admin/flags', {
      cookies: { st_access: 'user-token' },
    });
    const ctx = makeContext(undefined);

    const res = await GET(req, ctx);

    expect(res.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('never exposes the admin session token in the response body', async () => {
    mockAuthMeOk(['admin']);
    mockUpstreamFlags(200, { flags: [], count: 0, phase: 1 });

    const req = makeRequest('http://localhost:3000/api/admin/flags', {
      cookies: { st_access: 'super-secret-admin-token' },
    });
    const ctx = makeContext(undefined);

    const res = await GET(req, ctx);
    const bodyStr = JSON.stringify(await res.json());
    expect(bodyStr).not.toContain('super-secret-admin-token');
    expect(res.headers.get('authorization')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Downstream status is passed through faithfully — no faked data
// ---------------------------------------------------------------------------

describe('Faithful pass-through of downstream status', () => {
  it('passes through a 404 from the upstream (Auth-Python /admin/flags not yet deployed)', async () => {
    mockAuthMeOk(['admin']);
    mockUpstreamFlags(404, { error: 'not_found' });

    const req = makeRequest('http://localhost:3000/api/admin/flags', {
      cookies: { st_access: 'admin-token' },
    });
    const ctx = makeContext(undefined);

    const res = await GET(req, ctx);
    // The BFF must not mask the downstream 404 as a 200 with fake data.
    expect(res.status).toBe(404);
  });

  it('passes through a 502 when the upstream is entirely unreachable', async () => {
    mockAuthMeOk(['admin']);
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')));

    const req = makeRequest('http://localhost:3000/api/admin/flags', {
      cookies: { st_access: 'admin-token' },
    });
    const ctx = makeContext(undefined);

    const res = await GET(req, ctx);
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('upstream_unavailable');
  });

  it('passes through a 200 with the real upstream payload unmodified', async () => {
    mockAuthMeOk(['admin']);
    const payload = { flags: [{ key: 'x', resolved_value: true }], count: 1, phase: 1 };
    mockUpstreamFlags(200, payload);

    const req = makeRequest('http://localhost:3000/api/admin/flags', {
      cookies: { st_access: 'admin-token' },
    });
    const ctx = makeContext(undefined);

    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });
});

// ---------------------------------------------------------------------------
// 4. Unknown sub-path still 404s (Phase 1 is no-subpath read only)
// ---------------------------------------------------------------------------

describe('Unknown sub-path → 404 (Phase 1 scope)', () => {
  it('returns 404 for a sub-path even with a valid admin session, no upstream call', async () => {
    mockAuthMeOk(['admin']);

    const req = makeRequest('http://localhost:3000/api/admin/flags/some-key', {
      cookies: { st_access: 'admin-token' },
    });
    const ctx = makeContext(['some-key']);

    const res = await GET(req, ctx);

    expect(res.status).toBe(404);
    // Admin gate still ran (one call for /auth/me) but the upstream flags
    // endpoint was never hit for the unsupported sub-path.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
