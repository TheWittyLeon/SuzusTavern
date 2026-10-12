/**
 * @jest-environment node
 *
 * Lane G QA (Miko), item 4 -- TAV-EVENTS-WARN-ON-BOUNDED-READ. The silence is for ONE stop only:
 * "page cap reached" when the CALLER set maxPages. Every other way a read can end with rows unread
 * must still warn, whether or not the caller set a cap. Runs over the real reader and a fake wire.
 */
import { getSessionEvents } from '@/lib/api/dnd';
import { pageEventsForward } from '@/lib/api/eventsPaging';
import { readSessionEventsResult } from '@/lib/sessionEventsPaging';
import { MOUNT_MAX_PAGES, POLL_MAX_PAGES } from '@/lib/api/eventsPaging.constants';
import type { EventsWirePage } from '@/lib/api/eventsPageMeta';

const mockFetch = jest.fn();
type Row = { seq: number; kind: string; data?: Record<string, unknown> };
const story = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ seq: i + 1, kind: 'narration', data: { text: `l${i + 1}` } }));

type Hook = (sinceSeq: number, calls: number) => Response | null;
function wire(campaign: Row[], hook?: Hook) {
  let calls = 0;
  mockFetch.mockImplementation(async (url: string) => {
    calls += 1;
    const q = new URL(url, 'http://x').searchParams;
    const since = Number(q.get('since_seq') ?? 0);
    const hooked = hook?.(since, calls);
    if (hooked) return hooked;
    const limit = Math.min(Number(q.get('limit') ?? 200), 500);
    const after = campaign.filter((e) => e.seq > since);
    const page = after.slice(0, limit);
    return new Response(
      JSON.stringify({ success: true, data: { events: page, max_seq: page.length ? page[page.length - 1].seq : since, has_more: after.length > limit } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
}

let warn: jest.SpyInstance;
beforeEach(() => {
  mockFetch.mockReset();
  (global as Record<string, unknown>).fetch = mockFetch;
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe('the explicit cap is silent', () => {
  it.each([1, 2, 3])('getSessionEvents(.., maxPages=%i) over a 2,000-row log stops at its cap without a warning', async (cap) => {
    wire(story(2000));
    const out = await getSessionEvents('s1', undefined, cap);
    expect(out).toHaveLength(cap * 500);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('every other cut-short read still warns', () => {
  it('NO cap given: the mount cap (100 pages) is not "asked for" -> one warning naming the reason', async () => {
    wire(story(MOUNT_MAX_PAGES * 500 + 10));
    const out = await getSessionEvents('s1');
    expect(out).toHaveLength(MOUNT_MAX_PAGES * 500);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/page cap reached/);
  });

  it('cap given AND a later page fails before it: warns (the cut was a fault, not the cap)', async () => {
    wire(story(2000), (since) => (since > 0 ? new Response('{}', { status: 500 }) : null));
    const out = await getSessionEvents('s1', undefined, 5);
    expect(out).toHaveLength(500);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/later page failed/);
  });

  it('cap given AND the wire says has_more but the cursor cannot move: warns', async () => {
    wire([], (since) =>
      new Response(JSON.stringify({ success: true, data: { events: story(500), max_seq: since === 0 ? 500 : 500, has_more: true } }), { status: 200 }),
    );
    const out = await getSessionEvents('s1', undefined, 5);
    expect(out).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/cursor cannot move/);
  });

  it('the poll\'s own bound (POLL_MAX_PAGES) is not an asked-for cap on the raw reader: it warns', async () => {
    wire(story(POLL_MAX_PAGES * 500 + 5));
    // readSessionEventsResult goes through getSessionEventsRaw (the real dnd.ts over the fake wire).
    const read = await readSessionEventsResult('s1', undefined, 0, POLL_MAX_PAGES);
    expect(read && read.complete).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('pageEventsForward direct: capIsAsked silences ONLY "page cap reached" (later-page failure, stuck cursor stay loud)', async () => {
    const full = (rows: number, hasMore: boolean, maxSeq: number): EventsWirePage => ({
      rows: Array.from({ length: rows }, (_, i) => ({ seq: maxSeq - rows + 1 + i, kind: 'narration' })) as EventsWirePage['rows'],
      hasMore,
      maxSeq,
    });
    // cap reached, asked: silent
    await pageEventsForward(async (c) => full(500, true, c + 500), 's1', 0, 2, true);
    expect(warn).not.toHaveBeenCalled();
    // same read, cap NOT asked: loud
    await pageEventsForward(async (c) => full(500, true, c + 500), 's1', 0, 2, false);
    expect(warn).toHaveBeenCalledTimes(1);
    // asked, but a page fails: loud
    let n = 0;
    await pageEventsForward(async (c) => (++n === 2 ? null : full(500, true, c + 500)), 's1', 0, 5, true);
    expect(warn).toHaveBeenCalledTimes(2);
    // asked, but the cursor sticks: loud
    await pageEventsForward(async () => full(500, true, 500), 's1', 0, 5, true);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('a bounded read still tells its caller the truth: complete:false and the cursor, even when silent', async () => {
    wire(story(1200));
    const read = await pageEventsForward(
      async (cursor) => {
        const r = await fetch(`/api/dnd/sessions/s1/events?since_seq=${cursor}&limit=500`);
        const d = (await r.json()).data;
        return { rows: d.events, hasMore: d.has_more, maxSeq: d.max_seq };
      },
      's1',
      0,
      1,
      true,
    );
    expect(read).toMatchObject({ complete: false, cursor: 500, stop: 'page cap reached' });
    expect(warn).not.toHaveBeenCalled();
  });
});
