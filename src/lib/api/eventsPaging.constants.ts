/**
 * TAV-EVENTS-FEED-FROZEN-PAST-200 — paging constants for the raw events read.
 * Own module (no imports) so `dnd.ts` and `sessionEventsPaging.ts` can share
 * them without an import cycle, and so they survive tests that mock `dnd.ts`.
 */

/**
 * Rows per request. The engine caps `limit` at 500 (`le=500`).
 *
 * debt: RAW_EVENTS_PAGE_LIMIT is a hand-maintained client mirror of the engine's GET /events `limit` bound (le=500). ceiling: if the engine lowers the cap, every full page reads "short" and the pager's full-page rule ends the read early on a wire with no has_more; if it raises it, pages are smaller than they could be. until: the engine publishes its events page limit as a digest-pinned fixture, or in the response envelope (Backlog TAV-SPACE-KINDS-HAND-MIRROR, same shape).
 */
export const RAW_EVENTS_PAGE_LIMIT = 500;

/** Mount rehydration bound: 100 pages x 500 = 50,000 events. */
export const MOUNT_MAX_PAGES = 100;

/** Poll bound: a tick >5,000 events behind finishes on the next tick. */
export const POLL_MAX_PAGES = 10;
