// src/lib/auth/jwt.ts
//
// Edge-safe JWT decode helpers. No Node.js APIs, no jose, no server-only guard.
// Uses only atob + JSON.parse — available on the Edge runtime and in the browser.
//
// These helpers are re-exported by session.ts (server-only) and imported directly
// by middleware.ts (Edge). Keep this file free of any server-only imports.

/**
 * Decode the *exp* claim of a JWT without verifying the signature.
 * Used only for cheap expiry gating; Authentication-Python re-verifies on use.
 *
 * Returns null on any malformed input (wrong part count, bad base64, missing exp).
 */
export function decodeJwtExp(jwt: string): number | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;
    // base64url → base64 → decode
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
    const decoded = atob(padded);
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    const exp = parsed['exp'];
    if (typeof exp !== 'number') return null;
    return exp;
  } catch {
    return null;
  }
}

/** True iff jwt is absent, malformed, or exp <= (now + skewSeconds). */
export function isExpired(jwt: string | null, skewSeconds = 0): boolean {
  if (!jwt) return true;
  const exp = decodeJwtExp(jwt);
  if (exp === null) return true;
  return exp <= Math.floor(Date.now() / 1000) + skewSeconds;
}
