/**
 * TAV-EVENTS-PAGER-FOLLOWS-WIRE — what the events wire said about a page, and what a
 * whole forward read came to, as typed values.
 *
 * The engine answers `{ events, max_seq, has_more }`, with `max_seq` / `has_more`
 * computed BEFORE the NekoNova proxy drops `dm_override` rows the caller may not
 * see, so a full engine page can reach the client short. `fetchEventsPage` (dnd.ts)
 * returns the verdict beside the rows as an `EventsWirePage`; `pageEventsForward` returns
 * an `EventsRead`. Two channels ride on an array's identity (below): the page verdict
 * of `getSessionEventsRaw` and the partial-read verdict of `getSessionEvents`.
 *
 * Own module (no imports of dnd.ts) so it survives tests that mock `dnd.ts`.
 */
import type { EngineSessionEvent } from './types';

/** One page as the wire answered it. */
export interface EventsWirePage {
  rows: EngineSessionEvent[];
  /** The engine's pre-filter "more rows exist past this page". Absent on a proxy that omits it. */
  hasMore?: boolean;
  /** The engine's pre-filter highest seq on this page. */
  maxSeq?: number;
}

/** Why a forward read stopped before the end of the log. */
export type EventsReadStop = 'later page failed' | 'page cap reached' | 'has_more but the cursor cannot move';

/** The outcome of a whole forward read. */
export interface EventsRead {
  /** Events past the starting cursor, oldest first, each once. */
  rows: EngineSessionEvent[];
  /** False when the read stopped before the end of the log; the rest is still unread. */
  complete: boolean;
  /** The highest seq the read reached (the starting cursor if it read nothing). */
  cursor: number;
  /** Set exactly when `complete` is false. */
  stop?: EventsReadStop;
}

/**
 * The one remaining side channel: `getSessionEventsRaw` must keep returning a plain
 * `EngineSessionEvent[]` (the page tests mock exactly that), and the play screen's
 * reader pages over it, so the page verdict rides on the array's identity here.
 * A `.map` between the reader and the pager drops it and brings back the short-page
 * bug. `getSessionEvents` does not use it: it pages over `fetchEventsPage` directly.
 *
 * debt: the wire's has_more / max_seq reach readSessionEventsResult through a WeakMap keyed by the array getSessionEventsRaw returns. ceiling: any transform of that array between reader and pager silently loses the verdict (short pages end the read again). until: the page tests that mock getSessionEventsRaw as a bare array move to a typed page mock, then the play reader pages over fetchEventsPage and this map is deleted.
 */
const pageMeta = new WeakMap<EngineSessionEvent[], Pick<EventsWirePage, 'hasMore' | 'maxSeq'>>();

/** Attach the wire's verdict to a page's rows and return the same array. */
export function tagPage(page: EventsWirePage): EngineSessionEvent[] {
  pageMeta.set(page.rows, { hasMore: page.hasMore, maxSeq: page.maxSeq });
  return page.rows;
}

/** Recover a page from rows a reader returned (no verdict for an array from anywhere else). */
export function pageOf(rows: EngineSessionEvent[]): EventsWirePage {
  return { rows, ...pageMeta.get(rows) };
}

/**
 * Whether an events array is the PREFIX of a log (a later page failed, or the page cap was hit), as opposed to
 * the whole of it. `getSessionEvents` returns a plain `SessionEvent[]` (113 suites mock it as one), so the verdict
 * rides on the array's identity, like the page verdict above; an array from anywhere else (a mock) reads as whole.
 *
 * debt: the partial-read verdict reaches SessionRecap through a WeakSet keyed by the array getSessionEvents returns. ceiling: any copy or transform of that array between the reader and SessionRecap reads as a whole log again (the recap would generate from a prefix). until: the suites that mock getSessionEvents as a bare array move to a typed read result, then getSessionEvents returns { events, complete } and this set is deleted.
 */
const partialReads = new WeakSet<object>();

/** Mark an events array as a prefix of the log and return the same array. */
export function markPartialRead<T extends object>(events: T): T {
  partialReads.add(events);
  return events;
}

/** True when `events` came from a read that stopped early. */
export const isPartialRead = (events: object): boolean => partialReads.has(events);
