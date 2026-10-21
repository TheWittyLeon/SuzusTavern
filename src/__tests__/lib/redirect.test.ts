import { sanitizeNextPath } from '@/lib/auth/redirect';

const ORIGIN = 'http://localhost:3000';

describe('sanitizeNextPath — shared open-redirect guard', () => {
  describe('safe same-origin paths (returned, preserving query + fragment)', () => {
    it.each([
      ['/dashboard', '/dashboard'],
      ['/lobby', '/lobby'],
      ['/character/new', '/character/new'],
      ['/play/session-1?round=2', '/play/session-1?round=2'],
      ['/lobby?filter=open#section', '/lobby?filter=open#section'],
    ])('keeps %s', (input, expected) => {
      expect(sanitizeNextPath(input, ORIGIN)).toBe(expected);
    });
  });

  describe('unsafe targets fall back to /dashboard', () => {
    it.each([
      ['//evil.com', 'protocol-relative'],
      ['/\\evil.com', 'backslash trick (browsers normalise /\\ to //)'],
      ['\\/\\/evil.com', 'leading backslash'],
      ['https://evil.com', 'absolute https'],
      ['http://evil.com', 'absolute http'],
      ['javascript:alert(1)', 'javascript scheme'],
      ['', 'empty string'],
      ['relative/path', 'no leading slash'],
    ])('rejects %s (%s)', (input) => {
      expect(sanitizeNextPath(input, ORIGIN)).toBe('/dashboard');
    });

    // HUNT1020-03: the URL parser drops dot segments, so these stay same-origin yet come back as
    // pathname '//evil.com' — which the proxy 307 and router.replace re-resolve as protocol-relative.
    it.each([
      ['/.//evil.com'],
      ['/..//evil.com'],
      ['/%2e//evil.com'],
      ['/%2E%2E//evil.com'],
      ['/a/..//evil.com'],
      ['/./\t/evil.com'],
    ])('rejects dot-segment smuggle %s', (input) => {
      expect(sanitizeNextPath(input, ORIGIN)).toBe('/dashboard');
    });

    it('never returns a value that re-resolves off-origin or starts with //', () => {
      for (const input of ['/.//evil.com', '/..//evil.com', '/%2e//x', '/./\n/x', '/a/.././/x', '/.//\\x']) {
        const out = sanitizeNextPath(input, ORIGIN);
        expect(out.startsWith('//')).toBe(false);
        expect(new URL(out, ORIGIN).origin).toBe(ORIGIN);
      }
    });

    it('keeps a legitimate path that merely contains dot segments', () => {
      expect(sanitizeNextPath('/lobby/../dashboard', ORIGIN)).toBe('/dashboard');
      expect(sanitizeNextPath('/a/./b?x=1#h', ORIGIN)).toBe('/a/b?x=1#h');
    });

    it('rejects null', () => {
      expect(sanitizeNextPath(null, ORIGIN)).toBe('/dashboard');
    });

    it('rejects undefined', () => {
      expect(sanitizeNextPath(undefined, ORIGIN)).toBe('/dashboard');
    });
  });

  it('honours a custom fallback', () => {
    expect(sanitizeNextPath('//evil.com', ORIGIN, '/login')).toBe('/login');
  });
});
