/**
 * @jest-environment node
 *
 * HUNT1020-21 / HUNT1020-25 — client.ts refreshSession(): single flight, cross-tab lock + /me re-check,
 * 401-but-session-live = success, and runSignOut() ordering. Real client.ts and auth.ts; only fetch and
 * navigator.locks are fakes.
 */
import {
  apiFetch,
  refreshSession,
  resetRefreshSessionForTests,
  runSignOut,
} from '../../lib/api/client';
import { installFakeLocks, removeLocks } from '../../test-support/fakeLocks';

const mockFetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const urls = () => mockFetch.mock.calls.map((c) => String(c[0]));
const count = (u: string) => urls().filter((x) => x === u).length;

interface Deferred<T> { promise: Promise<T>; resolve(v: T): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Route table: path -> responder. Unlisted paths fail loudly. */
function route(table: Record<string, () => Response | Promise<Response>>) {
  mockFetch.mockImplementation(async (input) => {
    const h = table[String(input)];
    if (!h) throw new Error(`unexpected fetch ${String(input)}`);
    return h();
  });
}

const ME_OK = () => json({ user: { id: 1, username: 'alice' } });
const ME_401 = () => json({ error: 'no_access_token' }, 401);

beforeEach(() => {
  mockFetch.mockReset();
  (global as Record<string, unknown>).fetch = mockFetch;
  resetRefreshSessionForTests();
  removeLocks();
});

describe('single flight', () => {
  it('two concurrent callers share one refresh request', async () => {
    const gate = deferred<Response>();
    route({ '/api/auth/refresh': () => gate.promise });
    const a = refreshSession();
    const b = refreshSession();
    gate.resolve(json({ ok: true }));
    await expect(Promise.all([a, b])).resolves.toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
    ]);
    expect(count('/api/auth/refresh')).toBe(1);
  });

  it('two apiFetch 401s plus a direct caller make one refresh', async () => {
    const gate = deferred<Response>();
    let calls = 0;
    route({
      '/api/x': () => (calls++ < 2 ? json({}, 401) : json({ ok: 1 })),
      '/api/auth/refresh': () => gate.promise,
    });
    const p = Promise.all([apiFetch('/api/x'), apiFetch('/api/x'), refreshSession()]);
    await new Promise((r) => setTimeout(r, 0));
    gate.resolve(json({ ok: true }));
    await p;
    expect(count('/api/auth/refresh')).toBe(1);
  });

  it("one caller's abort does not abort the shared request for the other waiter", async () => {
    const gate = deferred<Response>();
    route({ '/api/auth/refresh': () => gate.promise });
    const ctl = new AbortController();
    const impatient = refreshSession({ signal: ctl.signal });
    const patient = refreshSession();
    ctl.abort();
    await expect(impatient).resolves.toMatchObject({ ok: false, status: 0 });
    gate.resolve(json({ ok: true }));
    await expect(patient).resolves.toMatchObject({ ok: true });
    expect(count('/api/auth/refresh')).toBe(1);
  });

  it('a settled refresh is not reused: the next call refreshes again', async () => {
    route({ '/api/auth/refresh': () => json({ ok: true }) });
    await refreshSession();
    await refreshSession();
    expect(count('/api/auth/refresh')).toBe(2);
  });
});

describe('failure classification is unchanged', () => {
  it.each([
    [500, 'refresh_unavailable'],
    [502, 'refresh_unavailable'],
    [429, 'refresh_unavailable'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [422, 'unauthorized'],
  ])('refresh %i -> apiFetch throws %s', async (status, code) => {
    route({
      '/api/x': () => json({}, 401),
      '/api/auth/refresh': () => json({ error: 'refresh_failed', retry_after: 7 }, status),
      '/api/auth/me': ME_401,
    });
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ status, code, body: { retry_after: 7 } });
  });

  it('a network failure is status 0, not a rejection', async () => {
    route({ '/api/auth/refresh': () => { throw new TypeError('down'); } });
    await expect(refreshSession()).resolves.toMatchObject({ ok: false, status: 0 });
  });

  it.each([500, 429])('refresh %i makes NO /api/auth/me re-check (a live-looking session is not proof)', async (status) => {
    route({ '/api/auth/refresh': () => json({}, status), '/api/auth/me': ME_OK });
    await expect(refreshSession()).resolves.toMatchObject({ ok: false, status });
    expect(count('/api/auth/me')).toBe(0);
  });
});

describe('refresh 401 but the session is live (another tab won the rotation)', () => {
  it('is success, and apiFetch replays', async () => {
    let first = true;
    route({
      '/api/x': () => (first ? ((first = false), json({}, 401)) : json({ ok: 1 })),
      '/api/auth/refresh': () => json({ error: 'refresh_failed' }, 401),
      '/api/auth/me': ME_OK,
    });
    await expect(apiFetch('/api/x')).resolves.toEqual({ ok: 1 });
    expect(count('/api/auth/me')).toBe(1);
  });

  it('401 then /me 401 stays "expired"', async () => {
    route({ '/api/auth/refresh': () => json({}, 401), '/api/auth/me': ME_401 });
    await expect(refreshSession()).resolves.toMatchObject({ ok: false, status: 401 });
  });

  it('401 then /me throwing stays "expired" (never a thrown refresh)', async () => {
    route({
      '/api/auth/refresh': () => json({}, 401),
      '/api/auth/me': () => { throw new TypeError('down'); },
    });
    await expect(refreshSession()).resolves.toMatchObject({ ok: false, status: 401 });
  });

  it('a /me 401 during the re-check never starts a nested refresh', async () => {
    route({ '/api/auth/refresh': () => json({}, 401), '/api/auth/me': ME_401 });
    await refreshSession();
    expect(count('/api/auth/refresh')).toBe(1);
  });
});

