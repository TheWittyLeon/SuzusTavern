// src/proxy.ts
//
// Edge proxy (formerly the "middleware" file convention) — route protection
// and auth-page redirect. Next.js 16 renamed this convention from
// `middleware.ts` to `proxy.ts`; the runtime reads the exported `proxy`
// function. Behaviour is identical to the classic middleware contract.
//
// Decision tree (design §2.10):
//   1. Protected paths (/dashboard, /lobby, /character, /play):
//      - No st_refresh cookie → 302 /login?next=<pathname+search>
//      - st_access expired/missing + st_refresh present → pass through
//        (the page's first apiFetch hits 401, client-side retry refreshes)
//      - st_access valid + st_refresh present → pass through
//   2. Auth pages (/login):
//      - st_access valid and not expired → 302 to ?next or /dashboard
//      - else → pass through
//   3. Everything else → pass through
//
// Never throws — catch-all wraps the logic; any failure falls through to
// NextResponse.next().
//
// ST-008
//
// NOTE: This file runs on the Edge runtime. It imports the JWT decode helpers
// from the Edge-safe `@/lib/auth/jwt` module — NOT from `session.ts`, which
// carries `import 'server-only'` and would break the Edge bundle.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { isExpired } from '@/lib/auth/jwt';
import { LOGIN_PATH, LOGIN_ROUTE_RE, REAUTH_PARAM } from '@/lib/auth/loginRoute';
import { sanitizeNextPath } from '@/lib/auth/redirect';

const ACCESS_COOKIE  = 'st_access';
const REFRESH_COOKIE = 'st_refresh';

const PROTECTED: RegExp[] = [
  /^\/dashboard(\/|$)/,
  /^\/lobby(\/|$)/,
  /^\/modules(\/|$)/,
  /^\/character(\/|$)/,
  /^\/play(\/|$)/,
  /^\/codex(\/|$)/,
];

const AUTH_PAGES: RegExp[] = [
  LOGIN_ROUTE_RE,
];

export const config = {
  // Exclude Next internals, static assets, /api/* (route handlers own their auth),
  // and favicon.
  matcher: ['/((?!_next/static|_next/image|_next/dev|favicon.ico|assets|api).*)'],
};

/**
 * TAV-NO-FRAMING-HEADERS: no page of the Tavern is meant to be framed, so every response this proxy
 * produces (redirects included) forbids it: CSP `frame-ancestors` for current browsers, and
 * `X-Frame-Options` for the ones that predate it. They live here, not in `next.config.ts`'s
 * `headers()`, because the dev box (.226) keeps its own copy of `next.config.ts` and a header there
 * would never reach it. The matcher above leaves `/api/*` and static assets out: those are not pages.
 */
const FRAME_ANCESTORS = "frame-ancestors 'none'";

export function proxy(req: NextRequest): NextResponse {
  const res = route(req);
  res.headers.set('Content-Security-Policy', FRAME_ANCESTORS);
  res.headers.set('X-Frame-Options', 'DENY');
  return res;
}

function route(req: NextRequest): NextResponse {
  try {
    const { pathname, search } = req.nextUrl;

    const accessToken  = req.cookies.get(ACCESS_COOKIE)?.value ?? null;
    const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value ?? null;

    // Decode exp without verifying signature — upstream verifies on authoritative use.
    // isExpired returns true for null/malformed tokens.
    const accessValid = accessToken !== null && !isExpired(accessToken);
    const refreshPresent = refreshToken !== null;

    // ── Protected paths ────────────────────────────────────────────────────
    if (PROTECTED.some((re) => re.test(pathname))) {
      if (!refreshPresent) {
        // No session at all — redirect to login with return path
        const loginUrl = req.nextUrl.clone();
        loginUrl.pathname = LOGIN_PATH;
        loginUrl.search = `next=${encodeURIComponent(pathname + search)}`;
        return NextResponse.redirect(loginUrl);
      }
      // refresh present (access may be expired) → pass through; client handles 401 retry
      return NextResponse.next();
    }

    // ── Auth pages (/login) ────────────────────────────────────────────────
    if (AUTH_PAGES.some((re) => re.test(pathname))) {
      // TAV-AUDIT-401-DEADEND — `accessValid` below is decoded from the token's
      // own `exp` claim WITHOUT verifying it against the auth server, so it
      // answers "has this token expired on paper", not "will the server accept
      // it". A revoked session, a server-side invalidation, or a signing-key
      // rotation all leave a token that is unexpired and universally rejected.
      //
      // That gap closed a LOOP, and it disabled the one control built for it:
      // SessionExpired's "sign in again" CTA links to /login?next=<path>, this
      // branch saw a paper-valid token and bounced it straight back to <path> —
      // the page that had just 401'd. The user could not reach the login form
      // by any in-app route.
      //
      // `?reauth=1` is the client saying "I have CONFIRMED this session is
      // dead" — knowledge the edge cannot have. Honouring it costs nothing:
      // this redirect is a convenience, never an authorization control (/login
      // is public, and every protected path is gated on the refresh cookie
      // above), so a hand-typed param can only ever forgo a shortcut.
      const reauth = req.nextUrl.searchParams.get(REAUTH_PARAM) === '1';
      if (accessValid && !reauth) {
        // Already authenticated — redirect to ?next or /dashboard.
        // Shared open-redirect guard with the login page (src/lib/auth/redirect.ts)
        // so the two can never drift on what counts as a safe same-origin target.
        const safe = sanitizeNextPath(
          req.nextUrl.searchParams.get('next'),
          req.nextUrl.origin,
        );
        return NextResponse.redirect(new URL(safe, req.nextUrl.origin));
      }
      return NextResponse.next();
    }

    // ── Everything else ────────────────────────────────────────────────────
    return NextResponse.next();
  } catch {
    // Never crash the edge — fall through
    return NextResponse.next();
  }
}
