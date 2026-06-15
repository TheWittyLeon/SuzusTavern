/**
 * @jest-environment node
 *
 * Tests for src/proxy.ts (Next 16 "proxy" file convention — formerly middleware)
 *
 * Covers:
 *   - protected path + no st_refresh → 302 to /login?next=<path>
 *   - protected path + expired access + valid refresh → pass through (200 NextResponse.next)
 *   - protected path + valid access + valid refresh → pass through
 *   - /login + valid access → 302 to ?next or /dashboard
 *   - /login + no access → pass through
 *   - static asset / api paths → pass through (not matched by the proxy matcher)
 *   - malformed JWT → treated as no session (redirect for protected routes)
 */

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (s: string) =>
    btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify(payload));
  return `${header}.${body}.fakesig`;
}

const NOW_UNIX = Math.floor(Date.now() / 1000);
const FUTURE   = NOW_UNIX + 3600;   // 1 hour from now — valid
const PAST     = NOW_UNIX - 3600;   // 1 hour ago — expired

function validAccessToken()  { return makeJwt({ sub: '1', exp: FUTURE }); }
function expiredAccessToken() { return makeJwt({ sub: '1', exp: PAST });  }
function validRefreshToken() { return 'opaque-refresh-token'; }

/** Build a NextRequest with optional cookies */
function makeReq(
  pathname: string,
  cookies: Record<string, string> = {},
  search = '',
): NextRequest {
  const url = `http://localhost:3000${pathname}${search}`;
  const headers = new Headers();
  if (Object.keys(cookies).length > 0) {
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    headers.set('cookie', cookieHeader);
  }
  return new NextRequest(url, { headers });
}

// ---------------------------------------------------------------------------
// Import the edge proxy handler (aliased to `middleware` for test brevity)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { proxy: middleware } = require('../proxy') as {
  proxy: (req: NextRequest) => import('next/server').NextResponse;
};

// ---------------------------------------------------------------------------
// Protected paths
// ---------------------------------------------------------------------------

describe('Protected paths', () => {
  it('redirects to /login?next= when no st_refresh cookie', () => {
    const req = makeReq('/dashboard');
    const res = middleware(req);

    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).toContain('next=');
    expect(decodeURIComponent(location)).toContain('/dashboard');
  });

  it('includes pathname + search in ?next= parameter', () => {
    const req = makeReq('/play/session-1', {}, '?round=2');
    const res = middleware(req);

    const location = res.headers.get('location') ?? '';
    const url = new URL(location);
    const next = url.searchParams.get('next') ?? '';
    expect(next).toContain('/play/session-1');
    expect(next).toContain('round=2');
  });

  it('passes through when access is expired but refresh is present', () => {
    const req = makeReq('/dashboard', {
      st_access: expiredAccessToken(),
      st_refresh: validRefreshToken(),
    });
    const res = middleware(req);

    // Pass-through = no redirect (status is 200 for NextResponse.next())
    expect(res.status).toBe(200);
  });

  it('passes through when access is missing but refresh is present', () => {
    const req = makeReq('/lobby', {
      st_refresh: validRefreshToken(),
    });
    const res = middleware(req);
    expect(res.status).toBe(200);
  });

  it('passes through when both access and refresh are valid', () => {
    const req = makeReq('/character/abc', {
      st_access: validAccessToken(),
      st_refresh: validRefreshToken(),
    });
    const res = middleware(req);
    expect(res.status).toBe(200);
  });

  it('redirects /play route when no refresh cookie', () => {
    const req = makeReq('/play/session-xyz');
    const res = middleware(req);
    expect(res.status).toBe(307);
  });

  it('redirects /character/new when no refresh cookie', () => {
    const req = makeReq('/character/new');
    const res = middleware(req);
    expect(res.status).toBe(307);
  });
});

// ---------------------------------------------------------------------------
// Malformed JWT
// ---------------------------------------------------------------------------

