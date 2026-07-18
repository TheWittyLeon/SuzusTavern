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
