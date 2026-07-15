/**
 * @jest-environment node
 *
 * DDX-20 — postDmTurn / subscribeDmJob (src/lib/stream.ts).
 *
 * Covers the load-bearing "apiCall-throws gotcha" fix: postDmTurn is a
 * bespoke fetch, NOT apiCall, so a 409 generation_in_progress response
 * RETURNS a typed BusyResult instead of throwing (Client Integration Design
 * §5/§6, P2 Design Delta §2.4).
 */
import { postDmTurn, subscribeDmJob, readSSE } from '../../lib/stream';
import type { DmTurnRequest, NarrationEvent } from '../../lib/api/types';

async function collect(iter: AsyncIterableIterator<NarrationEvent>): Promise<NarrationEvent[]> {
  const events: NarrationEvent[] = [];
  for await (const ev of iter) events.push(ev);
  return events;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(body: string, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

const PAYLOAD: DmTurnRequest = {
  username: 'leon',
  channel: 'test_table',
  session_id: 'sess-1',
  message: 'I open the door.',
  mode: 'say',
  turn_key: 'tk-abc-123',
};

describe('postDmTurn', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    (global as Record<string, unknown>).fetch = mockFetch;
  });

  it('200: returns a GenerationJobHandle unwrapped from the {success,data} envelope', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { job_id: 'job-1', turn_key: 'tk-abc-123', status: 'pending', deduped: false },
      }),
    );

    const result = await postDmTurn(PAYLOAD);

    expect(result).toEqual({
      job_id: 'job-1',
      turn_key: 'tk-abc-123',
      status: 'pending',
      deduped: false,
    });
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/narration/dm/turn');
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('same-origin');
    expect(JSON.parse(opts.body as string)).toEqual(PAYLOAD);
  });

  it('409: RETURNS a BusyResult — does NOT throw (the apiCall-throws gotcha fix)', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        {
          success: false,
          reason: 'generation_in_progress',
          data: { job_id: 'job-inflight', status: 'streaming', trigger_seq: 1237 },
        },
        409,
      ),
    );

    const result = await postDmTurn(PAYLOAD);

    expect(result).toEqual({
      busy: true,
      job_id: 'job-inflight',
      status: 'streaming',
      trigger_seq: 1237,
    });
  });

  it('409 with a pending (not streaming) in-flight job carries status through', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        {
          success: false,
          reason: 'generation_in_progress',
          data: { job_id: 'job-2', status: 'pending', trigger_seq: 10 },
        },
        409,
      ),
    );

    const result = await postDmTurn(PAYLOAD);
    expect(result).toMatchObject({ busy: true, status: 'pending' });
  });

  it('deduped re-POST (same turn_key while in flight): 200 with deduped:true, live status — not busy', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { job_id: 'job-1', turn_key: 'tk-abc-123', status: 'streaming', deduped: true },
      }),
    );

    const result = await postDmTurn(PAYLOAD);
    expect(result).toEqual({
      job_id: 'job-1',
      turn_key: 'tk-abc-123',
      status: 'streaming',
      deduped: true,
    });
  });

  it('401: throws ApiError (not a BusyResult — only 409 is a non-throwing outcome)', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401));

    await expect(postDmTurn(PAYLOAD)).rejects.toMatchObject({ status: 401 });
  });

  it('502 upstream-unavailable JSON: throws ApiError with the upstream status', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'Upstream unavailable' }, 502),
    );

    await expect(postDmTurn(PAYLOAD)).rejects.toMatchObject({ status: 502 });
  });

  it('network error: throws ApiError {status:0, code:"network"}', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(postDmTurn(PAYLOAD)).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('abort: throws ApiError {status:0, code:"abort"}', async () => {
    const abortErr = new DOMException('Aborted', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortErr);

    await expect(postDmTurn(PAYLOAD)).rejects.toMatchObject({ status: 0, code: 'abort' });
  });
});

describe('subscribeDmJob', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    (global as Record<string, unknown>).fetch = mockFetch;
  });

  it('opens GET /api/narration/dm/stream?job_id= and yields the SSE tail', async () => {
    mockFetch.mockResolvedValueOnce(
      sseResponse('data: {"success":true,"text":"The door creaks."}\n\ndata: [DONE]\n\n'),
    );

    const events = await collect(subscribeDmJob('job-1'));

    expect(events).toEqual([{ kind: 'chunk', text: 'The door creaks.' }, { kind: 'done' }]);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/narration/dm/stream?job_id=job-1');
    expect(opts.method).toBe('GET');
    expect(opts.credentials).toBe('same-origin');
  });

  it('encodes the job_id in the query string', async () => {
    mockFetch.mockResolvedValueOnce(sseResponse('data: [DONE]\n\n'));
    await collect(subscribeDmJob('job/with spaces'));
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe('/api/narration/dm/stream?job_id=job%2Fwith%20spaces');
  });

  it('yields {kind:"error"} on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'not_found' }, 404));
    const events = await collect(subscribeDmJob('unknown-job'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'error' });
  });

  it('returns silently on pre-flight abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await collect(subscribeDmJob('job-1', { signal: controller.signal }));
    expect(events).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('yields {kind:"error", error:"network"} on fetch throw', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const events = await collect(subscribeDmJob('job-1'));
    expect(events).toEqual([{ kind: 'error', error: 'network' }]);
  });
});

// Sanity: subscribeDmJob really does reuse readSSE (same module, no re-import drift).
it('readSSE is exported and importable (subscribeDmJob depends on it)', () => {
  expect(typeof readSSE).toBe('function');
});
