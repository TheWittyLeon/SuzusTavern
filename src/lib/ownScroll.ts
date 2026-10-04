/**
 * B8c-4 fix round 3 (Kage re-review, the `decide()` retry): a scroll the PAGE makes by itself (the story log's stick-to-bottom while narration streams, the shell's scroll restore after a slot moves) is
 * not the user's, and the fold's quiet period ("nothing is decided within 150 ms of the last scroll") must not count it, or a decision and the automatic scroll wait for as long as the log is being pinned.
 * The code that scrolls marks the element first; the one capture listener that stamps the quiet period asks. Per element and time-boxed: a user's flick on ANOTHER scroller is still heard, and so is
 * the user's own scroll on this one once the mark has expired.
 */
const until = new WeakMap<EventTarget, number>();

/** Mark `el` as being scrolled by the page for the next `ms` (a smooth scroll lasts longer than an instant one). */
export function markOwnScroll(el: EventTarget | null | undefined, ms = 150): void {
  if (el) until.set(el, Math.max(until.get(el) ?? 0, Date.now() + ms));
}

/** Is a scroll event on `target` the page's own? */
export function isOwnScroll(target: EventTarget | null): boolean {
  return target !== null && (until.get(target) ?? 0) > Date.now();
}
