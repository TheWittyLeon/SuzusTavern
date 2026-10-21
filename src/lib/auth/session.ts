// src/lib/auth/session.ts — server-only
import 'server-only';
import { cookies } from 'next/headers';

import { env } from '@/lib/env';
import type { User } from '@/lib/api/types';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './cookies';
import { getSharedMeCache } from './meCache';

// Re-export the pure Edge-safe helpers so callers that don't need server APIs
// can import from here without hitting the server-only guard.
export { decodeJwtExp, isExpired } from './jwt';

/**
 * How long the root layout waits for /auth/me before rendering without it (HUNT1020-24). The layout
 * awaits this before a single byte of HTML, so a stalled Auth-Python used to blank every page for as
 * long as undici's default (minutes). On timeout the page renders as "maybe authed" and the client's
 * silent refresh sorts it out.
 */
export const SESSION_ME_DEADLINE_MS = 2500;

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

  // HUNT1020-05: one /auth/me per document render burned Auth-Python's 20/hour cap. Serve a user
  // fetched for THIS exact token in the last 60 s (see meCache.ts for the no-bleed properties).
  const cache = getSharedMeCache();
  const cachedUser = cache.get(token);
  if (cachedUser) {
    return { user: cachedUser, accessExpiresAt, maybeAuthed: false };
  }

  try {
    const res = await fetch(`${env.AUTH_API_URL}/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      // Don't use Next's fetch cache — the 60 s per-token cache above is the only one.
      cache: 'no-store',
      // HUNT1020-24: a deadline, so a stalled upstream cannot hold the whole shell. A timeout throws
      // into the catch below, which already renders "no user, maybeAuthed iff a refresh cookie".
      signal: AbortSignal.timeout(SESSION_ME_DEADLINE_MS),
    });

    if (res.status === 401) cache.evict(token);

    if (!res.ok) {
      // Valid access token but /auth/me failed — treat as no session.
      // maybeAuthed reflects refresh presence in case the access token was
      // unexpectedly rejected (e.g. server restart cleared the signing key).
      return { user: null, accessExpiresAt, maybeAuthed: hasRefresh };
    }

    const data = await res.json() as { user?: User };
    // Only a real user is cached; never an error, an empty body or a timeout.
    if (data.user) cache.set(token, data.user, accessExpiresAt);
    return { user: data.user ?? null, accessExpiresAt, maybeAuthed: false };
  } catch {
    // Network error or parse failure — treat as no session
    return { user: null, accessExpiresAt, maybeAuthed: hasRefresh };
  }
}
