/**
 * R183 C6: when logout()'s request fails the user still lands on the login page, which now says
 * sign-out could not be confirmed. Real AuthProvider.logout() -> the URL it navigates to -> the
 * real login page reading that URL. Only authApi and the router are modelled.
 */
import React, { Suspense } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

let mockUrl = '/dashboard';
const mockReplace = jest.fn((url: string) => { mockUrl = url; });
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => mockUrl.split('?')[0],
  useSearchParams: () => new URL(mockUrl, 'http://localhost').searchParams,
}));
jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(), verify2FA: jest.fn(), logout: jest.fn(), refresh: jest.fn(), me: jest.fn(), register: jest.fn(),
}));

import * as authApi from '../../lib/api/auth';
import { AuthProvider, useAuth, type AuthContextValue } from '../../lib/auth/AuthProvider';
import { ToastProvider } from '../../components/Toast';
import LoginPage from '../../app/login/page';

const mockLogout = authApi.logout as jest.Mock;
const USER = { id: 1, username: 'alice', email: null, roles: [] };
const NOTICE = /couldn.t confirm you were signed out\. Close the browser to be sure\./i;

const held = {} as { auth: AuthContextValue };
function Probe() {
  const a = useAuth();
  React.useEffect(() => { held.auth = a; });
  return null;
}
function mount(user: typeof USER | null) {
  return render(
    <AuthProvider initialUser={user}>
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
