/**
 * Regression guard for next.config.ts.
 *
 * UIR2-TAV-16: Next's dev-mode "N" build-activity indicator defaults to
 * bottom-left and stamped over real content in 390/640 viewport captures.
 * It's dev-only (never present in an `output: "standalone"` production
 * build), so the fix disables it outright via `devIndicators: false`
 * rather than guess a corner that's clear across every route/viewport.
 */
import nextConfig, { parseOrigins } from '../../next.config';

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

/**
 * Dev profile: the cross-origin dev allow-list comes from ALLOWED_DEV_ORIGINS,
 * not a host literal in code, so a second dev host is an env value.
 */
describe('next.config.ts — allowedDevOrigins from ALLOWED_DEV_ORIGINS', () => {
  it('parses a comma-separated list, trimming and dropping empties', () => {
    expect(parseOrigins('10.69.69.226, 10.69.69.218 ,,')).toEqual(['10.69.69.226', '10.69.69.218']);
  });

  it('rejects a scheme, port or path loudly: Next compares hostnames only, so it would never match', () => {
    expect(() => parseOrigins('http://10.0.0.5')).toThrow(/bare hostname/);
    expect(() => parseOrigins('10.0.0.5:13000')).toThrow(/bare hostname/);
    expect(() => parseOrigins('ok.lan,10.0.0.5/x')).toThrow(/10\.0\.0\.5\/x/);
  });

  it.each(['*', '**', '*.*', '**.*', '*.*.*.*', '*.com', '10.69.69.*', '*.lan', 'ok.lan,*.*'])(
    'rejects the wildcard entry %j',
    (raw) => {
      expect(() => parseOrigins(raw)).toThrow(/wildcard/);
    },
  );

  it('documents why: Next 16.2.6 matches these wildcards against real hosts (characterisation)', () => {
    // Internal Next module; if this goes red after an upgrade, re-read the reasoning in next.config.ts.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isCsrfOriginAllowed } = require('next/dist/server/app-render/csrf-protection') as {
      isCsrfOriginAllowed: (origin: string, allowed: string[]) => boolean;
    };
    expect(isCsrfOriginAllowed('evil.com', ['*.*'])).toBe(true);
    expect(isCsrfOriginAllowed('10.1.2.3', ['*.*.*.*'])).toBe(true);
    expect(isCsrfOriginAllowed('evil.com', ['*.com'])).toBe(true);
    expect(isCsrfOriginAllowed('10.69.69.7', ['10.69.69.*'])).toBe(true);
    expect(isCsrfOriginAllowed('evil.example', ['*'])).toBe(false);
    expect(isCsrfOriginAllowed('10.0.0.5', ['10.0.0.5'])).toBe(true);
  });

  it('is empty when unset or blank', () => {
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins('  ')).toEqual([]);
  });

  it('the exported config carries no host literal of its own', () => {
    const saved = process.env.ALLOWED_DEV_ORIGINS;
    try {
      delete process.env.ALLOWED_DEV_ORIGINS;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fresh = require('../../next.config').default;
        expect(fresh.allowedDevOrigins).toEqual([]);
      });
      process.env.ALLOWED_DEV_ORIGINS = '10.0.0.5';
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fresh = require('../../next.config').default;
        expect(fresh.allowedDevOrigins).toEqual(['10.0.0.5']);
      });
    } finally {
      if (saved === undefined) delete process.env.ALLOWED_DEV_ORIGINS; else process.env.ALLOWED_DEV_ORIGINS = saved;
    }
  });
});
