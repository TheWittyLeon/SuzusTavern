/**
 * Tests for src/app/dashboard/page.tsx
 *
 * Covers:
 *   - loading + maybeAuthed → renders PageSkeleton (no logged-out flash)
 *   - resolved + user → renders h1 + Sign out button
 *   - clicking Sign out calls logout() and redirects to /login
 *   - logout redirect even when logout() throws
 *   - resolved + no user → redirect to /login
 *   - single h1 present
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Mock next/navigation ──────────────────────────────────────────────────────
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
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
import DashboardPage from '../../app/dashboard/page';
import type { User } from '../../lib/api/types';

const mockLogout = authApi.logout as jest.MockedFunction<typeof authApi.logout>;
const mockRefresh = authApi.refresh as jest.MockedFunction<typeof authApi.refresh>;
const mockMe = authApi.me as jest.MockedFunction<typeof authApi.me>;

const ALICE: User = { id: 1, username: 'alice', email: null };

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderDashboard(
  initialUser: User | null,
  initialMaybeAuthed = false,
) {
  return render(
    <AuthProvider initialUser={initialUser} initialMaybeAuthed={initialMaybeAuthed}>
      <DashboardPage />
    </AuthProvider>,
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockReplace.mockClear();
  mockLogout.mockReset();
  mockRefresh.mockReset();
  mockMe.mockReset();
});

// ── Structure (authed) ────────────────────────────────────────────────────────

describe('Dashboard page — structure (authed)', () => {
  it('renders a <main> element when user is present', () => {
    renderDashboard(ALICE);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('renders exactly one h1 heading when user is present', () => {
    renderDashboard(ALICE);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
  });

  it('renders user greeting with username', () => {
    renderDashboard(ALICE);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/welcome back.*alice/i);
  });

  it('renders a Sign out button', () => {
    renderDashboard(ALICE);
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });
});

// ── Skeleton while loading ────────────────────────────────────────────────────

describe('Dashboard page — skeleton while loading + maybeAuthed', () => {
  it('renders PageSkeleton status region (no h1 yet)', () => {
    // Hold refresh pending so we stay in loading state
    mockRefresh.mockReturnValue(new Promise(() => { /* never resolves */ }));

    renderDashboard(null, /* initialMaybeAuthed */ true);

    // No welcome heading during loading
    expect(
      screen.queryByRole('heading', { level: 1, name: /welcome back/i }),
    ).not.toBeInTheDocument();

    // PageSkeleton renders one or more role=status regions with aria-busy
    const statusRegions = screen.getAllByRole('status');
    expect(statusRegions.length).toBeGreaterThan(0);
    statusRegions.forEach((el) => {
      expect(el).toHaveAttribute('aria-busy', 'true');
    });
  });

  it('transitions from skeleton to authed content after silent refresh succeeds', async () => {
    mockRefresh.mockResolvedValueOnce({ ok: true });
    mockMe.mockResolvedValueOnce({ user: ALICE });

    renderDashboard(null, true);

    // Skeleton initially
    expect(
      screen.queryByRole('heading', { name: /welcome back/i }),
    ).not.toBeInTheDocument();

    // After refresh resolves
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /welcome back.*alice/i })).toBeInTheDocument(),
    );
  });
});

// ── Logout ────────────────────────────────────────────────────────────────────

describe('Dashboard page — logout', () => {
  it('calls logout() and redirects to /login on Sign out click', async () => {
    mockLogout.mockResolvedValueOnce({ ok: true });
    renderDashboard(ALICE);

    const signOutBtn = screen.getByRole('button', { name: /sign out/i });

    await act(async () => {
      fireEvent.click(signOutBtn);
    });

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });

  it('still redirects to /login even if logout() throws', async () => {
    mockLogout.mockRejectedValueOnce(new Error('network'));
    renderDashboard(ALICE);

    const signOutBtn = screen.getByRole('button', { name: /sign out/i });

    await act(async () => {
      fireEvent.click(signOutBtn);
    });

    // AuthProvider clears user on logout even when BFF throws;
    // dashboard route effect then redirects
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });
});

// ── No user (edge case) ───────────────────────────────────────────────────────

describe('Dashboard page — no user, not loading', () => {
  it('redirects to /login when not loading and no user and not maybeAuthed', async () => {
    renderDashboard(null, false);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });
});
