/**
 * HUNT1020-03 — login page consumer of sanitizeNextPath. After a real sign-in (and after 2FA),
 * router.replace must never receive a protocol-relative value from a dot-segment ?next=.
 */
import React, { Suspense } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockReplace = jest.fn();
const mockGet = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({ get: mockGet }),
}));
jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(), verify2FA: jest.fn(), logout: jest.fn(), refresh: jest.fn(), me: jest.fn(), register: jest.fn(),
}));

import * as authApi from '../../lib/api/auth';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ToastProvider } from '../../components/Toast';
import LoginPage from '../../app/login/page';

const mockLogin = authApi.login as jest.MockedFunction<typeof authApi.login>;
const mockVerify2FA = authApi.verify2FA as jest.MockedFunction<typeof authApi.verify2FA>;
const ALICE = { id: 1, username: 'alice', email: null };

const VARIANTS = ['/.//evil.example/signin', '/..//evil.example/signin', '/%2e//evil.example/signin'];

function renderLogin(next: string) {
  mockGet.mockImplementation((k: string) => (k === 'next' ? next : null));
  render(
    <AuthProvider initialUser={null}>
      <ToastProvider>
        <Suspense fallback={null}>
          <LoginPage />
        </Suspense>
      </ToastProvider>
    </AuthProvider>,
  );
}

async function submitCredentials() {
  const handle = await screen.findByLabelText('Tavern handle');
  fireEvent.change(handle, { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'pw' } });
  await act(async () => { fireEvent.submit(handle.closest('form')!); });
}

function expectOnOrigin() {
  expect(mockReplace).toHaveBeenCalledTimes(1);
  const target = mockReplace.mock.calls[0][0] as string;
  // Next resolves router.replace(href) as new URL(href, location.href) and hard-navigates off-origin.
  expect(new URL(target, window.location.href).origin).toBe(window.location.origin);
  expect(target).toBe('/dashboard');
}

beforeEach(() => {
  mockReplace.mockClear();
  mockLogin.mockReset();
  mockVerify2FA.mockReset();
});

describe.each(VARIANTS)('login ?next=%s', (next) => {
  it('password sign-in lands on-origin', async () => {
    mockLogin.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    renderLogin(next);
    await submitCredentials();
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expectOnOrigin();
  });

  it('2FA sign-in lands on-origin', async () => {
    mockLogin.mockResolvedValueOnce({ kind: '2fa', partial_token: 'pt' });
    mockVerify2FA.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    renderLogin(next);
    await submitCredentials();
    const code = await screen.findByLabelText('6-digit authenticator code');
    await act(async () => { fireEvent.change(code, { target: { value: '123456' } }); });
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expectOnOrigin();
  });
});

it('positive control: a legitimate next is still honoured', async () => {
  mockLogin.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
  renderLogin('/lobby');
  await submitCredentials();
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/lobby'));
});
