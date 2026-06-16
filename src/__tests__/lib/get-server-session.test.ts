/**
 * @jest-environment node
 *
 * Tests for getServerSession() in src/lib/auth/session.ts
 *
 * Separate from auth-session.test.ts because getServerSession uses
 * next/headers (server-only) and calls fetch — both need the node
 * environment to have Response / fetch available.
 *
 * Covers:
 *   - no cookie → {user: null, accessExpiresAt: null, maybeAuthed: false}
 *   - expired cookie, no refresh → {user: null, accessExpiresAt: <past>, maybeAuthed: false}, NO upstream call
 *   - expired cookie + refresh present → {user: null, maybeAuthed: true}, NO upstream call
 *   - no access cookie + refresh present → {user: null, maybeAuthed: true}
 *   - valid cookie + upstream 200 → {user, maybeAuthed: false}
 *   - valid cookie + upstream non-ok → {user: null, maybeAuthed: false (no refresh)}
 *   - valid cookie + upstream non-ok + refresh present → {user: null, maybeAuthed: true}
 *   - valid cookie + fetch throws → {user: null}
 */

// ---------------------------------------------------------------------------
// Mocks — must be set up before imports
// ---------------------------------------------------------------------------

jest.mock('server-only', () => ({}));

// next/headers mock — controlled per-test via the exported cookies mock
jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

