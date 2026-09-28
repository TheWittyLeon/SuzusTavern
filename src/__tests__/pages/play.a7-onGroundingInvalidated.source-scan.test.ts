/**
 * A7 carry item (a) / Kage-CR A4b Suggestion A — `useSceneState`'s
 * `onGroundingInvalidated` folds the Tora-Gesture CRITICAL-1 rescue
 * (capture whether focus is inside the check-affordance group, THEN
 * setGrounding, THEN diff, THEN refocus-if-stranded) into one definition.
 * The order is load-bearing: the capture must happen BEFORE `setGrounding`
 * replaces the grounding that may unmount the very check the user has
 * focus on.
 *
 * This CANNOT be pinned by a real-DOM/RTL integration test — Kage-CR
 * measured this directly (A4b Suggestion A, probe D): moving the capture to
 * AFTER `setGrounding(g)` SURVIVED the entire corpus, because React 18
 * batches the state update and the DOM doesn't actually change mid-callback
 * either way. A source-order guard is the only mechanism that actually
 * distinguishes the two orderings — same shape as
 * `src/__tests__/lib/escapeConsume.source-scan.test.ts`, which this mirrors.
 */
import fs from 'node:fs';
import path from 'node:path';

const REL_PATH = 'src/app/play/[sessionId]/hooks/useSceneState.ts';

function readSource(): string {
  return fs.readFileSync(path.join(process.cwd(), REL_PATH), 'utf8');
}

/** Strips `//` line comments so a comment mentioning `setGrounding(` before
 * the real call can't produce a false pass. Not a full parser — good enough
 * for this file, which has no `//` inside a string/template on these lines. */
function stripLineComments(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

describe('A7 carry item (a) — onGroundingInvalidated captures focus BEFORE setGrounding, in source order', () => {
  it('the checkWrapRef.contains(document.activeElement) capture textually precedes setGrounding( inside onGroundingInvalidated', () => {
    const stripped = stripLineComments(readSource());

    const fnStart = stripped.indexOf('const onGroundingInvalidated = useCallback(');
    expect(fnStart).toBeGreaterThan(-1);

    // A8 carry item (b) / Kage-CR A7 Suggestion A (tightening #1): the
    // window used to run to the HOOK's own `return {` (195 lines — Kage
    // measured it), not the callback's own deps-array close. Narrowed to
    // match the comment's own claim: the function body ends at its
    // `useCallback` deps array, `[diffAndExplainResolvedChecks,
    // refocusSceneHeadIfStranded]`.
    const DEPS_CLOSE = '[diffAndExplainResolvedChecks, refocusSceneHeadIfStranded]';
    const depsCloseIdx = stripped.indexOf(DEPS_CLOSE, fnStart);
    expect(depsCloseIdx).toBeGreaterThan(fnStart);
    const windowEnd = depsCloseIdx + DEPS_CLOSE.length;
    const body = stripped.slice(fnStart, windowEnd);

    // A8 carry item (b) / Kage-CR A7 Suggestion A (tightening #2): assert
    // the capture reads off `checkWrapRef` SPECIFICALLY, not just any
    // `.contains(document.activeElement)` — the bare substring would also
    // match a swap-in of `transitionWrapRef` or `freeformCheckRef`.
    const CAPTURE = 'checkWrapRef.current?.contains(document.activeElement)';
    const captureIdx = body.indexOf(CAPTURE);
    const setGroundingIdx = body.indexOf('setGrounding(g)');
    const diffIdx = body.indexOf('diffAndExplainResolvedChecks(g)');
    const refocusIdx = body.indexOf('refocusSceneHeadIfStranded(hadFocusInCheckWrap)');

    expect(captureIdx).toBeGreaterThan(-1);
    expect(setGroundingIdx).toBeGreaterThan(-1);
    expect(diffIdx).toBeGreaterThan(-1);
    expect(refocusIdx).toBeGreaterThan(-1);

    // LOAD-BEARING ORDER — capture first, then the state update, then the
    // diff, then the refocus rescue. A reorder here reintroduces exactly the
    // hazard Tora-Gesture CRITICAL-1 fixed, silently, since no real-DOM test
    // can observe it (see this file's header).
    expect(captureIdx).toBeLessThan(setGroundingIdx);
    expect(setGroundingIdx).toBeLessThan(diffIdx);
    expect(diffIdx).toBeLessThan(refocusIdx);
  });
});