describe('cross-tab lock (navigator.locks present)', () => {
  it('runs inside st-refresh and skips the refresh when /me is already fine', async () => {
    const locks = installFakeLocks();
    route({ '/api/auth/me': ME_OK, '/api/auth/refresh': () => json({ ok: true }) });
    await expect(refreshSession()).resolves.toMatchObject({ ok: true });
    expect(locks.requests).toEqual(['st-refresh']);
    expect(urls()).toEqual(['/api/auth/me']); // me-OK skip: no refresh request at all
  });

  it('refreshes when /me says the session is gone (exactly one /me and one refresh)', async () => {
    installFakeLocks();
    route({ '/api/auth/me': ME_401, '/api/auth/refresh': () => json({ ok: true }) });
    await expect(refreshSession()).resolves.toMatchObject({ ok: true });
    expect(urls()).toEqual(['/api/auth/me', '/api/auth/refresh']);
  });

  it('two tabs queue on the lock: the second finds /me fine and does not refresh (AC-7 count)', async () => {
    installFakeLocks();
    let rotated = false;
    route({
      '/api/auth/me': () => (rotated ? ME_OK() : ME_401()),
      '/api/auth/refresh': () => { rotated = true; return json({ ok: true }); },
    });
    // Simulate a second tab: call the underlying lock holder by running a refresh in "another module
    // instance" is not possible here, so two sequential locked refreshes stand in for it.
    await refreshSession();
    await refreshSession();
    expect(count('/api/auth/refresh')).toBe(1);
    expect(count('/api/auth/me')).toBe(2);
  });

  it('a lock that never frees resolves as "no answer" instead of hanging (bounded)', async () => {
    // AbortSignal.timeout is not driven by jest's fake timers: hand the lock wait a signal we fire.
    const ctl = new AbortController();
    const spy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(ctl.signal);
    try {
      Object.defineProperty(globalThis.navigator, 'locks', {
        configurable: true,
        value: {
          request: (_n: string, o: { signal: AbortSignal }) =>
            new Promise((_res, rej) =>
              o.signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))),
            ),
        },
      });
      const p = refreshSession();
      ctl.abort();
      await expect(p).resolves.toMatchObject({ ok: false, status: 0 });
      expect(spy).toHaveBeenCalledWith(15_000);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('runSignOut', () => {
  it('awaits an in-flight refresh before sending, and refuses new refreshes meanwhile', async () => {
    const gate = deferred<Response>();
    const order: string[] = [];
    route({
      '/api/auth/refresh': async () => { order.push('refresh-start'); const r = await gate.promise; order.push('refresh-end'); return r; },
    });
    const inflight = refreshSession();
    const out = runSignOut(async () => { order.push('logout'); return 'done'; });
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['refresh-start']); // logout is waiting
    // A new refresh now: refused, no fetch
    await expect(refreshSession()).resolves.toMatchObject({ ok: false, status: 401, body: { error: 'signed_out' } });
    gate.resolve(json({ ok: true }));
    await expect(out).resolves.toBe('done');
    await inflight;
    expect(order).toEqual(['refresh-start', 'refresh-end', 'logout']);
    expect(count('/api/auth/refresh')).toBe(1);
  });

  it('with the lock present, the logout request runs inside st-refresh', async () => {
    const locks = installFakeLocks();
    await runSignOut(async () => 'ok');
    expect(locks.requests).toEqual(['st-refresh']);
  });

  it('a refresh still queued for the lock when sign-out starts makes no request at all', async () => {
    installFakeLocks();
    const meGate = deferred<Response>();
    route({ '/api/auth/me': () => meGate.promise, '/api/auth/refresh': () => json({ ok: true }) });
    const inflight = refreshSession(); // queued for the lock, its callback has not run yet
    const out = runSignOut(async () => 'done');
    meGate.resolve(ME_401());
    await out;
    await expect(inflight).resolves.toMatchObject({ ok: false, body: { error: 'signed_out' } });
    expect(urls()).toEqual([]); // not even the /me pre-check: the sign-out check comes first
  });

  it('proceeds (and sends the revoke) when the in-flight refresh outlives the wait bound', async () => {
    jest.useFakeTimers();
    try {
      route({ '/api/auth/refresh': () => new Promise<Response>(() => { /* never answers */ }) });
      void refreshSession();
      const sent = jest.fn(async () => 'revoked');
      const out = runSignOut(sent);
      await jest.advanceTimersByTimeAsync(5_000);
      expect(sent).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(2_000);
      await expect(out).resolves.toBe('revoked');
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-allows refreshes once the sign-out settles, even when the revoke fails', async () => {
    await expect(runSignOut(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    route({ '/api/auth/refresh': () => json({ ok: true }) });
    await expect(refreshSession()).resolves.toMatchObject({ ok: true });
  });
});
