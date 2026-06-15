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
 *   - no cookie → {user: null, accessExpiresAt: null}
 *   - expired cookie → {user: null, accessExpiresAt: <past>}, NO upstream call
 *   - valid cookie + upstream 200 → {user}
 *   - valid cookie + upstream non-ok → {user: null}
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

beforeEach(() => {
  mockFetch.mockReset();
  // Default: no cookie
  nextHeaders.cookies.mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getServerSession', () => {
  it('returns {user: null, accessExpiresAt: null} when no st_access cookie', async () => {
    const result = await getServerSession();

    expect(result.user).toBeNull();
    expect(result.accessExpiresAt).toBeNull();
    // Must NOT call upstream /auth/me with no cookie
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns {user: null} and does NOT call upstream when cookie is expired', async () => {
    const expiredJwt = makeJwt({ sub: '1', exp: PAST });
    nextHeaders.cookies.mockResolvedValue({
      get: jest.fn((name: string) =>
        name === 'st_access' ? { value: expiredJwt } : undefined,
      ),
    });

    const result = await getServerSession();

    expect(result.user).toBeNull();
    // accessExpiresAt is still populated from the expired token
    expect(result.accessExpiresAt).toBe(PAST);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns {user} when cookie is valid and upstream /auth/me responds 200', async () => {
    const validJwt = makeJwt({ sub: '1', exp: FUTURE });
    nextHeaders.cookies.mockResolvedValue({
      get: jest.fn((name: string) =>
        name === 'st_access' ? { value: validJwt } : undefined,
      ),
    });

    mockFetch.mockResolvedValueOnce(
      jsonRes({ user: { id: 1, username: 'alice', email: null } }),
    );

    const result = await getServerSession();

    expect(result.user).toEqual({ id: 1, username: 'alice', email: null });
    expect(result.accessExpiresAt).toBe(FUTURE);

    // Verify upstream was called with Authorization: Bearer, NOT raw Cookie
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toContain('/auth/me');
    expect((init.headers as Record<string, string>)['Authorization']).toContain('Bearer');
    // Cookie header must not be forwarded
    expect((init.headers as Record<string, string>)['Cookie']).toBeUndefined();
  });

  it('returns {user: null} when upstream /auth/me returns non-ok (401)', async () => {
    const validJwt = makeJwt({ sub: '1', exp: FUTURE });
    nextHeaders.cookies.mockResolvedValue({
      get: jest.fn((name: string) =>
        name === 'st_access' ? { value: validJwt } : undefined,
      ),
    });

    mockFetch.mockResolvedValueOnce(
      jsonRes({ error: 'unauthorized' }, 401),
    );

    const result = await getServerSession();

    expect(result.user).toBeNull();
    expect(result.accessExpiresAt).toBe(FUTURE);
  });

  it('returns {user: null} when upstream /auth/me throws a network error', async () => {
    const validJwt = makeJwt({ sub: '1', exp: FUTURE });
    nextHeaders.cookies.mockResolvedValue({
      get: jest.fn((name: string) =>
        name === 'st_access' ? { value: validJwt } : undefined,
      ),
    });

    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await getServerSession();

    expect(result.user).toBeNull();
  });

  it('returns {user: null} when upstream /auth/me returns non-JSON body', async () => {
    const validJwt = makeJwt({ sub: '1', exp: FUTURE });
    nextHeaders.cookies.mockResolvedValue({
      get: jest.fn((name: string) =>
        name === 'st_access' ? { value: validJwt } : undefined,
      ),
    });

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
    nextHeaders.cookies.mockResolvedValue({
      get: jest.fn((name: string) =>
        name === 'st_access' ? { value: validJwt } : undefined,
      ),
    });

    mockFetch.mockResolvedValueOnce(
      jsonRes({ message: 'ok' }), // no "user" key
    );

    const result = await getServerSession();
    expect(result.user).toBeNull();
    expect(result.accessExpiresAt).toBe(FUTURE);
  });
});
