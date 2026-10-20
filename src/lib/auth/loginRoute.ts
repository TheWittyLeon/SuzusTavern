// src/lib/auth/loginRoute.ts
//
// The login route's identity in ONE place. Pure (no React, no next/*), so the edge proxy, the
// client AuthProvider/useAuthGate and SessionExpired all import it without drift.

/** The login route's pathname. */
export const LOGIN_PATH = '/login';

/** Matches `LOGIN_PATH` and anything under it (pathname only, no query). */
export const LOGIN_ROUTE_RE = new RegExp(`^${LOGIN_PATH}(/|$)`);

/** Query param proxy.ts honours as "the client has decided this session is over". */
export const REAUTH_PARAM = 'reauth';

/**
 * Where a client leaves a session: `/login?reauth=1`. proxy.ts then serves the login form even
 * while a (possibly dead, possibly just-signed-out) st_access still looks valid on paper, and it is
 * a fresh client-router cache key, so an earlier `/login` → `/dashboard` 307 cannot be replayed.
 */
export const LOGIN_REAUTH_HREF = `${LOGIN_PATH}?${REAUTH_PARAM}=1`;
