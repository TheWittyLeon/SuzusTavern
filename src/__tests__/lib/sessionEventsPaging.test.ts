/**
 * TAV-EVENTS-FEED-FROZEN-PAST-200 — readSessionEventsForward pages the raw
 * events read forward from a watermark.
 */
const mockRaw = jest.fn();
jest.mock('../../lib/api/dnd', () => ({
  getSessionEventsRaw: (...a: unknown[]) => mockRaw(...a),
}));

import { readSessionEventsForward } from '@/lib/sessionEventsPaging';
import { RAW_EVENTS_PAGE_LIMIT } from '@/lib/api/eventsPaging.constants';

const rows = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ seq: from + i, kind: 'narration' }));

beforeEach(() => mockRaw.mockReset());

describe('readSessionEventsForward', () => {
  it('returns a single short page without a second request', async () => {
    mockRaw.mockResolvedValueOnce(rows(1, 10));
    const out = await readSessionEventsForward('s1');
    expect(out).toHaveLength(10);
    expect(mockRaw).toHaveBeenCalledTimes(1);
    expect(mockRaw).toHaveBeenCalledWith('s1', undefined, 0);
  });

  it('pages with since_seq until a short page: 1,200 events = 3 requests', async () => {
    mockRaw
      .mockResolvedValueOnce(rows(1, 500))
      .mockResolvedValueOnce(rows(501, 1000))
      .mockResolvedValueOnce(rows(1001, 1200));
    const out = await readSessionEventsForward('s1');
    expect(out!.map((e) => e.seq)).toEqual(rows(1, 1200).map((e) => e.seq));
    expect(mockRaw.mock.calls.map((c) => c[2])).toEqual([0, 500, 1000]);
  });

  it('starts at the caller watermark', async () => {
    mockRaw.mockResolvedValueOnce([]);
    expect(await readSessionEventsForward('s1', undefined, 777)).toEqual([]);
    expect(mockRaw).toHaveBeenCalledWith('s1', undefined, 777);
  });

  it('a full page followed by an empty one ends cleanly', async () => {
    mockRaw.mockResolvedValueOnce(rows(1, RAW_EVENTS_PAGE_LIMIT)).mockResolvedValueOnce([]);
    expect(await readSessionEventsForward('s1')).toHaveLength(RAW_EVENTS_PAGE_LIMIT);
    expect(mockRaw).toHaveBeenCalledTimes(2);
  });

  it('stops when a page makes no forward progress (proxy that drops since_seq)', async () => {
    mockRaw.mockResolvedValue(rows(1, RAW_EVENTS_PAGE_LIMIT));
    await readSessionEventsForward('s1');
    expect(mockRaw).toHaveBeenCalledTimes(2); // second page repeats seq 1..500 -> break
  });

  it('honours maxPages', async () => {
    let next = 1;
    mockRaw.mockImplementation(() => {
      const r = rows(next, next + RAW_EVENTS_PAGE_LIMIT - 1);
      next += RAW_EVENTS_PAGE_LIMIT;
      return Promise.resolve(r);
    });
    const out = await readSessionEventsForward('s1', undefined, 0, 3);
    expect(mockRaw).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(3 * RAW_EVENTS_PAGE_LIMIT);
  });

  it('returns null when the first page fails (engine unreachable)', async () => {
    mockRaw.mockResolvedValueOnce(null);
    expect(await readSessionEventsForward('s1')).toBeNull();
  });

  it('keeps the pages already read when a later page fails', async () => {
    mockRaw.mockResolvedValueOnce(rows(1, 500)).mockResolvedValueOnce(null);
    expect(await readSessionEventsForward('s1')).toHaveLength(500);
  });
});
