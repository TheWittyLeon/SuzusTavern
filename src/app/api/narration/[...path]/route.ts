/**
 * Narration SSE proxy — forwards narration POSTs to the NekoNova backend.
 *
 * Permitted sub-paths:
 *   - 'stream'    → companion-pipeline narration (legacy/fallback)
 *   - 'dm/stream' → dedicated Suzu-DM pipeline (ST-062; core.dm_narrator)
 * All other sub-paths return 404. Only called when dm_mode === 'ai'; 'human'
 * and 'solo' modes never reach this route.
 *
 * Sibling of /api/dnd/[...path]/route.ts — intentionally kept separate so
 * the narrator (AI DM) can be swapped or disabled without touching the engine proxy.
 *
 * §2.8 / ST-062
 */
import { NextRequest, NextResponse } from 'next/server';

const NEKANOVA_URL = process.env.NEXT_PUBLIC_NEKANOVA_URL ?? 'http://localhost:8080';

const ALLOWED_SUBPATHS = new Set(['stream', 'dm/stream']);

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

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
  const auth = req.headers.get('authorization');
  if (auth) {
    forwardHeaders.set('authorization', auth);
  } else if (typeof req.cookies?.get === 'function') {
    const cookieAccess = req.cookies.get('st_access')?.value;
    if (cookieAccess) {
      forwardHeaders.set('authorization', `Bearer ${cookieAccess}`);
    } else {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
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

  // SSE passthrough — identical to dnd proxy SSE branch
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
