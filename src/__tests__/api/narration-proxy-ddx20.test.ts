/**
 * @jest-environment node
 *
 * DDX-20 additions to src/app/api/narration/[...path]/route.ts:
 *   - 'dm/turn' POST — JSON-vs-SSE content-type branch, upstream.status
 *     preserved (this is what propagates the 409 generation_in_progress
 *     busy shape — P2 Design Delta §2.4 — intact to the client).
 *   - GET /api/narration/dm/stream?job_id= — job-resume/subscribe tail,
 *     query forwarding, cookie->Bearer.
 *   - Legacy POST 'stream'/'dm/stream' SSE passthrough — unaffected
 *     (regression-covered here too, on top of narration-proxy.test.ts).
 */

import { NextRequest } from 'next/server';

const mockFetch = jest.fn();

beforeAll(() => {
  (global as Record<string, unknown>).fetch = mockFetch;
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_NEKANOVA_URL = 'http://localhost:8080';
  mockFetch.mockReset();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_NEKANOVA_URL;
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST, GET } = require('../../app/api/narration/[...path]/route') as {
  POST: (
    req: NextRequest,
    ctx: { params: Promise<{ path: string[] }> },
  ) => Promise<import('next/server').NextResponse>;
  GET: (
    req: NextRequest,
    ctx: { params: Promise<{ path: string[] }> },
  ) => Promise<import('next/server').NextResponse>;
};

function makeCtx(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

function makePostRequest(
  path: string[],
  options: { body?: string; headers?: Record<string, string>; cookie?: string } = {},
): NextRequest {
  const url = `http://localhost:3000/api/narration/${path.join('/')}`;
  const headers = new Headers(options.headers ?? {});
  if (options.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (options.cookie) headers.set('cookie', options.cookie);
  return new NextRequest(url, { method: 'POST', headers, body: options.body });
}

function makeGetRequest(
  path: string[],
  query: Record<string, string> = {},
  options: { headers?: Record<string, string>; cookie?: string } = {},
): NextRequest {
  const qs = new URLSearchParams(query).toString();
  const url = `http://localhost:3000/api/narration/${path.join('/')}${qs ? `?${qs}` : ''}`;
  const headers = new Headers(options.headers ?? {});
  if (options.cookie) headers.set('cookie', options.cookie);
  return new NextRequest(url, { method: 'GET', headers });
}

function jsonUpstream(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseUpstream(status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(encoder.encode('data: {"success":true,"text":"hi"}\n\ndata: [DONE]\n\n'));
      ctrl.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

// ---------------------------------------------------------------------------
// POST /dm/turn — sub-path gating
// ---------------------------------------------------------------------------

describe('POST dm/turn — sub-path gating', () => {
  it('accepts "dm/turn" (no longer 404)', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonUpstream({ success: true, data: { job_id: 'j1', turn_key: 'tk1', status: 'pending', deduped: false } }),
    );
    const req = makePostRequest(['dm', 'turn'], { body: '{}', cookie: 'st_access=tok' });
    const res = await POST(req, makeCtx(['dm', 'turn']));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /dm/turn — JSON branch + status preservation (the 409 propagation fix)
// ---------------------------------------------------------------------------

describe('POST dm/turn — JSON response branch preserves upstream.status', () => {
  it('200 success: JSON body forwarded verbatim, status 200', async () => {
    const upstreamBody = {
      success: true,
      data: { job_id: 'job-1', turn_key: 'tk-1', status: 'pending', deduped: false },
    };
    mockFetch.mockResolvedValueOnce(jsonUpstream(upstreamBody));

    const req = makePostRequest(['dm', 'turn'], {
      body: JSON.stringify({ turn_key: 'tk-1' }),
      cookie: 'st_access=tok',
    });
    const res = await POST(req, makeCtx(['dm', 'turn']));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual(upstreamBody);
  });

  it('409 generation_in_progress: status 409 is PRESERVED (not forced to 200)', async () => {
    const busyBody = {
      success: false,
      message: 'A DM turn is already in progress.',
      reason: 'generation_in_progress',
      data: { job_id: 'job-inflight', turn_key: 'tk-other', status: 'streaming', trigger_seq: 1237 },
    };
    mockFetch.mockResolvedValueOnce(jsonUpstream(busyBody, 409));

    const req = makePostRequest(['dm', 'turn'], {
      body: JSON.stringify({ turn_key: 'tk-fresh' }),
      cookie: 'st_access=tok',
    });
    const res = await POST(req, makeCtx(['dm', 'turn']));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual(busyBody);
  });

  it('401 from upstream (e.g. token expired mid-flight) is preserved, not swallowed to 200', async () => {
    mockFetch.mockResolvedValueOnce(jsonUpstream({ error: 'unauthorized' }, 401));
    const req = makePostRequest(['dm', 'turn'], { body: '{}', cookie: 'st_access=tok' });
    const res = await POST(req, makeCtx(['dm', 'turn']));
    expect(res.status).toBe(401);
  });

  it('502 from a non-JSON upstream body falls back cleanly (still non-2xx, not thrown)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('<html>gateway error</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const req = makePostRequest(['dm', 'turn'], { body: '{}', cookie: 'st_access=tok' });
    const res = await POST(req, makeCtx(['dm', 'turn']));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { success: boolean; data: { reason: string } };
    expect(body.success).toBe(false);
    // F2 (1.7 audit): synthesized reason so engineReasons.ts can render
    // readable copy instead of a blank/generic failure.
    expect(body.data.reason).toBe('upstream_non_json');
  });

  // F2: the upstream status is what's forwarded here, not always 502 — this
  // route already caught the parse failure pre-F2, but did not carry a
  // machine-readable reason. Confirm a non-502 status also survives intact.
  it('a non-JSON upstream body with a 400 status forwards 400, not 502', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('not json', { status: 400, headers: { 'content-type': 'application/json' } }),
    );
    const req = makePostRequest(['dm', 'turn'], { body: '{}', cookie: 'st_access=tok' });
    const res = await POST(req, makeCtx(['dm', 'turn']));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { data: { reason: string } };
    expect(body.data.reason).toBe('upstream_non_json');
  });

  it('fetch throw -> 502 Upstream unavailable (unchanged convention)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const req = makePostRequest(['dm', 'turn'], { body: '{}', cookie: 'st_access=tok' });
    const res = await POST(req, makeCtx(['dm', 'turn']));
    expect(res.status).toBe(502);
  });

  it('401 when no cookie/auth header present (unauthenticated) — never calls upstream', async () => {
    const req = makePostRequest(['dm', 'turn'], { body: '{}' });
    const res = await POST(req, makeCtx(['dm', 'turn']));
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Legacy POST 'stream'/'dm/stream' SSE passthrough — regression, unaffected
// ---------------------------------------------------------------------------

describe('legacy POST stream/dm-stream — SSE branch unaffected by the DDX-20 JSON branch', () => {
  it('dm/stream POST still returns SSE passthrough with status 200', async () => {
    mockFetch.mockResolvedValueOnce(sseUpstream());
    const req = makePostRequest(['dm', 'stream'], { body: '{}', cookie: 'st_access=tok' });
    const res = await POST(req, makeCtx(['dm', 'stream']));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
  });

  it('dm/stream POST SSE branch also preserves a non-200 upstream status', async () => {
    mockFetch.mockResolvedValueOnce(sseUpstream(500));
    const req = makePostRequest(['dm', 'stream'], { body: '{}', cookie: 'st_access=tok' });
    const res = await POST(req, makeCtx(['dm', 'stream']));
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /dm/stream?job_id= — resume/subscribe tail
// ---------------------------------------------------------------------------

describe('GET dm/stream — job-resume/subscribe tail', () => {
  it('404s for any sub-path other than dm/stream', async () => {
    const req = makeGetRequest(['stream'], {}, { cookie: 'st_access=tok' });
    const res = await GET(req, makeCtx(['stream']));
    expect(res.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('404s for GET dm/turn (POST-only route)', async () => {
    const req = makeGetRequest(['dm', 'turn'], {}, { cookie: 'st_access=tok' });
    const res = await GET(req, makeCtx(['dm', 'turn']));
    expect(res.status).toBe(404);
  });

  it('forwards the job_id query param to the upstream URL', async () => {
    mockFetch.mockResolvedValueOnce(sseUpstream());
    const req = makeGetRequest(['dm', 'stream'], { job_id: 'job-42' }, { cookie: 'st_access=tok' });
    await GET(req, makeCtx(['dm', 'stream']));

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:8080/api/narration/dm/stream?job_id=job-42');
  });

  it('forwards multiple query params verbatim', async () => {
    mockFetch.mockResolvedValueOnce(sseUpstream());
    const req = makeGetRequest(
      ['dm', 'stream'],
      { job_id: 'job-42', debug: '1' },
      { cookie: 'st_access=tok' },
    );
    await GET(req, makeCtx(['dm', 'stream']));
    const [url] = mockFetch.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('job_id')).toBe('job-42');
    expect(parsed.searchParams.get('debug')).toBe('1');
  });

  it('injects Bearer from st_access cookie', async () => {
    mockFetch.mockResolvedValueOnce(sseUpstream());
    const req = makeGetRequest(['dm', 'stream'], { job_id: 'job-1' }, { cookie: 'st_access=my-tok' });
    await GET(req, makeCtx(['dm', 'stream']));
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect((opts.headers as Headers).get('authorization')).toBe('Bearer my-tok');
  });

  it('uses explicit Authorization header over the cookie when both present', async () => {
    mockFetch.mockResolvedValueOnce(sseUpstream());
    const req = makeGetRequest(
      ['dm', 'stream'],
      { job_id: 'job-1' },
      { headers: { authorization: 'Bearer explicit' }, cookie: 'st_access=cookie-tok' },
    );
    await GET(req, makeCtx(['dm', 'stream']));
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect((opts.headers as Headers).get('authorization')).toBe('Bearer explicit');
  });

  it('401 when neither cookie nor Authorization header present — never calls upstream', async () => {
    const req = makeGetRequest(['dm', 'stream'], { job_id: 'job-1' });
    const res = await GET(req, makeCtx(['dm', 'stream']));
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('SSE passthrough headers set correctly on a successful resume', async () => {
    mockFetch.mockResolvedValueOnce(sseUpstream());
    const req = makeGetRequest(['dm', 'stream'], { job_id: 'job-1' }, { cookie: 'st_access=tok' });
    const res = await GET(req, makeCtx(['dm', 'stream']));
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
  });

  it('a JSON error from upstream (e.g. unknown job_id) preserves its status, not forced to SSE 200', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonUpstream({ success: false, error: 'job_not_found' }, 404),
    );
    const req = makeGetRequest(['dm', 'stream'], { job_id: 'unknown' }, { cookie: 'st_access=tok' });
    const res = await GET(req, makeCtx(['dm', 'stream']));
    expect(res.status).toBe(404);
  });

  it('502 when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const req = makeGetRequest(['dm', 'stream'], { job_id: 'job-1' }, { cookie: 'st_access=tok' });
    const res = await GET(req, makeCtx(['dm', 'stream']));
    expect(res.status).toBe(502);
  });

  // F2 (1.7 audit): GET's own JSON branch has the same upstream.json() parse
  // guard as POST's — confirm it also carries the upstream_non_json reason.
  it('non-JSON upstream body on the JSON branch: status forwarded, reason upstream_non_json', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('<html>gateway error</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const req = makeGetRequest(['dm', 'stream'], { job_id: 'job-1' }, { cookie: 'st_access=tok' });
    const res = await GET(req, makeCtx(['dm', 'stream']));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { success: boolean; data: { reason: string } };
    expect(body.success).toBe(false);
    expect(body.data.reason).toBe('upstream_non_json');
  });
});
