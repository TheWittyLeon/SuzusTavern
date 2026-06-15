/**
 * Tests for src/lib/env.ts
 * Verifies dev defaults, prod-required throws, and optional field behaviour.
 */

// Helper to set NODE_ENV (it's readonly in the type but writable at runtime in Node/Jest)
function setNodeEnv(value: string) {
  Object.defineProperty(process.env, 'NODE_ENV', {
    value,
    writable: true,
    configurable: true,
  });
}

describe('env.ts', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    setNodeEnv(originalNodeEnv ?? 'test');
    delete process.env.NEXT_PUBLIC_NEKANOVA_URL;
    delete process.env.AUTH_API_URL;
    delete process.env.NEXT_PUBLIC_AUTH_URL;
  });

  it('returns dev defaults when required vars are absent in development', () => {
    setNodeEnv('development');
    delete process.env.NEXT_PUBLIC_NEKANOVA_URL;
    delete process.env.AUTH_API_URL;
    delete process.env.NEXT_PUBLIC_AUTH_URL;
    jest.resetModules();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { env } = require('../../lib/env') as { env: { NEKANOVA_URL: string; AUTH_API_URL: string; PUBLIC_AUTH_URL: string | null; IS_PROD: boolean } };

    expect(env.NEKANOVA_URL).toBe('http://localhost:8080');
    expect(env.AUTH_API_URL).toBe('http://localhost:5000');
    expect(env.PUBLIC_AUTH_URL).toBeNull();
    expect(env.IS_PROD).toBe(false);
  });

  it('uses provided values when set', () => {
    setNodeEnv('development');
    process.env.NEXT_PUBLIC_NEKANOVA_URL = 'http://my-neko:9999';
    process.env.AUTH_API_URL = 'http://my-auth:4000';
    process.env.NEXT_PUBLIC_AUTH_URL = 'http://my-auth-ui:4000';
    jest.resetModules();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { env } = require('../../lib/env') as { env: { NEKANOVA_URL: string; AUTH_API_URL: string; PUBLIC_AUTH_URL: string | null; IS_PROD: boolean } };

    expect(env.NEKANOVA_URL).toBe('http://my-neko:9999');
    expect(env.AUTH_API_URL).toBe('http://my-auth:4000');
    expect(env.PUBLIC_AUTH_URL).toBe('http://my-auth-ui:4000');
  });

  it('throws when NEXT_PUBLIC_NEKANOVA_URL is missing in production', () => {
    setNodeEnv('production');
    delete process.env.NEXT_PUBLIC_NEKANOVA_URL;
    process.env.AUTH_API_URL = 'http://auth:5000';
    jest.resetModules();

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../lib/env');
    }).toThrow('NEXT_PUBLIC_NEKANOVA_URL');
  });

  it('throws when AUTH_API_URL is missing in production', () => {
    setNodeEnv('production');
    process.env.NEXT_PUBLIC_NEKANOVA_URL = 'http://neko:8080';
    delete process.env.AUTH_API_URL;
    jest.resetModules();

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../lib/env');
    }).toThrow('AUTH_API_URL');
  });

  it('IS_PROD is true when NODE_ENV is production', () => {
    setNodeEnv('production');
    process.env.NEXT_PUBLIC_NEKANOVA_URL = 'http://neko:8080';
    process.env.AUTH_API_URL = 'http://auth:5000';
    jest.resetModules();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { env } = require('../../lib/env') as { env: { IS_PROD: boolean } };
    expect(env.IS_PROD).toBe(true);
  });

  it('env object is frozen', () => {
    setNodeEnv('development');
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { env } = require('../../lib/env') as { env: Record<string, unknown> };
    expect(Object.isFrozen(env)).toBe(true);
  });
});