jest.mock('../../lib/env', () => ({
  env: {
    AUTH_API_URL: 'http://localhost:5000',
    NEKANOVA_URL: 'http://localhost:8080',
    IS_PROD: false,
    PUBLIC_AUTH_URL: null,
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextHeaders = require('next/headers') as { cookies: jest.Mock };

import { getServerSession } from '../../lib/auth/session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (s: string) =>
    btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64url(JSON.stringify({ alg: 'HS256' }))}.${b64url(JSON.stringify(payload))}.fakesig`;
}

const NOW_UNIX = Math.floor(Date.now() / 1000);
const FUTURE = NOW_UNIX + 3600;
const PAST   = NOW_UNIX - 3600;

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const mockFetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();

beforeAll(() => {
  (global as Record<string, unknown>).fetch = mockFetch;
});

/**
 * Build a mock cookie store.
 * @param accessToken - value for st_access cookie (undefined = not present)
 * @param refreshToken - value for st_refresh cookie (undefined = not present)
 */
function makeCookieStore(accessToken?: string, refreshToken?: string) {
  return {
    get: jest.fn((name: string) => {
      if (name === 'st_access' && accessToken !== undefined) return { value: accessToken };
      if (name === 'st_refresh' && refreshToken !== undefined) return { value: refreshToken };
      return undefined;
    }),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  // Default: no cookies at all
  nextHeaders.cookies.mockResolvedValue(makeCookieStore());
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getServerSession', () => {
  // ── Basic / no-cookie cases ───────────────────────────────────────────────

  it('returns {user: null, accessExpiresAt: null, maybeAuthed: false} when no cookies', async () => {
    const result = await getServerSession();

    expect(result.user).toBeNull();
    expect(result.accessExpiresAt).toBeNull();
    expect(result.maybeAuthed).toBe(false);
    // Must NOT call upstream /auth/me with no cookie
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns maybeAuthed: false when no access cookie and no refresh cookie', async () => {
    const result = await getServerSession();
    expect(result.maybeAuthed).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── maybeAuthed: expired/missing access + refresh present → true ──────────

  it('returns maybeAuthed: true when access is expired but refresh cookie is present — does NOT call /auth/me', async () => {
    const expiredJwt = makeJwt({ sub: '1', exp: PAST });
    nextHeaders.cookies.mockResolvedValue(
      makeCookieStore(expiredJwt, 'some-refresh-token'),
    );

    const result = await getServerSession();

    expect(result.user).toBeNull();
    expect(result.accessExpiresAt).toBe(PAST);
    expect(result.maybeAuthed).toBe(true);
    // IMPORTANT: must NOT call /auth/me — no valid access token
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns maybeAuthed: true when access is absent but refresh cookie is present', async () => {
    nextHeaders.cookies.mockResolvedValue(
      makeCookieStore(undefined, 'some-refresh-token'),
    );

    const result = await getServerSession();

    expect(result.user).toBeNull();
    expect(result.accessExpiresAt).toBeNull();
    expect(result.maybeAuthed).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── maybeAuthed: false when expired access and no refresh ─────────────────

  it('returns {user: null, maybeAuthed: false} and does NOT call upstream when access expired, no refresh', async () => {
    const expiredJwt = makeJwt({ sub: '1', exp: PAST });
    nextHeaders.cookies.mockResolvedValue(makeCookieStore(expiredJwt));

    const result = await getServerSession();

    expect(result.user).toBeNull();
    // accessExpiresAt is still populated from the expired token
    expect(result.accessExpiresAt).toBe(PAST);
    expect(result.maybeAuthed).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Valid access token + /auth/me success → maybeAuthed: false ───────────

  it('returns {user, maybeAuthed: false} when cookie is valid and upstream /auth/me responds 200', async () => {
    const validJwt = makeJwt({ sub: '1', exp: FUTURE });
    nextHeaders.cookies.mockResolvedValue(makeCookieStore(validJwt));

    mockFetch.mockResolvedValueOnce(
      jsonRes({ user: { id: 1, username: 'alice', email: null } }),
    );

    const result = await getServerSession();

    expect(result.user).toEqual({ id: 1, username: 'alice', email: null });
    expect(result.accessExpiresAt).toBe(FUTURE);
    expect(result.maybeAuthed).toBe(false);

    // Verify upstream was called with Authorization: Bearer, NOT raw Cookie
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toContain('/auth/me');
    expect((init.headers as Record<string, string>)['Authorization']).toContain('Bearer');
    // Cookie header must not be forwarded
    expect((init.headers as Record<string, string>)['Cookie']).toBeUndefined();
  });

  it('returns {user: null, maybeAuthed: false} when upstream /auth/me returns non-ok (401), no refresh', async () => {
    const validJwt = makeJwt({ sub: '1', exp: FUTURE });
    nextHeaders.cookies.mockResolvedValue(makeCookieStore(validJwt));

    mockFetch.mockResolvedValueOnce(
      jsonRes({ error: 'unauthorized' }, 401),
    );

    const result = await getServerSession();

    expect(result.user).toBeNull();
    expect(result.accessExpiresAt).toBe(FUTURE);
    expect(result.maybeAuthed).toBe(false);
  });

  it('returns maybeAuthed: true when /auth/me returns non-ok AND refresh cookie is present', async () => {
    const validJwt = makeJwt({ sub: '1', exp: FUTURE });
    nextHeaders.cookies.mockResolvedValue(makeCookieStore(validJwt, 'refresh-token'));

    mockFetch.mockResolvedValueOnce(
      jsonRes({ error: 'unauthorized' }, 401),
    );

    const result = await getServerSession();

    expect(result.user).toBeNull();
    // Access was valid but /auth/me rejected it — fall back to maybeAuthed
    expect(result.maybeAuthed).toBe(true);
  });

  it('returns {user: null} when upstream /auth/me throws a network error', async () => {
    const validJwt = makeJwt({ sub: '1', exp: FUTURE });
    nextHeaders.cookies.mockResolvedValue(makeCookieStore(validJwt));

    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await getServerSession();

    expect(result.user).toBeNull();
    expect(result.maybeAuthed).toBe(false);
  });

  it('returns maybeAuthed: true when /auth/me throws AND refresh cookie is present', async () => {
    const validJwt = makeJwt({ sub: '1', exp: FUTURE });
    nextHeaders.cookies.mockResolvedValue(makeCookieStore(validJwt, 'refresh-token'));

    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await getServerSession();

    expect(result.user).toBeNull();
    expect(result.maybeAuthed).toBe(true);
  });

  it('returns {user: null} when upstream /auth/me returns non-JSON body', async () => {
    const validJwt = makeJwt({ sub: '1', exp: FUTURE });
    nextHeaders.cookies.mockResolvedValue(makeCookieStore(validJwt));

    // Upstream returns plain text (non-JSON) with 200 — res.json() will throw
    mockFetch.mockResolvedValueOnce(
      new Response('OK but not JSON', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const result = await getServerSession();

    // Parse failure → treat as no session
    expect(result.user).toBeNull();
  });

  it('returns {user: null} when upstream /auth/me 200 body lacks "user" key', async () => {
    // Covers the `data.user ?? null` branch — data.user is undefined
    const validJwt = makeJwt({ sub: '1', exp: FUTURE });
    nextHeaders.cookies.mockResolvedValue(makeCookieStore(validJwt));

    mockFetch.mockResolvedValueOnce(
      jsonRes({ message: 'ok' }), // no "user" key
    );

    const result = await getServerSession();
    expect(result.user).toBeNull();
    expect(result.accessExpiresAt).toBe(FUTURE);
    expect(result.maybeAuthed).toBe(false);
  });
});