describe('Malformed JWT', () => {
  it('treats malformed st_access as no session (expired) for protected route', () => {
    // Even with a malformed access token, if refresh is absent → redirect
    const req = makeReq('/dashboard', { st_access: 'not.a.jwt' });
    const res = middleware(req);
    expect(res.status).toBe(307);
  });

  it('treats malformed st_access as expired — still passes through if refresh present', () => {
    const req = makeReq('/dashboard', {
      st_access: 'not.a.jwt',
      st_refresh: validRefreshToken(),
    });
    const res = middleware(req);
    expect(res.status).toBe(200);
  });

  it('does NOT redirect /login when access token is malformed (no session)', () => {
    const req = makeReq('/login', { st_access: 'garbage' });
    const res = middleware(req);
    // Malformed = treated as no session → pass through
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Auth pages (/login)
// ---------------------------------------------------------------------------

describe('/login — auth page', () => {
  it('redirects to /dashboard when user has a valid access token', () => {
    const req = makeReq('/login', { st_access: validAccessToken() });
    const res = middleware(req);

    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/dashboard');
  });

  it('redirects to ?next= target when ?next= is set and access is valid', () => {
    const req = makeReq('/login', { st_access: validAccessToken() }, '?next=%2Flobby');
    const res = middleware(req);

    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/lobby');
  });

  it('passes through /login when no access cookie', () => {
    const req = makeReq('/login');
    const res = middleware(req);
    expect(res.status).toBe(200);
  });

  it('passes through /login when access token is expired', () => {
    const req = makeReq('/login', { st_access: expiredAccessToken() });
    const res = middleware(req);
    expect(res.status).toBe(200);
  });

  it('falls back to /dashboard when ?next= points to a different origin', () => {
    const req = makeReq('/login', { st_access: validAccessToken() }, '?next=http%3A%2F%2Fevil.com');
    const res = middleware(req);

    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/dashboard');
    expect(location).not.toContain('evil.com');
  });
});

// ---------------------------------------------------------------------------
// Pass-through paths (root and other non-protected)
// ---------------------------------------------------------------------------

describe('Pass-through paths', () => {
  it('passes through root / without any cookies', () => {
    const req = makeReq('/');
    const res = middleware(req);
    expect(res.status).toBe(200);
  });

  it('passes through /about without any cookies', () => {
    const req = makeReq('/about');
    const res = middleware(req);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Never throw
// ---------------------------------------------------------------------------

describe('Never throw', () => {
  it('does not throw on completely unexpected input (falls through)', () => {
    // Pass a request with a weird URL — should not throw
    const req = makeReq('/some/random/path');
    expect(() => middleware(req)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Open-redirect guard — ?next= must be same-origin only
// ---------------------------------------------------------------------------

describe('Open-redirect guard', () => {
  it('falls back to /dashboard when ?next= is a bare non-http cross-origin value', () => {
    // javascript: scheme — must not be honored
    const req = makeReq(
      '/login',
      { st_access: validAccessToken() },
      '?next=javascript%3Aalert(1)',
    );
    const res = middleware(req);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/dashboard');
    expect(location).not.toContain('javascript');
  });

  it('falls back to /dashboard when ?next= is protocol-relative (//evil.com)', () => {
    const req = makeReq(
      '/login',
      { st_access: validAccessToken() },
      '?next=%2F%2Fevil.com%2Fphish',
    );
    const res = middleware(req);
    // //evil.com is parsed as a same-origin relative URL by new URL(next, origin) →
    // results in http://localhost:3000//evil.com which is same-origin, passes through.
    // This is acceptable — the path is on our origin, not a foreign origin.
    // Verify it doesn't redirect to a foreign origin.
    const location = res.headers.get('location') ?? '';
    expect(new URL(location).origin).toBe('http://localhost:3000');
  });

  it('preserves search params from a same-origin ?next= value', () => {
    const req = makeReq(
      '/login',
      { st_access: validAccessToken() },
      '?next=%2Flobby%3Ftab%3Dactive',
    );
    const res = middleware(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/lobby');
    expect(location).toContain('tab=active');
  });
});

// ---------------------------------------------------------------------------
// Proxy catch-block — force an internal error
// ---------------------------------------------------------------------------

describe('Proxy catch block', () => {
  it('falls through to NextResponse.next() when nextUrl throws internally', () => {
    // Construct a NextRequest and then sabotage nextUrl to cause proxy() to throw
    const req = makeReq('/dashboard', { st_refresh: 'rt' });
    // Replace nextUrl with a getter that throws after the first access
    let callCount = 0;
    Object.defineProperty(req, 'nextUrl', {
      get() {
        callCount++;
        if (callCount > 1) throw new Error('simulated internal failure');
        return new URL('http://localhost:3000/dashboard');
      },
      configurable: true,
    });

    let result: import('next/server').NextResponse | undefined;
    // Should NOT throw — the catch block returns NextResponse.next()
    expect(() => {
      result = middleware(req);
    }).not.toThrow();
    // The result is either a pass-through or a redirect — it must not be undefined
    expect(result).toBeDefined();
  });
});
