// src/lib/auth/authRoutes.ts
//
// THE list of auth BFF routes, in one pure table (Kage I3). Three things used to keep their own copy of
// it and drifted: the BFF dispatcher's if-chain, the CSRF guard's "which paths carry a body" set, and the
// client's "which 401s must not refresh-and-replay" set. Now each reads this:
//   - the dispatcher serves ONLY rows listed here (a path missing from the table is a 404, never handled);
//   - the guard requires a JSON Content-Type on every POST unless the row says `body: 'none'`;
//   - the client refreshes on a 401 only where the row says `refreshOn401`.
// Pure (no next/*, no node): Edge- and browser-safe.

export type AuthBodyKind = 'json' | 'none';

export interface AuthRoute {
  readonly method: 'GET' | 'POST';
  /** Path under /api/auth/ (no leading slash). */
  readonly path: string;
  /** 'json': the request carries a JSON body and must say so. 'none': no body is read. */
  readonly body: AuthBodyKind;
  /**
   * Whether a 401 from this route means "the access token expired, refresh and replay".
   * False for credential checks (a 401 is a wrong credential, and a replay counts twice toward the
   * upstream lock: HUNT1020-19), public endpoints, and refresh itself. `password/change` is true:
   * upstream answers a wrong current password with 400, so its 401 really is expiry.
   */
  readonly refreshOn401: boolean;
}

export const AUTH_ROUTES: readonly AuthRoute[] = [
  { method: 'GET', path: 'me', body: 'none', refreshOn401: true },
  { method: 'GET', path: 'registration-mode', body: 'none', refreshOn401: false },
  { method: 'GET', path: 'password-policy', body: 'none', refreshOn401: false },
  { method: 'POST', path: 'register', body: 'json', refreshOn401: false },
  { method: 'POST', path: 'login', body: 'json', refreshOn401: false },
  { method: 'POST', path: 'login/verify-2fa', body: 'json', refreshOn401: false },
  { method: 'POST', path: 'refresh', body: 'none', refreshOn401: false },
  // Logout reads no body, but the client sends `{}` as JSON and the guard requires it: a bodiless
  // state-changing POST is exactly what a cross-site form can send, so it earns no exemption.
  { method: 'POST', path: 'logout', body: 'json', refreshOn401: false },
  { method: 'POST', path: 'password/change', body: 'json', refreshOn401: true },
  { method: 'POST', path: 'request-password-reset', body: 'json', refreshOn401: false },
  { method: 'POST', path: 'reset-password', body: 'json', refreshOn401: false },
];

export function findAuthRoute(method: string, path: string): AuthRoute | undefined {
  return AUTH_ROUTES.find((r) => r.method === method && r.path === path);
}

const CLIENT_PREFIX = '/api/auth/';

/**
 * Client side (`apiFetch`): should a 401 from `clientPath` trigger refresh-and-replay?
 * Non-auth paths: yes. A path under /api/auth/ that is NOT in the table: no (fail safe: never replay a
 * request the table does not vouch for).
 */
export function refreshesOn401(clientPath: string): boolean {
  const bare = clientPath.split('?')[0];
  if (!bare.startsWith(CLIENT_PREFIX)) return true;
  const rel = bare.slice(CLIENT_PREFIX.length);
  return AUTH_ROUTES.find((r) => r.path === rel)?.refreshOn401 ?? false;
}
