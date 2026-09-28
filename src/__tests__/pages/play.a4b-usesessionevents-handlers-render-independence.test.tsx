/**
 * A4b item 5 (Kage-CR A4 IMPORTANT-1, 2026-09-28) — render-independence pin.
 *
 * `useSessionEvents` now destructures `handlers` into locals at the top of
 * the hook body and depends on the individual (stable) fields, never on
 * `handlers` itself, so the effect's own closing comment can state the
 * hazard is structurally impossible rather than comment-guarded: there is
 * no `handlers` identifier left in the effect body for a future edit to
 * add to the deps array via "satisfy what eslint asks for". But
 * `react-hooks/exhaustive-deps` only checks for MISSING dependencies, not
 * unnecessary ones — nothing stops a future edit from manually re-adding
 * `handlers` to the array out of habit, and `npx eslint` stays silent if it
 * does (confirmed: re-adding it produces zero lint warnings). This is
 * Kage's own suggested closing move (c) for IMPORTANT-1 — "a
 * render-independence pin... force a re-render... and assert the fetch
 * count still increments" — turning that verification into a permanent
 * regression test rather than a one-time check.
 *
 * `useSessionEvents` is driven directly (not through a full `PlayPage`
 * render) with a `handlers` prop matching page.tsx's own call-site shape
 * exactly: a FRESH object literal every render (the spread) wrapping
 * FIELD VALUES that never change identity — precisely what every real
 * caller already guarantees (`useState` setters, `[]`-stable
 * `useCallback`s, `useRef` objects). A naive fake that fabricates new
 * `jest.fn()`/`{ current }` values on every render would churn regardless
 * of this fix and prove nothing — the harness below creates the field
 * values ONCE.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { useSessionEvents } from '@/app/play/[sessionId]/hooks/useSessionEvents';
import type { UseSessionEventsHandlers } from '@/app/play/[sessionId]/hooks/useSessionEvents';

jest.mock('../../lib/config', () => ({
  DURABLE_GENERATION_ENABLED: false,
}));
jest.mock('../../lib/api/dnd', () => ({
  getSessionEventsRaw: jest.fn(() => Promise.resolve([])),
  getSessionEventsPage: jest.fn(() =>
    Promise.resolve({ events: [], max_seq: 0, has_more: false, pending_generation: null }),
  ),
  getGrounding: jest.fn(() => Promise.resolve(null)),
}));

function makeHandlers(): UseSessionEventsHandlers {
  return {
    lastEventSeqRef: { current: 0 },
    renderedSeqsRef: { current: new Set() },
    pendingByKeyRef: { current: new Map() },
    logRef: { current: [] },
    setLog: jest.fn(),
    appendLog: jest.fn(),
    clearStreamNarration: jest.fn(),
    checkWrapRef: { current: null },
    setGrounding: jest.fn(),
    diffAndExplainResolvedChecks: jest.fn(),
    refocusSceneHeadIfStranded: jest.fn(),
    applyOfferedCheckSignal: jest.fn(),
    setOfferedCheckSkill: jest.fn(),
    setFreeformOfferedCheck: jest.fn(),
    setActiveJob: jest.fn(),
    setJobFailed: jest.fn(),
    onTurnSettled: jest.fn(),
    subscribedJobIdRef: { current: null },
    turnKeyRef: { current: null },
    pollFailureGraceRef: { current: null },
    narrationAbort: { current: null },
    subscribeToJob: jest.fn(() => Promise.resolve()),
    setXCardEvent: jest.fn(),
    setLatestNarrationSeq: jest.fn(),
    journalSeenSeqsRef: { current: new Set() },
    setJournalEvents: jest.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as UseSessionEventsHandlers;
}

// Created ONCE — stable field identities, matching every real caller
// (useState setters / []-stable useCallbacks never change reference across
// renders; a MutableRefObject is stable by construction).
const stableHandlerFields = makeHandlers();

function Harness({ n }: { n: number }) {
  // A fresh object literal every render (the spread) wrapping the SAME
  // stable field values — exactly page.tsx's own
  // `useSessionEvents(sessionId, state, { ...fields })` call-site shape.
  useSessionEvents('s1', 'ok', { ...stableHandlerFields });
  return <div>{n}</div>;
}

describe('useSessionEvents — render-independence (Kage-CR A4 IMPORTANT-1)', () => {
  it('the poll interval is created ONCE across 10 re-renders with stable handler fields', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    const { rerender, unmount } = render(<Harness n={0} />);
    for (let i = 1; i <= 10; i++) {
      rerender(<Harness n={i} />);
    }

    // THE ASSERTION UNDER TEST — a fresh `handlers` object literal every
    // render must NOT tear the interval down and recreate it. Exactly one
    // setInterval call for the whole 11-render sequence (mount + 10
    // re-renders), zero clearInterval calls before unmount.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).not.toHaveBeenCalled();

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});
