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
import type { MutableRefObject } from 'react';
import { getSessionEventsRaw } from '@/lib/api/dnd';
import { pageEventsForward } from '@/lib/api/eventsPaging';
import { pageOf, type EventsRead } from '@/lib/api/eventsPageMeta';
import type { EngineSessionEvent } from '@/lib/api/types';
import { MOUNT_MAX_PAGES } from '@/lib/api/eventsPaging.constants';

/**
 * Read every event with `seq > sinceSeq`, oldest first (see `pageEventsForward`
 * for the stop conditions): the typed result, null when the first page fails.
 */
export async function readSessionEventsResult(
  sessionId: string,
  signal?: AbortSignal,
  sinceSeq = 0,
  maxPages = MOUNT_MAX_PAGES,
): Promise<EventsRead | null> {
  return pageEventsForward(
    async (cursor) => {
      const rows = await getSessionEventsRaw(sessionId, signal, cursor);
      return rows && pageOf(rows);
    },
    sessionId,
    sinceSeq,
    maxPages,
  );
}

/** The rows of `readSessionEventsResult`, for a caller that does not need to know whether the read finished. */
export async function readSessionEventsForward(
  sessionId: string,
  signal?: AbortSignal,
  sinceSeq = 0,
  maxPages = MOUNT_MAX_PAGES,
): Promise<EngineSessionEvent[] | null> {
  return (await readSessionEventsResult(sessionId, signal, sinceSeq, maxPages))?.rows ?? null;
}

/**
 * TAV-MOUNT-PARTIAL-HISTORY-HEALS — the mount's history read. Sets
 * `unreadHistoryRef` (owned by the play page's transcript hook, so it is gone
 * when the page unmounts) to whether the read stopped before the end of the log.
 * The play screen seeds its poll watermark from what the mount DID read, and the
 * flag-OFF poll draws only dice and X-card rows, so while the ref is true the poll
 * draws every kind it reads past the watermark, until a read reaches the end.
 * A null (first page failed) leaves it false: the mount then renders nothing and
 * runs the opening path, which a later heal must not race.
 */
export async function readSessionHistory(
  sessionId: string,
  signal: AbortSignal | undefined,
  unreadHistoryRef: MutableRefObject<boolean>,
): Promise<EngineSessionEvent[] | null> {
  const read = await readSessionEventsResult(sessionId, signal);
  unreadHistoryRef.current = read !== null && !read.complete;
  return read && read.rows;
}
