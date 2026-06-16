/**
 * Sprint 4 gap-fill: login page
 *
 * These tests were NOT covered by the original login.test.tsx. They target
 * the specific risks called out in the Sprint 4 QA scope:
 *
 *  1. sanitizeNext — backslash tricks, encoded chars, query-string preservation,
 *     empty/null fallback
 *  2. Submitting state — inputs disabled, submit disabled, aria-label changes
 *  3. Rate-limit path — countdown starts; submit disabled; no-NaN on missing
 *     retry_after; toast fires with 'warn'
 *  4. Network-error path — status=0, correct message, submit re-enabled
 *  5. 2FA — auto-submit fires exactly once at 6 digits (not at 5); bad TOTP
 *     clears input + shows error; Back clears totp error state
 *
 * Timer strategy: tests that exercise the countdown interval use fake timers
 * to avoid real delays and clean them up to prevent worker teardown leaks.
 * Tests that don't need timers leave them real (faster, no bleed risk).
 */

import React, { Suspense } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Mock next/navigation ──────────────────────────────────────────────────────
const mockReplace = jest.fn();
const mockGet = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({ get: mockGet }),
}));

// ── Mock auth API ─────────────────────────────────────────────────────────────
jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(),
  verify2FA: jest.fn(),
  logout: jest.fn(),
  refresh: jest.fn(),
  me: jest.fn(),
  register: jest.fn(),
}));

// ── Mock useToast ─────────────────────────────────────────────────────────────
const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ toast: mockToast }),
}));

import * as authApi from '../../lib/api/auth';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import LoginPage from '../../app/login/page';
import type { User } from '../../lib/api/types';

const mockLogin    = authApi.login    as jest.MockedFunction<typeof authApi.login>;
const mockVerify2FA = authApi.verify2FA as jest.MockedFunction<typeof authApi.verify2FA>;

const ALICE: User = { id: 1, username: 'alice', email: null };

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderLogin(next: string | null = null) {
  mockGet.mockReturnValue(next);
  return render(
    <AuthProvider initialUser={null}>
      <Suspense fallback={<div>Loading…</div>}>
        <LoginPage />
      </Suspense>
    </AuthProvider>,
  );
}

function makeApiError(
  status: number,
  body?: unknown,
): Error & { status: number; code: string; body?: unknown } {
  const err = new Error('api error') as Error & {
    status: number;
    code: string;
    body?: unknown;
  };
  err.status = status;
  err.code =
    status === 401 ? 'unauthorized'
    : status === 429 ? 'rate_limited'
    : 'network';
  err.body = body;
  return err;
}

async function submitCredentials(handle: string, password: string) {
  const handleInput = screen.getByLabelText('Tavern handle');
  const passInput = screen.getByLabelText('Passphrase');
  fireEvent.change(handleInput, { target: { value: handle } });
  fireEvent.change(passInput, { target: { value: password } });
  await act(async () => {
    fireEvent.submit(handleInput.closest('form')!);
  });
}

// ── Teardown ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockReplace.mockClear();
  mockGet.mockClear();
  mockLogin.mockReset();
  mockVerify2FA.mockReset();
  mockToast.mockClear();
});

afterEach(() => {
  // Restore real timers if a test replaced them
  jest.useRealTimers();
});

// ── 1. sanitizeNext — open-redirect variants ──────────────────────────────────

describe('Login page — sanitizeNext exhaustive guard', () => {
  // Cases that the current guard handles correctly
  const safeCases: Array<[string, string | null, string]> = [
    ['null next falls back to /dashboard',               null,              '/dashboard'],
    ['empty string next falls back to /dashboard',       '',               '/dashboard'],
    ['// double-slash prefix falls back',                '//evil.com',     '/dashboard'],
    ['https:// absolute URL falls back',                 'https://evil.com', '/dashboard'],
    ['http:// absolute URL falls back',                  'http://evil.com', '/dashboard'],
    // Encoded chars — raw param starts with '%', not '/', so falls back
    ['// encoded as %2F%2F falls back (raw param)',      '%2F%2Fevil.com', '/dashboard'],
    // Safe paths — must be preserved
    ['/ root is safe',                                   '/',               '/'],
    ['/dashboard is safe',                               '/dashboard',      '/dashboard'],
    ['/character/new is safe',                           '/character/new',  '/character/new'],
    ['/lobby is safe',                                   '/lobby',          '/lobby'],
    // Deep path with query string — must be preserved exactly
    ['/character/new?tab=spells is safe',                '/character/new?tab=spells', '/character/new?tab=spells'],
    ['/lobby?filter=open#section is safe',               '/lobby?filter=open#section', '/lobby?filter=open#section'],
  ];

  test.each(safeCases)('%s', async (_label, nextParam, expectedRedirect) => {
    mockLogin.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    renderLogin(nextParam);

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(expectedRedirect),
    );
  });
});

// ── sanitizeNext backslash open-redirect (FIXED) ─────────────────────────────
// Regression guard for the backslash trick: '/\\evil.com' satisfies a naive
// `startsWith('/') && !startsWith('//')` check, but browsers normalise '/\' to
// '//' during navigation → protocol-relative open redirect. The guard now uses
// /^\/(?![/\\])/ so the backslash form falls back to /dashboard.

