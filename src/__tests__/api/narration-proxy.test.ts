/**
 * @jest-environment node
 *
 * Tests for src/app/api/narration/[...path]/route.ts
 *
 * Covers:
 *   - only 'stream' sub-path accepted (others → 404)
 *   - Bearer injected from st_access cookie when no Authorization header
 *   - 401 when neither cookie nor Authorization header is present
 *   - SSE passthrough headers (Content-Type, Cache-Control, X-Accel-Buffering)
 *   - 502 on fetch throw
 */

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

// Import after mocks
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('../../app/api/narration/[...path]/route') as {
  POST: (
    req: NextRequest,
    ctx: { params: Promise<{ path: string[] }> },
  ) => Promise<import('next/server').NextResponse>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

function makeRequest(
  path: string[],
  options: {
    body?: string;
    headers?: Record<string, string>;
    cookie?: string;
  } = {},
): NextRequest {
  const url = `http://localhost:3000/api/narration/${path.join('/')}`;
  const headers = new Headers(options.headers ?? {});
  if (options.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (options.cookie) {
    headers.set('cookie', options.cookie);
  }
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: options.body,
  });
}

function sseUpstream(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(encoder.encode('data: {"success":true,"text":"hi"}\n\ndata: [DONE]\n\n'));
      ctrl.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

// ---------------------------------------------------------------------------
// Sub-path gating
// ---------------------------------------------------------------------------

describe('sub-path gating', () => {
  it('returns 404 for sub-path other than "stream"', async () => {
    // Provide a cookie so we don't hit the 401 path
    const req = makeRequest(['generate'], {
      body: '{}',
      cookie: 'st_access=valid-token',
    });
    const res = await POST(req, makeCtx(['generate']));
    expect(res.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 404 for empty path', async () => {
    const req = makeRequest([], { body: '{}', cookie: 'st_access=valid-token' });
    // An empty path joins to '' — not 'stream'
    const res = await POST(req, makeCtx([]));
    expect(res.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('accepts "stream" sub-path', async () => {
    mockFetch.mockResolvedValueOnce(sseUpstream());
    const req = makeRequest(['stream'], {
      body: '{"username":"p","message":"go","channel":"t"}',
      cookie: 'st_access=valid-token',
    });
    const res = await POST(req, makeCtx(['stream']));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Auth injection
// ---------------------------------------------------------------------------

describe('auth injection', () => {
  it('injects Bearer from st_access cookie when no Authorization header', async () => {
    mockFetch.mockResolvedValueOnce(sseUpstream());

    const req = makeRequest(['stream'], {
      body: '{"username":"p","message":"go","channel":"t"}',
      cookie: 'st_access=my-access-token',
    });
    await POST(req, makeCtx(['stream']));

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect((opts.headers as Headers).get('authorization')).toBe('Bearer my-access-token');
  });

  it('uses explicit Authorization header when provided (ignores cookie)', async () => {
    mockFetch.mockResolvedValueOnce(sseUpstream());

    const req = makeRequest(['stream'], {
      body: '{}',
      headers: { authorization: 'Bearer explicit-token' },
      cookie: 'st_access=cookie-token',
    });
    await POST(req, makeCtx(['stream']));

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect((opts.headers as Headers).get('authorization')).toBe('Bearer explicit-token');
  });

  it('returns 401 when neither cookie nor Authorization header is present', async () => {
    const req = makeRequest(['stream'], { body: '{}' });
    const res = await POST(req, makeCtx(['stream']));
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 401 when req.cookies.get is not a function (defensive guard)', async () => {
    // Simulate the feature-detect path where cookies API is absent
    const req = makeRequest(['stream'], { body: '{}' });
    // Override cookies to simulate an environment where .get is not a function
    Object.defineProperty(req, 'cookies', {
      get() { return { get: undefined }; },
      configurable: true,
    });

    const res = await POST(req, makeCtx(['stream']));
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SSE passthrough headers
// ---------------------------------------------------------------------------

describe('SSE passthrough headers', () => {
  it('sets text/event-stream, no-cache, and X-Accel-Buffering headers', async () => {
    mockFetch.mockResolvedValueOnce(sseUpstream());

    const req = makeRequest(['stream'], {
      body: '{}',
      cookie: 'st_access=tok',
    });
    const res = await POST(req, makeCtx(['stream']));

    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
  });
});

// ---------------------------------------------------------------------------
// Zero-byte body (branch: body.byteLength > 0 ? Buffer... : undefined)
// ---------------------------------------------------------------------------

describe('Zero-byte body handling', () => {
  it('forwards request with undefined body when request has no body', async () => {
    mockFetch.mockResolvedValueOnce(sseUpstream());

    // No body option — stream endpoint with missing payload
    const req = makeRequest(['stream'], {
      cookie: 'st_access=tok',
      // no body
    });
    const res = await POST(req, makeCtx(['stream']));
    // Should still succeed — zero-byte body is forwarded as undefined
    expect(res.status).toBe(200);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.body).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('returns 502 when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const req = makeRequest(['stream'], {
      body: '{}',
      cookie: 'st_access=tok',
    });
    const res = await POST(req, makeCtx(['stream']));

    expect(res.status).toBe(502);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Upstream unavailable');
  });
});
