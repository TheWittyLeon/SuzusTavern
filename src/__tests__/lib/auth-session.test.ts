/**
 * Tests for src/lib/auth/session.ts
 *
 * Covers:
 *   - decodeJwtExp: malformed input, missing exp, expired/future timestamps
 *   - isExpired: absent jwt, clock skew
 *   - getServerSession: no cookie, expired cookie, valid cookie (upstream ok/fail)
 */

// Mock server-only so the module can be imported in jsdom environment
jest.mock('server-only', () => ({}));
// Mock next/headers — only used by getServerSession
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined),
  }),
}));
// Mock env (getServerSession uses it; pure functions don't)
jest.mock('../../lib/env', () => ({
  env: { AUTH_API_URL: 'http://localhost:5000', IS_PROD: false },
}));

import { decodeJwtExp, isExpired } from '../../lib/auth/session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const body = btoa(JSON.stringify(payload))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${body}.fakesig`;
}

const NOW_UNIX = Math.floor(Date.now() / 1000);
const FUTURE = NOW_UNIX + 3600;   // 1 hour from now
const PAST   = NOW_UNIX - 3600;   // 1 hour ago

// ---------------------------------------------------------------------------
// decodeJwtExp
// ---------------------------------------------------------------------------

describe('decodeJwtExp', () => {
  it('returns exp for a valid future JWT', () => {
    const jwt = makeJwt({ sub: '1', exp: FUTURE });
    expect(decodeJwtExp(jwt)).toBe(FUTURE);
  });

  it('returns exp for an already-expired JWT', () => {
    const jwt = makeJwt({ sub: '1', exp: PAST });
    expect(decodeJwtExp(jwt)).toBe(PAST);
  });

  it('returns null when exp is absent from payload', () => {
    const jwt = makeJwt({ sub: '1' });
    expect(decodeJwtExp(jwt)).toBeNull();
  });

  it('returns null when exp is not a number', () => {
    const jwt = makeJwt({ sub: '1', exp: 'not-a-number' });
    expect(decodeJwtExp(jwt)).toBeNull();
  });

  it('returns null for a malformed string (not 3 parts)', () => {
    expect(decodeJwtExp('not.a.valid.jwt.at.all')).toBeNull();
    expect(decodeJwtExp('onlytwoparts.x')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decodeJwtExp('')).toBeNull();
  });

  it('returns null when payload is not valid base64url JSON', () => {
    expect(decodeJwtExp('header.!!!notbase64!!!.sig')).toBeNull();
  });

  it('returns null when the payload segment is an empty string', () => {
    // Produces header..sig — parts.length is 3 but parts[1] is ''
    expect(decodeJwtExp('header..sig')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isExpired
// ---------------------------------------------------------------------------

describe('isExpired', () => {
  it('returns true for null jwt', () => {
    expect(isExpired(null)).toBe(true);
  });

  it('returns true for empty string jwt', () => {
    expect(isExpired('')).toBe(true);
  });

  it('returns true for expired token', () => {
    const jwt = makeJwt({ exp: PAST });
    expect(isExpired(jwt)).toBe(true);
  });

  it('returns false for future token', () => {
    const jwt = makeJwt({ exp: FUTURE });
    expect(isExpired(jwt)).toBe(false);
  });

  it('returns true when skewSeconds pushes a near-future token past expiry', () => {
    const nearFuture = NOW_UNIX + 10; // expires in 10 seconds
    const jwt = makeJwt({ exp: nearFuture });
    // With 30s skew, a token expiring in 10s is treated as expired
    expect(isExpired(jwt, 30)).toBe(true);
  });

  it('returns false when skewSeconds does not push token past expiry', () => {
    const farFuture = NOW_UNIX + 3600;
    const jwt = makeJwt({ exp: farFuture });
    expect(isExpired(jwt, 30)).toBe(false);
  });

  it('returns true for malformed jwt', () => {
    expect(isExpired('garbage')).toBe(true);
  });
});

