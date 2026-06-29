/**
 * Admin flags BFF — /api/admin/flags/[...path]
 *
 * Proxies feature-flag read operations to Authentication-Python.
 * Phase 1: GET /api/admin/flags → GET /admin/flags  (read-only panel)
 *
 * Allowed paths:
 *   GET  (no path segments)   → GET  /admin/flags
 *
 * Security:
 *   - Admin gate runs BEFORE any upstream call (fail-closed).
 *   - The real enforcement lives in Auth-Python @admin_required; the BFF gate is
 *     defence-in-depth, matching the pattern in /api/admin/auth/[...path]/route.ts.
 *   - Tokens stay server-side via the st_access cookie; NEVER a NEXT_PUBLIC_* var.
 *   - COOKIE_SECURE=false is respected (homelab plain-HTTP deploy).
 *
 * Phase 2 will extend this with PUT/DELETE per-user overrides once that endpoint
 * exists in Auth-Python. The [...path] catch-all is already in place for that.
 */
import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { readAccess } from '@/lib/auth/cookies';

type Ctx = { params: Promise<{ path: string[] }> };

// ---------------------------------------------------------------------------
// Admin session gate — same implementation as /api/admin/auth/[...path]
// ---------------------------------------------------------------------------

/**
 * Reads the st_access cookie, calls /auth/me, returns { token } when the
 * session has the 'admin' role. Returns null on any failure — fails CLOSED.
 *
 * In non-production we also accept an Authorization: Bearer header so
 * test tooling can authenticate without a cookie jar.
 */
async function getAdminToken(req: NextRequest): Promise<{ token: string } | null> {
  let token: string | null = null;

  if (typeof req.cookies?.get === 'function') {
    token = readAccess(req.cookies);
  }

  if (!token && !env.IS_PROD) {
    const auth = req.headers.get('authorization');
    if (auth?.startsWith('Bearer ')) token = auth.slice(7);
  }

  if (!token) return null;

  try {
    const res = await fetch(`${env.AUTH_API_URL}/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json() as { user?: { username?: string; roles?: string[] } };
    if (!Array.isArray(data.user?.roles) || !data.user.roles.includes('admin')) return null;
    return { token };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Upstream proxy helper
// ---------------------------------------------------------------------------

async function proxyToAuth(
  upstreamPath: string,
  method: string,
  token: string,
): Promise<NextResponse> {
  const url = new URL(`${env.AUTH_API_URL}/${upstreamPath}`);

  let res: Response | null = null;
  try {
    res = await fetch(url.toString(), {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
  }

  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch {
    raw = null;
  }

  return NextResponse.json(raw ?? {}, { status: res.status });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function dispatch(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params;
  const joined = path.join('/');

  // Admin gate — runs before any upstream call
  const session = await getAdminToken(req);
  if (!session) {
    return NextResponse.json({ error: 'forbidden', reason: 'not_admin' }, { status: 403 });
  }

  const { token } = session;

  // ── Phase 1: read-only flag list ──────────────────────────────────────────

  // GET /api/admin/flags (no sub-path) → GET /admin/flags
  if (req.method === 'GET' && (joined === '' || joined === undefined)) {
    return proxyToAuth('admin/flags', 'GET', token);
  }

  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return dispatch(req, ctx);
}
