// src/lib/auth/requestGuard.ts
//
// CSRF guard for the state-changing auth BFF routes (HUNT1020-22/-23). Pure: takes a Headers and
// the request's own host, returns a verdict code (or null = allowed). No import of next/*, so it
// is unit-testable and Edge-safe.
//
// Why it exists: the BFF forwarded `req.text()` upstream with a forced `application/json` header and
// looked at neither Origin nor Content-Type, so a cross-site `<form enctype="text/plain">` POST became
// a JSON login (login CSRF: the victim is signed into the attacker's account — SameSite=Lax does not
// help because a login sends no cookie, and a top-level navigation response may store them) and a
// cross-site POST to /logout cleared the victim's cookies.
//
// Policy, strictest signal first:
//   1. Sec-Fetch-Site: only 'same-origin' passes ('same-site', 'cross-site', 'none' do not). Browsers
//      send Fetch Metadata only to a "potentially trustworthy" origin, i.e. HTTPS or localhost. The LAN
//      Tavern is served over plain HTTP (the prod shape), where Chrome sends NO Sec-Fetch-Site (Kage
//      confirmed on the LAN), so there the control is rule 2, not this one.
//   2. Else Origin (a browser always sends it on a cross-origin POST): its host must equal our Host. A
//      literal 'null' or unparsable value fails.
//   3. Neither header: not a browser (curl, server-to-server, tests) — no ambient cookies to abuse.
//   4. Every POST requires a JSON Content-Type unless its authRoutes.ts row says `body: 'none'`. A cross-site page can only send
//      text/plain | urlencoded | multipart without a CORS preflight, which this BFF never answers.
//
// The refusal verdict is a fixed code: the raw header values are hostile input and are never echoed
// into logs or the response.

import type { AuthBodyKind } from './authRoutes';

export type GuardVerdict = 'cross_site' | 'bad_origin' | 'not_json';

export function checkAuthPost(
  headers: Headers,
  ownHost: string,
  bodyKind: AuthBodyKind,
): GuardVerdict | null {
  const site = headers.get('sec-fetch-site');
  if (site !== null) {
    if (site.trim().toLowerCase() !== 'same-origin') return 'cross_site';
  } else {
    const origin = headers.get('origin');
    if (origin !== null) {
      let host: string | null = null;
      try {
        host = new URL(origin).host;
      } catch {
        host = null;
      }
      // debt: Origin is compared by host[:port] only, so http://tavern vs https://tavern is not told apart.
      // ceiling: a same-host attacker on the other scheme; none exists on the single-scheme LAN today.
      // until: the HTTPS gateway lands; then compare the full origin (scheme too).
      if (host === null || host.toLowerCase() !== ownHost.toLowerCase()) return 'bad_origin';
    }
  }

  // Fail closed: JSON is required for anything that is not explicitly `'none'`.
  if (bodyKind !== 'none') {
    const ct = (headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/json') return 'not_json';
  }
  return null;
}
