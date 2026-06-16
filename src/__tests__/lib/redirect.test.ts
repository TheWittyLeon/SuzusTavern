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
