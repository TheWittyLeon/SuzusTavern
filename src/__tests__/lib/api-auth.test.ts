/**
 * @jest-environment node
 *
 * Tests for src/lib/api/auth.ts
 *
 * Table-driven — verifies each wrapper calls the correct path/method/body.
 */

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  (global as Record<string, unknown>).fetch = mockFetch;

  mockFetch.mockResolvedValue(
    new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
});

import { login, verify2FA, refresh, me, logout, register } from '../../lib/api/auth';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function lastCall() {
  const [url, init] = mockFetch.mock.calls[
    mockFetch.mock.calls.length - 1
  ] as [string, RequestInit & { body?: string }];
  const body = init.body ? (JSON.parse(init.body as string) as unknown) : undefined;
  return { url, method: init.method ?? 'GET', body };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api/auth.ts', () => {
  it('login — POST /api/auth/login with username+password', async () => {
    await login('alice', 's3cret').catch(() => null);
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/auth/login');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ username: 'alice', password: 's3cret' });
  });

  it('verify2FA — POST /api/auth/login/verify-2fa with totp_code', async () => {
    await verify2FA('123456').catch(() => null);
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/auth/login/verify-2fa');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ totp_code: '123456' });
  });

  it('refresh — POST /api/auth/refresh (no body)', async () => {
    await refresh().catch(() => null);
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/auth/refresh');
    expect(method).toBe('POST');
    expect(body).toBeUndefined();
  });

  it('me — GET /api/auth/me', async () => {
    await me().catch(() => null);
    const { url, method } = lastCall();
    expect(url).toBe('/api/auth/me');
    expect(method).toBe('GET');
  });

  it('logout — POST /api/auth/logout (no body)', async () => {
    await logout().catch(() => null);
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/auth/logout');
    expect(method).toBe('POST');
    expect(body).toBeUndefined();
  });

  it('register — POST /api/auth/register with username+password', async () => {
    await register('bob', 'pass').catch(() => null);
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/auth/register');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ username: 'bob', password: 'pass' });
  });

  it('register — includes optional email when provided', async () => {
    await register('bob', 'pass', 'bob@example.com').catch(() => null);
    const { body } = lastCall();
    expect(body).toMatchObject({ email: 'bob@example.com' });
  });
});
