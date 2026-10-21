/**
 * R183 C6: when logout()'s request fails the user still lands on the login page, which now says
 * sign-out could not be confirmed. Real AuthProvider.logout() -> the URL it navigates to -> the
 * real login page reading that URL. Only authApi and the router are modelled.
 */
import React, { Suspense } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

let mockUrl = '/dashboard';
const mockSubs = new Set<() => void>();
const mockReplace = jest.fn((url: string) => { mockUrl = url; mockSubs.forEach((f) => f()); });
jest.mock('next/navigation', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react') as typeof import('react');
  // A router that re-renders subscribers on replace(), as Next does.
  const useUrl = () => R.useSyncExternalStore(
    (f) => { mockSubs.add(f); return () => { mockSubs.delete(f); }; },
    () => mockUrl,
    () => mockUrl,
  );
  return {
    useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
    usePathname: () => useUrl().split('?')[0],
    useSearchParams: () => {
      const url = useUrl();
      return R.useMemo(() => new URL(url, 'http://localhost').searchParams, [url]);
    },
  };
});
jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(), verify2FA: jest.fn(), logout: jest.fn(), refresh: jest.fn(), me: jest.fn(), register: jest.fn(),
}));

import * as authApi from '../../lib/api/auth';
import { AuthProvider, useAuth, type AuthContextValue } from '../../lib/auth/AuthProvider';
import { ToastProvider } from '../../components/Toast';
import LoginPage from '../../app/login/page';

const mockLogout = authApi.logout as jest.Mock;
const mockLogin = authApi.login as jest.Mock;
const USER = { id: 1, username: 'alice', email: null, roles: [] };
const NOTICE = /couldn.t confirm you were signed out\./i;

const held = {} as { auth: AuthContextValue };
function Probe() {
  const a = useAuth();
  React.useEffect(() => { held.auth = a; });
  return null;
}
function mount(user: typeof USER | null, initialMaybeAuthed = false) {
  return render(
    <AuthProvider initialUser={user} initialMaybeAuthed={initialMaybeAuthed}>
      <ToastProvider>
        <Probe />
        <Suspense fallback={null}><LoginPage /></Suspense>
      </ToastProvider>
    </AuthProvider>,
  );
}

beforeEach(() => { jest.clearAllMocks(); mockUrl = '/dashboard'; });

describe('sign-out failure shapes land on /login WITH the notice', () => {
  it.each([
    ['network error', () => Promise.reject(Object.assign(new Error('x'), { name: 'ApiError', status: 0 }))],
    ['BFF 500', () => Promise.reject(Object.assign(new Error('x'), { name: 'ApiError', status: 500 }))],
    ['client timeout', () => Promise.reject(Object.assign(new Error('x'), { name: 'ApiError', status: 0, code: 'timeout' }))],
  ])('%s', async (_n, impl) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockLogout.mockImplementation(impl);
    mount(USER);
    await act(async () => { await held.auth.logout(); });
    expect(mockUrl).toBe('/login?reauth=1&signout=unconfirmed');
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(NOTICE);
    warn.mockRestore();
  });
});

