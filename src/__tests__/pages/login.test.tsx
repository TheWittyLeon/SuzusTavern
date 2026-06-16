/**
 * Tests for src/app/login/page.tsx
 *
 * Covers:
 *   - Renders <main> + single h1
 *   - Idle state: form fields, submit button, back link
 *   - Submit → ok: redirects to ?next or /dashboard
 *   - Submit → bad creds: shows role="alert", clears password field
 *   - Submit → 2FA: renders TOTP step with code input
 *   - 2FA verify → ok: redirects to /dashboard
 *   - 2FA back: returns to credentials form
 *   - OAuth chips are disabled and aria-disabled
 *   - Open-redirect guard: unsafe ?next= values fall back to /dashboard
 */

import React, { Suspense } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Mock next/navigation ─────────────────────────────────────────────────────
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

import * as authApi from '../../lib/api/auth';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ToastProvider } from '../../components/Toast';
import LoginPage from '../../app/login/page';
import type { User } from '../../lib/api/types';

const mockLogin = authApi.login as jest.MockedFunction<typeof authApi.login>;
const mockVerify2FA = authApi.verify2FA as jest.MockedFunction<typeof authApi.verify2FA>;

const ALICE: User = { id: 1, username: 'alice', email: null };

// ── Test helpers ──────────────────────────────────────────────────────────────

function renderLogin(next: string | null = null) {
  mockGet.mockReturnValue(next);
  return render(
    <AuthProvider initialUser={null}>
      <ToastProvider>
        <Suspense fallback={<div>Loading…</div>}>
          <LoginPage />
        </Suspense>
      </ToastProvider>
    </AuthProvider>,
  );
}

function makeApiError(status: number, body?: unknown) {
  const err = new Error('api error') as Error & { status: number; code: string; body?: unknown };
  err.status = status;
  err.code = status === 401 ? 'unauthorized' : status === 429 ? 'rate_limited' : 'network';
  err.body = body;
  return err;
}

/** Fill handle + passphrase and submit the credentials form */
async function submitCredentials(handle: string, password: string) {
  const handleInput = screen.getByLabelText('Tavern handle');
  const passInput = screen.getByLabelText('Passphrase');
  const form = handleInput.closest('form')!;

  fireEvent.change(handleInput, { target: { value: handle } });
  fireEvent.change(passInput, { target: { value: password } });

  await act(async () => {
    fireEvent.submit(form);
  });
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockReplace.mockClear();
  mockGet.mockClear();
  mockLogin.mockReset();
  mockVerify2FA.mockReset();
});

// ── Structural tests ─────────────────────────────────────────────────────────

describe('Login page — structure', () => {
  it('renders a <main> element', async () => {
    renderLogin();
    await screen.findByRole('main');
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('renders exactly one h1 heading with text "Welcome back."', async () => {
    renderLogin();
    await screen.findByRole('heading', { level: 1 });
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Welcome back.');
  });

  it('renders handle and passphrase inputs', async () => {
    renderLogin();
    await screen.findByLabelText('Tavern handle');
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
  });

  it('renders a back link pointing to /', async () => {
    renderLogin();
    await screen.findByRole('link', { name: /back/i });
    expect(screen.getByRole('link', { name: /back/i })).toHaveAttribute('href', '/');
  });

  it('submit button is enabled in idle state', async () => {
    renderLogin();
    await screen.findByRole('button', { name: /sign in/i });
    expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled();
  });
});

// ── Submit → ok → redirect ────────────────────────────────────────────────────

describe('Login page — submit → ok → redirect', () => {
  it('redirects to /dashboard when no ?next param', async () => {
    mockLogin.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    renderLogin(null);

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
  });

  it('redirects to ?next when it is a safe same-origin path', async () => {
    mockLogin.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    renderLogin('/lobby');

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/lobby'));
  });
});

// ── Open-redirect guard ───────────────────────────────────────────────────────

describe('Login page — open-redirect guard', () => {
  it('falls back to /dashboard for ?next=//evil.com', async () => {
    mockLogin.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    renderLogin('//evil.com');

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
  });

  it('falls back to /dashboard for ?next=https://evil.com', async () => {
    mockLogin.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    renderLogin('https://evil.com');

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
  });

  it('accepts a safe path like /character/new', async () => {
    mockLogin.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    renderLogin('/character/new');

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/character/new'));
  });
});

// ── Bad credentials error ─────────────────────────────────────────────────────

describe('Login page — error-badcreds', () => {
  it('shows role=alert with error text on 401', async () => {
    mockLogin.mockRejectedValueOnce(makeApiError(401));
    renderLogin();

    await screen.findByLabelText('Passphrase');
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: 'wrongpass' },
    });

    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/wrong handle or passphrase/i);
  });

  it('clears the password field after bad creds', async () => {
    mockLogin.mockRejectedValueOnce(makeApiError(401));
    renderLogin();

    await screen.findByLabelText('Passphrase');
    fireEvent.change(screen.getByLabelText('Passphrase'), {
      target: { value: 'wrongpass' },
    });

    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByLabelText('Passphrase')).toHaveValue('');
  });

  it('re-enables submit button after bad creds error', async () => {
    mockLogin.mockRejectedValueOnce(makeApiError(401));
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Tavern handle').closest('form')!);
    });

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled();
  });
});

// ── 2FA transition ────────────────────────────────────────────────────────────

describe('Login page — 2FA transition', () => {
  it('renders TOTP code input and new heading when login returns "2fa"', async () => {
    mockLogin.mockResolvedValueOnce({ kind: '2fa', partial_token: 'pt-abc' });
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    await screen.findByLabelText('6-digit authenticator code');
    expect(screen.getByText('One more step.')).toBeInTheDocument();
  });

  it('redirects on successful 2FA verify', async () => {
    mockLogin.mockResolvedValueOnce({ kind: '2fa', partial_token: 'pt-abc' });
    mockVerify2FA.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    const codeInput = await screen.findByLabelText('6-digit authenticator code');

    await act(async () => {
      // Type 6 digits — triggers auto-submit via useEffect
      fireEvent.change(codeInput, { target: { value: '123456' } });
    });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
  });

  it('returns to credentials form on "Back to sign in" click', async () => {
    mockLogin.mockResolvedValueOnce({ kind: '2fa', partial_token: 'pt-abc' });
    renderLogin();

    await screen.findByLabelText('Tavern handle');
    await submitCredentials('alice', 'secret');

    await screen.findByText('One more step.');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }));
    });

    await screen.findByRole('heading', { level: 1, name: /welcome back/i });
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
  });
});

// ── OAuth chips disabled ──────────────────────────────────────────────────────

describe('Login page — OAuth coming soon', () => {
  it('Twitch button is disabled and has aria-disabled="true"', async () => {
    renderLogin();
    // Twitch is rendered as a <button> (no href) when disabled
    await screen.findByRole('button', { name: /twitch/i });
    const twitchBtn = screen.getByRole('button', { name: /twitch/i });
    expect(twitchBtn).toBeDisabled();
    expect(twitchBtn).toHaveAttribute('aria-disabled', 'true');
  });

  it('Discord button is disabled and has aria-disabled="true"', async () => {
    renderLogin();
    await screen.findByRole('button', { name: /discord/i });
    const discordBtn = screen.getByRole('button', { name: /discord/i });
    expect(discordBtn).toBeDisabled();
    expect(discordBtn).toHaveAttribute('aria-disabled', 'true');
  });
});
