/**
 * @jest-environment node
 *
 * Server-context tests for src/lib/env.ts. In a real Node server there is no
 * `window`, so server-only required vars (AUTH_API_URL) must throw when missing
 * in production. jsdom (the default env for the client-side env tests) always
 * defines `window`, so those assertions live here in a node environment.
 */

export {}; // module scope — avoids a global-scope collision with env.test.ts's setNodeEnv

function setNodeEnv(value: string) {
  Object.defineProperty(process.env, 'NODE_ENV', {
    value,
    writable: true,
    configurable: true,
  });
}

describe('env.ts (server context)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    setNodeEnv(originalNodeEnv ?? 'test');
    delete process.env.NEXT_PUBLIC_NEKANOVA_URL;
    delete process.env.AUTH_API_URL;
  });

  it('has no window (confirms node environment)', () => {
    expect(typeof window).toBe('undefined');
  });

  it('throws when server-only AUTH_API_URL is missing in production on the server', () => {
    setNodeEnv('production');
    process.env.NEXT_PUBLIC_NEKANOVA_URL = 'http://neko:8080';
    delete process.env.AUTH_API_URL;
    jest.resetModules();

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../lib/env');
    }).toThrow('AUTH_API_URL');
  });

  it('throws when public NEXT_PUBLIC_NEKANOVA_URL is missing in production on the server', () => {
    setNodeEnv('production');
    delete process.env.NEXT_PUBLIC_NEKANOVA_URL;
    process.env.AUTH_API_URL = 'http://auth:5000';
    jest.resetModules();

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../lib/env');
    }).toThrow('NEXT_PUBLIC_NEKANOVA_URL');
  });
});
