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
 * A8 carry item (a) / Kage-CR A7 pre-merge ratchet ruling (2026-09-28): the
 * metric `main()` enforces is `countCodeLines`, NOT the raw `wc -l` count
 * above -- `countLines` stays exported (and unit-tested) purely as the
 * `wc -l`-matching primitive several history entries below cite, but it is
 * no longer what the gate measures. Kage's own numbers: page.tsx was 2,028
 * lines of which 949 (47%) were comments/blanks, so a ceiling on the raw
 * count "can be satisfied by deleting explanation and breached by adding
 * it -- inverting the incentive precisely in review fix rounds, which are
 * the rounds where explanation is the deliverable." `countCodeLines` strips
 * `//` and `/* *\/` comments (string/template-literal aware, same technique
 * as `src/__tests__/lib/escapeConsume.source-scan.test.ts`'s own
 * `stripComments`) PLUS whole `{/* ... *\/}` JSX-comment expression
 * containers (their own `{`/`}` are JSX syntax, not comment syntax, so the
 * generic stripper alone leaves a brace-only remnant that a naive
 * `line.trim() === ''` blank-check would not catch), then counts every
 * line that still has non-whitespace content after both strips. See
 * `check-page-line-ratchet.test.ts`'s fixture suite for the exact
 * comments-in / JSX-comments-out / blanks-out / code-in cases this is
 * measured against.
 *
 * Run: npm run lint:page-ratchet (wired into `npm run lint`)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './lib/strip-source-comments.mjs';

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
// XP-escape-guard debt: marker (the 3-overlay guard reading
// outcomeChooserOpen/journalOpen, ~page.tsx:930s at the time -- A8 carry
// item (b) / Kage-CR A7 Suggestion B: cited by FEATURE here, not by line,
// the way the A3/A4 entries above cite features; a hardcoded line number in
// a historical chain drifts every time a later extraction moves the target)
// so its `until:` fits tools/debt-harvest.py's 3-line lookahead uncut -- +5
// comment-only lines,
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
// commit 0, Kage-CR A7 ruling 1: the SAME XP-escape-guard debt: marker
// re-worded (A8 carry item (b) / Suggestion B: cited by feature, not line,
// for the same drift reason as the -> 2173 entry above) -- the stated
// blocker was wrong (ownership, not composition ORDER) and its `until:` had
// fired without discharging the
// debt. Re-word only, no move -- +10 comment-only lines, same
// "deliberate, reviewed, comment-only" category as the +5/+6/+8 entries
// above. Raised, not lowered, and said why, per this file's own rule.) ->
// 2028 (A7 commit 0, Kage-CR A7 IMPORTANT-5: useDrawer's `id` argument
// wired through as a real return value (durable fix, not the delete-the-
// param alternative) -- SessionHead gains a `paneId` prop reading
// journalDrawer.id, +1 line at its call site; the four DOM-id literals
// (both <Drawer id>, the mobile tab's aria-controls, TopBar's own
// aria-controls) all collapsed to read the one hook's return instead of
// independently-typed copies. +1 line, same category as above.) -> 2017
// (A7 pre-merge, Kage-CR ruling on the +11: the 16-line review-provenance
// parenthetical at page.tsx ~936 folded to 5 lines -- its history lives in
// the `-> 2027` entry above and the Reviews note, not in page.tsx. -11
// returns the ceiling to its pre-round value; the `id` wiring's +1 code
// line is kept and absorbed by the fold.)
// -> 946 CODE LINES (A8 carry item (a), Kage-CR A7 pre-merge ratchet ruling:
// "make the ratchet count non-comment, non-blank lines ... filed forward,
// not this round"). The metric itself changes here, not just the number --
// see this file's header and `countCodeLines` below. Re-baseline: page.tsx
// was 2,017 raw (`wc -l`) lines / 946 non-comment, non-blank lines at this
// commit (measured with the SAME `countCodeLines` this ratchet now runs,
// not estimated) -- the two prior raw-line entries immediately above this
// one (2,027 -> 2,028 -> 2,017) are the LAST entries in this chain measured
// in the old unit; every entry from here on is in code lines. No source
// line moved in this commit -- this is a metric swap plus its re-baseline,
// not an extraction.
// -> 898 (A9b commit C2, TAV-PLAY-SHELL step 6b, Amendment B.4/S6): the
// five status-tenant divs (session recap, session paused/ended, turn
// status, dead status, durable-retry row) moved verbatim to
// tenants/StatusAnnouncers.tsx, and the CastSpellPanel group moved
// verbatim to tenants/CastSpellTenant.tsx -- each site in page.tsx is now
// one `<XyzTenant .../>` call instead of the original inline JSX. Net -48
// code lines (the S6 fix banking ratchet headroom ahead of C4's shell
// commit, per the build brief's R-3 risk mitigation). No DOM/behaviour
// change -- every id/class/role/aria attribute is byte-identical.
// Update this value, in the SAME commit, whenever page.tsx's actual
// non-comment, non-blank line count drops below it. Never raise it
// silently -- unless the growth is deliberate and reviewed, in which case
// raise it in the same commit and say why (this file's own rule, restated
// correctly per the A7 pre-merge ratchet ruling: the runbook's "may only go
// down" was a paraphrase that was never this file's actual rule).
export const RATCHET_CEILING = 898;

