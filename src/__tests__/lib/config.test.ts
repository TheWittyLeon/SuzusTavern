/**
 * Tests for src/lib/config.ts
 *
 * Covers CODEX_ENABLED's resolution across environments — this is the flag
 * gating the Codex nav tab (TavernShell) and the /codex route guard (DDX-21
 * follow-up). Mirrors env.test.ts's setNodeEnv + resetModules convention,
 * since CODEX_ENABLED is derived from env.ts's IS_PROD (NODE_ENV) signal.
 */

// No top-level import/export otherwise — this `export {}` forces TS to treat
// the file as a module (isolated scope) rather than a global script, so this
// file's `setNodeEnv` doesn't collide with env.test.ts's identically-named,
// identically-shaped top-level helper (TS2393: duplicate function
// implementation — both files would otherwise merge into one global scope).
export {};

// Helper to set NODE_ENV (it's readonly in the type but writable at runtime in Node/Jest)
function setNodeEnv(value: string) {
  Object.defineProperty(process.env, 'NODE_ENV', {
    value,
    writable: true,
    configurable: true,
  });
}

describe('config.ts', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    setNodeEnv(originalNodeEnv ?? 'test');
    delete process.env.NEXT_PUBLIC_NEKANOVA_URL;
    delete process.env.AUTH_API_URL;
    jest.resetModules();
  });

  describe('CODEX_ENABLED', () => {
    it('is true under the jest test environment (NODE_ENV=test)', () => {
      // No setNodeEnv() call — asserts the REAL environment this whole suite
      // (and every other Codex test file) runs under, unmocked.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CODEX_ENABLED } = require('../../lib/config') as { CODEX_ENABLED: boolean };
      expect(process.env.NODE_ENV).toBe('test');
      expect(CODEX_ENABLED).toBe(true);
    });

    it('is true in development (NODE_ENV=development — the local dev stack)', () => {
      setNodeEnv('development');
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CODEX_ENABLED } = require('../../lib/config') as { CODEX_ENABLED: boolean };
      expect(CODEX_ENABLED).toBe(true);
    });

    it('is false in production (NODE_ENV=production)', () => {
      setNodeEnv('production');
      process.env.NEXT_PUBLIC_NEKANOVA_URL = 'http://neko:8080';
      process.env.AUTH_API_URL = 'http://auth:5000';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CODEX_ENABLED } = require('../../lib/config') as { CODEX_ENABLED: boolean };
      expect(CODEX_ENABLED).toBe(false);
    });

    it('tracks env.IS_PROD exactly (inverse)', () => {
      setNodeEnv('production');
      process.env.NEXT_PUBLIC_NEKANOVA_URL = 'http://neko:8080';
      process.env.AUTH_API_URL = 'http://auth:5000';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { env } = require('../../lib/env') as { env: { IS_PROD: boolean } };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CODEX_ENABLED } = require('../../lib/config') as { CODEX_ENABLED: boolean };
      expect(env.IS_PROD).toBe(true);
      expect(CODEX_ENABLED).toBe(!env.IS_PROD);
    });
  });

  describe('OAUTH_ENABLED (regression — untouched by this pass)', () => {
    it('is still false', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { OAUTH_ENABLED } = require('../../lib/config') as { OAUTH_ENABLED: boolean };
      expect(OAUTH_ENABLED).toBe(false);
    });
  });
});
