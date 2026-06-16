/**
 * Tests for src/lib/auth/cookies.ts
 *
 * Covers:
 *   - cookieOpts.secure flips on env.COOKIE_SECURE
 *   - clearAll deletes all three cookies
 *   - setAccess/setRefresh/setPartial set correct maxAge
 */

jest.mock('server-only', () => ({}));

describe('auth/cookies.ts', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // Helper to load the module with a specific COOKIE_SECURE value
  function loadCookies(cookieSecure: boolean) {
    jest.mock('../../lib/env', () => ({
      env: { COOKIE_SECURE: cookieSecure, IS_PROD: cookieSecure, AUTH_API_URL: 'http://localhost:5000', NEKANOVA_URL: 'http://localhost:8080', PUBLIC_AUTH_URL: null },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../../lib/auth/cookies') as typeof import('../../lib/auth/cookies');
  }

  // Minimal mock for ResponseCookies
  function makeMockCookies() {
    const store: Map<string, unknown> = new Map();
    return {
      set: jest.fn((name: string, value: string, opts: unknown) => store.set(name, { value, opts })),
      delete: jest.fn((name: string) => store.delete(name)),
      get: jest.fn((name: string) => store.get(name) as { value: string } | undefined),
      _store: store,
    };
  }

  describe('cookieOpts', () => {
    it('secure is false when COOKIE_SECURE is false', () => {
      const { cookieOpts } = loadCookies(false);
      const opts = cookieOpts(60);
      expect(opts.secure).toBe(false);
    });

    it('secure is true when COOKIE_SECURE is true', () => {
      jest.resetModules();
      const { cookieOpts } = loadCookies(true);
      const opts = cookieOpts(60);
      expect(opts.secure).toBe(true);
    });

    it('has correct fixed properties', () => {
      const { cookieOpts } = loadCookies(false);
      const opts = cookieOpts(900);
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe('lax');
      expect(opts.path).toBe('/');
      expect(opts.maxAge).toBe(900);
    });
  });

  describe('clearAll', () => {
    it('deletes all three cookies', () => {
      const { clearAll, ACCESS_COOKIE, REFRESH_COOKIE, PARTIAL_COOKIE } = loadCookies(false);
      const mockCookies = makeMockCookies();

      clearAll(mockCookies as unknown as import('next/dist/server/web/spec-extension/cookies').ResponseCookies);

      expect(mockCookies.delete).toHaveBeenCalledWith(ACCESS_COOKIE);
      expect(mockCookies.delete).toHaveBeenCalledWith(REFRESH_COOKIE);
      expect(mockCookies.delete).toHaveBeenCalledWith(PARTIAL_COOKIE);
      expect(mockCookies.delete).toHaveBeenCalledTimes(3);
    });
  });

  describe('setAccess', () => {
    it('sets cookie with 15-minute maxAge', () => {
      const { setAccess } = loadCookies(false);
      const mockCookies = makeMockCookies();

      setAccess(
        mockCookies as unknown as import('next/dist/server/web/spec-extension/cookies').ResponseCookies,
        'test-access-token',
      );

      expect(mockCookies.set).toHaveBeenCalledWith(
        'st_access',
        'test-access-token',
        expect.objectContaining({ maxAge: 15 * 60 }),
      );
    });

    it('calls delete when token is null', () => {
      const { setAccess } = loadCookies(false);
      const mockCookies = makeMockCookies();

      setAccess(
        mockCookies as unknown as import('next/dist/server/web/spec-extension/cookies').ResponseCookies,
        null,
      );

      expect(mockCookies.delete).toHaveBeenCalledWith('st_access');
    });
  });

  describe('setRefresh', () => {
    it('sets cookie with 7-day maxAge', () => {
      const { setRefresh } = loadCookies(false);
      const mockCookies = makeMockCookies();

      setRefresh(
        mockCookies as unknown as import('next/dist/server/web/spec-extension/cookies').ResponseCookies,
        'test-refresh-token',
      );

      expect(mockCookies.set).toHaveBeenCalledWith(
        'st_refresh',
        'test-refresh-token',
        expect.objectContaining({ maxAge: 7 * 24 * 60 * 60 }),
      );
    });

    it('calls delete when token is null', () => {
      const { setRefresh } = loadCookies(false);
      const mockCookies = makeMockCookies();

      setRefresh(
        mockCookies as unknown as import('next/dist/server/web/spec-extension/cookies').ResponseCookies,
        null,
      );

      expect(mockCookies.delete).toHaveBeenCalledWith('st_refresh');
    });

    it('logs a warning when refresh token exceeds 3000 bytes', () => {
      jest.resetModules();
      const { setRefresh } = loadCookies(false);
      const mockCookies = makeMockCookies();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { /* suppress */ });

      // 3001-char token exceeds the soft limit
      const oversizedToken = 'x'.repeat(3001);
      setRefresh(
        mockCookies as unknown as import('next/dist/server/web/spec-extension/cookies').ResponseCookies,
        oversizedToken,
      );

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('3001'));
      expect(mockCookies.set).toHaveBeenCalledWith('st_refresh', oversizedToken, expect.any(Object));

      warnSpy.mockRestore();
    });

    it('does NOT log a warning when refresh token is exactly 3000 bytes', () => {
      jest.resetModules();
      const { setRefresh } = loadCookies(false);
      const mockCookies = makeMockCookies();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { /* suppress */ });

      const exactToken = 'x'.repeat(3000);
      setRefresh(
        mockCookies as unknown as import('next/dist/server/web/spec-extension/cookies').ResponseCookies,
        exactToken,
      );

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('setPartial', () => {
    it('sets cookie with 5-minute maxAge', () => {
      const { setPartial } = loadCookies(false);
      const mockCookies = makeMockCookies();

      setPartial(
        mockCookies as unknown as import('next/dist/server/web/spec-extension/cookies').ResponseCookies,
        'partial-token',
      );

      expect(mockCookies.set).toHaveBeenCalledWith(
        'st_partial',
        'partial-token',
        expect.objectContaining({ maxAge: 5 * 60 }),
      );
    });
  });
});