describe('Login page — sanitizeNext backslash open-redirect guard', () => {
  it('rejects the /\\ backslash trick and falls back to /dashboard', async () => {
    mockLogin.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    renderLogin('/\\evil.com');

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/dashboard'),
    );
    expect(mockReplace).not.toHaveBeenCalledWith('/\\evil.com');
  });
});

// ── 2. Submitting state ───────────────────────────────────────────────────────

describe('Login page — submitting state', () => {
  it('disables submit button while submitting', async () => {
    // Never resolves — leaves us in submitting state
    mockLogin.mockReturnValue(new Promise(() => { /* never */ }));
    renderLogin();

    await screen.findByLabelText('Tavern handle');

    // Find the submit button by its aria-label (idle = 'Sign in')
    const submitBtn = screen.getByRole('button', { name: /sign in/i });
    expect(submitBtn).not.toBeDisabled();

    act(() => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    // After submit kicks off, button should be disabled
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled(),
    );
  });

  it('disables handle input while submitting', async () => {
    mockLogin.mockReturnValue(new Promise(() => { /* never */ }));
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    act(() => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Tavern handle')).toBeDisabled(),
    );
  });

  it('disables passphrase input while submitting', async () => {
    mockLogin.mockReturnValue(new Promise(() => { /* never */ }));
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    act(() => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Passphrase')).toBeDisabled(),
    );
  });
});

// ── 3. Rate-limit path ────────────────────────────────────────────────────────

describe('Login page — error-ratelimited (429)', () => {
  it('shows inline error and disables submit when 429 with retry_after=30', async () => {
    jest.useFakeTimers();

    mockLogin.mockRejectedValueOnce(
      makeApiError(429, { retry_after: 30 }),
    );
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );

    // Inline error present
    expect(screen.getByRole('alert')).toHaveTextContent(/too many attempts/i);

    // Submit is disabled during countdown
    const submitBtn = screen.queryByRole('button', { name: /wait/i });
    expect(submitBtn).toBeDisabled();

    jest.useRealTimers();
  });

  it('falls back to 60s countdown when retry_after is missing (no NaN)', async () => {
    jest.useFakeTimers();

    // 429 with no body at all — retry_after defaults to 60
    mockLogin.mockRejectedValueOnce(makeApiError(429, undefined));
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );

    // a11y: the assertive alert announces once; the countdown lives in a
    // SEPARATE polite region so it doesn't re-interrupt every second.
    expect(screen.getByRole('alert').textContent).not.toContain('NaN');
    const countdownEl = screen.getByText(/try again in/i);
    expect(countdownEl.textContent).not.toContain('NaN');
    // Should contain a valid time string (60s default)
    expect(countdownEl.textContent).toMatch(/\d+s/);

    jest.useRealTimers();
  });

  it('falls back to 60s countdown when retry_after is null (no NaN)', async () => {
    jest.useFakeTimers();

    mockLogin.mockRejectedValueOnce(makeApiError(429, { retry_after: null }));
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );

    expect(screen.getByRole('alert').textContent).not.toContain('NaN');
    const countdownEl = screen.getByText(/try again in/i);
    expect(countdownEl.textContent).not.toContain('NaN');
    expect(countdownEl.textContent).toMatch(/\d+s/);

    jest.useRealTimers();
  });

  it('fires useToast with tone "warn" on 429', async () => {
    jest.useFakeTimers();

    mockLogin.mockRejectedValueOnce(makeApiError(429, { retry_after: 10 }));
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'warn' }),
      ),
    );

    jest.useRealTimers();
  });

  it('re-enables submit after countdown elapses', async () => {
    jest.useFakeTimers();

    mockLogin.mockRejectedValueOnce(makeApiError(429, { retry_after: 3 }));
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    // Wait for rate-limit state
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );

    // Advance timers past the countdown
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });

    // Submit should be re-enabled and show idle label
    await waitFor(() => {
      // After countdown, form returns to idle: aria-label is 'Sign in' again
      const btn = screen.queryByRole('button', { name: /sign in/i });
      expect(btn).not.toBeNull();
      expect(btn).not.toBeDisabled();
    });

    jest.useRealTimers();
  });

  it('hides the inline error after countdown elapses', async () => {
    jest.useFakeTimers();

    mockLogin.mockRejectedValueOnce(makeApiError(429, { retry_after: 2 }));
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );

    jest.useRealTimers();
  });
});

// ── 4. Network error (status 0) ───────────────────────────────────────────────

