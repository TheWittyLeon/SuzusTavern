/**
 * Regression guard for next.config.ts.
 *
 * UIR2-TAV-16: Next's dev-mode "N" build-activity indicator defaults to
 * bottom-left and stamped over real content in 390/640 viewport captures.
 * It's dev-only (never present in an `output: "standalone"` production
 * build), so the fix disables it outright via `devIndicators: false`
 * rather than guess a corner that's clear across every route/viewport.
 */
import nextConfig from '../../next.config';

describe('next.config.ts — devIndicators (UIR2-TAV-16)', () => {
  it('disables the dev-mode build-activity indicator', () => {
    expect(nextConfig.devIndicators).toBe(false);
  });

  it('leaves the standalone output mode untouched', () => {
    expect(nextConfig.output).toBe('standalone');
  });
});

/**
 * UIR2-TAV-10: /admin/review was a bare 404 — the review-queue UI actually
 * lives at /admin/content. A real redirects() entry (not just a nicer 404
 * page) means any stale link/bookmark/typo still lands on the right page.
 */
describe('next.config.ts — /admin/review redirect (UIR2-TAV-10)', () => {
  it('redirects /admin/review to /admin/content, temporarily (not cached forever)', async () => {
    expect(typeof nextConfig.redirects).toBe('function');
    const redirects = await nextConfig.redirects!();
    const entry = redirects.find((r) => r.source === '/admin/review');
    expect(entry).toBeDefined();
    expect(entry?.destination).toBe('/admin/content');
    expect(entry?.permanent).toBe(false);
  });
});
