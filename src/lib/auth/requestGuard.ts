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
//   1. Sec-Fetch-Site (every current browser sends it, and page script cannot forge it): only
//      'same-origin' passes. 'same-site' (another port/subdomain), 'cross-site' and 'none' do not.
//   2. Else Origin (older browsers always send it on a POST): its host must equal our Host. A
//      literal 'null' or unparsable value fails.
//   3. Neither header: not a browser (curl, server-to-server, tests) — no ambient cookies to abuse.
//   4. Bodied routes also require a JSON Content-Type. A cross-site page can only send
//      text/plain | urlencoded | multipart without a CORS preflight, which this BFF never answers.
//
// The refusal verdict is a fixed code: the raw header values are hostile input and are never echoed
// into logs or the response.

export type GuardVerdict = 'cross_site' | 'bad_origin' | 'not_json';

export function checkAuthPost(
  headers: Headers,
  ownHost: string,
  opts: { json: boolean },
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
      if (host === null || host.toLowerCase() !== ownHost.toLowerCase()) return 'bad_origin';
    }
  }

  if (opts.json) {
    const ct = (headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/json') return 'not_json';
  }
  return null;
}
