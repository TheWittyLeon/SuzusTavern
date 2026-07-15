/**
 * @jest-environment node
 *
 * DDX-20 — getSessionEventsPage (src/lib/api/dnd.ts).
 * Cursor-paged read: GET /api/dnd/sessions/:id/events?since_seq={n}.
 */
const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  (global as Record<string, unknown>).fetch = mockFetch;
});

import { getSessionEventsPage } from '../../lib/api/dnd';

function lastCall() {
  const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [
    string,
    RequestInit,
  ];
  return { url, method: init.method ?? 'GET' };
}

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('getSessionEventsPage', () => {
  it('GET /api/dnd/sessions/:id/events?since_seq={n} — path shape', async () => {
    mockFetch.mockResolvedValueOnce(
      envelope({ events: [], max_seq: 0, has_more: false, pending_generation: null }),
    );
    await getSessionEventsPage('sess-1', 42);
    const { url, method } = lastCall();
    expect(url).toBe('/api/dnd/sessions/sess-1/events?since_seq=42');
    expect(method).toBe('GET');
  });

  it('defaults since_seq to 0 when omitted (cold-start / full-replay path)', async () => {
    mockFetch.mockResolvedValueOnce(
      envelope({ events: [], max_seq: 0, has_more: false, pending_generation: null }),
    );
    await getSessionEventsPage('sess-1');
    const { url } = lastCall();
    expect(url).toBe('/api/dnd/sessions/sess-1/events?since_seq=0');
  });

  it('resolves to the unwrapped {events, max_seq, has_more, pending_generation} shape', async () => {
    const page = {
      events: [{ seq: 43, kind: 'narration', actor: null, visibility: 'table', data: { text: 'x' } }],
      max_seq: 43,
      has_more: false,
      pending_generation: null,
    };
    mockFetch.mockResolvedValueOnce(envelope(page));
    const result = await getSessionEventsPage('sess-1', 42);
    expect(result).toEqual(page);
  });

  it('surfaces a non-null pending_generation block verbatim', async () => {
    const pending = {
      turn_key: 'tk-1',
      job_id: 'job-1',
      status: 'streaming' as const,
      trigger_seq: 100,
      started_at: '2026-07-14T18:03:05Z',
    };
    mockFetch.mockResolvedValueOnce(
      envelope({ events: [], max_seq: 100, has_more: false, pending_generation: pending }),
    );
    const result = await getSessionEventsPage('sess-1', 100);
    expect(result.pending_generation).toEqual(pending);
  });

  it('has_more:true signals the caller should page forward (max_seq is the next cursor)', async () => {
    mockFetch.mockResolvedValueOnce(
      envelope({
        events: [{ seq: 201 }, { seq: 202 }],
        max_seq: 202,
        has_more: true,
        pending_generation: null,
      }),
    );
    const result = await getSessionEventsPage('sess-1', 200, undefined);
    expect(result.has_more).toBe(true);
    expect(result.max_seq).toBe(202);
  });

  it('encodes the session id in the path', async () => {
    mockFetch.mockResolvedValueOnce(
      envelope({ events: [], max_seq: 0, has_more: false, pending_generation: null }),
    );
    await getSessionEventsPage('sess with space', 0);
    const { url } = lastCall();
    expect(url).toBe('/api/dnd/sessions/sess%20with%20space/events?since_seq=0');
  });

  it('THROWS on a {success:false} envelope (unlike getSessionEventsRaw, which swallows to null)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(getSessionEventsPage('unknown', 0)).rejects.toThrow();
  });

  it('THROWS on network error (no swallow-to-null sentinel)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(getSessionEventsPage('sess-1', 0)).rejects.toThrow();
  });
});
