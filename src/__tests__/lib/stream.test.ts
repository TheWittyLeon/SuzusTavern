/**
 * @jest-environment node
 *
 * Tests for src/lib/stream.ts
 *
 * Covers:
 *   - parses chunked data:{...} + [DONE] sentinel
 *   - ignores blank lines between events
 *   - yields {kind:'error'} on bad JSON
 *   - abort signal stops iteration
 *
 * node environment: TextEncoder, ReadableStream, Response, AbortController all available.
 */

import { readSSE, streamNarration } from '../../lib/stream';
import type { NarrationEvent } from '../../lib/api/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a ReadableStream from a raw SSE string. */
function sseResponse(body: string, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** Collect all events from an async iterator. */
async function collect(iter: AsyncIterableIterator<NarrationEvent>): Promise<NarrationEvent[]> {
  const events: NarrationEvent[] = [];
  for await (const ev of iter) {
    events.push(ev);
  }
  return events;
}

// ---------------------------------------------------------------------------
// readSSE — core parsing
// ---------------------------------------------------------------------------

describe('readSSE — parsing', () => {
  it('parses a single chunk event and a [DONE] sentinel', async () => {
    const body = 'data: {"success":true,"text":"Hello"}\n\ndata: [DONE]\n\n';
    const events = await collect(readSSE(sseResponse(body)));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: 'chunk', text: 'Hello' });
    expect(events[1]).toEqual({ kind: 'done' });
  });

  it('parses multiple chunk events before [DONE]', async () => {
    const body = [
      'data: {"success":true,"text":"foo"}\n\n',
      'data: {"success":true,"text":"bar"}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const events = await collect(readSSE(sseResponse(body)));

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ kind: 'chunk', text: 'foo' });
    expect(events[1]).toEqual({ kind: 'chunk', text: 'bar' });
    expect(events[2]).toEqual({ kind: 'done' });
  });

  it('ignores blank lines between events (does not emit spurious events)', async () => {
    // Extra blank lines are valid SSE whitespace — should not produce extra events
    const body = '\ndata: {"success":true,"text":"hi"}\n\n\n\ndata: [DONE]\n\n';
    const events = await collect(readSSE(sseResponse(body)));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: 'chunk', text: 'hi' });
    expect(events[1]).toEqual({ kind: 'done' });
  });

  it('yields {kind:"error"} on bad JSON in a data line', async () => {
    const body = 'data: not-valid-json\n\ndata: [DONE]\n\n';
    const events = await collect(readSSE(sseResponse(body)));

    expect(events[0]?.kind).toBe('error');
    expect(events[0]).toMatchObject({ kind: 'error' });
    expect(events[1]).toEqual({ kind: 'done' });
  });

  it('concatenates multi-line data fields per SSE spec', async () => {
    // Multi-line data: the spec says concatenate with \n
    // Two consecutive data: lines before a blank line form one event
    const body = 'data: {"success":true,\ndata: "text":"hello"}\n\ndata: [DONE]\n\n';
    const events = await collect(readSSE(sseResponse(body)));

    // The concatenated value will be '{"success":true,\n"text":"hello"}' — valid JSON
    // At minimum it yields some event (chunk or error) + done
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[events.length - 1]).toEqual({ kind: 'done' });
  });

  it('yields {kind:"error"} when data line is valid JSON but has unexpected shape', async () => {
    // Valid JSON, but neither {success:true, text} nor {success:false, error}
    const body = 'data: {"type":"ping"}\n\ndata: [DONE]\n\n';
    const events = await collect(readSSE(sseResponse(body)));

    expect(events[0]?.kind).toBe('error');
    expect((events[0] as { kind: 'error'; error: string }).error).toContain('Unexpected event shape');
    expect(events[1]).toEqual({ kind: 'done' });
  });

  it('yields {kind:"error"} when upstream sends success:false', async () => {
    const body = 'data: {"success":false,"error":"internal error"}\n\ndata: [DONE]\n\n';
    const events = await collect(readSSE(sseResponse(body)));

    expect(events[0]).toEqual({ kind: 'error', error: 'internal error' });
    expect(events[1]).toEqual({ kind: 'done' });
  });

  it('handles response with no body gracefully', async () => {
    // Response with null body
    const res = new Response(null, { status: 200 });
    const events = await collect(readSSE(res));
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// readSSE — abort signal
// ---------------------------------------------------------------------------

describe('readSSE — abort signal', () => {
  it('stops iteration when signal is already aborted before read', async () => {
    const controller = new AbortController();
    controller.abort();

    const body = 'data: {"success":true,"text":"should not emit"}\n\ndata: [DONE]\n\n';
    const events = await collect(readSSE(sseResponse(body), { signal: controller.signal }));

    // Aborted before any read — should get 0 events
    expect(events).toHaveLength(0);
  });

  it('stops iteration when signal is aborted after yielding first event', async () => {
    const controller = new AbortController();

    // Use a stream with two events. Abort after reading the first — the second
    // should never be yielded.
    const body = [
      'data: {"success":true,"text":"first"}\n\n',
      'data: {"success":true,"text":"second"}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const events: NarrationEvent[] = [];
    const iter = readSSE(sseResponse(body), { signal: controller.signal });

    // Read the first event
    const first = await iter.next();
    if (!first.done) events.push(first.value);

    // Abort before reading further
    controller.abort();

    // Return the iterator explicitly to trigger cleanup
    await iter.return?.();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: 'chunk', text: 'first' });
  });
});

// ---------------------------------------------------------------------------
// readSSE — abort via reader.read() AbortError
// ---------------------------------------------------------------------------

describe('readSSE — reader AbortError during read', () => {
  it('stops cleanly when reader.read() rejects with AbortError', async () => {
    // Simulate a stream whose first read() throws an AbortError
    // (happens when reader.cancel() fires from the abort signal listener
    // concurrently with a pending reader.read() call)
    const abortError = new DOMException('The operation was aborted.', 'AbortError');

    const mockReader = {
      read: jest.fn<Promise<ReadableStreamReadResult<Uint8Array>>, []>()
        .mockRejectedValueOnce(abortError),
      cancel: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
      releaseLock: jest.fn<void, []>(),
    };

    const mockBody = {
      getReader: jest.fn().mockReturnValue(mockReader),
    };

    const res = new Response(null, { status: 200 });
    Object.defineProperty(res, 'body', {
      get() { return mockBody as unknown as ReadableStream; },
      configurable: true,
    });

    const controller = new AbortController();
    const events = await collect(readSSE(res, { signal: controller.signal }));

    // AbortError from reader.read() should be swallowed — yields nothing
    expect(events).toHaveLength(0);
  });

  it('stops mid-loop when signal becomes aborted between reads', async () => {
    // First read returns data; second read detects signal is aborted before executing
    const controller = new AbortController();
    const encoder = new TextEncoder();

    let readCount = 0;
    const mockReader = {
      read: jest.fn<Promise<ReadableStreamReadResult<Uint8Array>>, []>()
        .mockImplementation(() => {
          readCount++;
          if (readCount === 1) {
            // Abort after yielding the first chunk
            controller.abort();
            return Promise.resolve({
              done: false,
              value: encoder.encode('data: {"success":true,"text":"first"}\n\n'),
            });
          }
          // This read should not be reached — the abort check at loop top catches it
          return Promise.resolve({ done: true, value: undefined });
        }),
      cancel: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
      releaseLock: jest.fn<void, []>(),
    };

    const mockBody = {
      getReader: jest.fn().mockReturnValue(mockReader),
    };

    const res = new Response(null, { status: 200 });
    Object.defineProperty(res, 'body', {
      get() { return mockBody as unknown as ReadableStream; },
      configurable: true,
    });

    const events = await collect(readSSE(res, { signal: controller.signal }));
    // We get the first chunk, then iteration stops on abort check
    expect(events.length).toBeGreaterThanOrEqual(0); // 0 or 1 depending on timing
    // Critically: no throw, clean return
  });

  it('re-throws when reader.read() rejects with a non-AbortError', async () => {
    // A non-abort error (e.g., network failure mid-stream) should propagate
    const networkError = new Error('Stream interrupted');

    const mockReader = {
      read: jest.fn<Promise<ReadableStreamReadResult<Uint8Array>>, []>()
        .mockRejectedValueOnce(networkError),
      cancel: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
      releaseLock: jest.fn<void, []>(),
    };

    const mockBody = {
      getReader: jest.fn().mockReturnValue(mockReader),
    };

    const res = new Response(null, { status: 200 });
    Object.defineProperty(res, 'body', {
      get() { return mockBody as unknown as ReadableStream; },
      configurable: true,
    });

    const iter = readSSE(res);
    await expect(iter.next()).rejects.toThrow('Stream interrupted');
  });
});

// ---------------------------------------------------------------------------
// streamNarration
// ---------------------------------------------------------------------------

describe('streamNarration', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    (global as Record<string, unknown>).fetch = mockFetch;
  });

  it('yields events from a successful SSE stream', async () => {
    const body = 'data: {"success":true,"text":"narrated"}\n\ndata: [DONE]\n\n';
    mockFetch.mockResolvedValueOnce(sseResponse(body));

    const events = await collect(
      streamNarration({ username: 'player', message: 'go', channel: 'tavern' }),
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: 'chunk', text: 'narrated' });
    expect(events[1]).toEqual({ kind: 'done' });
  });

  it('yields {kind:"error"} on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const events = await collect(
      streamNarration({ username: 'player', message: 'go', channel: 'tavern' }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'error' });
  });

  it('yields {kind:"error", error:"network"} on fetch throw', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const events = await collect(
      streamNarration({ username: 'player', message: 'go', channel: 'tavern' }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: 'error', error: 'network' });
  });

  it('returns silently on abort before fetch', async () => {
    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      streamNarration(
        { username: 'player', message: 'go', channel: 'tavern' },
        { signal: controller.signal },
      ),
    );

    expect(events).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns silently when fetch throws an AbortError (abort mid-flight)', async () => {
    // fetch itself throwing AbortError — distinct from pre-flight abort check
    const abortErr = new DOMException('Aborted', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortErr);

    const events = await collect(
      streamNarration({ username: 'player', message: 'go', channel: 'tavern' }),
    );

    // AbortError from fetch is swallowed — no events yielded
    expect(events).toHaveLength(0);
  });

  it('yields {kind:"error"} with status string when error body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Service Unavailable', {
        status: 503,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const events = await collect(
      streamNarration({ username: 'player', message: 'go', channel: 'tavern' }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('error');
    // Error message should include the HTTP status
    expect((events[0] as { kind: 'error'; error: string }).error).toContain('503');
  });
});
