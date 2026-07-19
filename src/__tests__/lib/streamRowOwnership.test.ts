/**
 * TAV-S1-ABORT-CLEAR — unit coverage for the ownership guard used by
 * play/[sessionId]/page.tsx's `narrate()` and `subscribeToJob()` to decide
 * whether an aborted beat should clean up its own aria-hidden streaming row.
 *
 * The guard itself is deliberately a pure function (no React/refs) so this
 * exact decision table is directly testable without standing up a full
 * component render + fake SSE generator for every branch.
 */
import { shouldClearAbortedStreamRow } from '@/lib/streamRowOwnership';

describe('shouldClearAbortedStreamRow — TAV-S1-ABORT-CLEAR', () => {
  it('clears when the ref still points at this beat\'s own row (no successor claimed it)', () => {
    expect(shouldClearAbortedStreamRow('row-1', 'row-1')).toBe(true);
  });

  it('does NOT clear when a successor beat already replaced the ref with its own row', () => {
    // The normal supersede path: a new beat's clearStreamNarration + upsert
    // has already moved streamRowIdRef on to a fresh id before this beat's
    // own abort check runs.
    expect(shouldClearAbortedStreamRow('row-2', 'row-1')).toBe(false);
  });

  it('does NOT clear when a successor already cleared the ref down to null', () => {
    expect(shouldClearAbortedStreamRow(null, 'row-1')).toBe(false);
  });

  it('does NOT clear when this beat never created a row of its own (aborted before first chunk)', () => {
    expect(shouldClearAbortedStreamRow('row-1', null)).toBe(false);
    expect(shouldClearAbortedStreamRow(null, null)).toBe(false);
  });
});
