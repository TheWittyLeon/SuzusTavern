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
import { isReadComplete } from '@/lib/api/eventsPageMeta';
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

/**
 * TAV-MOUNT-PARTIAL-HISTORY-HEALS — sessions whose mount read stopped before the
 * end of the log (a later page failed, or the page cap hit). The play screen
 * seeds its poll watermark from what the mount DID read, and the flag-OFF poll
 * draws only dice and X-card rows, so without this the narration in the unread
 * rows would never appear until a reload. While a session is listed here the
 * poll draws every kind it reads past the watermark, and delists the session
 * once a read reaches the end of the log.
 */
const sessionsWithUnreadHistory = new Set<string>();

/**
 * The mount's history read: `readSessionEventsForward` from zero, plus the
 * record of whether it reached the end. A null (first page failed) is not
 * recorded: the mount then renders nothing and runs the opening path, which a
 * later heal must not race.
 */
export async function readSessionHistory(
  sessionId: string,
  signal?: AbortSignal,
): Promise<EngineSessionEvent[] | null> {
  const rows = await readSessionEventsForward(sessionId, signal);
  if (rows !== null && !isReadComplete(rows)) sessionsWithUnreadHistory.add(sessionId);
  else sessionsWithUnreadHistory.delete(sessionId);
  return rows;
}

export const hasUnreadHistory = (sessionId: string): boolean =>
  sessionsWithUnreadHistory.has(sessionId);

/** Called by the poll after a read from the watermark that reached the end of the log. */
export const markHistoryRead = (sessionId: string): void => {
  sessionsWithUnreadHistory.delete(sessionId);
};

/** True when a poll read reached the end of the log (an untagged array counts as complete). */
export const readReachedEnd = isReadComplete;