/**
 * Pure: counts lines the way `wc -l` does (newline-byte count). Exported so
 * tests can check the off-by-one behaviour on strings with/without a
 * trailing newline without touching any file on disk. No longer what
 * `main()` measures (see `countCodeLines` below and this file's header) --
 * kept as the `wc -l`-matching primitive the history chain's raw-line
 * entries above `RATCHET_CEILING` are stated in.
 */
export function countLines(text) {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') count += 1;
  }
  return count;
}

/**
 * Strips every whole `{/* ... *\/}` JSX-comment expression container,
 * replacing it with spaces (newlines preserved so line positions never
 * shift). Matched BEFORE the generic comment stripper below and as its own
 * pass — a JSX comment's `{`/`}` are JSX syntax, not comment syntax, so
 * generic block-comment stripping alone would leave a `{  }` remnant on a
 * line that was semantically ONLY a comment, and a plain `line.trim() ===
 * ''` blank-check would then (wrongly) count that line as code. Matching
 * `{` immediately followed by `/*` (mirroring the reverse at the close) is
 * deliberately narrow: real code that happens to be a bare `{}` block on
 * its own line (e.g. a closing brace) never starts with `/*` inside it, so
 * it is never mistaken for a JSX comment.
 *
 * Known, accepted imprecision (same class of caveat
 * escapeConsume.source-scan.test.ts's own stripComments states for itself:
 * "not a full parser"): a string or template literal containing the exact
 * text `{/* ... *\/}` would be stripped too. This is a lint/ratchet tool,
 * not a security boundary, and no line in page.tsx today contains that
 * substring inside a string — accepted rather than reached for a real
 * parser, per the mirror rule (no new dependency for what a ~10-line regex
 * already does correctly for the file this gate actually runs on).
 */
function stripJsxComments(text) {
  return text.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, (m) => m.replace(/[^\n]/g, ' '));
}

// A8 fix round, Kage-CR IMPORTANT-1 / suggestion (shared lexer): the
// string/template-literal-aware `stripComments` used to be a byte-for-byte
// duplicate of `src/__tests__/lib/escapeConsume.source-scan.test.ts`'s own
// copy. It now lives in `scripts/lib/strip-source-comments.mjs`, imported
// by both, so the `${}`-nesting fix documented there reaches both call
// sites from one place. See that module's header for the fix itself and
// its two documented residual gaps (nested-brace-inside-interpolation,
// regex literals containing `/*`).

/**
 * Pure: the metric `main()` actually enforces (A8 carry item (a)). Strips
 * JSX comments, then `//`/`/* *\/` comments, then counts every line whose
 * trimmed remainder is non-empty — i.e. every line with real code on it,
 * whether or not a comment ALSO shares that line (`const x = 5; // hi`
 * counts; a line that is only a comment, only whitespace, or only the
 * `{}` remnant of a stripped JSX comment does not). See
 * check-page-line-ratchet.test.ts's fixture suite for the four cases this
 * is measured against.
 */
export function countCodeLines(text) {
  const stripped = stripComments(stripJsxComments(text));
  let count = 0;
  for (const line of stripped.split('\n')) {
    if (line.trim() !== '') count += 1;
  }
  return count;
}

