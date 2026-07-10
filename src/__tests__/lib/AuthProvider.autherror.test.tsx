/**
 * Tests for AuthProvider's authError signal + retryAuth (UIR2-TAV-3).
 *
 * Covers:
 *   - no-op fallback context has authError: null
 *   - silentRefresh (mount, initialMaybeAuthed) failing with a 401-shaped
 *     error → authError='expired'
 *   - silentRefresh failing with a 429-shaped error → authError='rate_limited'
 *   - silentRefresh failing with a plain network error (no status) → 'expired'
 *   - silentRefresh: refresh() succeeds but me() fails → 'expired'
 *   - a successful silent refresh leaves authError null
 *   - retryAuth(): success clears authError and sets user; failure re-sets it
 *   - authError is cleared on successful login / verify2FA / standalone refresh()
 */
import React from 'react';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock the auth API wrappers (apiFetch underneath touches fetch)
// ---------------------------------------------------------------------------

jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(),
  verify2FA: jest.fn(),
  logout: jest.fn(),
  refresh: jest.fn(),
  me: jest.fn(),
  register: jest.fn(),
}));

import * as authApi from '../../lib/api/auth';
import { AuthProvider, useAuth } from '../../lib/auth/AuthProvider';
import type { User } from '../../lib/api/types';

const mockLogin = authApi.login as jest.MockedFunction<typeof authApi.login>;
const mockVerify = authApi.verify2FA as jest.MockedFunction<typeof authApi.verify2FA>;
const mockRefresh = authApi.refresh as jest.MockedFunction<typeof authApi.refresh>;
const mockMe = authApi.me as jest.MockedFunction<typeof authApi.me>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALICE: User = { id: 1, username: 'alice', email: null };

/** Shapes an Error the way client.ts's makeApiError does — {status, code}. */
function apiError(status: number, message = 'api error') {
  return Object.assign(new Error(message), { status, code: String(status) });
}

function AuthConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="username">{auth.user?.username ?? 'none'}</span>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="maybeAuthed">{String(auth.maybeAuthed)}</span>
      <span data-testid="authError">{String(auth.authError)}</span>
      <button onClick={() => auth.login('alice', 'secret')}>login</button>
      <button onClick={() => auth.verify2FA('123456')}>verify2fa</button>
      <button onClick={() => auth.refresh()}>refresh</button>
      <button onClick={() => auth.retryAuth()}>retryAuth</button>
    </div>
  );
}

function wrap(initialUser: User | null = null, initialMaybeAuthed = false) {
  return render(
    <AuthProvider initialUser={initialUser} initialMaybeAuthed={initialMaybeAuthed}>
      <AuthConsumer />
    </AuthProvider>,
  );
}

beforeEach(() => {
  mockLogin.mockReset();
  mockVerify.mockReset();
  mockRefresh.mockReset();
  mockMe.mockReset();
});

// ---------------------------------------------------------------------------
// No-op fallback
// ---------------------------------------------------------------------------

describe('useAuth outside AuthProvider — authError', () => {
  it('no-op fallback context has authError: null', () => {
    function Orphan() {
      const auth = useAuth();
      return <span data-testid="authError">{String(auth.authError)}</span>;
    }
    render(<Orphan />);
    expect(screen.getByTestId('authError')).toHaveTextContent('null');
  });
});

// ---------------------------------------------------------------------------
// silentRefresh failure → authError
// ---------------------------------------------------------------------------

describe('AuthProvider — silentRefresh failure sets authError', () => {
  it('401 → authError="expired"', async () => {
    mockRefresh.mockRejectedValueOnce(apiError(401));
    wrap(null, true);

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('authError')).toHaveTextContent('expired');
    expect(screen.getByTestId('username')).toHaveTextContent('none');
    expect(screen.getByTestId('maybeAuthed')).toHaveTextContent('false');
  });

  it('429 → authError="rate_limited"', async () => {
    mockRefresh.mockRejectedValueOnce(apiError(429));
    wrap(null, true);

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('authError')).toHaveTextContent('rate_limited');
    expect(screen.getByTestId('username')).toHaveTextContent('none');
  });

  it('a plain network error (no status) → authError="expired"', async () => {
    mockRefresh.mockRejectedValueOnce(new Error('network'));
    wrap(null, true);

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('authError')).toHaveTextContent('expired');
  });

  it('refresh() succeeds but me() fails (401) → authError="expired"', async () => {
    mockRefresh.mockResolvedValueOnce({ ok: true });
    mockMe.mockRejectedValueOnce(apiError(401));
    wrap(null, true);

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('authError')).toHaveTextContent('expired');
    expect(screen.getByTestId('username')).toHaveTextContent('none');
  });

  it('a successful silent refresh leaves authError null', async () => {
    mockRefresh.mockResolvedValueOnce({ ok: true });
    mockMe.mockResolvedValueOnce({ user: ALICE });
    wrap(null, true);

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'));
    expect(screen.getByTestId('authError')).toHaveTextContent('null');
  });
});

// ---------------------------------------------------------------------------
// retryAuth
// ---------------------------------------------------------------------------

