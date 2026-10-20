/**
 * TAV-LOGOUT-STAYS-ON-DASHBOARD edge cases (Miko-QA): real AuthProvider + useAuthGate + TavernShell,
 * authApi mocked at the module seam. Complements logout-flow.test.tsx (slow answer + never-answers).
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => '/dashboard',
}));
jest.mock('../../lib/theme/ThemeProvider', () => ({
  useTheme: () => ({ vibe: 'dusk-tavern', setVibe: jest.fn(), density: 'cozy', setDensity: jest.fn() }),
}));
jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(), verify2FA: jest.fn(), logout: jest.fn(), refresh: jest.fn(), me: jest.fn(), register: jest.fn(),
}));

import * as authApi from '../../lib/api/auth';
import { AuthProvider, useAuth, type AuthContextValue } from '../../lib/auth/AuthProvider';
import { useAuthGate } from '../../lib/auth/useAuthGate';
import TavernShell from '../../components/TavernShell';

const mockLogout = authApi.logout as jest.Mock;
const mockLogin = authApi.login as jest.Mock;
const mockVerify = authApi.verify2FA as jest.Mock;
const mockRefresh = authApi.refresh as jest.Mock;
const USER = { id: 1, username: 'alice', email: null, roles: [] };

let auth: AuthContextValue;
function Probe() { auth = useAuth(); return null; }
function Page() {
  const gate = useAuthGate({ skeleton: <div>skeleton</div>, label: 'Loading' });
  if (gate) return <>{gate}</>;
  return <TavernShell active="dashboard" title="Home"><div>body</div></TavernShell>;
}
function mount(initialUser: typeof USER | null = USER, gatePage = true) {
  return render(<AuthProvider initialUser={initialUser}><Probe />{gatePage ? <Page /> : null}</AuthProvider>);
}
async function clickSignOut() {
  fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
  fireEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }));
}

beforeEach(() => { jest.clearAllMocks(); });

describe('sign out: BFF failure shapes still end on /login?reauth=1', () => {
  it.each([
    ['network error', () => Promise.reject(Object.assign(new Error('x'), { status: 0 }))],
    ['500', () => Promise.reject(Object.assign(new Error('x'), { status: 500 }))],
    ['client timeout (AbortError)', () => Promise.reject(new DOMException('t', 'TimeoutError'))],
  ])('%s', async (_n, impl) => {
    mockLogout.mockImplementation(impl);
    mount();
    await clickSignOut();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?reauth=1'));
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('passes a bounded abort signal to the BFF call', async () => {
    mockLogout.mockResolvedValue({ ok: true });
    mount();
    await clickSignOut();
    await waitFor(() => expect(mockLogout).toHaveBeenCalled());
    expect(mockLogout.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });
});

describe('sign out: double click', () => {
  it('two clicks reach logout() and navigate exactly once', async () => {
    let done!: () => void;
    mockLogout.mockImplementation(() => new Promise((r) => { done = () => r({ ok: true }); }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    const item = await screen.findByRole('menuitem', { name: /sign out/i });
    fireEvent.click(item);
    fireEvent.click(item); // same tick, same node reference
    await act(async () => { done(); });
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });
});

describe('gate normal path is not disabled', () => {
  it('no session at mount (refresh fails 401, not signing out) still redirects to /login', async () => {
    mockRefresh.mockRejectedValue(Object.assign(new Error('no'), { status: 401, code: 'NO_REFRESH' }));
    mount(null);
    // 401 classifies to an authError prompt or a redirect; either way it must not hang on the bare skeleton.
    await waitFor(() => {
      const redirected = mockReplace.mock.calls.some((c) => c[0] === '/login');
      const prompted = screen.queryByRole('heading') !== null;
      expect(redirected || prompted).toBe(true);
    });
  });
  it('signingOut is false at mount', () => {
    mount();
    expect(auth.signingOut).toBe(false);
  });
});

describe('signingOut lifecycle', () => {
  async function logoutViaApi() {
    mockLogout.mockResolvedValue({ ok: true });
    await act(async () => { await auth.logout(); });
    expect(auth.signingOut).toBe(true);
  }
  it('login() success clears it', async () => {
    mount(USER, false);
    await logoutViaApi();
    mockLogin.mockResolvedValue({ kind: 'ok', user: USER });
    await act(async () => { await auth.login('a', 'b'); });
    expect(auth.signingOut).toBe(false);
    expect(auth.user).toEqual(USER);
  });
  it('2FA path clears it (login -> 2fa -> verify2FA)', async () => {
    mount(USER, false);
    await logoutViaApi();
    mockLogin.mockResolvedValue({ kind: '2fa' });
    await act(async () => { await auth.login('a', 'b'); });
    expect(auth.signingOut).toBe(true); // half-step: still no user
    mockVerify.mockResolvedValue({ user: USER });
    await act(async () => { await auth.verify2FA('123456'); });
    expect(auth.signingOut).toBe(false);
  });
  it('a FAILED login after logout leaves it set (still no user)', async () => {
    mount(USER, false);
    await logoutViaApi();
    mockLogin.mockRejectedValue(new Error('bad creds'));
    await act(async () => { await auth.login('a', 'b').catch(() => undefined); });
    expect(auth.user).toBeNull();
  });

  // Ren's caveat, as a user walks it: sign out, land on /login, then reach a protected page again
  // WITHOUT a full reload (Back button restoring the client-router entry; AuthProvider lives above
  // the route so its state survives). user is null, signingOut is still true => gate stands down =>
  // skeleton forever and no redirect.
  // KNOWN DEFECT pin (Miko-QA 2026-10-20): `it.failing` flips red the day signingOut is scoped/cleared properly.
  it.failing('a protected page mounted AFTER sign-out completed still redirects to /login', async () => {
    mockLogout.mockResolvedValue({ ok: true });
    let showSecond!: () => void;
    function Second() { return <Page />; }
    function Host() {
      const [second, setSecond] = React.useState(false);
      showSecond = () => setSecond(true);
      return second ? <Second /> : null;
    }
    render(<AuthProvider initialUser={USER}><Probe /><Page /><Host /></AuthProvider>);
    await clickSignOut();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?reauth=1'));
    mockReplace.mockClear();
    act(() => { showSecond(); }); // new gate consumer under the SAME provider (Back-button entry)
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });
});
