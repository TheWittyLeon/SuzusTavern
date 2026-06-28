/**
 * Admin auth BFF — /api/admin/auth/[...path]
 *
 * Proxies admin signup-management operations to Authentication-Python.
 * All routes require the session to carry the 'admin' role (same gate as
 * /api/dnd/admin/*). The user's Bearer token is forwarded server-side —
 * it never touches the browser.
 *
 * Allowed paths:
 *   GET    invitations                    → GET  /admin/invitations
 *   POST   invitations                    → POST /admin/invitations
 *   DELETE invitations/<id>               → DELETE /admin/invitations/<id>
 *   GET    pending                        → GET  /admin/pending-registrations
 *   POST   pending/<id>/approve           → POST /admin/pending-registrations/<id>/approve
 *   POST   pending/<id>/deny              → POST /admin/pending-registrations/<id>/deny
 *
 * Security:
 *   - Admin gate runs BEFORE any upstream call (fail-closed).
 *   - The real enforcement lives in Auth-Python @admin_required; the BFF gate is
 *     defence-in-depth, matching the pattern in /api/dnd/admin/* (getAdminSession).
 *   - Tokens stay server-side via the st_access cookie; NEVER a NEXT_PUBLIC_* var.
 *   - COOKIE_SECURE=false is respected (homelab plain-HTTP deploy).
 *
 * B3 — signup UI + admin screens.
 */
import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { readAccess } from '@/lib/auth/cookies';

type Ctx = { params: Promise<{ path: string[] }> };

// ---------------------------------------------------------------------------
// Admin session gate (mirrors getAdminSession in /api/dnd/[...path]/route.ts)
// ---------------------------------------------------------------------------

/**
 * Reads the st_access cookie, calls /auth/me, returns the username when the
 * session has the 'admin' role. Returns null on any failure — fails CLOSED.
 *
 * In non-production we also accept an Authorization: Bearer header so
 * test tooling can authenticate without a cookie jar.
 */
async function getAdminToken(req: NextRequest): Promise<{ token: string; username: string } | null> {
  let token: string | null = null;

  // Primary: cookie-BFF path (production and homelab)
  if (typeof req.cookies?.get === 'function') {
    token = readAccess(req.cookies);
  }

  // Secondary: Bearer header (non-prod only — test tooling)
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
    if (!data.user.username) return null;
    return { token, username: data.user.username };
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
  body?: string | null,
  queryParams?: URLSearchParams,
): Promise<NextResponse> {
  const url = new URL(`${env.AUTH_API_URL}/${upstreamPath}`);
  if (queryParams) {
    queryParams.forEach((v, k) => url.searchParams.set(k, v));
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  let res: Response | null = null;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body ?? undefined,
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
  const rawBody = req.method !== 'GET' && req.method !== 'HEAD'
    ? await req.text()
    : null;

  // Forward query params (page, per_page, status, search, created_by)
  const upstream = req.nextUrl.searchParams;

  // ── Invitations ──────────────────────────────────────────────────────────

  // GET /api/admin/auth/invitations → GET /admin/invitations
  if (req.method === 'GET' && joined === 'invitations') {
    return proxyToAuth('admin/invitations', 'GET', token, null, upstream);
  }

  // POST /api/admin/auth/invitations → POST /admin/invitations
  if (req.method === 'POST' && joined === 'invitations') {
    return proxyToAuth('admin/invitations', 'POST', token, rawBody);
  }

  // DELETE /api/admin/auth/invitations/<id> → DELETE /admin/invitations/<id>
  const inviteDeleteMatch = joined.match(/^invitations\/(\d+)$/);
  if (req.method === 'DELETE' && inviteDeleteMatch) {
    return proxyToAuth(`admin/invitations/${inviteDeleteMatch[1]}`, 'DELETE', token);
  }

  // ── Pending registrations ────────────────────────────────────────────────

  // GET /api/admin/auth/pending → GET /admin/pending-registrations
  if (req.method === 'GET' && joined === 'pending') {
    return proxyToAuth('admin/pending-registrations', 'GET', token, null, upstream);
  }

  // POST /api/admin/auth/pending/<id>/approve → POST /admin/pending-registrations/<id>/approve
  const approveMatch = joined.match(/^pending\/(\d+)\/approve$/);
  if (req.method === 'POST' && approveMatch) {
    return proxyToAuth(
      `admin/pending-registrations/${approveMatch[1]}/approve`,
      'POST',
      token,
      rawBody,
    );
  }

  // POST /api/admin/auth/pending/<id>/deny → POST /admin/pending-registrations/<id>/deny
  const denyMatch = joined.match(/^pending\/(\d+)\/deny$/);
  if (req.method === 'POST' && denyMatch) {
    return proxyToAuth(
      `admin/pending-registrations/${denyMatch[1]}/deny`,
      'POST',
      token,
      rawBody,
    );
  }

  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return dispatch(req, ctx);
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return dispatch(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  return dispatch(req, ctx);
}