describe('AuthProvider — retryAuth', () => {
  it('success clears authError and sets user', async () => {
    // Arrive already in the expired state via a failed silent refresh.
    mockRefresh.mockRejectedValueOnce(apiError(401));
    wrap(null, true);
    await waitFor(() => expect(screen.getByTestId('authError')).toHaveTextContent('expired'));

    mockRefresh.mockResolvedValueOnce({ ok: true });
    mockMe.mockResolvedValueOnce({ user: ALICE });
    await act(async () => {
      screen.getByRole('button', { name: 'retryAuth' }).click();
    });

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'));
    expect(screen.getByTestId('authError')).toHaveTextContent('null');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('failure re-sets authError (rate_limited) and leaves user null', async () => {
    mockRefresh.mockRejectedValueOnce(apiError(401));
    wrap(null, true);
    await waitFor(() => expect(screen.getByTestId('authError')).toHaveTextContent('expired'));

    mockRefresh.mockRejectedValueOnce(apiError(429));
    await act(async () => {
      screen.getByRole('button', { name: 'retryAuth' }).click();
    });

    await waitFor(() => expect(screen.getByTestId('authError')).toHaveTextContent('rate_limited'));
    expect(screen.getByTestId('username')).toHaveTextContent('none');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });
});

// ---------------------------------------------------------------------------
// authError cleared by other successful auth transitions
// ---------------------------------------------------------------------------

describe('AuthProvider — authError cleared on other successful transitions', () => {
  it('successful login clears a stale authError', async () => {
    mockRefresh.mockRejectedValueOnce(apiError(401));
    wrap(null, true);
    await waitFor(() => expect(screen.getByTestId('authError')).toHaveTextContent('expired'));

    mockLogin.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    await act(async () => {
      screen.getByRole('button', { name: 'login' }).click();
    });

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'));
    expect(screen.getByTestId('authError')).toHaveTextContent('null');
  });

  it('successful verify2FA clears a stale authError', async () => {
    mockRefresh.mockRejectedValueOnce(apiError(401));
    wrap(null, true);
    await waitFor(() => expect(screen.getByTestId('authError')).toHaveTextContent('expired'));

    mockVerify.mockResolvedValueOnce({ kind: 'ok', user: ALICE });
    await act(async () => {
      screen.getByRole('button', { name: 'verify2fa' }).click();
    });

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'));
    expect(screen.getByTestId('authError')).toHaveTextContent('null');
  });

  it('successful standalone refresh() clears a stale authError', async () => {
    mockRefresh.mockRejectedValueOnce(apiError(401));
    wrap(null, true);
    await waitFor(() => expect(screen.getByTestId('authError')).toHaveTextContent('expired'));

    mockRefresh.mockResolvedValueOnce({ ok: true });
    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click();
    });

    await waitFor(() => expect(screen.getByTestId('authError')).toHaveTextContent('null'));
  });
});

// ---------------------------------------------------------------------------
// retryAuth concurrent invocation — retryAuth now carries an in-flight ref
// guard (retryingRef): a second invocation while one is already in flight is
// a synchronous no-op (refs mutate immediately, unlike React state, so this
// holds even for two invocations in the SAME tick with no yield between
// them — not just a naturally-slower double click). Locks the fix rather
// than the prior characterization of the unguarded clobber.
// ---------------------------------------------------------------------------

describe('AuthProvider — retryAuth invoked twice before the first settles', () => {
  it('the in-flight guard prevents a same-tick double retry from clobbering', async () => {
    // Arrive in the expired state via a failed silent refresh, same as the
    // other retryAuth tests.
    mockRefresh.mockRejectedValueOnce(apiError(401));
    wrap(null, true);
    await waitFor(() => expect(screen.getByTestId('authError')).toHaveTextContent('expired'));
    mockRefresh.mockClear(); // isolate the count to post-mount (retry) calls only

    // A deferred promise for the ONE refresh call the guard actually allows
    // through — the second click's retryAuth() now early-returns before it
    // ever calls authApi.refresh(), so there is no second mock value to
    // queue and nothing to race.
    let resolveRefresh!: () => void;
    const refreshOnce = new Promise<{ ok: true }>((res) => { resolveRefresh = () => res({ ok: true }); });
    mockRefresh.mockReturnValueOnce(refreshOnce);
    mockMe.mockResolvedValueOnce({ user: ALICE });

    const retryButton = screen.getByRole('button', { name: 'retryAuth' });

    // Fire both invocations without awaiting either — AuthConsumer's button
    // never unmounts (unlike the real SessionExpired CTA), so this reaches
    // retryAuth() twice unconditionally, in the same synchronous batch (the
    // tightest possible timing). retryingRef is a plain ref mutation, set
    // synchronously by the first call before the second click is even
    // dispatched — so the guard holds even here.
    act(() => {
      fireEvent.click(retryButton);
      fireEvent.click(retryButton);
    });

    // Only ONE refresh call happened — the second click's retryAuth() was a
    // no-op.
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRefresh();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'));
    expect(screen.getByTestId('authError')).toHaveTextContent('null');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(mockMe).toHaveBeenCalledTimes(1);
  });
});
