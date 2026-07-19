/**
 * TAV-S1-ABORT-CLEAR — shared guard for play/[sessionId]/page.tsx's two
 * DM-narration streaming loops (`narrate()` and `subscribeToJob()`).
 *
 * Both loops mirror an in-progress beat into a single shared aria-hidden
 * "streaming row" (`streamRowIdRef`) and both are superseded by aborting the
 * PREVIOUS `AbortController` before starting a new one. When a loop notices
 * `ctrl.signal.aborted` after its own `for await` exits, it must decide
 * whether to clean up the streaming row it was mirroring into:
 *
 *   - If a SUCCESSOR beat already started (the normal supersede path), that
 *     successor already cleared + replaced `streamRowIdRef` with its OWN row
 *     before this aborted loop's check runs — clearing again here would
 *     delete the successor's brand-new row, not this beat's stale one.
 *   - If NO successor ever started (e.g. a future cancel-only caller that
 *     aborts without immediately starting a replacement stream), the ref
 *     still points at THIS beat's own row — leaving it would strand a
 *     dangling aria-hidden row nothing will ever finalize or remove.
 *
 * The distinguishing signal: has `streamRowIdRef.current` (the CURRENT,
 * live value) drifted away from the id this beat itself minted? If it still
 * matches, no successor has claimed it, and it's safe (and necessary) to
 * clear.
 */
export function shouldClearAbortedStreamRow(
  currentRowId: string | null,
  ownRowId: string | null,
): boolean {
  return ownRowId !== null && currentRowId === ownRowId;
}
