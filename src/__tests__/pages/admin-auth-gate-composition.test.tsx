/**
 * Auth-gate + admin-role-gate COMPOSITION coverage (UIR2-TAV-3) for
 * /admin/flags and /admin/pending — two of the five retrofitted admin pages
 * that had ZERO page-level test coverage before OR after this diff (no
 * admin-flags.test.tsx / admin-pending.test.tsx exists anywhere in the repo;
 * the only admin-page auth-gate tests that exist — admin-content-queue.
 * test.tsx, admin-content-review.test.tsx — cover a DIFFERENT two pages, and
 * even those only ever test `user: null` (genuine logout) and a non-admin
 * `user`, never the new authError branch).
 *
 * Every one of these five admin pages composes TWO independent gates in
 * sequence:
 *   1. useAuthGate (UIR2-TAV-3) — resolving / failed-refresh / genuine-logout
 *   2. a pre-existing admin-ROLE effect — authenticated-but-non-admin →
 *      /dashboard
 * This file proves that composition holds for both zero-coverage pages,
 * across all 5 states: expired, rate_limited, genuine logout, authenticated
 * non-admin, and (a positive control) authenticated admin — establishing
 * that the admin content only ever resolves for its legitimate audience
 * before asserting any of the negative cases mean anything.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { FeatureFlag } from '@/lib/api/adminFlags';
import type { PendingUser } from '@/lib/api/signup';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/admin/flags',
}));

const mockUseAuth = jest.fn();
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../../components/TavernShell', () => {
  const Shell = ({ children, title }: { children: React.ReactNode; title: React.ReactNode }) => (
    <div data-testid="tavern-shell">
      <h1>{title}</h1>
      {children}
    </div>
  );
  Shell.displayName = 'TavernShell';
  return Shell;
});

const mockListFlags = jest.fn<Promise<{ flags: FeatureFlag[]; count: number; phase: number }>, [AbortSignal?]>();
jest.mock('../../lib/api/adminFlags', () => ({
  listFlags: (...args: [AbortSignal?]) => mockListFlags(...args),
}));

const mockListPending = jest.fn();
jest.mock('../../lib/api/signup', () => ({
  listPending: (...args: unknown[]) => mockListPending(...args),
  approveRegistration: jest.fn(),
  denyRegistration: jest.fn(),
}));

jest.mock('../../components/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ toast: jest.fn(), dismiss: jest.fn() }),
}));

import AdminFlagsPage from '../../app/admin/flags/page';
import AdminPendingPage from '../../app/admin/pending/page';

const ADMIN_USER = { id: 1, username: 'Leon', email: null, roles: ['admin'] };
const REGULAR_USER = { id: 2, username: 'Other', email: null, roles: ['user'] };

beforeEach(() => {
  mockReplace.mockClear();
  mockUseAuth.mockReset();
  mockListFlags.mockReset();
  mockListPending.mockReset();
});

// ---------------------------------------------------------------------------
// /admin/flags
// ---------------------------------------------------------------------------

describe('AdminFlagsPage — auth-gate + role-gate composition', () => {
  it('authError="expired" shows SessionExpired, never the admin shell, never fetches flags', async () => {
    mockUseAuth.mockReturnValue({
      user: null, loading: false, maybeAuthed: false, authError: 'expired', retryAuth: jest.fn(),
    });
    render(<AdminFlagsPage />);

    expect(
      await screen.findByRole('heading', { name: /your session has ended/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('tavern-shell')).not.toBeInTheDocument();
    expect(mockListFlags).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('authError="rate_limited" shows the retry variant, never the admin shell', async () => {
    mockUseAuth.mockReturnValue({
      user: null, loading: false, maybeAuthed: false, authError: 'rate_limited', retryAuth: jest.fn(),
    });
    render(<AdminFlagsPage />);

    expect(await screen.findByRole('heading', { name: /hold on a moment/i })).toBeInTheDocument();
    expect(screen.queryByTestId('tavern-shell')).not.toBeInTheDocument();
    expect(mockListFlags).not.toHaveBeenCalled();
  });

  it('genuine logout redirects to /login (role effect never fires — user is null)', async () => {
    mockUseAuth.mockReturnValue({
      user: null, loading: false, maybeAuthed: false, authError: null, retryAuth: jest.fn(),
    });
    render(<AdminFlagsPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByTestId('tavern-shell')).not.toBeInTheDocument();
    expect(mockListFlags).not.toHaveBeenCalled();
  });

  it('authenticated non-admin: auth gate passes through (user is truthy), then the ROLE gate redirects to /dashboard — admin content never fetched', async () => {
    mockUseAuth.mockReturnValue({
      user: REGULAR_USER, loading: false, maybeAuthed: false, authError: null, retryAuth: jest.fn(),
    });
    render(<AdminFlagsPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByTestId('tavern-shell')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /your session has ended|hold on a moment/i }),
    ).not.toBeInTheDocument();
    expect(mockListFlags).not.toHaveBeenCalled();
  });

  it('POSITIVE CONTROL: authenticated admin resolves the real page and fetches flags — proves the composed gate does not also block the legitimate case', async () => {
    mockUseAuth.mockReturnValue({
      user: ADMIN_USER, loading: false, maybeAuthed: false, authError: null, retryAuth: jest.fn(),
    });
    mockListFlags.mockResolvedValueOnce({ flags: [], count: 0, phase: 1 });
    render(<AdminFlagsPage />);

    expect(await screen.findByTestId('tavern-shell')).toBeInTheDocument();
    await waitFor(() => expect(mockListFlags).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// /admin/pending
// ---------------------------------------------------------------------------

const PENDING_ITEM: PendingUser = {
  id: 9, username: 'newbie', email: 'newbie@example.com', created_at: '2026-07-01T00:00:00Z',
};

describe('AdminPendingPage — auth-gate + role-gate composition', () => {
  it('authError="expired" shows SessionExpired, never the admin shell, never fetches pending signups', async () => {
    mockUseAuth.mockReturnValue({
      user: null, loading: false, maybeAuthed: false, authError: 'expired', retryAuth: jest.fn(),
    });
    render(<AdminPendingPage />);

    expect(
      await screen.findByRole('heading', { name: /your session has ended/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('tavern-shell')).not.toBeInTheDocument();
    expect(mockListPending).not.toHaveBeenCalled();
  });

  it('authError="rate_limited" shows the retry variant, never the admin shell', async () => {
    mockUseAuth.mockReturnValue({
      user: null, loading: false, maybeAuthed: false, authError: 'rate_limited', retryAuth: jest.fn(),
    });
    render(<AdminPendingPage />);

    expect(await screen.findByRole('heading', { name: /hold on a moment/i })).toBeInTheDocument();
    expect(mockListPending).not.toHaveBeenCalled();
  });

  it('genuine logout redirects to /login', async () => {
    mockUseAuth.mockReturnValue({
      user: null, loading: false, maybeAuthed: false, authError: null, retryAuth: jest.fn(),
    });
    render(<AdminPendingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByTestId('tavern-shell')).not.toBeInTheDocument();
    expect(mockListPending).not.toHaveBeenCalled();
  });

  it('authenticated non-admin redirects to /dashboard via the role gate — admin content never fetched', async () => {
    mockUseAuth.mockReturnValue({
      user: REGULAR_USER, loading: false, maybeAuthed: false, authError: null, retryAuth: jest.fn(),
    });
    render(<AdminPendingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByTestId('tavern-shell')).not.toBeInTheDocument();
    expect(mockListPending).not.toHaveBeenCalled();
  });

  it('POSITIVE CONTROL: authenticated admin resolves the real page and fetches pending signups', async () => {
    mockUseAuth.mockReturnValue({
      user: ADMIN_USER, loading: false, maybeAuthed: false, authError: null, retryAuth: jest.fn(),
    });
    mockListPending.mockResolvedValueOnce({ pending: [PENDING_ITEM], total: 1, page: 1, per_page: 20, pages: 1 });
    render(<AdminPendingPage />);

    expect(await screen.findByTestId('tavern-shell')).toBeInTheDocument();
    await waitFor(() => expect(mockListPending).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
