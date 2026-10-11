/**
 * TAV-EVENTS-FEED-FROZEN-PAST-200 / TAV-RECAP-READS-OLDEST-200 — the one
 * forward-paging loop for the session event log.
 *
 * The engine's GET /events defaults to `limit=200, since_seq=0`, ascending, so
 * a single unparameterised read returns only the campaign's OLDEST 200 rows.
 * Every consumer that needs the newest events pages forward from a watermark.
 *
 * Takes the page fetcher as an argument (no import of `dnd.ts`), so both
 * `getSessionEvents` (in dnd.ts) and `readSessionEventsForward` can share it
 * without an import cycle.
 */
import type { EngineSessionEvent } from './types';
import { markIncomplete, pageMetaOf } from './eventsPageMeta';
import { MOUNT_MAX_PAGES, RAW_EVENTS_PAGE_LIMIT } from './eventsPaging.constants';

/**
 * Read every event with `seq > sinceSeq`, oldest first, one page at a time.
 *
 * The wire extends the read: while a page's `has_more` is true it continues,
 * advancing from the page's `max_seq` (computed before the proxy's per-caller
 * filter, so it moves even when every row of a page was filtered out) or the
 * last row's `seq`, whichever is higher. Otherwise (no `has_more`: an older
 * proxy or a mocked reader; or `has_more` false) a page short of
 * `RAW_EVENTS_PAGE_LIMIT` is the end, and a full page is asked past once more.
 *
 * Also stops when a page makes no forward progress (a proxy that drops
 * `since_seq` would otherwise loop forever), or at `maxPages`.
 *
 * Returns `null` only when the FIRST page fails (engine unreachable — the
 * existing sentinel). A later page failing returns what was read so far,
 * marked incomplete (`isReadComplete`): the events are a contiguous prefix past
 * `sinceSeq`, so the caller's watermark still advances correctly and the rest
 * arrives next time. Hitting `maxPages` with rows left is marked the same way.
 */
export async function pageEventsForward(
  fetchPage: (sinceSeq: number) => Promise<EngineSessionEvent[] | null>,
  sinceSeq = 0,
  maxPages = MOUNT_MAX_PAGES,
): Promise<EngineSessionEvent[] | null> {
  let cursor = sinceSeq;
  let all: EngineSessionEvent[] | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await fetchPage(cursor);
    if (rows === null) return all && markIncomplete(all);
    all = [...(all ?? []), ...rows];
    const meta = pageMetaOf(rows);
    const rowMax = rows.reduce((m, e) => Math.max(m, e.seq ?? 0), cursor);
    // `has_more` only EXTENDS the read: a full page is asked past even when the
    // wire says no more (rows can land between two requests), and a short page
    // is the end unless the wire says otherwise.
    const wireHasMore = meta?.hasMore === true;
    if (!wireHasMore && rows.length < RAW_EVENTS_PAGE_LIMIT) return all;
    const next = wireHasMore ? Math.max(rowMax, meta?.maxSeq ?? 0) : rowMax;
    if (next <= cursor) return all; // no forward progress
    cursor = next;
  }
  return all && markIncomplete(all);
}
