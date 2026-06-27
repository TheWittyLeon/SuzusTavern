/**
 * DnD API proxy — forwards all /api/dnd/** requests to the NekoNova backend.
 * Handles SSE passthrough for /api/narration/stream sub-path.
 *
 * S8.3 extension: when the path starts with "admin/", the proxy:
 *   1. Reads the st_access cookie and fetches /auth/me server-side.
 *   2. If the session does NOT have the 'admin' role → returns 403 immediately,
 *      does NOT forward the request, does NOT attach the admin token.
 *   3. Only when roles includes 'admin': attaches
 *      X-DND-Admin-Token from SUZU_DND_ADMIN_TOKEN_TAVERN (server-only env,
 *      NEVER a NEXT_PUBLIC_* var) and forwards as normal.
 *
 * The admin token is never returned in any response and never logged.
 *
 * Environment:
 *   NEXT_PUBLIC_NEKANOVA_URL — base URL of the NekoNova backend (default: http://localhost:8080)
 *   AUTH_API_URL             — Authentication-Python base URL (server-only)
 *   SUZU_DND_ADMIN_TOKEN_TAVERN — admin token forwarded to engine (server-only, never NEXT_PUBLIC_)
 *
 * ST-070 / S8.3
 */
import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';

const NEKANOVA_URL = process.env.NEXT_PUBLIC_NEKANOVA_URL ?? 'http://localhost:8080';

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

/**
 * Server-side admin role check.
 *
 * Reads the st_access cookie from the incoming request, calls AUTH_API_URL/auth/me
 * directly (server-to-server, same as getServerSession), and returns whether the
 * session has the 'admin' role.
 *
 * Returns false on any failure (missing token, network error, bad response) —
 * fails CLOSED so a misconfigured deploy cannot accidentally grant access.
 *
 * COOKIE_SECURE=false homelab note: the st_access cookie has Secure=false on
 * the nekonova-aux HTTP deployment. We read it as a plain cookie value here —
 * no HTTPS assumption needed.
 */
async function isAdminSession(req: NextRequest): Promise<boolean> {
  let token: string | undefined;

  if (typeof req.cookies?.get === 'function') {
    token = req.cookies.get('st_access')?.value;
  }
  if (!token) {
    // Also check Authorization header (forwarded sessions in tests)
    const auth = req.headers.get('authorization');
    if (auth?.startsWith('Bearer ')) {
      token = auth.slice(7);
    }
  }
  if (!token) return false;

  try {
    const res = await fetch(`${env.AUTH_API_URL}/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const data = await res.json() as { user?: { roles?: string[] } };
    return Array.isArray(data.user?.roles) && data.user.roles.includes('admin');
  } catch {
    return false;
  }
}

async function proxyRequest(
  req: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { path } = await context.params;
  const pathStr = path.join('/');

  // ── S8.3 admin gate ──────────────────────────────────────────────────────
  // Admin paths: anything starting with "admin/" requires role=admin.
  // Gate runs before any upstream request is made; the admin token is only
  // attached after the role check passes.
  const isAdminPath = pathStr.startsWith('admin/') || pathStr === 'admin';
  if (isAdminPath) {
    const adminOk = await isAdminSession(req);
    if (!adminOk) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', data: { reason: 'not_admin' } },
        { status: 403 },
      );
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const upstreamPath = `/api/dnd/${pathStr}`;
  const upstreamUrl = new URL(upstreamPath, NEKANOVA_URL);

  // Forward query parameters
  req.nextUrl.searchParams.forEach((value: string, key: string) => {
    upstreamUrl.searchParams.set(key, value);
  });

  // Forward relevant headers
  const forwardHeaders = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) forwardHeaders.set('content-type', contentType);
  // §3.1 additive: inject Bearer from st_access cookie when no Authorization header present.
  // Feature-detect req.cookies?.get per §8 risk mitigation — test-constructed requests
  // may not have cookie support; if absent, no auth header is forwarded (existing behaviour).
  const auth = req.headers.get('authorization');
  if (auth) {
    forwardHeaders.set('authorization', auth);
  } else if (typeof req.cookies?.get === 'function') {
    const cookieAccess = req.cookies.get('st_access')?.value;
    if (cookieAccess) forwardHeaders.set('authorization', `Bearer ${cookieAccess}`);
  }

  // S8.3: attach the admin token on admin paths (role check already passed above).
  // Read from server-only env — NEVER a NEXT_PUBLIC_* var.
  if (isAdminPath) {
    const adminToken = process.env.SUZU_DND_ADMIN_TOKEN_TAVERN;
    if (adminToken) {
      forwardHeaders.set('x-dnd-admin-token', adminToken);
    }
    // If the token is unset in this env the header is omitted; the engine will
    // return 503 (fails-closed on its end). The proxy does not need to pre-check.
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await req.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      method: req.method,
      headers: forwardHeaders,
      body: body ? Buffer.from(body) : undefined,
      // @ts-expect-error — Node.js fetch requires duplex for streaming body
      duplex: 'half',
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Upstream unavailable' },
      { status: 502 },
    );
  }

  // SSE passthrough — pipe body directly to client without buffering
  const upstreamContentType = upstream.headers.get('content-type') ?? '';
  if (upstreamContentType.includes('text/event-stream')) {
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // Regular JSON response — parse and re-serialize to normalise content-type
  const responseData: unknown = await upstream.json();
  return NextResponse.json(responseData, { status: upstream.status });
}

export const GET = (req: NextRequest, ctx: RouteContext): Promise<NextResponse> =>
  proxyRequest(req, ctx);
export const POST = (req: NextRequest, ctx: RouteContext): Promise<NextResponse> =>
  proxyRequest(req, ctx);
export const PUT = (req: NextRequest, ctx: RouteContext): Promise<NextResponse> =>
  proxyRequest(req, ctx);
export const DELETE = (req: NextRequest, ctx: RouteContext): Promise<NextResponse> =>
  proxyRequest(req, ctx);
export const PATCH = (req: NextRequest, ctx: RouteContext): Promise<NextResponse> =>
  proxyRequest(req, ctx);