/**
 * A8 fix round, Kage-CR IMPORTANT-1(ii): a second, deliberately DUMBER line
 * counter, used only as a fail-closed cross-check against `countCodeLines`
 * (below) — never as the ratchet's own metric. Shares `stripJsxComments`
 * (a narrow, non-fragile regex, not the vulnerable state machine) so an
 * ordinary JSX comment doesn't manufacture a permanent, meaningless
 * divergence between the two counters; past that, it has no string/
 * template/regex awareness at all (only `//`, `/*`, and a leading `*`
 * continuation-line prefix, plus naive single-line-scoped block tracking),
 * so it is fooled by DIFFERENT inputs than `countCodeLines` is: a `//` or
 * `/*` sitting inside a real string is miscounted here but not there, and
 * conversely a nested template or a regex literal containing `/*` is
 * miscounted by `countCodeLines` (see strip-source-comments.mjs's header)
 * but never by this one — this counter re-evaluates a `/*`'s closing
 * marker fresh on every line's own text, so it can never carry a
 * mis-parsed "still inside a string" assumption across lines the way the
 * quote-tracking state machine can. Two independently-wrong-in-different-
 * ways counters landing far apart is the signal that something is
 * actually being misread, without needing to know which one is right.
 */
export function countCodeLinesNaive(text) {
  const jsxStripped = stripJsxComments(text);
  let inBlock = false;
  let count = 0;
  for (const rawLine of jsxStripped.split('\n')) {
    if (inBlock) {
      const closeIdx = rawLine.indexOf('*/');
      if (closeIdx === -1) continue;
      inBlock = false;
      if (rawLine.slice(closeIdx + 2).trim() !== '') count += 1;
      continue;
    }
    const line = rawLine.trim();
    if (line === '' || line.startsWith('//') || line.startsWith('*')) continue;
    if (line.startsWith('/*')) {
      const closeIdx = line.indexOf('*/', 2);
      if (closeIdx === -1) { inBlock = true; continue; }
      if (line.slice(closeIdx + 2).trim() !== '') count += 1;
      continue;
    }
    count += 1;
  }
  return count;
}

// A8 fix round, Kage-CR IMPORTANT-1(ii): on the real page.tsx today the two
// counters read 946 (countCodeLines) vs 946 (countCodeLinesNaive) -- an
// exact match, measured directly with both exported functions, not
// estimated. On a scratch reproduction of Kage's poisoned fixture (the
// nested-template poison plus 60 real lines spliced into a copy of
// page.tsx, see check-page-line-ratchet.test.ts) the two land roughly 60%+
// apart. 5% ("a few percent" per the A8 fix-round instruction) clears
// today's exact-match baseline with real headroom for incidental future
// differences neither lexer resolves the same way (a `//` or a leading `*`
// inside a real string, for example) while staying far below the poison's
// order-of-magnitude-larger gap.
export const DIVERGENCE_TOLERANCE_PERCENT = 5;

/**
 * Pure: IMPORTANT-1(ii)'s fail-closed check. `countCodeLines` and
 * `countCodeLinesNaive` are two different, differently-wrong lexers; if
 * they land far apart, at least one of them has misread this file and the
 * gate should refuse rather than silently trust whichever one `main()`
 * happens to call the "real" metric.
 */
export function evaluateDivergence(smartCount, naiveCount, tolerancePercent = DIVERGENCE_TOLERANCE_PERCENT) {
  const denom = Math.max(smartCount, naiveCount, 1);
  const percent = (Math.abs(smartCount - naiveCount) / denom) * 100;
  if (percent > tolerancePercent) {
    return {
      pass: false,
      message:
        `\n✗ page.tsx ratchet: the two line counters disagree by ` +
        `${percent.toFixed(1)}% (countCodeLines=${smartCount}, ` +
        `countCodeLinesNaive=${naiveCount}), past the ${tolerancePercent}% ` +
        `tolerance.\n\nThis usually means a nested template literal, a ` +
        `regex literal containing "/*", or a similarly unusual construct ` +
        `is fooling one of the two lexers (scripts/lib/strip-source-` +
        `comments.mjs's header documents the known gaps). Refusing rather ` +
        `than trusting a count neither lexer confirms independently.\n`,
    };
  }
  return { pass: true, message: `✓ line counters agree within tolerance (${percent.toFixed(1)}%).` };
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
  // A8 carry item (a): the gate measures countCodeLines (non-comment,
  // non-blank), not the raw wc -l count -- see this file's header.
  const actual = countCodeLines(raw);
  // A8 fix round, Kage-CR IMPORTANT-1(ii): fail closed BEFORE trusting
  // `actual` for the ratchet decision below -- a poisoned nested template
  // or a regex literal containing `/*` can make countCodeLines silently
  // undercount by hundreds of lines (see strip-source-comments.mjs), and a
  // falsely-low count would pass the ratchet AND invite a bad
  // re-baseline. The divergence check runs first and refuses loudly
  // instead.
  const naive = countCodeLinesNaive(raw);
  const divergence = evaluateDivergence(actual, naive);
  if (!divergence.pass) {
    console.error(divergence.message);
    process.exit(1);
  }
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
