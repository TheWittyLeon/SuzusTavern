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
 * TAV-MOUNT-PARTIAL-HISTORY-HEALS — the mount's history read. Returns the typed read (null when the
 * first page failed); the caller decides what an incomplete one means. The play screen seeds its
 * poll watermark from what the mount DID read, and the flag-OFF poll draws only dice and X-card
 * rows, so while the read was incomplete the poll heals: it draws every kind it reads past the
 * watermark, until a read reaches the end of the log. The mount arms the flag (`unreadHistoryRef`,
 * owned by the transcript hook) before it reads anything, so a poll tick that lands first heals instead of
 * consuming the log as live, and settles it (`flagUnreadHistory`) in the run that seeds the watermark.
 */
export function readSessionHistory(sessionId: string, signal: AbortSignal | undefined): Promise<EventsRead | null> {
  return readSessionEventsResult(sessionId, signal);
}

/**
 * Record whether a mount history read left rows unread (a null read, the first page failing, counts:
 * the whole log is unread). Call it in the same synchronous run that seeds the poll watermark.
 */
export function flagUnreadHistory(unreadHistoryRef: MutableRefObject<boolean>, read: EventsRead | null): void {
  unreadHistoryRef.current = read === null || !read.complete;
}
