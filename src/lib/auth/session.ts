// src/lib/auth/session.ts — server-only
import 'server-only';
import { cookies } from 'next/headers';

import { env } from '@/lib/env';
import type { User } from '@/lib/api/types';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './cookies';

// Re-export the pure Edge-safe helpers so callers that don't need server APIs
// can import from here without hitting the server-only guard.
export { decodeJwtExp, isExpired } from './jwt';

/**
 * Server-component helper. Reads st_access from cookies, decodes exp,
 * fetches the user directly from AUTH_API_URL server-to-server.
 *
 * Does NOT call the BFF route (which resolves against window.location.origin —
 * undefined server-side). Goes directly to Authentication-Python instead.
 *
 * NEVER calls /auth/refresh here — RSCs can read cookies but cannot set them.
 * Refreshing server-side would rotate the refresh token and then be unable to
 * persist the new token → logout cascade. Refresh happens client-side in
 * AuthProvider after mount.
 *
 * Returns:
 *   { user, accessExpiresAt, maybeAuthed }
 *
 * maybeAuthed is true iff the access token is missing/expired BUT a refresh
 * cookie (st_refresh) is present. Layout uses this to render an authenticated
 * shell + skeleton instead of the logged-out view, while the client silently
 * refreshes. See M2 fix in SPRINT2_FOUNDATION_DESIGN.md §10.
 */
export async function getServerSession(): Promise<{
  user: User | null;
  accessExpiresAt: number | null;
  maybeAuthed: boolean;
}> {
  const { decodeJwtExp, isExpired } = await import('./jwt');
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE)?.value ?? null;
  const accessExpiresAt = token ? decodeJwtExp(token) : null;

  const hasRefresh = Boolean(cookieStore.get(REFRESH_COOKIE)?.value);

  if (!token || isExpired(token)) {
    // Access missing or expired — check if refresh is present for maybeAuthed.
    // Do NOT call /auth/me (no valid access token to send).
    return { user: null, accessExpiresAt, maybeAuthed: hasRefresh };
  }

  try {
    const res = await fetch(`${env.AUTH_API_URL}/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      // Don't cache — session state changes frequently
      cache: 'no-store',
    });

    if (!res.ok) {
      // Valid access token but /auth/me failed — treat as no session.
      // maybeAuthed reflects refresh presence in case the access token was
      // unexpectedly rejected (e.g. server restart cleared the signing key).
      return { user: null, accessExpiresAt, maybeAuthed: hasRefresh };
    }

    const data = await res.json() as { user?: User };
    return { user: data.user ?? null, accessExpiresAt, maybeAuthed: false };
  } catch {
    // Network error or parse failure — treat as no session
    return { user: null, accessExpiresAt, maybeAuthed: hasRefresh };
  }
}
