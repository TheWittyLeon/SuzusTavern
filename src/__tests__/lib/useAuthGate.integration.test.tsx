/**
 * Integration coverage for useAuthGate (UIR2-TAV-3) — wires the REAL
 * AuthProvider + REAL useAuthGate + REAL SessionExpired together (unlike
 * useAuthGate.test.tsx, which mocks useAuth(), and AuthProvider.autherror.
 * test.tsx, which never renders SessionExpired/useAuthGate at all). Neither
 * of those two unit-level files proves the full stack actually composes —
 * this file closes that gap.
 *
 * Covers:
 *   - mount → 429 silent refresh → real SessionExpired (rate_limited),
 *     retry CTA focused
 *   - clicking "Try again" while its own refresh is genuinely still in
 *     flight (a controlled/deferred promise, not same-tick) proves the CTA
 *     STAYS MOUNTED (MAJOR-2: showing "Retrying…"/aria-busy, never swapped
 *     for the generic skeleton) and a real second click on it is a no-op —
 *     via retryAuth's own in-flight ref guard, since the button is not
 *     actually unmounted/detached the way it used to be.
 *   - a fast double real-DOM click (fireEvent.click ×2, no await between) on
 *     the SAME queried button reference reaches retryAuth at most once —
 *     both because of the natural button-unmount mitigation AND (since the
 *     fix) retryAuth's own retryingRef guard, which collapses even a
 *     same-tick double invoke (no commit between the two dispatches at all)
 *     to a single retry — locks the fix for the race characterized in
 *     AuthProvider.autherror.test.tsx's "invoked twice before the first
 *     settles" test.
 *   - a raced (now guarded, inert) retry followed by a deliberate logout
 *     lands cleanly on the genuine-logout redirect — no stale authError
 *     survives to show the wrong SessionExpired variant, since logout() now
 *     clears authError too.
 *   - full recovery: retry succeeds → real page content renders, exactly
 *     once through the whole Provider→Hook→Component→Provider round trip.
 *   - exactly one #main-content landmark exists while the gate is active on
 *     a page (no duplicate-id collision with a shell that never mounts).
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/dashboard',
}));

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
import { useAuthGate } from '../../lib/auth/useAuthGate';
import type { User } from '../../lib/api/types';

const mockRefresh = authApi.refresh as jest.MockedFunction<typeof authApi.refresh>;
const mockMe = authApi.me as jest.MockedFunction<typeof authApi.me>;
const mockLogout = authApi.logout as jest.MockedFunction<typeof authApi.logout>;

const ALICE: User = { id: 1, username: 'alice', email: null };

/** Shapes an Error the way client.ts's makeApiError does — {status, code}. */
function apiError(status: number, message = 'api error') {
  return Object.assign(new Error(message), { status, code: String(status) });
}

/** A minimal stand-in for a retrofitted protected page. */
function TestPage() {
  // useAuth() called BEFORE useAuthGate() and before any early return —
  // mirrors the Rules-of-Hooks contract every real retrofitted page follows
  // (see e.g. dashboard/page.tsx). Exposes `logout` for the follow-on
  // "stale authError after a deliberate logout" test below.
  const { logout } = useAuth();
  const gate = useAuthGate({
    skeleton: <div data-testid="skeleton-content">loading skeleton</div>,
    label: 'Loading the thing',
  });
  if (gate) return gate;
  return (
    <div data-testid="real-content">
      real page content
      <button onClick={() => void logout()}>log out</button>
    </div>
  );
}

function renderTestPage() {
  return render(
    <AuthProvider initialUser={null} initialMaybeAuthed>
      <TestPage />
    </AuthProvider>,
  );
}

beforeEach(() => {
  mockReplace.mockClear();
  mockRefresh.mockReset();
  mockMe.mockReset();
  mockLogout.mockReset();
});

