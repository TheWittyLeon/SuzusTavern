/**
 * Narration SSE proxy — forwards narration POSTs to the NekoNova backend.
 *
 * Permitted sub-paths:
 *   - 'stream'    → companion-pipeline narration (legacy/fallback)
 *   - 'dm/stream' → dedicated Suzu-DM pipeline (ST-062; core.dm_narrator).
 *                   POST = legacy generate-and-stream (flag-OFF path,
 *                   unchanged). GET = DDX-20 job-resume/subscribe tail
 *                   (`?job_id=`), flag-ON only.
 *   - 'dm/turn'   → DDX-20 durable generation job create/dedup (POST only).
 * All other sub-paths return 404. Only called when dm_mode === 'ai'; 'human'
 * and 'solo' modes never reach this route.
 *
 * Sibling of /api/dnd/[...path]/route.ts — intentionally kept separate so
 * the narrator (AI DM) can be swapped or disabled without touching the engine proxy.
 *
 * §2.8 / ST-062 / DDX-20
 */
import { NextRequest, NextResponse } from 'next/server';

const NEKANOVA_URL = process.env.NEXT_PUBLIC_NEKANOVA_URL ?? 'http://localhost:8080';

const ALLOWED_SUBPATHS = new Set(['stream', 'dm/stream', 'dm/turn']);

// DDX-20: only 'dm/stream' supports the GET resume/subscribe tail. 'stream'
// and 'dm/turn' have no GET semantics.
const GET_ALLOWED_SUBPATHS = new Set(['dm/stream']);

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

/**
 * Cookie→Bearer resolution shared by POST and GET. Prefers an explicit
 * Authorization header, then falls back to the `st_access` cookie. Returns
 * null when neither is present — callers must reject with 401 rather than
 * calling upstream anonymously.
 */
function resolveAuthHeader(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  if (auth) return auth;
  if (typeof req.cookies?.get === 'function') {
    const cookieAccess = req.cookies.get('st_access')?.value;
    if (cookieAccess) return `Bearer ${cookieAccess}`;
  }
  return null;
}

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  const subPath = path.join('/');

  if (!ALLOWED_SUBPATHS.has(subPath)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const upstreamUrl = `${NEKANOVA_URL}/api/narration/${subPath}`;

  // Build forward headers
  const forwardHeaders = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) forwardHeaders.set('content-type', contentType);

  // Inject Authorization: prefer explicit header, then st_access cookie.
  // If neither is present, reject immediately — never call upstream anonymously.
  const authHeader = resolveAuthHeader(req);
  if (authHeader) {
    forwardHeaders.set('authorization', authHeader);
  } else {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Forward the request body
  const body = await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: forwardHeaders,
      body: body.byteLength > 0 ? Buffer.from(body) : undefined,
      // @ts-expect-error — Node.js fetch requires duplex for streaming body
      duplex: 'half',
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Upstream unavailable' },
      { status: 502 },
    );
  }

  // DDX-20 §5.1 — branch on upstream content-type (mirrors the dnd proxy's
  // own SSE/JSON branch, [...path]/route.ts:249-263). 'stream'/'dm/stream'
  // POST responses are SSE; 'dm/turn' (and any error upstream returns before
  // it can open the SSE body, e.g. a 401/502) is JSON. Preserving
  // `upstream.status` on the JSON branch is what propagates the 409
  // generation_in_progress busy shape (P2 Design Delta §2.4) — and any other
  // non-2xx — intact to the client instead of silently becoming a 200.
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

  // F2 (1.7 audit): synthesize `reason: 'upstream_non_json'` so the
  // engineReasons.ts fallback chain renders readable copy instead of the
  // caller's generic fallback string. `upstream.status` was already being
  // forwarded here (never replaced with 500) — this only adds the reason.
  let responseData: unknown;
  try {
    responseData = await upstream.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Upstream returned a non-JSON, non-SSE response',
        data: { reason: 'upstream_non_json' },
      },
      { status: upstream.status || 502 },
    );
  }
  return NextResponse.json(responseData, { status: upstream.status });
}

/**
 * DDX-20 — GET /api/narration/dm/stream?job_id= (job-resume/subscribe tail).
 * Forwards the `job_id` query param (and any others present) to the
 * upstream — the narration route did not forward query params before this;
 * add it here, mirroring the dnd proxy's own query-forward at
 * [...path]/route.ts:142-144.
 *
 * Kage #6 (doc fix): NOT always SSE passthrough — same JSON-vs-SSE
 * content-type branch as POST above. The upstream tail either opens
 * (text/event-stream, passthrough below) or the request itself refuses
 * before any SSE body starts (e.g. an unknown job_id 404, an expired
 * cookie's 401) as a plain JSON error — that branch parses and
 * re-serializes it with `upstream.status` preserved, exactly like the POST
 * handler's own JSON branch, rather than forcing every response through the
 * SSE headers unconditionally.
 */
export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  const subPath = path.join('/');

  if (!GET_ALLOWED_SUBPATHS.has(subPath)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const upstreamUrl = new URL(`/api/narration/${subPath}`, NEKANOVA_URL);
  req.nextUrl.searchParams.forEach((value: string, key: string) => {
    upstreamUrl.searchParams.set(key, value);
  });

  const forwardHeaders = new Headers();
  const authHeader = resolveAuthHeader(req);
  if (authHeader) {
    forwardHeaders.set('authorization', authHeader);
  } else {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      headers: forwardHeaders,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Upstream unavailable' },
      { status: 502 },
    );
  }

  // JSON-vs-SSE branch, same rationale as POST above (e.g. an unknown
  // job_id/401 from upstream may come back as JSON, not an opened SSE body).
  const upstreamContentType = upstream.headers.get('content-type') ?? '';
  if (!upstreamContentType.includes('text/event-stream')) {
    // F2 (1.7 audit): same reason-synthesis as the POST branch above.
    let responseData: unknown;
    try {
      responseData = await upstream.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'Upstream returned a non-JSON, non-SSE response',
          data: { reason: 'upstream_non_json' },
        },
        { status: upstream.status || 502 },
      );
    }
    return NextResponse.json(responseData, { status: upstream.status });
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
