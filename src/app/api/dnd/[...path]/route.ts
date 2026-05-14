/**
 * DnD API proxy — forwards all /api/dnd/** requests to the NekoNova backend.
 * Handles SSE passthrough for /api/narration/stream sub-path.
 *
 * Environment:
 *   NEXT_PUBLIC_NEKANOVA_URL — base URL of the NekoNova backend (default: http://localhost:8080)
 *
 * ST-070
 */
import { NextRequest, NextResponse } from 'next/server';

const NEKANOVA_URL = process.env.NEXT_PUBLIC_NEKANOVA_URL ?? 'http://localhost:8080';

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

async function proxyRequest(
  req: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { path } = await context.params;
  const upstreamPath = `/api/dnd/${path.join('/')}`;
  const upstreamUrl = new URL(upstreamPath, NEKANOVA_URL);

  // Forward query parameters
  req.nextUrl.searchParams.forEach((value: string, key: string) => {
    upstreamUrl.searchParams.set(key, value);
  });

  // Forward relevant headers
  const forwardHeaders = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) forwardHeaders.set('content-type', contentType);
  const auth = req.headers.get('authorization');
  if (auth) forwardHeaders.set('authorization', auth);

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
