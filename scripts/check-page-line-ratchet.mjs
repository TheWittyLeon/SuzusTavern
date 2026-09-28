#!/usr/bin/env node
/**
 * TAV-PLAY-SHELL-RATCHET-NOT-ENFORCED (P2). Decomposition plan §8 "The
 * concrete rule for R1", item 3: "npm run lint gains one line asserting
 * page.tsx is no longer than the count recorded at the previous step's
 * close. page.tsx may only shrink." This is the gate that makes R14's
 * accepted cost (two tracks touching /play at once, R1 in the risk
 * register) survivable — a concurrent feature PR that adds lines to
 * page.tsx instead of landing in the region/hook that owns them
 * (decomposition plan §8, "The concrete rule for R1", rule 2) fails
 * `npm run lint` immediately, not code review three days later once both
 * branches have moved on.
 *
 * RATCHET_CEILING is a hand-maintained literal — same pattern this repo
 * already uses for SCOPE_GLOBS in check-layout-tokens.mjs and
 * PLAY_PHONE_MAX_WIDTH in breakpoints.ts: whoever lands a commit that
 * shrinks page.tsx lowers this number, in the SAME commit, to the file's
 * new actual line count. Never raise it. If a change genuinely needs to
 * raise it, that need is itself the finding the ratchet exists to catch —
 * extract instead.
 *
 * Line-counting matches `wc -l` (a count of '\n' bytes), the tool every
 * number in the decomposition plan and this task was measured with — NOT
 * `content.split('\n').length`, which overcounts by one on any file ending
 * in a trailing newline (the POSIX norm, and true of page.tsx today).
 *
 * Run: npm run lint:page-ratchet (wired into `npm run lint`)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PAGE_REL = 'src/app/play/[sessionId]/page.tsx';
const PAGE = join(ROOT, PAGE_REL);

// History: 5861 (ratchet's own close, step 4 start) -> 5790 (step 4: killed
// the aria-hidden Offers duplicate) -> 5797 (TAV-PLAY-A11Y-DEADSTATUS-NOT-
// ALWAYS-MOUNTED, +7 lines, justified in that commit) -> 5477 (step 5 hook 1:
// useSessionLifecycle) -> 5485 (+8: two debt: markers) -> 5486 (step 5 hook 2:
// useMyCharacter, net +1) -> 5415 (step 5 hook 3: useSafety extracted --
// state + onRaiseXCard handler + xCardActive derivation moved) -> 5416
// (+1: hook 2's debt: marker was malformed -- "debt:" mid-sentence instead
// of starting its own comment line, so tools/debt-harvest.py silently never
// saw it at all, not even as [no-trigger] -- reflowed onto its own line) ->
// 4577 (step 5 hook 4: useScene extracted -- grounding/checks/transitions
// state, the check-diff/arrival/rescue/outcome-line helpers, openScene, and
// onMoveOn/onAttemptCheck/handleSceneAdvance moved; net -839 despite two new
// ref-mirror sync effects and several exhaustive-deps fixes the extraction
// introduced, same "linter can no longer prove local-ref stability" pattern
// as hook 2's own history entry above) -> 4013 (A2, Amendment A §A.6: step 5
// hook 5 split into useCombatState (state cells + the 4s combat poll + every
// pure derivation off combatState) and useCombatActions (beginEncounter/
// onCombatAction/onEndCombat/the monster auto-driver effect/the turn-change
// refocus effect); net -564, no new ref-mirror -- the existing confirmBeatRef
// ceiling stays at exactly one) -> 4006 (A3 commit 0b, Kage-CR A2
// IMPORTANT-2/IMPORTANT-3: useCombatState exports activeParticipant/
// activeIsMine instead of page.tsx recomputing a byte-identical copy, and
// drops the zero-reader combatStateRef/pollIntervalRef from its return; net
// -7. This commit landed without lowering the ceiling to match -- caught and
// folded into the next entry rather than amended, since 4006 < 4013 the gate
// never actually regressed) -> 3985 (A3, Amendment A §A.2 row 4:
// useTranscript extracted -- log/appendLog/idRef/logRef/lastEventSeqRef/
// renderedSeqsRef/pendingByKeyRef/chatLogRef/streamRowIdRef + the three
// DM-STREAM row writers; composed ABOVE useCombatState/useScene; net -21
// (-47 for the extraction itself, +26 for six exhaustive-deps fixes the
// linter now needs -- chatLogRef/logRef/streamRowIdRef/idRef/
// pendingByKeyRef/setLog moved from page.tsx-local useRef/useState calls,
// which the linter can prove stable, to a hook's destructured return,
// which it can't -- same "linter can no longer prove local-ref stability"
// pattern as hook 2's and hook 4's own history entries above; zero new
// ref-mirror) -> 3984 (A5 commit 0: lint-gate aggregation + Kage-CR A3
// IMPORTANT-1/IMPORTANT-2; net -1, comment-only churn on the mount
// effect's shortcut marker) -> 2848 (A5, Amendment A §A.2 rows 7/9: useNarration
// extracted (narrate/narrateDurable/narrateDurableBeat/subscribeToJob/
// revealText/onRetryFailedTurn/onSendDmNarration + talking/thinking/
// activeJob/jobFailed + refs); useScene split into useSceneState (row 6)
// and useSceneActions (row 9, handleSceneAdvance/onMoveOn/onAttemptCheck);
// confirmBeatRef + its useLayoutEffect deleted -- zero ref-mirrors remain
// in hooks/. Net -1136) -> 2784 (A6, Amendment A §A.2 row 8: useDice
// extracted -- quickChecks/advantage/rollBusy(+ref)/diceRollPollIntervalRef/
// onRoll; composed BELOW useNarration, ABOVE useSceneActions (which now
// takes `advantage` from useDice's destructure, same call-site shape,
// Amendment A §A.3 edge R5, reorder only). The still-inline events poll
// (useSessionEvents territory, A4) keeps writing through
// dice.diceRollPollIntervalRef by the same destructured name -- deliberately
// NOT extracted this commit (see hooks/useDice.ts's own header). Net -64,
// zero new ref-mirror.) -> 2783 (A4 commit 0, Kage-CR A6 IMPORTANT-1/
// IMPORTANT-2: diceRollPollIntervalRef deleted outright (useDice never read
// or wrote it; the still-inline poll now owns a plain effect-local interval
// id instead of a ref) and the 5 stale useScene-attributed provenance
// comments inside the poll's [960,1470] range corrected to useSceneState/
// useSceneActions. Net -1.) -> folded to 2169 (A4, Amendment A §A.2 row 11: the
// unified durable events poll + its flag-OFF legacy sibling extracted into
// `useSessionEvents(sessionId, state, handlers)`, composed LAST (after
// useCombatActions). One named `handlers` object (27 fields: 10 refs, 11
// setters, 6 stable callbacks -- not positional params, per Kage's A6
// MD9 finding that same-shaped positional args survive a tsc-silent swap).
// GROUNDING_INVALIDATING_KINDS/POLL_FAILURE_GRACE_TICKS/
// parseOfferedCheckPayload moved with it (single consumer); scanXCardTracking
// (+ NARRATION_BEAT_KINDS) moved to format.ts instead (the mount effect's
// rehydration branch is a second consumer). Zero sibling-hook imports, zero
// new ref-mirrors -- Kage's own A6 measurement confirmed the poll's 227 code
// lines read zero sibling STATE values, so the handler-callback fan-out
// needed no mirror. Net -614 (the 620-line extraction net of +6 for
// correcting eight stale cross-file "…below"/"…destructure above"
// provenance comments the poll's departure left pointing at nothing, in
// this and sibling hook files), the largest single extraction in the
// series. (A7 carry item (f), Kage-CR A4 Suggestion D / A4b Suggestion E:
// this arrow used to read "-> 2163", which was arithmetically wrong --
// 2783 - 614 = 2169, matching the ceiling this commit actually landed at
// and the RATCHET_CEILING value below. Corrected to "folded to 2169",
// mirroring the A3 entry's own "caught and folded into the next entry"
// precedent above for an intermediate number that never existed as a
// real ceiling.)
// -> 2168 (A7 carry item (a), Kage-CR A4 IMPORTANT-2(ii)/A4b IMPORTANT-3: the
// useSessionEvents poll's capture->setGrounding->diff->refocus sequence (4
// fields: checkWrapRef/setGrounding/diffAndExplainResolvedChecks/
// refocusSceneHeadIfStranded, duplicated on both the durable and flag-OFF
// branches) folded into ONE `onGroundingInvalidated` handler owned by
// useSceneState. Net -1.) -> 2173 (A7 carry item (f): reflowed the
// XP-escape-guard debt: marker at page.tsx:1034 so its `until:` fits
// tools/debt-harvest.py's 3-line lookahead uncut -- +5 comment-only lines,
// same "deliberate, reviewed, comment-only" category as the +6/+8 entries
// above. Raised, not lowered, and said why, per this file's own rule.) ->
// 2017 (A7 proper, decomposition plan §2.2 §1.8/§1.9/§1.13: `useDrawer` x2
// (`useMemberSheetDrawer`/`useJournalDrawer`, plan §1.8/§1.9) +
// `useFocusAnchors` (§1.13) extracted -- journalEvents/journalOpen/
// journalSeenSeqsRef/journalCloseBtnRef + memberSheetOpen/
// selectedMemberSheet/-Name/-IsSelf/memberSheetLoading/-Error/
// memberSheetCloseBtnRef + their close/onSelectMember handlers all moved
// off page.tsx-local state into the two drawer hooks (also discharging A7
// carry item (b)'s debt -- journalSeenSeqsRef/setJournalEvents now have an
// owning hook; the marker recording that debt is deleted in the follow-up,
// Kage-CR A7 ruling 2); endCombatBtnRef/
// lastOpenerRef/beginCombatRef/composerRailAnchorRef/dmPanelAnchorRef + the
// death-save-row and begin-encounter-button stranding-rescue effects + the
// begin-encounter rising-edge toast moved into useFocusAnchors. Zero new
// ref-mirrors, zero DOM/behaviour change (every identifier keeps its
// pre-extraction name at every JSX call site). Net -156.) -> 2027 (A7
// commit 0, Kage-CR A7 ruling 1: the XP-escape-guard debt: marker at
// page.tsx:931 re-worded -- the stated blocker was wrong (ownership, not
// composition ORDER) and its `until:` had fired without discharging the
// debt. Re-word only, no move -- +10 comment-only lines, same
// "deliberate, reviewed, comment-only" category as the +5/+6/+8 entries
// above. Raised, not lowered, and said why, per this file's own rule.)
// Update this value, in the SAME commit, whenever page.tsx's actual line
// count drops below it. Never raise it silently.
export const RATCHET_CEILING = 2027;

/**
 * Pure: counts lines the way `wc -l` does (newline-byte count). Exported so
 * tests can check the off-by-one behaviour on strings with/without a
 * trailing newline without touching any file on disk.
 */
