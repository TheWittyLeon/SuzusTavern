// src/lib/auth/redirect.ts
//
// Shared same-origin open-redirect guard for the post-login `?next=` parameter.
// Used by BOTH the login page (client) and proxy.ts (Edge middleware) so the two
// can never drift on what counts as a "safe" redirect target. Pure and
// dependency-free → safe on the Edge runtime and in the browser. Do NOT add
// 'server-only' or next imports here.

/**
 * Returns a safe same-origin path derived from `next`, or `fallback`
 * (default '/dashboard') when `next` is missing, malformed, cross-origin, or a
 * protocol-relative / backslash open-redirect attempt.
 *
 * Robust against the '/\evil.com' trick: browsers normalise '/\' to '//', so a
 * naive `!startsWith('//')` check leaks. We reject any raw backslash up front,
 * require a single leading '/', then resolve via the URL parser and require the
 * resolved origin to match. The returned value preserves the path, query, and
 * fragment of a same-origin target.
 */
export function sanitizeNextPath(
  next: string | null | undefined,
  origin: string,
  fallback = '/dashboard',
): string {
  // Must be a leading-slash relative path with no backslashes. Absolute URLs
  // ('http://…') fail the leading-slash check; '/\evil.com' fails the backslash
  // check before the URL parser can normalise it into a protocol-relative URL.
  if (!next || next[0] !== '/' || next.includes('\\')) {
    return fallback;
  }
  try {
    const url = new URL(next, origin);
    // Protocol-relative ('//evil.com') resolves to a different origin → reject.
    if (url.origin !== origin) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