describe('everything else shows no notice', () => {
  it('a successful logout lands on /login?reauth=1 without the line', async () => {
    mockLogout.mockResolvedValue({ ok: true });
    mount(USER);
    await act(async () => { await held.auth.logout(); });
    expect(mockUrl).toBe('/login?reauth=1');
    await screen.findByRole('heading', { name: /welcome back/i });
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('a plain /login visit shows no line', async () => {
    mockUrl = '/login';
    mount(null);
    await screen.findByRole('heading', { name: /welcome back/i });
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it('only the exact value counts: ?signout=other shows no line', async () => {
    mockUrl = '/login?signout=other';
    mount(null);
    await screen.findByRole('heading', { name: /welcome back/i });
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});

describe('"Sign out again" (R192)', () => {
  const FAIL_HREF = '/login?reauth=1&signout=unconfirmed';
  const again = () => screen.getByRole('button', { name: /sign out again/i });

  it('page load with the param makes ZERO logout calls, even for the full crafted link', async () => {
    mockUrl = FAIL_HREF;
    mount(null);
    await screen.findByRole('status');
    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('click -> exactly one logout call -> /login?reauth=1, notice gone', async () => {
    mockUrl = FAIL_HREF;
    mockLogout.mockResolvedValue({ ok: true });
    mount(null);
    fireEvent.click(again());
    await waitFor(() => expect(mockUrl).toBe('/login?reauth=1'));
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockLogout.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('failure keeps the notice, says so in one short line, goes nowhere, and can be retried', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockUrl = FAIL_HREF;
    mockLogout.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 0, code: 'network' }));
    mount(null);
    fireEvent.click(again());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/didn.t work either/i));
    expect(screen.getByRole('status')).toHaveTextContent(NOTICE);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockUrl).toBe(FAIL_HREF);
    expect(again()).not.toHaveAttribute('aria-disabled');
    mockLogout.mockResolvedValueOnce({ ok: true });
    fireEvent.click(again());
    await waitFor(() => expect(mockUrl).toBe('/login?reauth=1'));
    expect(mockLogout).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('is disabled while in flight and two clicks in one tick send one request', async () => {
    mockUrl = FAIL_HREF;
    let done!: () => void;
    mockLogout.mockImplementation(() => new Promise((r) => { done = () => r({ ok: true }); }));
    mount(null);
    fireEvent.click(again());
    fireEvent.click(again());
    expect(again()).toHaveAttribute('aria-disabled', 'true');
    expect(again()).toHaveAttribute('aria-busy', 'true');
    expect(again()).not.toBeDisabled(); // `disabled` would drop keyboard focus to <body> (jsdom cannot show that)
    expect(mockLogout).toHaveBeenCalledTimes(1);
    await act(async () => { done(); });
    await waitFor(() => expect(mockUrl).toBe('/login?reauth=1'));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('keeps keyboard focus on the button after a failed retry (aria-disabled, never disabled)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockUrl = FAIL_HREF;
    mockLogout.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 0, code: 'network' }));
    mount(null);
    const btn = again();
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/didn.t work either/i));
    expect(btn).not.toBeDisabled();
    expect(document.activeElement).toBe(btn);
    warn.mockRestore();
  });

  it('the failure line disappears while the next attempt is in flight', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockUrl = FAIL_HREF;
    mockLogout.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 0 }));
    mount(null);
    fireEvent.click(again());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/didn.t work either/i));
    mockLogout.mockImplementation(() => new Promise(() => {})); // never settles
    fireEvent.click(again());
    expect(screen.getByRole('status')).not.toHaveTextContent(/didn.t work either/i);
    expect(screen.getByRole('status')).toHaveTextContent(NOTICE);
    warn.mockRestore();
  });

  describe('a successful retry clears what the first sign-out left in the provider', () => {
    it('user', async () => {
      mockUrl = FAIL_HREF;
      mockLogout.mockResolvedValue({ ok: true });
      mount(USER); // stale: the first sign-out failed before it could clear anything
      expect(held.auth.user).not.toBeNull();
      fireEvent.click(again());
      await waitFor(() => expect(mockUrl).toBe('/login?reauth=1'));
      expect(held.auth.user).toBeNull();
    });

    it('maybeAuthed (silent refresh still pending)', async () => {
      mockUrl = FAIL_HREF;
      (authApi.refresh as jest.Mock).mockImplementation(() => new Promise(() => {}));
      mockLogout.mockResolvedValue({ ok: true });
      mount(null, true);
      expect(held.auth.maybeAuthed).toBe(true);
      fireEvent.click(again());
      await waitFor(() => expect(mockUrl).toBe('/login?reauth=1'));
      expect(held.auth.maybeAuthed).toBe(false);
    });

    it('authError (silent refresh failed with a retryable error)', async () => {
      // The silent refresh does not run ON /login (TAV-LOGIN-BG-REFRESH-RACE): the error is left by a
      // protected page's refresh, and the user then reaches the login page's notice.
      mockUrl = '/dashboard';
      (authApi.refresh as jest.Mock).mockRejectedValue(Object.assign(new Error('x'), { status: 503, code: 'refresh_unavailable' }));
      mockLogout.mockResolvedValue({ ok: true });
      mount(null, true);
      await waitFor(() => expect(held.auth.authError).not.toBeNull());
      await act(async () => { mockUrl = FAIL_HREF; mockSubs.forEach((f) => f()); });
      fireEvent.click(again());
      await waitFor(() => expect(mockUrl).toBe('/login?reauth=1'));
      expect(held.auth.authError).toBeNull();
    });
  });

  it('a failed retry logs "staying on the login page", not "navigating"', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockUrl = FAIL_HREF;
    mockLogout.mockRejectedValueOnce(Object.assign(new Error('secret'), { name: 'Error', status: 0, code: 'timeout' }));
    mount(null);
    fireEvent.click(again());
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn).toHaveBeenCalledWith('[auth] logout call failed; staying on the login page', { name: 'Error', status: 0, code: 'timeout' });
    warn.mockRestore();
  });

  describe('exclusive with signing in', () => {
    const fillAndSubmit = () => {
      fireEvent.change(screen.getByLabelText('Tavern handle'), { target: { value: 'bob' } });
      fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'pw' } });
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    };

    it('a pending retry blocks sign-in: zero login calls, submit button inert', async () => {
      mockUrl = FAIL_HREF;
      mockLogout.mockImplementation(() => new Promise(() => {}));
      mount(null);
      fireEvent.click(again());
      fillAndSubmit();
      expect(mockLogin).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /open the door/i })).toBeDisabled();
    });

    it('a sign-in that just succeeded (page navigating away) blocks the retry too', async () => {
      mockUrl = FAIL_HREF;
      mockLogin.mockResolvedValue({ kind: 'ok', user: USER });
      mockReplace.mockImplementationOnce(() => {}); // navigation is in progress: the page is still on screen
      mount(null);
      fillAndSubmit();
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
      fireEvent.click(again());
      expect(mockLogout).not.toHaveBeenCalled();
      expect(again()).toHaveAttribute('aria-disabled', 'true');
    });

    it('a submitting sign-in blocks the retry: zero logout calls', async () => {
      mockUrl = FAIL_HREF;
      mockLogin.mockImplementation(() => new Promise(() => {}));
      mount(null);
      fillAndSubmit();
      await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(1));
      fireEvent.click(again());
      expect(mockLogout).not.toHaveBeenCalled();
      expect(again()).toHaveAttribute('aria-disabled', 'true');
    });
  });

  it('the notice is described to the handle input (alongside nothing else when idle)', async () => {
    mockUrl = FAIL_HREF;
    mount(null);
    const notice = await screen.findByRole('status');
    expect(notice).toHaveAttribute('id', 'signout-notice');
    expect(notice).not.toHaveTextContent(/sign out again/i); // description / announcement exclude the button
    expect(screen.getByLabelText('Tavern handle')).toHaveAttribute('aria-describedby', 'signout-notice');
  });

  it('no notice -> no aria-describedby on the handle input', async () => {
    mockUrl = '/login?reauth=1';
    mount(null);
    await screen.findByRole('heading', { name: /welcome back/i });
    expect(screen.getByLabelText('Tavern handle')).not.toHaveAttribute('aria-describedby');
  });
});

describe('a forged ?signout=unconfirmed is informational only', () => {
  it('shows the line, calls no API, navigates nowhere, and leaves the form usable', async () => {
    mockUrl = '/login?signout=unconfirmed';
    mount(null);
    expect(await screen.findByRole('status')).toHaveTextContent(NOTICE);
    await waitFor(() => expect(screen.getByLabelText('Tavern handle')).toBeEnabled());
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
    expect(authApi.login).not.toHaveBeenCalled();
  });
});