export function countLines(text) {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') count += 1;
  }
  return count;
}

/**
 * Pure: the ratchet's actual decision, isolated from process.exit / stdio
 * so it can be unit-tested directly (mutation-verification: feed it a
 * count above the ceiling and assert it reports failure, without ever
 * writing to page.tsx — a 5,861-line file imported by the majority of the
 * /play suite, which is exactly the kind of shared-file mutation
 * b8de6ea's maxWorkers cap exists to keep out of the flake budget).
 */
export function evaluateRatchet(actualLines, ceiling = RATCHET_CEILING) {
  if (actualLines > ceiling) {
    return {
      pass: false,
      message:
        `\n✗ page.tsx ratchet: ${actualLines} lines, ceiling is ${ceiling}.\n\n` +
        `${PAGE_REL} grew by ${actualLines - ceiling} line(s).\n` +
        `TAV-PLAY-SHELL's extraction track owns this file; feature work on\n` +
        `/play lands in the region or hook that owns it, never in page.tsx\n` +
        `directly (decomposition plan §8, "The concrete rule for R1", rule 2).\n` +
        `Extract instead of adding here. If this growth is a deliberate,\n` +
        `reviewed part of the extraction itself, raise RATCHET_CEILING in\n` +
        `scripts/check-page-line-ratchet.mjs in the same commit and say why.\n`,
    };
  }
  if (actualLines < ceiling) {
    return {
      pass: true,
      message:
        `✓ page.tsx ratchet: ${actualLines} lines (ceiling ${ceiling}, ` +
        `${ceiling - actualLines} line(s) of headroom). Lower RATCHET_CEILING ` +
        `to ${actualLines} in the commit that earned the shrink so the ratchet holds it.`,
    };
  }
  return { pass: true, message: `✓ page.tsx ratchet: ${actualLines} lines, at ceiling.` };
}

function main() {
  const raw = readFileSync(PAGE, 'utf8');
  const actual = countLines(raw);
  const { pass, message } = evaluateRatchet(actual, RATCHET_CEILING);
  if (pass) {
    console.log(message);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}

// Only run as a script (not when imported by the regression test below).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
