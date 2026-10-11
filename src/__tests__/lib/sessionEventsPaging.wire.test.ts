/**
 * @jest-environment node
 *
 * TAV-EVENTS-FEED-FROZEN-PAST-200 / TAV-RECAP-READS-OLDEST-200 — the pager over the REAL
 * getSessionEventsRaw and a fake wire (not a mocked reader), so the URL, the envelope and the
 * page-boundary rule are all exercised together.
 *
 * The fake wire behaves like proxy-over-engine: engine route = rows with seq > since_seq, ascending,
 * capped at `limit` (<= 500), answering { events, max_seq, has_more } with max_seq / has_more computed
 * BEFORE the proxy's per-caller filter; the proxy (ProjectNekoNova api/routes/dnd_sessions.py,
 * _filter_events_for_caller) then drops `dm_override` rows from `events` for a caller who may not see
 * them (a non-DM when dm_override_player_visible is false; an anonymous caller always).
 */
const mockFetch = jest.fn();
beforeEach(() => {
  mockFetch.mockReset();
  (global as Record<string, unknown>).fetch = mockFetch;
});

import { readSessionEventsForward } from '@/lib/sessionEventsPaging';
import { getSessionEvents } from '@/lib/api/dnd';
import { MOUNT_MAX_PAGES } from '@/lib/api/eventsPaging.constants';

type Row = { seq: number; kind: string; data?: Record<string, unknown> };

function wire(campaign: Row[], hideKind?: string) {
  mockFetch.mockImplementation(async (url: string) => {
    const q = new URL(url, 'http://x').searchParams;
    const since = Number(q.get('since_seq') ?? 0);
    const limit = Math.min(Number(q.get('limit') ?? 200), 500);
    const after = campaign.filter((e) => e.seq > since);
    const page = after.slice(0, limit);
    const shown = hideKind ? page.filter((e) => e.kind !== hideKind) : page;
    return new Response(
      JSON.stringify({
        success: true,
        data: { events: shown, max_seq: page.length ? page[page.length - 1].seq : since, has_more: after.length > limit },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
}

const story = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ seq: i + 1, kind: 'narration', data: { text: `l${i + 1}` } }));

describe('page boundaries over the real wire', () => {
  it.each([
    [199, 1],
    [200, 1],
    [499, 1],
    [500, 2],
    [501, 2],
    [1000, 3],
    [1001, 3],
  ])('%i events are all read in %i request(s)', async (total, requests) => {
    wire(story(total));
    const out = await readSessionEventsForward('s1');
    expect(out).toHaveLength(total);
    expect(out!.map((e) => e.seq)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(mockFetch).toHaveBeenCalledTimes(requests);
  });

  it('a fresh campaign with 0 events is an empty array, not null', async () => {
    wire([]);
    expect(await readSessionEventsForward('s1')).toEqual([]);
  });

  it('the mount cap stops at MOUNT_MAX_PAGES x 500 and a read from the returned watermark continues with no gap or overlap', async () => {
    const total = MOUNT_MAX_PAGES * 500 + 120;
    wire(story(total));
    const first = await readSessionEventsForward('s1');
    expect(first).toHaveLength(MOUNT_MAX_PAGES * 500);
    expect(mockFetch).toHaveBeenCalledTimes(MOUNT_MAX_PAGES);
    const mark = first![first!.length - 1].seq as number;
    const rest = await readSessionEventsForward('s1', undefined, mark);
    expect(rest!.map((e) => e.seq)).toEqual(Array.from({ length: 120 }, (_, i) => mark + 1 + i));
  });

  it('events that land between two pages are picked up by the second page, and nothing is read twice', async () => {
    const campaign = story(500);
    wire(campaign);
    let calls = 0;
    const inner = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (url: string) => {
      calls += 1;
      if (calls === 2) campaign.push(...story(530).slice(500)); // 30 rows arrive mid-read
      return inner(url);
    });
    const out = await readSessionEventsForward('s1');
    expect(out!.map((e) => e.seq)).toEqual(Array.from({ length: 530 }, (_, i) => i + 1));
  });
});

describe('the recap reader over the real wire', () => {
  it('a campaign with fewer than 200 events is one request and keeps every row', async () => {
    wire(story(37));
    const out = await getSessionEvents('s1');
    expect(out).toHaveLength(37);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('a 1,200-event campaign ends on its LAST event', async () => {
    wire(story(1200));
    const out = await getSessionEvents('s1');
    expect(out![out!.length - 1].description).toBe('l1200');
  });

  it('a first-page HTTP 500 is the null sentinel, not an empty recap', async () => {
    mockFetch.mockResolvedValue(new Response('{"success":false}', { status: 500 }));
    expect(await getSessionEvents('s1')).toBeNull();
  });
});

describe('a proxy that filters rows out of a full page', () => {
  // DEFECT (P2, conditional): pageEventsForward treats "fewer than 500 rows" as the end of the log.
  // The proxy drops dm_override rows AFTER the engine applied its 500 cap, so a full engine page
  // reaches the client short whenever one of its rows is an override the caller may not see
  // (a non-DM player with dm_override_player_visible=false; any anonymous reader). The mount then
  // stops after the first ~500 events with has_more:true on the wire unread, and the unread tail's
  // narration never reaches the transcript (the poll only draws dice_roll / x_card). The wire already
  // says what to do: has_more and max_seq are pre-filter, but getSessionEventsRaw discards them.
  it('reads past a short page when the wire says has_more', async () => {
    const campaign = story(700);
    campaign[99] = { seq: 100, kind: 'dm_override', data: {} };
    wire(campaign, 'dm_override');
    const out = await readSessionEventsForward('s1');
    expect(out!.some((e) => e.seq === 700)).toBe(true);
    expect(out).toHaveLength(699); // 700 minus the one override the caller may not see
  });

  it('control: with nothing filtered the same 700-event campaign is read whole', async () => {
    wire(story(700));
    expect(await readSessionEventsForward('s1')).toHaveLength(700);
  });

  it('a whole page filtered to zero rows still advances from max_seq while has_more is true', async () => {
    const campaign = story(700);
    for (let i = 0; i < 500; i += 1) campaign[i] = { seq: i + 1, kind: 'dm_override', data: {} };
    wire(campaign, 'dm_override');
    const out = await readSessionEventsForward('s1');
    expect(out!.map((e) => e.seq)).toEqual(Array.from({ length: 200 }, (_, i) => 501 + i));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('an anonymous reader whose every row is hidden ends cleanly when has_more goes false', async () => {
    wire(Array.from({ length: 30 }, (_, i) => ({ seq: i + 1, kind: 'dm_override' })), 'dm_override');
    expect(await readSessionEventsForward('s1')).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('a response with no has_more (older proxy) still ends on a short page', async () => {
    const campaign = story(700);
    mockFetch.mockImplementation(async (url: string) => {
      const since = Number(new URL(url, 'http://x').searchParams.get('since_seq') ?? 0);
      const events = campaign.filter((e) => e.seq > since).slice(0, 500);
      return new Response(JSON.stringify({ success: true, data: { events } }), { status: 200 });
    });
    const out = await readSessionEventsForward('s1');
    expect(out).toHaveLength(700);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('has_more true with a max_seq that does not move stops instead of looping', async () => {
    mockFetch.mockImplementation(async () =>
      new Response(JSON.stringify({ success: true, data: { events: [], max_seq: 0, has_more: true } }), { status: 200 }),
    );
    expect(await readSessionEventsForward('s1')).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
