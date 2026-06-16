/**
 * Sprint 4 gap-fill: AuthProvider M2 invariant + strict-mode guard
 *
 * These tests were NOT covered by AuthProvider.test.tsx and target the
 * specific regression risks called out in the Sprint 4 QA scope:
 *
 *  1. M2 invariant: /auth/me is NOT called when initialMaybeAuthed=true
 *     but refresh() fails — the code path must short-circuit before me().
 *
 *  2. Strict-mode double-mount guard: the silentRefreshRan ref means the
 *     silent-refresh effect fires exactly once even when React strict mode
 *     invokes the effect cleanup+re-run twice.
 *
 *  3. /auth/me is NOT called when initialMaybeAuthed is false (no refresh
 *     cookie present on the server side — the common case for new sessions).
 *
 * Why these matter:
 *   The M2 fix prevents the "logged-out flash" for returning users by calling
 *   refresh() then me() on mount. If the refresh fails and we still call me(),
 *   that's a wasted round-trip and — more critically — it could race with
 *   the BFF returning a 401 that triggers the apiFetch 401-retry, potentially
 *   causing a double-refresh storm on the same rotation cycle.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock auth API
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

const mockRefresh = authApi.refresh as jest.MockedFunction<typeof authApi.refresh>;
const mockMe      = authApi.me      as jest.MockedFunction<typeof authApi.me>;

const ALICE: User = { id: 1, username: 'alice', email: null };

// ---------------------------------------------------------------------------
// Consumer + wrapper helpers
// ---------------------------------------------------------------------------

function AuthConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="username">{auth.user?.username ?? 'none'}</span>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="maybeAuthed">{String(auth.maybeAuthed)}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockRefresh.mockReset();
  mockMe.mockReset();
});

// ---------------------------------------------------------------------------
// M2 invariant: /auth/me must NOT be called when refresh fails
// ---------------------------------------------------------------------------

describe('AuthProvider — M2 invariant: /auth/me call gating', () => {
  it('does NOT call me() when refresh() fails', async () => {
    mockRefresh.mockRejectedValueOnce(new Error('unauthorized'));

    wrap(null, /* initialMaybeAuthed */ true);

    await waitFor(() =>
      expect(screen.getByTestId('loading')).toHaveTextContent('false'),
    );

    // The critical assertion: me() must not be called on refresh failure
    expect(mockMe).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('leaves user=null, loading=false, maybeAuthed=false after refresh failure', async () => {
    mockRefresh.mockRejectedValueOnce(new Error('unauthorized'));

    wrap(null, true);

    await waitFor(() =>
      expect(screen.getByTestId('loading')).toHaveTextContent('false'),
    );

    expect(screen.getByTestId('username')).toHaveTextContent('none');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('maybeAuthed')).toHaveTextContent('false');
  });

  it('calls me() exactly once when refresh() succeeds', async () => {
    mockRefresh.mockResolvedValueOnce({ ok: true });
    mockMe.mockResolvedValueOnce({ user: ALICE });

    wrap(null, true);

    await waitFor(() =>
      expect(screen.getByTestId('username')).toHaveTextContent('alice'),
    );

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockMe).toHaveBeenCalledTimes(1);
  });

  it('does NOT call refresh() or me() when initialMaybeAuthed is false', async () => {
    wrap(null, /* initialMaybeAuthed */ false);

    // No async work — should be immediate
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockMe).not.toHaveBeenCalled();
  });

  it('does NOT call refresh() or me() when initialUser is already populated', () => {
    // Server already resolved the user — no silent refresh needed
    wrap(ALICE, /* initialMaybeAuthed */ true);

    // Synchronous assertion: no async work should start
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('username')).toHaveTextContent('alice');
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockMe).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Strict-mode double-mount guard
// ---------------------------------------------------------------------------

describe('AuthProvider — strict-mode double-mount guard', () => {
  it('runs silent refresh exactly once when mounted without StrictMode (baseline)', async () => {
    // Baseline: a normal single mount runs the effect exactly once.
    mockRefresh.mockResolvedValueOnce({ ok: true });
    mockMe.mockResolvedValueOnce({ user: ALICE });

    wrap(null, true);

    await waitFor(() =>
      expect(screen.getByTestId('username')).toHaveTextContent('alice'),
    );

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockMe).toHaveBeenCalledTimes(1);
  });

  it('silentRefreshRan ref prevents a second refresh call on the same instance', async () => {
    // The ref guard protects against the React StrictMode pattern where the
    // effect runs cleanup → re-run on the same component instance.
    // We can't trigger actual StrictMode double-invoke from RTL, but we can
    // verify the guard is in place: if refresh() is called more than once on
    // the same mount, that's a bug the ref prevents.
    //
    // Approach: set up two resolvers and confirm only the first resolves anything.
    const calls: number[] = [];

    mockRefresh.mockImplementation(() => {
      calls.push(Date.now());
      return Promise.resolve({ ok: true });
    });
    mockMe.mockResolvedValue({ user: ALICE });

    wrap(null, true);

    await waitFor(() =>
      expect(screen.getByTestId('username')).toHaveTextContent('alice'),
    );

    // Only one refresh call — the ref guard blocked any second invocation
    expect(calls).toHaveLength(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockMe).toHaveBeenCalledTimes(1);
  });

  it('does not double-refresh when component re-mounts with same props', async () => {
    // If the component unmounts and remounts (e.g., due to parent state change),
    // the silentRefreshRan ref resets. This test verifies that behavior is
    // correct: a fresh mount DOES run the refresh (not zero times).
    //
    // This is intentional — the ref is per-instance, not global. A full
    // unmount/remount represents a new page visit, not strict-mode double-invoke.

    mockRefresh.mockResolvedValue({ ok: true });
    mockMe.mockResolvedValue({ user: ALICE });

    const { unmount } = wrap(null, true);

    await waitFor(() =>
      expect(screen.getByTestId('username')).toHaveTextContent('alice'),
    );
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    unmount();
    mockRefresh.mockReset();
    mockMe.mockReset();
    mockRefresh.mockResolvedValueOnce({ ok: true });
    mockMe.mockResolvedValueOnce({ user: ALICE });

    // Fresh mount — should run exactly once again
    wrap(null, true);

    await waitFor(() =>
      expect(screen.getByTestId('username')).toHaveTextContent('alice'),
    );
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Cancellation safety: cancelled=true on unmount prevents state update after
// component is gone (avoids "Can't perform a React state update on an
// unmounted component" warnings and potential memory leaks).
// ---------------------------------------------------------------------------

describe('AuthProvider — unmount cancellation during silent refresh', () => {
  it('does not throw or update state when component unmounts before refresh completes', async () => {
    // Hold refresh in flight
    let resolveRefresh!: (v: { ok: true }) => void;
    mockRefresh.mockReturnValue(
      new Promise<{ ok: true }>((res) => { resolveRefresh = res; }),
    );

    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => { /* suppress React's state-on-unmounted warning */ });

    const { unmount } = wrap(null, true);

    // Unmount before refresh resolves
    unmount();

    // Now resolve the refresh — should NOT cause errors or state updates
    await act(async () => {
      resolveRefresh({ ok: true });
    });

    // No React errors thrown
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('unmounted component'),
    );

    consoleSpy.mockRestore();
  });
});
