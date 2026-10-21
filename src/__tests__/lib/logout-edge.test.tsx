/**
 * TAV-LOGOUT-STAYS-ON-DASHBOARD edge cases (Miko-QA): real AuthProvider + useAuthGate + TavernShell,
 * authApi mocked at the module seam. Complements logout-flow.test.tsx (slow answer + never-answers).
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// The router moves the pathname (and re-renders subscribers), as Next does: replace('/login?...')
// lands on /login. Reset to /dashboard before each test.
const nav = {
  path: '/dashboard',
  follow: true, // false: replace() is recorded but the pathname stays (to hold signingOut set)
  subs: new Set<() => void>(),
};
const mockReplace = jest.fn((url: string) => {
  if (nav.follow) nav.path = url.split('?')[0];
  nav.subs.forEach((f) => f());
});
jest.mock('next/navigation', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react') as typeof import('react');
  return {
    useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
    usePathname: () =>
      R.useSyncExternalStore(
        (f) => { nav.subs.add(f); return () => { nav.subs.delete(f); }; },
        () => nav.path,
        () => nav.path,
      ),
  };
});
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

const held = {} as { auth: AuthContextValue; showSecond: () => void };
function Probe() {
  const a = useAuth();
  React.useEffect(() => { held.auth = a; });
  return null;
}
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

beforeEach(() => { jest.clearAllMocks(); nav.path = '/dashboard'; nav.follow = true; });

describe('sign out: BFF failure shapes still end on /login?reauth=1 (+ the unconfirmed marker)', () => {
  it.each([
    ['network error', () => Promise.reject(Object.assign(new Error('x'), { status: 0 }))],
    ['500', () => Promise.reject(Object.assign(new Error('x'), { status: 500 }))],
    ['client timeout (TimeoutError)', () => Promise.reject(new DOMException('t', 'TimeoutError'))],
  ])('%s', async (_n, impl) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); // the deliberate failure's log
    mockLogout.mockImplementation(impl);
    mount();
    await clickSignOut();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?reauth=1&signout=unconfirmed'));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('hands the BFF call an AbortSignal (the 5 s bound itself is pinned in logout-flow)', async () => {
    mockLogout.mockResolvedValue({ ok: true });
    mount();
    await clickSignOut();
    await waitFor(() => expect(mockLogout).toHaveBeenCalled());
    expect(mockLogout.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });
});

describe('sign out: double click', () => {
  // End-to-end result only: the gate swaps the shell for the skeleton on the first click, which
  // alone removes the menu item. The button's own disabled={signingOut} guard is NOT what this proves.
  it('two clicks in one tick reach logout() once and navigate once', async () => {
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
  it('never signed in (no user, not signing out) redirects to /login', async () => {
    mount(null);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?reauth=1'));
  });
  it('a refresh the server rejects (401) shows the expired prompt, not a bare skeleton', async () => {
    mockRefresh.mockRejectedValue(Object.assign(new Error('no'), { status: 401, code: 'unauthorized' }));
    render(<AuthProvider initialUser={null} initialMaybeAuthed><Probe /><Page /></AuthProvider>);
    expect(await screen.findByRole('heading', { name: /your session has ended/i })).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
  it('signingOut is false at mount', () => {
    mount();
    expect(held.auth.signingOut).toBe(false);
  });
});

describe('a caller that only awaits logout()', () => {
  it('ends on /login?reauth=1 with no navigation of its own', async () => {
    mockLogout.mockResolvedValue({ ok: true });
    mount(USER, false); // provider only: no shell, no gate, nobody else to navigate
    await act(async () => { await held.auth.logout(); });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/login?reauth=1');
    expect(nav.path).toBe('/login');
    expect(held.auth.signingOut).toBe(false); // arrival ended the in-flight window
  });
  it('warns with the error type (never a value) when the BFF call fails, and still navigates', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockLogout.mockRejectedValue(Object.assign(new Error('secret-token-abc'), { name: 'ApiError', status: 0 }));
    mount(USER, false);
    await act(async () => { await held.auth.logout(); });
    expect(mockReplace).toHaveBeenCalledWith('/login?reauth=1&signout=unconfirmed');
    // Exactly {name, status, code}: the raw error (and its message) must never be a logged argument.
    expect(warn).toHaveBeenCalledWith(expect.any(String), { name: 'ApiError', status: 0, code: undefined });
    warn.mockRestore();
  });
});

describe('logout failure log tells a timeout from a dropped connection', () => {
  it.each(['timeout', 'network'])('logs code %s (never the message)', async (code) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockLogout.mockRejectedValue(Object.assign(new Error('secret-token-abc'), { name: 'Error', status: 0, code }));
    mount(USER, false);
    await act(async () => { await held.auth.logout(); });
    expect(warn).toHaveBeenCalledWith(expect.any(String), { name: 'Error', status: 0, code });
    warn.mockRestore();
  });
});

describe('signingOut lifecycle', () => {
  beforeEach(() => { nav.follow = false; }); // hold the flag: these tests walk what clears it
  async function logoutViaApi() {
    mockLogout.mockResolvedValue({ ok: true });
    await act(async () => { await held.auth.logout(); });
    expect(held.auth.signingOut).toBe(true);
  }
  it('login() success clears it', async () => {
    mount(USER, false);
    await logoutViaApi();
    mockLogin.mockResolvedValue({ kind: 'ok', user: USER });
    await act(async () => { await held.auth.login('a', 'b'); });
    expect(held.auth.signingOut).toBe(false);
    expect(held.auth.user).toEqual(USER);
  });
  it('2FA path clears it (login -> 2fa -> verify2FA)', async () => {
    mount(USER, false);
    await logoutViaApi();
    mockLogin.mockResolvedValue({ kind: '2fa' });
    await act(async () => { await held.auth.login('a', 'b'); });
    expect(held.auth.signingOut).toBe(true); // half-step: still no user
    mockVerify.mockResolvedValue({ user: USER });
    await act(async () => { await held.auth.verify2FA('123456'); });
    expect(held.auth.signingOut).toBe(false);
  });
  it('a FAILED login after logout leaves it set (still no user)', async () => {
    mount(USER, false);
    await logoutViaApi();
    mockLogin.mockRejectedValue(new Error('bad creds'));
    await act(async () => { await held.auth.login('a', 'b').catch(() => undefined); });
    expect(held.auth.user).toBeNull();
    expect(held.auth.signingOut).toBe(true);
  });

  // Ren's caveat, as a user walks it: sign out, land on /login, then reach a protected page again
  // WITHOUT a full reload (Back button restoring the client-router entry; AuthProvider lives above
  // the route so its state survives). user is null, signingOut is still true => gate stands down =>
  // skeleton forever and no redirect.
  it('a protected page mounted AFTER sign-out completed still redirects to /login', async () => {
    nav.follow = true; // this one needs the sign-out to actually arrive on /login
    mockLogout.mockResolvedValue({ ok: true });
    function Second() { return <Page />; }
    function Host() {
      const [second, setSecond] = React.useState(false);
      React.useEffect(() => { held.showSecond = () => setSecond(true); }, []);
      return second ? <Second /> : null;
    }
    render(<AuthProvider initialUser={USER}><Probe /><Page /><Host /></AuthProvider>);
    await clickSignOut();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?reauth=1'));
    mockReplace.mockClear();
    // Back button: the client router returns to /dashboard and mounts a new gate consumer under
    // the SAME provider.
    act(() => { nav.path = '/dashboard'; nav.subs.forEach((f) => f()); held.showSecond(); });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?reauth=1'));
  });
});
