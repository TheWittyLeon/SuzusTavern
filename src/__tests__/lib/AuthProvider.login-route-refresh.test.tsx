/**
 * TAV-LOGIN-BG-REFRESH-RACE.
 *
 * Reloading /login with only the refresh cookie live (the layout reports `initialMaybeAuthed`) ran
 * the provider's mount-time silent refresh+me ON THE LOGIN PAGE. The login page never reads the user,
 * so the work bought nothing, and it raced "Sign out again": a refresh that landed after a successful
 * retrySignOut() restored the user and re-issued the cookies the sign-out had just cleared.
 *
 * The silent refresh is therefore deferred while the route is /login, and a sign-out (or a sign-in)
 * settles it for good: a later move to a protected page must not resurrect a session the user ended.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';

let mockPathname = '/login';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => mockPathname,
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
import type { User } from '../../lib/api/types';

const mockRefresh = authApi.refresh as jest.Mock;
const mockMe = authApi.me as jest.Mock;
const mockLogout = authApi.logout as jest.Mock;
const mockLogin = authApi.login as jest.Mock;

const ALICE: User = { id: 1, username: 'alice', email: null };

const held = {} as { auth: AuthContextValue };
function Probe() {
  const a = useAuth();
  React.useEffect(() => { held.auth = a; });
  return <span data-testid="who">{a.user?.username ?? 'none'}</span>;
}
const tree = () => (
  <AuthProvider initialUser={null} initialMaybeAuthed>
    <Probe />
  </AuthProvider>
);

/** A refresh that settles when the test says so: the slow background request of the race. */
function deferredRefresh() {
  let settle!: () => void;
  mockRefresh.mockImplementation(() => new Promise<void>((resolve) => { settle = resolve; }));
  mockMe.mockResolvedValue({ user: ALICE });
  return () => settle?.();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPathname = '/login';
  mockLogout.mockResolvedValue(undefined);
});

describe('the background refresh and the login route', () => {
  it('does not run on /login at all', async () => {
    mockRefresh.mockResolvedValue(undefined);
    mockMe.mockResolvedValue({ user: ALICE });
    render(tree());
    await act(async () => {});
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockMe).not.toHaveBeenCalled();
    expect(screen.getByTestId('who')).toHaveTextContent('none');
  });

  it('cannot restore the user after a successful "Sign out again" (the race)', async () => {
    const landRefresh = deferredRefresh();
    render(tree());
    await act(async () => {});
    let ok = false;
    await act(async () => { ok = await held.auth.retrySignOut(); });
    expect(ok).toBe(true);
    await act(async () => { landRefresh(); });
    expect(screen.getByTestId('who')).toHaveTextContent('none');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('still runs once the app leaves /login (a protected page reached with only the refresh cookie)', async () => {
    mockRefresh.mockResolvedValue(undefined);
    mockMe.mockResolvedValue({ user: ALICE });
    const view = render(tree());
    await act(async () => {});
    expect(mockRefresh).not.toHaveBeenCalled();
    mockPathname = '/dashboard';
    view.rerender(tree());
    await act(async () => {});
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('who')).toHaveTextContent('alice');
  });

  it('never runs after a sign-out, even when the app then leaves /login', async () => {
    mockRefresh.mockResolvedValue(undefined);
    const view = render(tree());
    await act(async () => {});
    await act(async () => { await held.auth.retrySignOut(); });
    mockPathname = '/dashboard';
    view.rerender(tree());
    await act(async () => {});
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.getByTestId('who')).toHaveTextContent('none');
  });

  it('never runs after a sign-in on /login (the form already holds a fresh session)', async () => {
    mockLogin.mockResolvedValue({ kind: 'ok', user: ALICE });
    mockRefresh.mockResolvedValue(undefined);
    const view = render(tree());
    await act(async () => {});
    await act(async () => { await held.auth.login('alice', 'pw'); });
    mockPathname = '/dashboard';
    view.rerender(tree());
    await act(async () => {});
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.getByTestId('who')).toHaveTextContent('alice');
  });
});