describe('Login page — error-network', () => {
  it('shows the network error message on status=0', async () => {
    const networkErr = makeApiError(0);
    networkErr.code = 'network';
    mockLogin.mockRejectedValueOnce(networkErr);
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      /can't reach the tavern/i,
    );
  });

  it('re-enables submit immediately after network error (no countdown)', async () => {
    const networkErr = makeApiError(0);
    networkErr.code = 'network';
    mockLogin.mockRejectedValueOnce(networkErr);
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );

    // After network error, submit is re-enabled
    const submitBtn = screen.getByRole('button', { name: /sign in/i });
    expect(submitBtn).not.toBeDisabled();
  });

  it('does NOT start a countdown on network error', async () => {
    jest.useFakeTimers();

    const networkErr = makeApiError(0);
    networkErr.code = 'network';
    mockLogin.mockRejectedValueOnce(networkErr);
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );

    // Advance time — submit should remain enabled (no wait countdown)
    await act(async () => { jest.advanceTimersByTime(2000); });

    expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled();

    jest.useRealTimers();
  });
});

// ── 5. 2FA auto-submit and back behavior ─────────────────────────────────────

describe('Login page — 2FA detailed behavior', () => {
  it('does NOT auto-submit at 5 digits', async () => {
    mockLogin.mockResolvedValueOnce({ kind: '2fa', partial_token: 'pt-abc' });
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    const codeInput = await screen.findByLabelText('6-digit authenticator code');

    await act(async () => {
      fireEvent.change(codeInput, { target: { value: '12345' } }); // 5 digits
    });

    // verify2FA should NOT have been called
    expect(mockVerify2FA).not.toHaveBeenCalled();
    // Still on the 2FA step
    expect(screen.getByText('One more step.')).toBeInTheDocument();
  });

  it('auto-submit fires exactly once when 6 digits are entered', async () => {
    mockLogin.mockResolvedValueOnce({ kind: '2fa', partial_token: 'pt-abc' });
    mockVerify2FA.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    const codeInput = await screen.findByLabelText('6-digit authenticator code');

    await act(async () => {
      fireEvent.change(codeInput, { target: { value: '123456' } });
    });

    await waitFor(() =>
      expect(mockVerify2FA).toHaveBeenCalledTimes(1),
    );
  });

  it('shows error and clears TOTP input when verify2FA throws (bad code)', async () => {
    mockLogin.mockResolvedValueOnce({ kind: '2fa', partial_token: 'pt-abc' });
    // Auto-submit will trigger after 6 digits; make it fail
    mockVerify2FA.mockRejectedValueOnce(makeApiError(401));
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    const codeInput = await screen.findByLabelText('6-digit authenticator code');
    await act(async () => {
      fireEvent.change(codeInput, { target: { value: '999999' } });
    });

    // Error should appear
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      /that code didn't work/i,
    );

    // TOTP input should be cleared
    await waitFor(() =>
      expect(screen.getByLabelText('6-digit authenticator code')).toHaveValue(''),
    );
  });

  it('shows network error message when verify2FA throws with status=0', async () => {
    mockLogin.mockResolvedValueOnce({ kind: '2fa', partial_token: 'pt-abc' });
    const netErr = makeApiError(0);
    netErr.code = 'network';
    mockVerify2FA.mockRejectedValueOnce(netErr);
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    const codeInput = await screen.findByLabelText('6-digit authenticator code');
    await act(async () => {
      fireEvent.change(codeInput, { target: { value: '000000' } });
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      /couldn't verify.*connection/i,
    );
  });

  it('Back to sign in clears TOTP error and returns to credentials form', async () => {
    mockLogin.mockResolvedValueOnce({ kind: '2fa', partial_token: 'pt-abc' });
    mockVerify2FA.mockRejectedValueOnce(makeApiError(401));
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    const codeInput = await screen.findByLabelText('6-digit authenticator code');
    // Trigger a TOTP error first
    await act(async () => {
      fireEvent.change(codeInput, { target: { value: '999999' } });
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );

    // Now click Back
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }));
    });

    // Back on credentials form — h1 restored
    await screen.findByRole('heading', { level: 1, name: /welcome back/i });
    // No stale TOTP error
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // TOTP input gone
    expect(
      screen.queryByLabelText('6-digit authenticator code'),
    ).not.toBeInTheDocument();
  });

  it('Back to sign in with no prior error clears totp value and returns credentials form', async () => {
    mockLogin.mockResolvedValueOnce({ kind: '2fa', partial_token: 'pt-abc' });
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    await screen.findByLabelText('6-digit authenticator code');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }));
    });

    await screen.findByRole('heading', { level: 1, name: /welcome back/i });
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Verify button is disabled when TOTP value is less than 6 digits', async () => {
    mockLogin.mockResolvedValueOnce({ kind: '2fa', partial_token: 'pt-abc' });
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    await screen.findByLabelText('6-digit authenticator code');

    // 0 digits — button should be disabled
    const verifyBtn = screen.getByRole('button', { name: /verify code/i });
    expect(verifyBtn).toBeDisabled();
  });

  it('TOTP onChange strips non-digit characters', async () => {
    mockLogin.mockResolvedValueOnce({ kind: '2fa', partial_token: 'pt-abc' });
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    const codeInput = await screen.findByLabelText('6-digit authenticator code');

    await act(async () => {
      fireEvent.change(codeInput, { target: { value: '12ab34' } });
    });

    // Only digits should remain
    expect(codeInput).toHaveValue('1234');
  });
});
