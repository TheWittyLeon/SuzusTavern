/**
 * @jest-environment <rootDir>/src/test-utils/jsdom-with-fetch-env.js
 *
 * HUNT1020-04 — a locked account (Auth-Python 423) is not a network failure. Real auth client and
 * real login page; only the BFF's answers are faked.
 */
import React, { Suspense } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/login',
}));
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ToastProvider } from '../../components/Toast';
import LoginPage from '../../app/login/page';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

async function submitLogin() {
  render(
    <AuthProvider initialUser={null}>
      <ToastProvider>
        <Suspense fallback={null}>
          <LoginPage />
        </Suspense>
      </ToastProvider>
    </AuthProvider>,
  );
  fireEvent.change(await screen.findByLabelText('Tavern handle'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'right-one' } });
  await act(async () => { fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

afterEach(() => jest.useRealTimers());

it('423 with locked_until: says the account is locked and for how long, never "check your connection"', async () => {
  const until = new Date(Date.now() + 12 * 60_000).toISOString().replace(/\.\d+Z$/, ''); // naive UTC, like Auth-Python
  global.fetch = jest.fn((p: string) =>
    p === '/api/auth/login' ? json(423, { msg: 'account locked', locked_until: until }) : json(404, {}),
  ) as unknown as typeof fetch;
  await submitLogin();
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(/locked/i);
  expect(alert).toHaveTextContent(/about 1[123] minutes/);
  expect(screen.queryByText(/Can.t reach the tavern/)).not.toBeInTheDocument();
  expect(mockReplace).not.toHaveBeenCalled();
});

it('423 without locked_until: honest generic copy', async () => {
  global.fetch = jest.fn(() => json(423, { msg: 'account locked' })) as unknown as typeof fetch;
  await submitLogin();
  expect(screen.getByRole('alert')).toHaveTextContent(/locked.*little while/i);
  expect(screen.queryByText(/Can.t reach the tavern/)).not.toBeInTheDocument();
});

// HUNT1020-19 through the real page: a typo sends ONE credential POST even with a live refresh cookie.
it('wrong passphrase with a live refresh cookie sends the login once, not twice', async () => {
  const calls: string[] = [];
  global.fetch = jest.fn((p: string) => {
    calls.push(p);
    if (p === '/api/auth/login') return json(401, { msg: 'bad credentials' });
    if (p === '/api/auth/refresh') return json(200, { ok: true });
    return json(404, {});
  }) as unknown as typeof fetch;
  await submitLogin();
  expect(calls).toEqual(['/api/auth/login']);
  expect(screen.getByRole('alert')).toHaveTextContent(/Wrong handle or passphrase/);
});

it('positive control: a genuine network failure still says so', async () => {
  global.fetch = jest.fn(() => Promise.reject(new TypeError('failed'))) as unknown as typeof fetch;
  await submitLogin();
  expect(screen.getByText(/Can.t reach the tavern/)).toBeInTheDocument();
});
