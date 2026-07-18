/**
 * Tests for src/lib/auth/useAuthGate.tsx (UIR2-TAV-3).
 *
 * Unit-tests the hook against a mocked useAuth() — AuthProvider's own state
 * machine (silentRefresh → authError) is covered separately in
 * AuthProvider.autherror.test.tsx — so each gate outcome can be asserted in
 * isolation without driving the whole provider through a fetch mock.
 *
 * Covers:
 *   - user present → gate is null, page body renders, no redirect
 *   - authError='expired' → SessionExpired (expired copy), no redirect
 *   - authError='rate_limited' → SessionExpired (rate_limited copy); its
 *     retry control invokes retryAuth()
 *   - loading/maybeAuthed (resolving) → bounded skeleton with the given label
 *   - genuine logout (user/loading/maybeAuthed/authError all falsy) →
 *     router.replace('/login'); skeleton shown in the meantime, never the
 *     page body
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PageSkeleton from '../../components/PageSkeleton';

const mockReplace = jest.fn();
const mockUsePathname = jest.fn(() => '/dashboard');
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => mockUsePathname(),
}));

const mockUseAuth = jest.fn();
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

import { useAuthGate } from '../../lib/auth/useAuthGate';

const SKELETON = <div data-testid="skeleton-content">loading skeleton</div>;

function Harness() {
  const gate = useAuthGate({ skeleton: SKELETON, label: 'Loading the thing' });
  if (gate) return <>{gate}</>;
  return <div data-testid="page-body">real page body</div>;
}

beforeEach(() => {
  mockReplace.mockClear();
  mockUsePathname.mockClear();
  mockUsePathname.mockReturnValue('/dashboard');
  mockUseAuth.mockReset();
});

describe('useAuthGate — user present', () => {
  it('returns null (page body renders) and never redirects', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, username: 'alice', email: null },
      loading: false,
      maybeAuthed: false,
      authError: null,
      retryAuth: jest.fn(),
    });
    render(<Harness />);
    expect(screen.getByTestId('page-body')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('useAuthGate — authError="expired"', () => {
  it('renders SessionExpired (expired copy) instead of the page body', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      maybeAuthed: false,
      authError: 'expired',
      retryAuth: jest.fn(),
    });
    render(<Harness />);
    expect(screen.queryByTestId('page-body')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /your session has ended/i }),
    ).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('forwards the current pathname into the sign-in link', () => {
    mockUsePathname.mockReturnValue('/character/42');
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      maybeAuthed: false,
      authError: 'expired',
      retryAuth: jest.fn(),
    });
    render(<Harness />);
    expect(screen.getByRole('link', { name: /sign in again/i })).toHaveAttribute(
      'href',
      '/login?next=%2Fcharacter%2F42',
    );
  });
});

describe('useAuthGate — authError="rate_limited"', () => {
  it('renders SessionExpired (rate_limited copy) whose retry calls retryAuth()', async () => {
    const retryAuth = jest.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      maybeAuthed: false,
      authError: 'rate_limited',
      retryAuth,
    });
    render(<Harness />);
    expect(screen.getByRole('heading', { name: /hold on a moment/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(retryAuth).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('useAuthGate — resolving (loading/maybeAuthed)', () => {
  it('renders the bounded skeleton landmark; no redirect', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      maybeAuthed: true,
      authError: null,
      retryAuth: jest.fn(),
    });
    render(<Harness />);
    expect(screen.queryByTestId('page-body')).not.toBeInTheDocument();
    expect(screen.getByTestId('skeleton-content')).toBeInTheDocument();
    // Iro-A11y MAJOR-1: the wrapper carries only the landmark id — no aria-busy
    // /aria-label, because PageSkeleton owns the single loading live region
    // (role="status"); a second one here would double-announce.
    const skeletonMain = screen.getByRole('main');
    expect(skeletonMain).toHaveAttribute('id', 'main-content');
    expect(skeletonMain).not.toHaveAttribute('aria-busy');
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('useAuthGate — DDX-TAV3-SKELETON-LABEL', () => {
  function LabelHarness({ skeleton }: { skeleton: ReactNode }) {
    const gate = useAuthGate({ skeleton, label: 'Loading your dashboard' });
    if (gate) return <>{gate}</>;
    return <div data-testid="page-body">real page body</div>;
  }

  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      maybeAuthed: true,
      authError: null,
      retryAuth: jest.fn(),
    });
  });

  it('threads opts.label onto a single <PageSkeleton> child as its own label — still exactly one role="status" region', () => {
    render(<LabelHarness skeleton={<PageSkeleton variant="card" lines={3} />} />);
    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveAttribute('aria-label', 'Loading your dashboard');
    expect(regions[0]).toHaveTextContent('Loading your dashboard');
  });

  it('threads the same label onto EVERY <PageSkeleton> nested inside a Fragment/div wrapper (dashboard\'s stacked-card+list shape) — still one live region\'s worth of distinct text, not two different generic "Loading…"s', () => {
    render(
      <LabelHarness
        skeleton={
          <>
            <PageSkeleton variant="card" lines={3} />
            <div style={{ marginTop: 20 }}>
              <PageSkeleton variant="list" lines={4} />
            </div>
          </>
        }
      />,
    );
    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(2);
    regions.forEach((r) => expect(r).toHaveAttribute('aria-label', 'Loading your dashboard'));
  });

  it('does not override a <PageSkeleton> that already sets its own explicit label', () => {
    render(
      <LabelHarness
        skeleton={<PageSkeleton variant="card" label="Loading something more specific" />}
      />,
    );
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading something more specific',
    );
  });

  it('the wrapping <main> itself never gains aria-busy/aria-label — the label lives on PageSkeleton\'s region only, not a second one', () => {
    render(<LabelHarness skeleton={<PageSkeleton variant="card" lines={3} />} />);
    const main = screen.getByRole('main');
    expect(main).not.toHaveAttribute('aria-busy');
    expect(main).not.toHaveAttribute('aria-label');
  });
});

describe('useAuthGate — genuine logout', () => {
  it('redirects to /login, and never renders the page body while doing so', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      maybeAuthed: false,
      authError: null,
      retryAuth: jest.fn(),
    });
    render(<Harness />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByTestId('page-body')).not.toBeInTheDocument();
    // Bounded skeleton, not SessionExpired — this is the "never had a
    // session" case, not a failed-refresh case.
    expect(screen.getByTestId('skeleton-content')).toBeInTheDocument();
  });
});
