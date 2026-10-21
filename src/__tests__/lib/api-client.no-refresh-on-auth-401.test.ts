/**
 * @jest-environment node
 *
 * HUNT1020-19 — a 401 from a credential-checking auth endpoint is a wrong credential, not an expired
 * access token. It must not trigger /api/auth/refresh nor replay the credential POST.
 */
import { apiFetch } from '../../lib/api/client';
import * as authApi from '../../lib/api/auth';

const mockFetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  mockFetch.mockReset();
  (global as Record<string, unknown>).fetch = mockFetch;
});

const urls = () => mockFetch.mock.calls.map((c) => String(c[0]));

describe('auth endpoints are exempt from 401 -> refresh -> replay', () => {
  // refresh WOULD succeed, so a (wrong) refresh attempt is visible as a replay.
  beforeEach(() => {
    mockFetch.mockImplementation(async (input) =>
      String(input) === '/api/auth/refresh' ? json({ ok: true }) : json({ error: 'bad credentials' }, 401),
    );
  });

  it('login: one POST, 401 surfaces, no refresh', async () => {
    await expect(authApi.login('alice', 'wrong')).rejects.toMatchObject({ status: 401 });
    expect(urls()).toEqual(['/api/auth/login']);
  });

  it('verify-2fa: one POST, no refresh', async () => {
    await expect(authApi.verify2FA('000000')).rejects.toMatchObject({ status: 401 });
    expect(urls()).toEqual(['/api/auth/login/verify-2fa']);
  });

  it.each([
    ['register', () => authApi.register('a', 'b')],
    ['request-password-reset', () => authApi.requestPasswordReset('a@b.c')],
    ['reset-password', () => authApi.resetPassword('tok', 'pw')],
    ['logout', () => authApi.logout()],
  ])('%s: no refresh on 401', async (name, call) => {
    await expect(call()).rejects.toMatchObject({ status: 401 });
    expect(urls()).toEqual([`/api/auth/${name}`]);
  });

  it('ignores a query string when matching the exempt path', async () => {
    await expect(apiFetch('/api/auth/login?x=1', { method: 'POST', json: {} })).rejects.toMatchObject({ status: 401 });
    expect(urls()).toEqual(['/api/auth/login?x=1']);
  });
});

describe('positive controls: refresh-and-replay still works where a 401 means "expired"', () => {
  it('an ordinary API path refreshes and replays once', async () => {
    mockFetch
      .mockResolvedValueOnce(json({ error: 'unauthorized' }, 401))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ ok: 1 }));
    await expect(apiFetch('/api/dnd/anything')).resolves.toEqual({ ok: 1 });
    expect(urls()).toEqual(['/api/dnd/anything', '/api/auth/refresh', '/api/dnd/anything']);
  });

  it('password/change (wrong current password is 400 upstream, so its 401 is expiry) still refreshes', async () => {
    mockFetch
      .mockResolvedValueOnce(json({ error: 'unauthorized' }, 401))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ msg: 'ok' }));
    await authApi.changePassword('a', 'b');
    expect(urls()).toEqual(['/api/auth/password/change', '/api/auth/refresh', '/api/auth/password/change']);
  });

  it('/api/auth/me still refreshes (that is how an expired access cookie is recovered)', async () => {
    mockFetch
      .mockResolvedValueOnce(json({ error: 'x' }, 401))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ user: { id: 1 } }));
    await authApi.me();
    expect(urls()).toEqual(['/api/auth/me', '/api/auth/refresh', '/api/auth/me']);
  });
});
