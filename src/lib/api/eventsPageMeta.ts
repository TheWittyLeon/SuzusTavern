/**
 * TAV-EVENTS-PAGER-FOLLOWS-WIRE — what the events wire said about a page, carried
 * beside the rows instead of inside them.
 *
 * The engine answers `{ events, max_seq, has_more }`, with `max_seq` / `has_more`
 * computed BEFORE the NekoNova proxy drops `dm_override` rows the caller may not
 * see, so a full engine page can reach the client short. `getSessionEventsRaw`
 * must keep returning a plain `EngineSessionEvent[]` (the recap and several page
 * tests depend on that shape), so the wire's verdict rides in a WeakMap keyed by
 * the returned array. An array from anywhere else (a test mock, an old proxy)
 * has no entry, and the pager falls back to the short-page rule.
 *
 * Own module (no imports of dnd.ts) so it survives tests that mock `dnd.ts`.
 */
import type { EngineSessionEvent } from './types';

export interface EventsPageMeta {
  /** The engine's pre-filter "more rows exist past this page". Absent on a proxy that omits it. */
  hasMore?: boolean;
  /** The engine's pre-filter highest seq on this page. */
  maxSeq?: number;
}

const pageMeta = new WeakMap<EngineSessionEvent[], EventsPageMeta>();

/** Attach the wire's verdict to a page and return the same array. */
export function tagPage(rows: EngineSessionEvent[], meta: EventsPageMeta): EngineSessionEvent[] {
  pageMeta.set(rows, meta);
  return rows;
}

export function pageMetaOf(rows: EngineSessionEvent[]): EventsPageMeta | undefined {
  return pageMeta.get(rows);
}

/**
 * A whole-read result the pager stopped before the end of the log (a later page
 * failed, or the page cap hit). Untagged = complete.
 */
const incompleteReads = new WeakSet<EngineSessionEvent[]>();

export function markIncomplete(rows: EngineSessionEvent[]): EngineSessionEvent[] {
  incompleteReads.add(rows);
  return rows;
}

export function isReadComplete(rows: EngineSessionEvent[]): boolean {
  return !incompleteReads.has(rows);
}
