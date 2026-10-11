/**
 * TAV-EVENTS-FEED-FROZEN-PAST-200 — forward-paged reader for the raw session
 * event log.
 *
 * The engine's GET /events defaults to `limit=200, since_seq=0`, ascending, so
 * a single unparameterised read returns only the campaign's OLDEST 200 rows.
 * Every consumer that needs "the newest events" (mount rehydration, the
 * flag-OFF events poll) must therefore page forward from a watermark rather
 * than re-read from zero. The loop itself lives in `lib/api/eventsPaging.ts`
 * (shared with `getSessionEvents`); this is its raw-reader binding.
 *
 * Not in `dnd.ts` on purpose: callers (and the /play test pin) mock that
 * module wholesale, and the loop must keep working over the mocked reader.
 */
import { getSessionEventsRaw } from '@/lib/api/dnd';
import { pageEventsForward } from '@/lib/api/eventsPaging';
import type { EngineSessionEvent } from '@/lib/api/types';
import { MOUNT_MAX_PAGES } from '@/lib/api/eventsPaging.constants';

/**
 * Read every event with `seq > sinceSeq`, oldest first (see `pageEventsForward`
 * for the stop conditions and the null / partial-result contract).
 */
export function readSessionEventsForward(
  sessionId: string,
  signal?: AbortSignal,
  sinceSeq = 0,
  maxPages = MOUNT_MAX_PAGES,
): Promise<EngineSessionEvent[] | null> {
  return pageEventsForward(
    (cursor) => getSessionEventsRaw(sessionId, signal, cursor),
    sinceSeq,
    maxPages,
  );
}
