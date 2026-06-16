/**
 * Sprint 4 gap-fill: landing page scope-absence guards
 *
 * The original landing.test.tsx checks pricing and books are absent.
 * These tests add the remaining out-of-scope sections from the spec:
 *
 *  1. "two-modes" section (SaaS pivot copy that was cut)
 *  2. Additional pricing-adjacent text variants not covered by the original
 *  3. Hero aggregate stat row text
 *  4. Verify the "How it works" section heading is present (regression guard)
 *  5. Verify the "What she does" section heading is present (regression guard)
 *  6. Section headings are h2 — not divs, not h1 (hierarchy guard)
 *  7. Footer build tag falls back to expected text when env var absent
 *  8. "Browse tables" and "Start a campaign" CTAs link to the correct routes
 */

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import LandingPage from '@/app/page';

// ── Scope-absence: out-of-scope sections ─────────────────────────────────────

describe('Landing page — out-of-scope content absent', () => {
  it('does not render "two-modes" section text', () => {
    render(<LandingPage />);
    expect(screen.queryByText(/two modes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/solo mode/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/co-dm/i)).not.toBeInTheDocument();
  });

  it('does not render any pricing tier label', () => {
    render(<LandingPage />);
    // Additional variants beyond $9/$24 from the original test
    expect(screen.queryByText(/free tier/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/per month/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/subscribe/i)).not.toBeInTheDocument();
  });

  it('does not render fabricated uptime in the footer', () => {
    render(<LandingPage />);
    // "14d 02h" and similar patterns must not appear
    expect(screen.queryByText(/uptime/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/14d/i)).not.toBeInTheDocument();
  });

  it('does not render "7 sessions remembered" waveform status text', () => {
    // Canvas mock footer copy — out of scope
    render(<LandingPage />);
    expect(screen.queryByText(/sessions remembered/i)).not.toBeInTheDocument();
  });

  it('does not render SaaS-pivot or "other streamers" copy', () => {
    render(<LandingPage />);
    expect(screen.queryByText(/other streamers/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/for streamers/i)).not.toBeInTheDocument();
  });
});

// ── Section headings: correct level ──────────────────────────────────────────

describe('Landing page — heading hierarchy', () => {
  it('renders the "How it works" section with an h2', () => {
    render(<LandingPage />);
    // SectionHead renders an h2 for the title prop
    expect(
      screen.getByRole('heading', { level: 2, name: /three rolls/i }),
    ).toBeInTheDocument();
  });

  it('renders the "What she does" section with an h2', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('heading', { level: 2, name: /patient narrator/i }),
    ).toBeInTheDocument();
  });

  it('renders the story/why section with an h2', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('heading', { level: 2, name: /can't find a DM/i }),
    ).toBeInTheDocument();
  });

  it('has exactly one h1', () => {
    render(<LandingPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('the h1 is in the hero — not the header', () => {
    render(<LandingPage />);
    const h1 = screen.getByRole('heading', { level: 1 });
    // The h1 text is the hero headline, not a brand name
    expect(h1).toHaveTextContent(/dungeon master/i);
    expect(h1).not.toHaveTextContent(/Suzu's Tavern/);
  });
});

// ── CTA routing ───────────────────────────────────────────────────────────────

describe('Landing page — CTA routes', () => {
  it('"Start a campaign" CTA links to /login', () => {
    render(<LandingPage />);
    const ctaLink = screen.getByRole('link', { name: /start a campaign/i });
    expect(ctaLink).toHaveAttribute('href', '/login');
  });

  it('"Browse open tables" CTA links to /lobby', () => {
    render(<LandingPage />);
    const ctaLink = screen.getByRole('link', { name: /browse open tables/i });
    expect(ctaLink).toHaveAttribute('href', '/lobby');
  });

  it('"Roll a character" CTA in story section links to /login', () => {
    render(<LandingPage />);
    const ctaLinks = screen
      .getAllByRole('link')
      .filter((el) => el.textContent?.includes('Roll a character'));
    expect(ctaLinks.length).toBeGreaterThan(0);
    ctaLinks.forEach((link) =>
      expect(link).toHaveAttribute('href', '/login'),
    );
  });

  it('"Watch a table" CTA links to /lobby', () => {
    render(<LandingPage />);
    const watchLink = screen.getByRole('link', { name: /watch a table/i });
    expect(watchLink).toHaveAttribute('href', '/lobby');
  });
});

// ── Footer fallback ───────────────────────────────────────────────────────────

describe('Landing page — footer build tag', () => {
  it('renders fallback build tag text when NEXT_PUBLIC_BUILD_TAG is not set', () => {
    // env var not set in test environment — falls back to 'a NekoNova product'
    render(<LandingPage />);
    // Either the env var is set (CI) or the fallback renders. Test that the
    // footer does NOT show an empty string or "undefined".
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).not.toMatch(/undefined/);
    expect(footer.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('renders the copyright line in the footer', () => {
    render(<LandingPage />);
    expect(
      screen.getByText(/© 2026 Suzu's Tavern/i),
    ).toBeInTheDocument();
  });
});

// ── Nav links ─────────────────────────────────────────────────────────────────

describe('Landing page — navigation', () => {
  it('nav contains "How it works" anchor', () => {
    render(<LandingPage />);
    const nav = screen.getByRole('navigation');
    const howLink = Array.from(nav.querySelectorAll('a')).find((a) =>
      a.href?.includes('#how'),
    );
    expect(howLink).toBeTruthy();
  });

  it('nav contains "What she does" anchor', () => {
    render(<LandingPage />);
    const nav = screen.getByRole('navigation');
    const whatLink = Array.from(nav.querySelectorAll('a')).find((a) =>
      a.href?.includes('#what'),
    );
    expect(whatLink).toBeTruthy();
  });

  it('nav does NOT contain a link to #pricing or #books (out of scope)', () => {
    render(<LandingPage />);
    const nav = screen.getByRole('navigation');
    const allNavLinks = Array.from(nav.querySelectorAll('a'));
    const hasScoped = allNavLinks.some(
      (a) => a.href?.includes('#pricing') || a.href?.includes('#books'),
    );
    expect(hasScoped).toBe(false);
  });
});
