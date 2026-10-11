/**
 * TAV-EVENTS-FEED-FROZEN-PAST-200 — paging constants for the raw events read.
 * Own module (no imports) so `dnd.ts` and `sessionEventsPaging.ts` can share
 * them without an import cycle, and so they survive tests that mock `dnd.ts`.
 */

/** Rows per request. The engine caps `limit` at 500 (`le=500`). */
export const RAW_EVENTS_PAGE_LIMIT = 500;

/** Mount rehydration bound: 100 pages x 500 = 50,000 events. */
export const MOUNT_MAX_PAGES = 100;

/** Poll bound: a tick >5,000 events behind finishes on the next tick. */
export const POLL_MAX_PAGES = 10;
