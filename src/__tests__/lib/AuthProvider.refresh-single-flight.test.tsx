/**
 * HUNT1020-21 / HUNT1020-25 / TAV-LOGOUT-DURING-INFLIGHT-REFRESH — every AuthProvider refresh writer goes
 * through client.ts refreshSession(), and logout()/retrySignOut() order themselves around it.
 * Real client.ts + AuthProvider; authApi is the mocked transport (so `refresh` calls = requests sent).
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/dashboard',
}));
jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(),
  verify2FA: jest.fn(),
  logout: jest.fn(),
  refresh: jest.fn(),
  me: jest.fn(),
  register: jest.fn(),
}));

import * as authApi from '../../lib/api/auth';
import { AuthProvider, useAuth, type AuthContextValue } from '../../lib/auth/AuthProvider';
import { apiFetch, resetRefreshSessionForTests } from '../../lib/api/client';
import { removeLocks } from '../../test-support/fakeLocks';
import type { User } from '../../lib/api/types';

const mockRefresh = authApi.refresh as jest.Mock;
const mockMe = authApi.me as jest.Mock;
const mockLogout = authApi.logout as jest.Mock;
const ALICE: User = { id: 1, username: 'alice', email: null };

const held = {} as { auth: AuthContextValue };
function Probe() {
  const a = useAuth();
  React.useEffect(() => { held.auth = a; });
  return <span data-testid="who">{a.user?.username ?? 'none'}</span>;
}
const tree = (maybeAuthed = false) => (
  <AuthProvider initialUser={null} initialMaybeAuthed={maybeAuthed}>
    <Probe />
  </AuthProvider>
);

function gate() {
  let settle!: (v?: unknown) => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise((res, rej) => { settle = res; fail = rej; });
  return { promise, settle, fail };
}

let events: string[];
beforeEach(() => {
  jest.clearAllMocks();
  resetRefreshSessionForTests();
  removeLocks();
  events = [];
  mockMe.mockResolvedValue({ user: ALICE });
  mockLogout.mockImplementation(async () => { events.push('logout'); return { ok: true }; });
});

describe('one refresh across writers', () => {
  it('silent refresh on mount + context refresh() + retryAuth() + an apiFetch 401 = ONE refresh request', async () => {
    const g = gate();
    mockRefresh.mockImplementation(() => { events.push('refresh'); return g.promise; });
    (global as Record<string, unknown>).fetch = jest.fn(async () =>
      new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }),
    );
    render(tree(true)); // silent refresh starts
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    let ctxRefresh!: Promise<boolean>;
    let retry!: Promise<void>;
    let api!: Promise<unknown>;
    act(() => {
      ctxRefresh = held.auth.refresh();
      retry = held.auth.retryAuth();
      api = apiFetch('/api/x').catch(() => undefined);
    });
    await act(async () => { g.settle({ ok: true }); await Promise.all([ctxRefresh, retry, api]); });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await expect(ctxRefresh).resolves.toBe(true);
  });
});

describe('logout during an in-flight refresh', () => {
  it.each([
    ['silent refresh', () => { render(tree(true)); return Promise.resolve(); }],
    ['retryAuth', () => { render(tree(false)); return Promise.resolve(held.auth.retryAuth()); }],
    ['context refresh()', () => { render(tree(false)); return Promise.resolve(held.auth.refresh()); }],
  ])('%s: logout is sent after the refresh settles, no refresh starts after, a late result is ignored', async (_n, start) => {
    const g = gate();
    mockRefresh.mockImplementation(() => { events.push('refresh-start'); return g.promise.then(() => { events.push('refresh-end'); return { ok: true }; }); });
    let writer!: Promise<unknown>;
    await act(async () => { writer = start(); });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));

    let out!: Promise<void>;
    act(() => { out = held.auth.logout(); });
    await act(async () => { await Promise.resolve(); });
    expect(events).toEqual(['refresh-start']); // revoke is waiting on the refresh

    await act(async () => {
      g.settle();
      await out;
      await writer;
    });
    expect(events).toEqual(['refresh-start', 'refresh-end', 'logout']);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(held.auth.user).toBeNull(); // the refresh+me that landed did not log the user back in
    expect(held.auth.authError).toBeNull();
  });

  it('a refresh started after logout began is refused: no request, no user', async () => {
    const g = gate();
    mockLogout.mockImplementation(() => { events.push('logout-start'); return g.promise; });
    render(tree(false));
    let out!: Promise<void>;
    act(() => { out = held.auth.logout(); });
    let ok = true;
    await act(async () => { ok = await held.auth.refresh(); });
    expect(ok).toBe(false);
    expect(mockRefresh).not.toHaveBeenCalled();
    await act(async () => { g.settle({ ok: true }); await out; });
    expect(held.auth.user).toBeNull();
  });

  it('retrySignOut waits for an in-flight refresh too', async () => {
    const g = gate();
    mockRefresh.mockImplementation(() => { events.push('refresh-start'); return g.promise.then(() => { events.push('refresh-end'); return { ok: true }; }); });
    render(tree(false));
    let writer!: Promise<boolean>;
    act(() => { writer = held.auth.refresh(); });
    let retry!: Promise<boolean>;
    act(() => { retry = held.auth.retrySignOut(); });
    await act(async () => { await Promise.resolve(); });
    expect(events).toEqual(['refresh-start']);
    await act(async () => { g.settle(); await Promise.all([retry, writer]); });
    expect(events).toEqual(['refresh-start', 'refresh-end', 'logout']);
    await expect(retry).resolves.toBe(true);
    await expect(writer).resolves.toBe(false); // landed after the sign-out began: not reported as a success
  });

  it('refreshes work again after a failed logout settles (unconfirmed sign-out, user goes Back)', async () => {
    mockLogout.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 0, code: 'network' }));
    mockRefresh.mockResolvedValue({ ok: true });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(tree(false));
    await act(async () => { await held.auth.logout(); });
    let ok = false;
    await act(async () => { ok = await held.auth.refresh(); });
    expect(ok).toBe(true);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('refresh failure classification through the provider (unchanged)', () => {
  it.each([
    [500, 'offline'],
    [0, 'offline'],
    [429, 'rate_limited'],
    [401, 'expired'],
    [403, 'expired'],
  ])('retryAuth with refresh %i -> %s', async (status, expected) => {
    mockRefresh.mockRejectedValue(Object.assign(new Error('x'), { status, code: 'e' }));
    (global as Record<string, unknown>).fetch = jest.fn(async () => { throw new TypeError('down'); }); // /me re-check fails
    render(tree(false));
    await act(async () => { await held.auth.retryAuth(); });
    expect(held.auth.authError).toBe(expected);
  });
});