describe('useAuthGate integration — mount-time 429 → real SessionExpired', () => {
  it('renders the real rate_limited SessionExpired with a focused, working retry CTA', async () => {
    mockRefresh.mockRejectedValueOnce(apiError(429));
    renderTestPage();

    expect(
      await screen.findByRole('heading', { name: /hold on a moment/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('real-content')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toHaveFocus();
    // Exactly one main landmark — TavernShell-equivalent chrome never mounts
    // alongside this state (guards against a duplicate #main-content id).
    expect(document.querySelectorAll('#main-content')).toHaveLength(1);
  });
});

describe('useAuthGate integration — retry CTA stays mounted+focused through a real in-flight retry (MAJOR-2)', () => {
  it('a real second click on the SAME still-mounted button, dispatched after the first click`s render has committed, is a guarded no-op', async () => {
    mockRefresh.mockRejectedValueOnce(apiError(429));
    renderTestPage();
    const retryButton = await screen.findByRole('button', { name: /try again/i });
    mockRefresh.mockClear(); // isolate the count to post-mount (retry) calls only

    // A deferred promise — the retry's refresh() call genuinely does not
    // resolve until we say so, simulating a real slow network round trip
    // (not a same-tick resolution a fast test could race past).
    let resolveRefresh!: () => void;
    mockRefresh.mockReturnValueOnce(
      new Promise<{ ok: true }>((res) => { resolveRefresh = () => res({ ok: true }); }),
    );

    // A REAL browser delivers a physical double-click as two SEPARATE tasks —
    // the first click's synchronous handler (and React's commit for it) fully
    // completes before the second click event is even dispatched. A bare,
    // un-batched `act()` call models exactly that: it flushes/commits before
    // returning.
    act(() => {
      fireEvent.click(retryButton);
    });

    // MAJOR-2: while that refresh is still pending, the SAME SessionExpired
    // (and the SAME button element) stays mounted and focused — authError is
    // deliberately NOT cleared at the start of a retry anymore, so
    // useAuthGate never swaps in the generic skeleton mid-retry. The button
    // now shows the busy/"Retrying…" presentation instead of unmounting.
    expect(screen.queryByTestId('skeleton-content')).not.toBeInTheDocument();
    const busyButton = screen.getByRole('button', { name: /retrying/i });
    expect(busyButton).toBe(retryButton);
    expect(busyButton.isConnected).toBe(true);
    expect(busyButton).toHaveFocus();

    // A literal second click on the SAME (still-connected, still-focused)
    // button reaches React's handler fine, but retryAuth's own retryingRef
    // guard makes it a no-op — proves a REAL, separately-dispatched double
    // click cannot reach the race characterized in
    // AuthProvider.autherror.test.tsx through this one real call site.
    fireEvent.click(busyButton);
    expect(mockRefresh).toHaveBeenCalledTimes(1); // only the first click's call

    mockMe.mockResolvedValueOnce({ user: ALICE });
    await act(async () => {
      resolveRefresh();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('real-content')).toBeInTheDocument());
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockMe).toHaveBeenCalledTimes(1);
  });

  it('the in-flight guard collapses a same-tick double invoke to a single retry', async () => {
    mockRefresh.mockRejectedValueOnce(apiError(429));
    renderTestPage();
    const retryButton = await screen.findByRole('button', { name: /try again/i });
    mockRefresh.mockClear(); // isolate the count to post-mount (retry) calls only

    // Only ONE mock value is ever queued — the guard makes the second
    // click's retryAuth() early-return before it calls authApi.refresh() at
    // all, so there's no second call to race against (nothing to reject).
    let resolveRefresh!: () => void;
    mockRefresh.mockReturnValueOnce(
      new Promise<{ ok: true }>((res) => { resolveRefresh = () => res({ ok: true }); }),
    );
    mockMe.mockResolvedValueOnce({ user: ALICE });

    // The tightest timing a synchronous test body can produce: no `act()`
    // boundary, no `await`, between the two dispatches — both fire against
    // the SAME pre-click render, since React batches the whole synchronous
    // callback into one commit at the end, not one commit per click. Despite
    // that, retryingRef is a plain ref mutation (not React state), set
    // synchronously by the first call before the second click is even
    // dispatched — so the guard holds even at this, the tightest possible
    // timing (stronger than the real-double-click case above, which the
    // button's conditional rendering already handled on its own).
    act(() => {
      fireEvent.click(retryButton);
      fireEvent.click(retryButton);
    });

    // Only the first dispatch reached the handler.
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRefresh();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('real-content')).toBeInTheDocument());
    expect(mockMe).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('heading', { name: /hold on a moment/i }),
    ).not.toBeInTheDocument();
  });

  it('a raced retry no longer leaves a stale prompt on the next logout', async () => {
    // Same adversarial setup as the test above: attempt a same-tick double
    // retry (now a inert non-race, per the in-flight guard), let it recover
    // to real content, then log out deliberately and confirm nothing stale
    // is left behind for the NEXT auth transition to trip over.
    mockRefresh.mockRejectedValueOnce(apiError(429));
    renderTestPage();
    const retryButton = await screen.findByRole('button', { name: /try again/i });
    mockRefresh.mockClear();

    let resolveRefresh!: () => void;
    mockRefresh.mockReturnValueOnce(
      new Promise<{ ok: true }>((res) => { resolveRefresh = () => res({ ok: true }); }),
    );
    mockMe.mockResolvedValueOnce({ user: ALICE });

    act(() => {
      fireEvent.click(retryButton);
      fireEvent.click(retryButton); // guarded no-op — nothing left in flight to clobber later
    });
    await act(async () => {
      resolveRefresh();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('real-content')).toBeInTheDocument());

    // Now the user deliberately logs out — a completely unrelated, correct
    // action. logout() clears `user` AND (per the fix) `authError`, so there
    // is no stale error left for useAuthGate to read.
    mockLogout.mockResolvedValueOnce({ ok: true });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'log out' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Clean genuine-logout: no SessionExpired of either variant, and the
    // real redirect-to-/login effect fires (not a stale rate_limited/expired
    // prompt standing in for it).
    expect(screen.queryByTestId('real-content')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /hold on a moment/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /your session has ended/i }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });
});

