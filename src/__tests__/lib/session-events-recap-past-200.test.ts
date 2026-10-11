/**
 * @jest-environment node
 *
 * TAV-RECAP-READS-OLDEST-200 — getSessionEvents (the flattened reader behind
 * the "previously on" recap) sent a bare /events URL, and the engine answers
 * that with the campaign's OLDEST 200 rows. buildRecap takes the LAST notable
 * events, so past 200 events the recap summarised the opening of the story.
 *
 * `installEngine` behaves like the real GET /events route: ascending, rows
 * with seq > since_seq, `limit` defaulting to 200 and capped at 500.
 */
const mockFetch = jest.fn();

import { getSessionEvents } from '../../lib/api/dnd';
import { buildRecap } from '../../lib/dnd/recap';

// Third arg (maxPages) lands with the fix; the cast keeps tsc green before it.
type Reader = (
  sessionId: string,
  signal?: AbortSignal,
  maxPages?: number,
) => ReturnType<typeof getSessionEvents>;
const read = getSessionEvents as Reader;

const campaign = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    kind: 'scene_advance',
    actor: 'suzu',
    data: { description: `scene ${i + 1}` },
    created_at: '2026-10-11T10:00:00Z',
  }));

function installEngine(rows: ReturnType<typeof campaign>) {
  mockFetch.mockImplementation((url: string) => {
    const q = new URL(url, 'http://x').searchParams;
    const since = Number(q.get('since_seq') ?? 0);
    const limit = Math.min(Number(q.get('limit') ?? 200), 500);
    const events = rows.filter((e) => e.seq > since).slice(0, limit);
    return Promise.resolve(
      new Response(JSON.stringify({ success: true, data: { events } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

const sinceArgs = () =>
  mockFetch.mock.calls.map((c) => new URL(c[0] as string, 'http://x').searchParams.get('since_seq'));

beforeEach(() => {
  mockFetch.mockReset();
  (global as Record<string, unknown>).fetch = mockFetch;
});

const SESSION = { channel: 'the_hollow_tide' };

describe('getSessionEvents — TAV-RECAP-READS-OLDEST-200', () => {
  it('a recap built from a 1,200-event campaign reflects the last events, not the first 200', async () => {
    installEngine(campaign(1200));
    const events = await read('s1');
    expect(events).toHaveLength(1200);
    const recap = buildRecap(SESSION, events ?? []);
    expect(recap.lines).toEqual(['scene 1197', 'scene 1198', 'scene 1199', 'scene 1200']);
    expect(sinceArgs()).toEqual(['0', '500', '1000']);
  });

  it('keeps the flattened shape (event_id/event_type/description), not the raw one', async () => {
    installEngine(campaign(3));
    const events = await read('s1');
    expect(events![2]).toEqual({
      event_id: '3',
      event_type: 'scene_advance',
      actor: 'suzu',
      description: 'scene 3',
      created_at: '2026-10-11T10:00:00Z',
    });
  });

  it('maxPages=1 (checkShouldOpen) makes exactly one request even on a long campaign', async () => {
    installEngine(campaign(1200));
    const events = await read('s1', undefined, 1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(500);
    expect(events![0].description).toBe('scene 1'); // the opening is on page 1
  });

  it('a first-page failure returns the null sentinel', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await read('s1')).toBeNull();
  });

  it('a later-page failure returns the rows read so far, not null', async () => {
    const rows = campaign(1200);
    installEngine(rows);
    const good = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementationOnce(good).mockRejectedValueOnce(new Error('ECONNRESET'));
    const events = await read('s1');
    expect(events).toHaveLength(500);
    expect(events![499].description).toBe('scene 500');
  });
});
