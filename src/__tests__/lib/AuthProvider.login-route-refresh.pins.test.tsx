/**
 * TAV-LOGIN-BG-REFRESH-RACE / TAV-CHANGE-PASSPHRASE-SIGNOUT: pins for the mutants the first tests let
 * survive (Kage review of ef4c090). Real AuthProvider and real ChangePassphrasePanel, only the API
 * wrappers and the router are faked.
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

let mockPathname = '/login';
const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: jest.fn() }),
  usePathname: () => mockPathname,
}));
jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(), verify2FA: jest.fn(), logout: jest.fn(), refresh: jest.fn(), me: jest.fn(), register: jest.fn(),
  changePassword: jest.fn(), passwordPolicy: jest.fn(),
}));
import * as authApi from '../../lib/api/auth';
import { AuthProvider, useAuth, type AuthContextValue } from '../../lib/auth/AuthProvider';
import ChangePassphrasePanel from '../../components/ChangePassphrasePanel';

const ALICE = { id: 1, username: 'alice', email: null } as never;
const held = {} as { auth: AuthContextValue };
function Probe() { const a = useAuth(); React.useEffect(() => { held.auth = a; }); return null; }
const tree = (strict = false) => {
  const t = (<AuthProvider initialUser={null} initialMaybeAuthed><Probe /></AuthProvider>);
  return strict ? <React.StrictMode>{t}</React.StrictMode> : t;
};
beforeEach(() => { jest.clearAllMocks(); mockPathname = '/login'; (authApi.logout as jest.Mock).mockResolvedValue(undefined); });

describe('mount-time loading is released by every exit from it', () => {
  it('retrySignOut on /login', async () => {
    render(tree()); await act(async () => {});
    expect(held.auth.loading).toBe(true);
    await act(async () => { await held.auth.retrySignOut(); });
    expect(held.auth.loading).toBe(false);
  });
  it('logout on /login', async () => {
    render(tree()); await act(async () => {});
    await act(async () => { await held.auth.logout(); });
    expect(held.auth.loading).toBe(false);
  });
  it('login ok clears maybeAuthed (authReady = !loading && !maybeAuthed)', async () => {
    (authApi.login as jest.Mock).mockResolvedValue({ kind: 'ok', user: ALICE });
    render(tree()); await act(async () => {});
    await act(async () => { await held.auth.login('a', 'b'); });
    expect([held.auth.loading, held.auth.maybeAuthed]).toEqual([false, false]);
  });
  it('verify2FA clears maybeAuthed and settles the deferred refresh', async () => {
    (authApi.login as jest.Mock).mockResolvedValue({ kind: '2fa' });
    (authApi.verify2FA as jest.Mock).mockResolvedValue({ user: ALICE });
    const v = render(tree()); await act(async () => {});
    await act(async () => { await held.auth.login('a', 'b'); });
    await act(async () => { await held.auth.verify2FA('123456'); });
    expect([held.auth.loading, held.auth.maybeAuthed]).toEqual([false, false]);
    mockPathname = '/dashboard'; v.rerender(tree()); await act(async () => {});
    expect(authApi.refresh).not.toHaveBeenCalled();
  });
});

describe('the silent refresh under React.StrictMode and route changes', () => {
  it('StrictMode: a cold load on a protected page settles (refresh once, user lands)', async () => {
    mockPathname = '/dashboard';
    (authApi.refresh as jest.Mock).mockResolvedValue(undefined);
    (authApi.me as jest.Mock).mockResolvedValue({ user: ALICE });
    render(tree(true)); await act(async () => {}); await act(async () => {});
    expect(authApi.refresh).toHaveBeenCalledTimes(1);
    expect([held.auth.user, held.auth.loading]).toEqual([ALICE, false]);
  });
  it('a route change mid-refresh does not abandon it (cancel only on unmount)', async () => {
    mockPathname = '/dashboard';
    let settle!: () => void;
    (authApi.refresh as jest.Mock).mockImplementation(() => new Promise<void>((r) => { settle = r; }));
    (authApi.me as jest.Mock).mockResolvedValue({ user: ALICE });
    const v = render(tree()); await act(async () => {});
    mockPathname = '/login'; v.rerender(tree()); await act(async () => {});
    mockPathname = '/lobby'; v.rerender(tree()); await act(async () => {});
    await act(async () => { settle(); }); await act(async () => {});
    expect([held.auth.user, held.auth.loading]).toEqual([ALICE, false]);
  });
});

describe('passphrase failure does not sign out (real provider)', () => {
  it.each([
    ['400 field errors', Object.assign(new Error('bad'), { status: 400, body: { errors: ['nope'] } })],
    ['429', Object.assign(new Error('slow'), { status: 429, body: {} })],
    ['network', new Error('down')],
  ])('%s', async (_n, err) => {
    jest.useFakeTimers();
    try {
      (authApi.passwordPolicy as jest.Mock).mockResolvedValue({ min_length: 8 });
      (authApi.changePassword as jest.Mock).mockRejectedValue(err);
      render(<AuthProvider initialUser={ALICE}><ChangePassphrasePanel /><Probe /></AuthProvider>);
      await act(async () => {});
      fireEvent.change(screen.getByLabelText('Current passphrase'), { target: { value: 'old-one' } });
      fireEvent.change(screen.getByLabelText('New passphrase'), { target: { value: 'Brand-New-1!' } });
      fireEvent.change(screen.getByLabelText('Confirm new passphrase'), { target: { value: 'Brand-New-1!' } });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /change passphrase/i })); });
      await act(async () => { jest.advanceTimersByTime(5000); });
      expect(authApi.logout).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(held.auth.user).toEqual(ALICE);
    } finally { jest.useRealTimers(); }
  });
  it('positive control: success does sign out on the same harness', async () => {
    jest.useFakeTimers();
    try {
      (authApi.passwordPolicy as jest.Mock).mockResolvedValue({ min_length: 8 });
      (authApi.changePassword as jest.Mock).mockResolvedValue({ msg: 'ok' });
      render(<AuthProvider initialUser={ALICE}><ChangePassphrasePanel /><Probe /></AuthProvider>);
      await act(async () => {});
      fireEvent.change(screen.getByLabelText('Current passphrase'), { target: { value: 'old-one' } });
      fireEvent.change(screen.getByLabelText('New passphrase'), { target: { value: 'Brand-New-1!' } });
      fireEvent.change(screen.getByLabelText('Confirm new passphrase'), { target: { value: 'Brand-New-1!' } });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /change passphrase/i })); });
      await act(async () => { jest.advanceTimersByTime(5000); });
      expect(authApi.logout).toHaveBeenCalledTimes(1);
      expect(held.auth.user).toBeNull();
    } finally { jest.useRealTimers(); }
  });
});
