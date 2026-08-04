// src/lib/api/auth.ts
//
// Typed wrappers for the auth BFF at /api/auth/*.
// All calls go to our own origin — never directly to Authentication-Python.
import { apiFetch } from './client';
import type { LoginResult, User } from './types';

export const login = (username: string, password: string, signal?: AbortSignal) =>
  apiFetch<LoginResult>('/api/auth/login', {
    method: 'POST',
    json: { username, password },
    signal,
  });

export const verify2FA = (totp_code: string, signal?: AbortSignal) =>
  apiFetch<{ kind: 'ok'; user: User }>('/api/auth/login/verify-2fa', {
    method: 'POST',
    json: { totp_code },
    signal,
  });

export const refresh = (signal?: AbortSignal) =>
  apiFetch<{ ok: true }>('/api/auth/refresh', { method: 'POST', signal });

export const me = (signal?: AbortSignal) =>
  apiFetch<{ user: User }>('/api/auth/me', { method: 'GET', signal });

export const logout = (signal?: AbortSignal) =>
  apiFetch<{ ok: true }>('/api/auth/logout', { method: 'POST', signal });

export const register = (
  username: string,
  password: string,
  email?: string,
  signal?: AbortSignal,
) =>
  apiFetch<{ user: User }>('/api/auth/register', {
    method: 'POST',
    json: { username, password, email },
    signal,
  });

// ── Password self-service (AUTH-PASSWORD-SELF-SERVICE) ──────────────────────
// All four upstream endpoints already existed in Authentication-Python; none
// was reachable, because the BFF's path allow-list is strict-deny and they had
// never been added to it. The reset EMAIL has been linking to
// `{base}/reset-password?token=…` — a page that did not exist — so the forgot
// flow 404'd end to end.

/** The server's LIVE complexity rules. Fetched rather than duplicated so the
 *  form cannot drift from the validator that actually enforces them. Public;
 *  carries no user data. */
export interface PasswordPolicy {
  min_length: number;
  max_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_digit: boolean;
  require_special: boolean;
  /** How many previous passwords are refused on reuse. */
  history_depth: number;
}

export const passwordPolicy = (signal?: AbortSignal) =>
  apiFetch<PasswordPolicy>('/api/auth/password-policy', { method: 'GET', signal });

/**
 * Change the signed-in user's password.
 *
 * NOTE: upstream REVOKES EVERY SESSION on success, and the BFF clears this
 * browser's cookies to match — so the caller must treat a 200 as "you are now
 * logged out" and send the user to /login rather than leaving them on a page
 * whose next request will 401.
 */
export const changePassword = (
  current_password: string,
  new_password: string,
  signal?: AbortSignal,
) =>
  apiFetch<{ msg?: string }>('/api/auth/password/change', {
    method: 'POST',
    json: { current_password, new_password },
    signal,
  });

/**
 * Ask for a reset link. ALWAYS resolves 200 whether or not the address exists
 * — that is deliberate anti-enumeration upstream, so the UI must show the same
 * message either way and must never imply whether an account was found.
 *
 * Upstream additionally only sends when `email_verified` is true, so a real
 * but unverified address is also a silent no-op.
 */
export const requestPasswordReset = (email: string, signal?: AbortSignal) =>
  apiFetch<{ msg?: string }>('/api/auth/request-password-reset', {
    method: 'POST',
    json: { email },
    signal,
  });

/** Consume a reset token from the emailed link. `errors` carries field-level
 *  complexity failures and is already relayed by the BFF's key allow-list. */
export const resetPassword = (token: string, password: string, signal?: AbortSignal) =>
  apiFetch<{ msg?: string; errors?: string[] }>('/api/auth/reset-password', {
    method: 'POST',
    json: { token, password },
    signal,
  });
