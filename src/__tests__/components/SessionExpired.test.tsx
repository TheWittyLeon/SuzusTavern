/**
 * Tests for src/components/SessionExpired.tsx (UIR2-TAV-3).
 *
 * Covers:
 *   - both variants render as a <main> landmark labelled by their own heading
 *   - 'expired': "Sign in again" links to /login, carrying ?next=<pathname>
 *     when a pathname is supplied, and bare /login when it isn't
 *   - 'rate_limited': "Try again" calls onRetry; a secondary link still
 *     offers a direct path to /login
 *   - the primary CTA receives focus on mount, for both variants
 */
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SessionExpired from '@/components/SessionExpired';

describe('SessionExpired — variant="expired" (default)', () => {
  it('renders as a <main> landmark labelled by its own heading', () => {
    render(<SessionExpired pathname="/dashboard" />);
    expect(
      screen.getByRole('main', { name: /your session has ended/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /your session has ended/i }),
    ).toBeInTheDocument();
  });

  it('explains what happened', () => {
    render(<SessionExpired pathname="/dashboard" />);
    expect(screen.getByText(/signed out/i)).toBeInTheDocument();
  });

  it('"Sign in again" links to /login carrying ?next=<pathname>', () => {
    render(<SessionExpired pathname="/dashboard" />);
    const link = screen.getByRole('link', { name: /sign in again/i });
    expect(link).toHaveAttribute('href', '/login?next=%2Fdashboard');
  });

  it('links to bare /login when no pathname is supplied', () => {
    render(<SessionExpired />);
    const link = screen.getByRole('link', { name: /sign in again/i });
    expect(link).toHaveAttribute('href', '/login');
  });

  it('focuses the primary CTA on mount', () => {
    render(<SessionExpired pathname="/dashboard" />);
    expect(screen.getByRole('link', { name: /sign in again/i })).toHaveFocus();
  });

  it('does not render a retry control', () => {
    render(<SessionExpired pathname="/dashboard" />);
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});

describe('SessionExpired — variant="rate_limited"', () => {
  it('renders as a <main> landmark labelled by its own heading', () => {
    render(<SessionExpired variant="rate_limited" />);
    expect(screen.getByRole('main', { name: /hold on a moment/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /hold on a moment/i }),
    ).toBeInTheDocument();
  });

  it('"Try again" calls onRetry when clicked', () => {
    const onRetry = jest.fn();
    render(<SessionExpired variant="rate_limited" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers a secondary link straight to /login', () => {
    render(<SessionExpired variant="rate_limited" />);
    const links = screen.getAllByRole('link');
    expect(links.some((l) => l.getAttribute('href') === '/login')).toBe(true);
  });

  it('focuses the primary CTA (Try again) on mount', () => {
    render(<SessionExpired variant="rate_limited" onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: /try again/i })).toHaveFocus();
  });

  // MAJOR-2 (Tora, interaction review): `busy` drives an in-place
  // "Retrying…" presentation instead of unmounting/disabling the CTA.
  it('busy=true shows "Retrying…" and marks the CTA aria-busy, WITHOUT disabling it (focus must never leave a busy CTA)', () => {
    render(<SessionExpired variant="rate_limited" onRetry={() => {}} busy />);
    const cta = screen.getByRole('button', { name: /retrying/i });
    expect(cta).toHaveAttribute('aria-busy', 'true');
    // Deliberately NOT disabled — a native `disabled` attribute blurs a
    // currently-focused button in most browsers, which would defeat the
    // fix's whole point.
    expect(cta).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: /^try again$/i })).not.toBeInTheDocument();
  });

  it('busy=false (default) shows the ordinary "Try again" label with no aria-busy', () => {
    render(<SessionExpired variant="rate_limited" onRetry={() => {}} />);
    const cta = screen.getByRole('button', { name: /try again/i });
    expect(cta).not.toHaveAttribute('aria-busy');
  });

  it('the CTA stays focused across a busy transition — same DOM node, never re-mounted', () => {
    const { rerender } = render(<SessionExpired variant="rate_limited" onRetry={() => {}} />);
    const before = screen.getByRole('button', { name: /try again/i });
    expect(before).toHaveFocus();
    rerender(<SessionExpired variant="rate_limited" onRetry={() => {}} busy />);
    const after = screen.getByRole('button', { name: /retrying/i });
    expect(after).toBe(before);
    expect(after).toHaveFocus();
  });
});

describe('SessionExpired — variant="offline" (TAV3-OFFLINE-VARIANT)', () => {
  it('renders as a <main> landmark labelled by its own heading, distinct from "expired"', () => {
    render(<SessionExpired variant="offline" />);
    expect(
      screen.getByRole('main', { name: /can.?t reach the tavern/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /can.?t reach the tavern/i }),
    ).toBeInTheDocument();
  });

  it('does not assert the user was signed out (unlike "expired")', () => {
    render(<SessionExpired variant="offline" />);
    expect(screen.queryByText(/signed out/i)).not.toBeInTheDocument();
  });

  it('"Try again" calls onRetry when clicked (retry, not sign-in, is the primary action)', () => {
    const onRetry = jest.fn();
    render(<SessionExpired variant="offline" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('still offers a secondary link straight to /login', () => {
    render(<SessionExpired variant="offline" />);
    const links = screen.getAllByRole('link');
    expect(links.some((l) => l.getAttribute('href') === '/login')).toBe(true);
  });

  it('focuses the primary CTA (Try again) on mount', () => {
    render(<SessionExpired variant="offline" onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: /try again/i })).toHaveFocus();
  });

  // MAJOR-2 (Tora, interaction review): same busy contract as "rate_limited".
  it('busy=true shows "Retrying…" and marks the CTA aria-busy, WITHOUT disabling it', () => {
    render(<SessionExpired variant="offline" onRetry={() => {}} busy />);
    const cta = screen.getByRole('button', { name: /retrying/i });
    expect(cta).toHaveAttribute('aria-busy', 'true');
    expect(cta).not.toBeDisabled();
  });

  it('the CTA stays focused across a busy transition — same DOM node, never re-mounted', () => {
    const { rerender } = render(<SessionExpired variant="offline" onRetry={() => {}} />);
    const before = screen.getByRole('button', { name: /try again/i });
    expect(before).toHaveFocus();
    rerender(<SessionExpired variant="offline" onRetry={() => {}} busy />);
    const after = screen.getByRole('button', { name: /retrying/i });
    expect(after).toBe(before);
    expect(after).toHaveFocus();
  });
});
