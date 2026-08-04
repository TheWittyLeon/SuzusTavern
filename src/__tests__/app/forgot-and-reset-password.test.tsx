/**
 * /forgot-password and /reset-password — the signed-out passphrase surfaces.
 *
 * The single most important assertion in this file is the anti-enumeration
 * one: the forgot form must look IDENTICAL whether or not the address has an
 * account. Upstream deliberately always answers 200 for that reason, and a
 * well-meaning "no account found" branch in the UI would hand an attacker the
 * exact oracle the server refuses to give them.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

const push = jest.fn();
let searchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

jest.mock('../../lib/api/auth', () => ({
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
  passwordPolicy: jest.fn(),
}));

import * as auth from '../../lib/api/auth';
import ForgotPasswordPage from '../../app/forgot-password/page';
import ResetPasswordPage from '../../app/reset-password/page';

const mockRequest = auth.requestPasswordReset as jest.Mock;
const mockReset = auth.resetPassword as jest.Mock;
const mockPolicy = auth.passwordPolicy as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  searchParams = new URLSearchParams();
  mockPolicy.mockResolvedValue({
    min_length: 8,
    max_length: 128,
    require_uppercase: true,
    require_lowercase: true,
    require_digit: true,
    require_special: true,
    history_depth: 5,
  });
});

async function submitForgot(email: string) {
  render(<ForgotPasswordPage />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
  });
}

describe('/forgot-password — anti-enumeration', () => {
  it('shows the SAME conditional wording for any address', async () => {
    // Upstream returns 200 for a real address and a fake one alike; the UI
    // must not distinguish them, and must not claim an email was sent.
    mockRequest.mockResolvedValue({ msg: 'if that email exists, ...' });
    await submitForgot('definitely-not-a-user@nowhere.invalid');
    const confirmation = screen.getByText(/if that address has an account/i);
    expect(confirmation).toBeInTheDocument();
    // Must NOT assert delivery, and must NOT reveal absence.
    expect(screen.queryByText(/we.ve sent you/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
  });

  it('still shows the neutral confirmation for a real address', async () => {
    // Positive control on the test above: identical output for both inputs is
    // the property under test, so both branches must be exercised.
    mockRequest.mockResolvedValue({ msg: 'if that email exists, ...' });
    await submitForgot('real@example.com');
    expect(screen.getByText(/if that address has an account/i)).toBeInTheDocument();
  });

  it('surfaces a 429 as rate limiting, not as a failed send', async () => {
    mockRequest.mockRejectedValue(
      Object.assign(new Error('slow'), { status: 429, body: {} }),
    );
    await submitForgot('real@example.com');
    expect(screen.getByText(/too many requests/i)).toBeInTheDocument();
  });
});

describe('/reset-password', () => {
  it('refuses to render the form without a token', () => {
    render(<ResetPasswordPage />);
    expect(screen.getByText(/reset link incomplete/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('New passphrase')).not.toBeInTheDocument();
  });

  it('submits the token from the query string, never one it invents', async () => {
    searchParams = new URLSearchParams('token=abc123');
    mockReset.mockResolvedValue({ msg: 'ok' });
    render(<ResetPasswordPage />);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('New passphrase'), {
      target: { value: 'Brand-New-1!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new passphrase'), {
      target: { value: 'Brand-New-1!' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /set new passphrase/i }));
    });
    expect(mockReset).toHaveBeenCalledWith('abc123', 'Brand-New-1!');
    expect(screen.getByText(/passphrase changed/i)).toBeInTheDocument();
  });

  it('surfaces the server’s complexity errors verbatim', async () => {
    searchParams = new URLSearchParams('token=abc123');
    mockReset.mockRejectedValue(
      Object.assign(new Error('bad'), {
        status: 400,
        body: { msg: 'nope', errors: ['Password must contain a symbol'] },
      }),
    );
    render(<ResetPasswordPage />);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('New passphrase'), {
      target: { value: 'abcdefgh' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new passphrase'), {
      target: { value: 'abcdefgh' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /set new passphrase/i }));
    });
    expect(
      await screen.findByText('Password must contain a symbol'),
    ).toBeInTheDocument();
  });

  it('reports an expired or reused token from the server message', async () => {
    searchParams = new URLSearchParams('token=stale');
    mockReset.mockRejectedValue(
      Object.assign(new Error('bad'), {
        status: 400,
        body: { msg: 'invalid or expired reset token' },
      }),
    );
    render(<ResetPasswordPage />);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('New passphrase'), {
      target: { value: 'Brand-New-1!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new passphrase'), {
      target: { value: 'Brand-New-1!' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /set new passphrase/i }));
    });
    expect(
      await screen.findByText('invalid or expired reset token'),
    ).toBeInTheDocument();
  });
});


describe('Kuro-Sec fixes', () => {
  it('strips ?token= from the URL once captured, but still submits it', async () => {
    // Finding 3: the token rode in the Referer of the policy fetch this page
    // makes on mount, landing it in the edge access log, and stayed in
    // browser history. It must leave the URL without leaving the form.
    searchParams = new URLSearchParams('token=secret-token');
    // `window.location` is non-configurable in this jsdom, so drive the REAL
    // URL and spy on the call the effect makes.
    window.history.replaceState(null, '', '/reset-password?token=secret-token');
    const replaceState = jest.spyOn(window.history, 'replaceState');
    try {
      mockReset.mockResolvedValue({ msg: 'ok' });
      render(<ResetPasswordPage />);
      await act(async () => {});
      expect(replaceState).toHaveBeenCalledWith(null, '', '/reset-password');

      // ...and the captured token is still what gets submitted.
      fireEvent.change(screen.getByLabelText('New passphrase'), {
        target: { value: 'Brand-New-1!' },
      });
      fireEvent.change(screen.getByLabelText('Confirm new passphrase'), {
        target: { value: 'Brand-New-1!' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /set new passphrase/i }));
      });
      expect(mockReset).toHaveBeenCalledWith('secret-token', 'Brand-New-1!');
    } finally {
      replaceState.mockRestore();
    }
  });
});
