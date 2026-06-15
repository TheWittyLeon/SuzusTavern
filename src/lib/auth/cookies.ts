// src/lib/auth/cookies.ts — server-only helpers for managing httpOnly session cookies.
import 'server-only';
import type { ResponseCookies } from 'next/dist/server/web/spec-extension/cookies';

/**
 * Structural duck-type accepted by the read helpers.
 * Covers both ReadonlyRequestCookies and NextRequest.cookies (RequestCookies),
 * which have slightly different class shapes.
 */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

import { env } from '@/lib/env';

export const ACCESS_COOKIE  = 'st_access';
export const REFRESH_COOKIE = 'st_refresh';
export const PARTIAL_COOKIE = 'st_partial'; // 2FA half-step

export interface CookieOpts {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;  // true in prod
  path: '/';
  maxAge: number;   // seconds
}

/** Production-grade defaults. `secure` is true iff env.IS_PROD. */
export function cookieOpts(maxAgeSeconds: number): CookieOpts {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.IS_PROD,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Set the access token cookie (15 min). Pass null to clear. */
export function setAccess(cookies: ResponseCookies, token: string | null): void {
  if (token === null) {
    cookies.delete(ACCESS_COOKIE);
  } else {
    cookies.set(ACCESS_COOKIE, token, cookieOpts(15 * 60));
  }
}

// One-shot guard so an oversized refresh token logs once per process, not on
// every 15-minute refresh (which would flood production logs once tripped).
let warnedRefreshSize = false;

/** Set the refresh token cookie (7 days). Pass null to clear. */
export function setRefresh(cookies: ResponseCookies, token: string | null): void {
  if (token === null) {
    cookies.delete(REFRESH_COOKIE);
  } else {
    // Guard: warn (once) if the token is approaching the 4KB per-cookie browser limit.
    if (token.length > 3000 && !warnedRefreshSize) {
      warnedRefreshSize = true;
      console.warn(
        `[cookies] st_refresh token length ${token.length} bytes exceeds 3000-byte soft limit — monitor for browser 4KB cap. (logged once per process)`,
      );
    }
    cookies.set(REFRESH_COOKIE, token, cookieOpts(7 * 24 * 60 * 60));
  }
}

/** Set the partial (2FA half-step) token cookie (5 min). Pass null to clear. */
export function setPartial(cookies: ResponseCookies, token: string | null): void {
  if (token === null) {
    cookies.delete(PARTIAL_COOKIE);
  } else {
    cookies.set(PARTIAL_COOKIE, token, cookieOpts(5 * 60));
  }
}

/** Clear all three managed cookies unconditionally. */
export function clearAll(cookies: ResponseCookies): void {
  cookies.delete(ACCESS_COOKIE);
  cookies.delete(REFRESH_COOKIE);
  cookies.delete(PARTIAL_COOKIE);
}

// Read helpers — work on both ReadonlyRequestCookies and ResponseCookies.

export function readAccess(cookies: CookieReader): string | null {
  return cookies.get(ACCESS_COOKIE)?.value ?? null;
}

export function readRefresh(cookies: CookieReader): string | null {
  return cookies.get(REFRESH_COOKIE)?.value ?? null;
}

export function readPartial(cookies: CookieReader): string | null {
  return cookies.get(PARTIAL_COOKIE)?.value ?? null;
}
