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
import type { EventsWirePage, EventsRead, EventsReadStop } from './eventsPageMeta';
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
 * Only rows past the cursor are appended, so a wire that ignores `since_seq`
 * (and serves the same page again) cannot double the log. Also stops when a page
 * makes no forward progress, or at `maxPages`.
 *
 * Returns `null` only when the FIRST page fails (engine unreachable: the existing
 * sentinel). Every other stop is an `EventsRead`: `complete` is false when the
 * read ended with rows unread (a later page failed, the page cap was hit, or the
 * wire said `has_more` but the cursor cannot move), `cursor` is the last seq read,
 * and one `console.warn` names the session, that seq and the reason (not for hitting a cap the
 * caller asked for: `capIsAsked`). The rows are
 * a contiguous prefix past `sinceSeq`, so the caller's watermark still advances
 * correctly and the rest arrives next time.
 */
export async function pageEventsForward(
  fetchPage: (sinceSeq: number) => Promise<EventsWirePage | null>,
  sessionId: string,
  sinceSeq = 0,
  maxPages = MOUNT_MAX_PAGES,
  capIsAsked = false,
): Promise<EventsRead | null> {
  let cursor = sinceSeq;
  let all: EventsRead['rows'] | null = null;
  const partial = (stop: EventsReadStop): EventsRead => {
    // A caller that set `maxPages` on purpose (`capIsAsked`: the opening gate's one-page peek) asked for the
    // stop at the cap, so that stop is not a fault. The result still says `complete: false` for whoever reads it.
    if (!(capIsAsked && stop === 'page cap reached')) {
      console.warn(`[events] session ${sessionId}: read stopped after seq ${cursor}: ${stop}`);
    }
    return { rows: all ?? [], complete: false, cursor, stop };
  };
  for (let page = 0; page < maxPages; page += 1) {
    const got = await fetchPage(cursor);
    if (got === null) return all && partial('later page failed');
    const { rows } = got;
    // Append only rows past the cursor: a wire that ignores `since_seq` serves the
    // same page again, and appending it before the no-progress check would double
    // the log. (A row with no `seq` cannot be compared, so it is kept.)
    const fresh = rows.filter((e) => e.seq == null || e.seq > cursor);
    all = [...(all ?? []), ...fresh];
    const rowMax = rows.reduce((m, e) => Math.max(m, e.seq ?? 0), cursor);
    // `has_more` only EXTENDS the read: a full page is asked past even when the
    // wire says no more (rows can land between two requests), and a short page
    // is the end unless the wire says otherwise.
    const wireHasMore = got.hasMore === true;
    if (!wireHasMore && rows.length < RAW_EVENTS_PAGE_LIMIT) return { rows: all, complete: true, cursor: Math.max(rowMax, got.maxSeq ?? 0) };
    const next = wireHasMore ? Math.max(rowMax, got.maxSeq ?? 0) : rowMax;
    if (next <= cursor) {
      // No forward progress. A wire that still says `has_more` has rows we cannot
      // reach, so that read is incomplete; a full page with no has_more is the end.
      return wireHasMore ? partial('has_more but the cursor cannot move') : { rows: all, complete: true, cursor };
    }
    cursor = next;
  }
  return all && partial('page cap reached');
}
