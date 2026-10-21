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
import { getSharedMeCache } from '../../lib/auth/meCache';

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
  getSharedMeCache().clear(); // the per-token /auth/me cache is process-wide; start each test cold
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


// ---------------------------------------------------------------------------
// HUNT1020-05 — per-token /auth/me cache; HUNT1020-24 — deadline
// ---------------------------------------------------------------------------

describe('getServerSession — per-token /auth/me cache (HUNT1020-05)', () => {
  const tokenFor = (sub: string) => makeJwt({ sub, exp: FUTURE });
  const userOf = (name: string) => ({ id: name.length, username: name, email: null });
  const asToken = (token: string, refresh?: string) =>
    nextHeaders.cookies.mockResolvedValue(makeCookieStore(token, refresh));

  it('a second render with the same token does not spend another /auth/me', async () => {
    mockFetch.mockImplementation(async () => jsonRes({ user: userOf('alice') }));
    asToken(tokenFor('1'));
    const first = await getServerSession();
    const second = await getServerSession();
    expect(first.user).toMatchObject({ username: 'alice' });
    expect(second.user).toMatchObject({ username: 'alice' });
    expect(second.maybeAuthed).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('two tokens never see each other\'s user, in any interleaving', async () => {
    mockFetch.mockImplementation(async (_url, init) => {
      const auth = String((init?.headers as Record<string, string>).Authorization);
      return jsonRes({ user: userOf(auth.includes(tokenFor('alice-sub')) ? 'alice' : 'bob') });
    });
    const A = tokenFor('alice-sub');
    const B = tokenFor('bob-sub');
    const seen: string[] = [];
    for (const t of [A, B, A, B, B, A]) {
      asToken(t);
      seen.push((await getServerSession()).user!.username);
    }
    expect(seen).toEqual(['alice', 'bob', 'alice', 'bob', 'bob', 'alice']);
    expect(mockFetch).toHaveBeenCalledTimes(2); // one per token, the rest served from cache
  });

  it('same user, different (rotated) token is a separate entry', async () => {
    mockFetch.mockImplementation(async () => jsonRes({ user: userOf('alice') }));
    asToken(makeJwt({ sub: '1', exp: FUTURE, n: 1 }));
    await getServerSession();
    asToken(makeJwt({ sub: '1', exp: FUTURE, n: 2 }));
    await getServerSession();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('never caches errors: 5xx, 429, network failure, or an empty body are re-asked next time', async () => {
    asToken(tokenFor('1'), 'r');
    mockFetch.mockResolvedValueOnce(jsonRes({ msg: 'boom' }, 500));
    expect((await getServerSession()).user).toBeNull();
    mockFetch.mockResolvedValueOnce(jsonRes({ error: 'rate_limited' }, 429));
    expect((await getServerSession()).user).toBeNull();
    mockFetch.mockRejectedValueOnce(new TypeError('network'));
    expect((await getServerSession()).user).toBeNull();
    mockFetch.mockResolvedValueOnce(jsonRes({}, 200));
    expect((await getServerSession()).user).toBeNull();
    mockFetch.mockResolvedValueOnce(jsonRes({ user: userOf('alice') }));
    expect((await getServerSession()).user).toMatchObject({ username: 'alice' });
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it('a 401 evicts: two renders miss together, one is answered 200 (cached), the other 401', async () => {
    const t = tokenFor('1');
    asToken(t);
    mockFetch.mockResolvedValueOnce(jsonRes({ user: userOf('alice') }));
    mockFetch.mockResolvedValueOnce(jsonRes({ msg: 'revoked' }, 401));
    const [first, second] = await Promise.all([getServerSession(), getServerSession()]);
    expect(first.user).toMatchObject({ username: 'alice' });
    expect(second.user).toBeNull();
    // the 401 must have dropped what the 200 just cached
    expect(getSharedMeCache().get(t)).toBeNull();
  });

  it('a render whose fetch started BEFORE a logout evicted the token cannot refill the cache', async () => {
    const t = tokenFor('1');
    asToken(t);
    let release!: (r: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise<Response>((res) => { release = res; }));
    const pending = getServerSession();
    await new Promise((r) => setTimeout(r, 5)); // the fetch is in flight
    getSharedMeCache().evict(t); // what the logout route does
    release(jsonRes({ user: userOf('alice') }));
    await pending;
    expect(getSharedMeCache().get(t)).toBeNull();
  });
});

describe('getServerSession — /auth/me deadline (HUNT1020-24)', () => {
  it('a stalled upstream times out into "no user, maybeAuthed iff refresh present" instead of blocking', async () => {
    const ctl = new AbortController();
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(ctl.signal);
    mockFetch.mockImplementation(
      (_url, init) =>
        new Promise((_res, rej) => {
          const sig = init!.signal!;
          if (sig.aborted) rej(sig.reason); // deadline already passed when fetch started
          else sig.addEventListener('abort', () => rej(sig.reason));
        }),
    );
    nextHeaders.cookies.mockResolvedValue(makeCookieStore(makeJwt({ sub: '1', exp: FUTURE }), 'refresh-cookie'));

    const pending = getServerSession();
    await new Promise((r) => setTimeout(r, 0)); // let the fetch start and hang
    expect(mockFetch).toHaveBeenCalledTimes(1);
    ctl.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    const result = await pending;

    expect(timeoutSpy).toHaveBeenCalledWith(2500);
    expect(result.user).toBeNull();
    expect(result.maybeAuthed).toBe(true); // client silent-refresh takes over
    expect(getSharedMeCache().size).toBe(0); // a timeout is never cached
    timeoutSpy.mockRestore();
  });
});
