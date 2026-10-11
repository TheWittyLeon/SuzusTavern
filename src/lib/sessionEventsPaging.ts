/**
 * TAV-EVENTS-FEED-FROZEN-PAST-200 — forward-paged reader for the raw session
 * event log.
 *
 * The engine's GET /events defaults to `limit=200, since_seq=0`, ascending, so
 * a single unparameterised read returns only the campaign's OLDEST 200 rows.
 * Every consumer that needs "the newest events" (mount rehydration, the
 * flag-OFF events poll) must therefore page forward from a watermark rather
 * than re-read from zero. This is the one place that loop lives.
 *
 * Not in `dnd.ts` on purpose: callers (and the /play test pin) mock that
 * module wholesale, and the loop must keep working over the mocked reader.
 */
import { getSessionEventsRaw } from '@/lib/api/dnd';
import type { EngineSessionEvent } from '@/lib/api/types';
import {
  MOUNT_MAX_PAGES,
  RAW_EVENTS_PAGE_LIMIT,
} from '@/lib/api/eventsPaging.constants';

/**
 * Read every event with `seq > sinceSeq`, oldest first, one page at a time.
 *
 * Stops when a page comes back short of `RAW_EVENTS_PAGE_LIMIT` (the engine
 * route reports no `has_more` on this read, so "short page" is the end
 * signal), when a page makes no forward progress (a proxy that drops
 * `since_seq` would otherwise loop forever), or at `maxPages`.
 *
 * Returns `null` only when the FIRST page fails (engine unreachable — the
 * existing sentinel). A later page failing returns what was read so far:
 * the events are a contiguous prefix past `sinceSeq`, so the caller's
 * watermark still advances correctly and the rest arrives next time.
 */
export async function readSessionEventsForward(
  sessionId: string,
  signal?: AbortSignal,
  sinceSeq = 0,
  maxPages = MOUNT_MAX_PAGES,
): Promise<EngineSessionEvent[] | null> {
  let cursor = sinceSeq;
  let all: EngineSessionEvent[] | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await getSessionEventsRaw(sessionId, signal, cursor);
    if (rows === null) return all;
    all = [...(all ?? []), ...rows];
    if (rows.length < RAW_EVENTS_PAGE_LIMIT) break;
    const pageMax = rows.reduce((m, e) => Math.max(m, e.seq ?? 0), cursor);
    if (pageMax <= cursor) break; // no forward progress
    cursor = pageMax;
  }
  return all;
}