describe('useAuthGate integration — focus re-lands correctly when the error VARIANT itself changes', () => {
  it('rate_limited → retry fails differently (expired this time) → focus moves to the NEW (link) CTA, not stuck on the old one', async () => {
    // MAJOR-2 changed the mechanism this test locks: authError is no longer
    // cleared to null at the start of a retry (see AuthProvider's
    // retryAuth), so a retry that fails with a DIFFERENT classification no
    // longer routes through an intermediate skeleton — React reconciles the
    // SAME SessionExpired instance (same type+position) straight from
    // variant='rate_limited' to variant='expired', never unmounting it.
    // SessionExpired's own focus effect now depends on `variant` specifically
    // BECAUSE of this (see its own comment) — without that, this transition
    // would leave focus stale on the old (now-unmounted-within-SessionExpired)
    // button. Proving that empirically rather than trusting the reasoning
    // alone (a prior "should be safe" assumption in this same file's
    // retryAuth-clobber test turned out to be wrong when run for real).
    mockRefresh.mockRejectedValueOnce(apiError(429));
    renderTestPage();
    const retryButton = await screen.findByRole('button', { name: /try again/i });
    expect(retryButton).toHaveFocus();

    // This retry fails a DIFFERENT way — 401, not 429.
    mockRefresh.mockRejectedValueOnce(apiError(401));
    await act(async () => {
      fireEvent.click(retryButton);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      await screen.findByRole('heading', { name: /your session has ended/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    // The 'expired' variant's CTA is an <a>, a different element entirely —
    // it must be focused, proving the mount effect genuinely re-ran.
    const signInLink = screen.getByRole('link', { name: /sign in again/i });
    expect(signInLink).toHaveFocus();
    // Exactly one main landmark throughout the transition.
    expect(document.querySelectorAll('#main-content')).toHaveLength(1);
  });
});

describe('useAuthGate integration — genuine logout redirects, never renders real content', () => {
  it('router.replace("/login") fires and real-content never appears', async () => {
    mockRefresh.mockRejectedValueOnce(apiError(404)); // no refresh cookie server-side
    // initialMaybeAuthed=true always runs the mount silentRefresh in this
    // harness; a genuinely-logged-out visitor is the initialMaybeAuthed=false
    // case instead — assert that path directly.
    render(
      <AuthProvider initialUser={null} initialMaybeAuthed={false}>
        <TestPage />
      </AuthProvider>,
    );

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByTestId('real-content')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /your session has ended/i }),
    ).not.toBeInTheDocument();
  });
});
