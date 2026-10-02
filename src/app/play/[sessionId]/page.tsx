'use client';
/**
 * Play session — /play/[sessionId] (ST-060–065, ST-071, ST-062 / CUI-11/12 / ADV-7T/8).
 *
 * The immersive 3-pane table where Suzu runs the game:
 *   left   — party roster (ST-061) + initiative (ST-020 / CUI-11)
 *   centre — narrator strip (ST-018/071) + chat log (ST-019) + composer (ST-063)
 *   right  — scene card + skill-check affordance (P1-PLAYFIX §3.3.3) +
 *            "Move on" affordance (ADV-7T) + dice tray + safety tools
 *
 * State machine: idle → composing → narrating → idle, with a combat overlay.
 *
 * ADV-7/8 (CUI-11/12):
 *   - Holds ONE `combatState` (CombatState | null) as source of truth.
 *   - Polls GET /api/dnd/combat/{id}/state every 4s while active + foregrounded.
 *   - Every mutating combat call replaces combatState from the response's data.state.
 *   - Initiative tracker and target picker read from combatState.participants.
 *   - Attack sends target_id (participant_id) alongside the name fallback.
 *   - On scene_advance: refetch grounding + surface the scene transition beat.
 *   - "Move on" button: shown when grounding has a valid non-encounter-gated transition.
 *   - Refused actions (400 + data.reason): surface to user; refresh from data.state.
 *
 * Poll guard: interval pauses on document.hidden, clears on unmount.
 * Request-monotone guard: combatState updates are fenced by a seqRef so stale
 * in-flight polls never overwrite a fresher mutation response.
 *
 * DDX-25 R2 (D1): a second, independent poll (same cadence/guards) refetches
 * session status (active/paused/ended) so a pause/resume/end by the DM
 * converges on every open tab, not just the one that performed it. No
 * seqRef-style monotone guard needed there — see the poll's own comment.
 *
 * DDX-25 R3: that poll now skips setSession() on a no-op tick (fetched
 * snapshot structurally equal to current state, via sessionsEqual()) so
 * `session` keeps a STABLE object identity across ticks with nothing new to
 * report. A downstream consumer (SessionRecap) was keying an LLM-backed
 * "previously on" narration call off session-object identity and re-firing
 * it every ~4s indefinitely — see the poll's own comment and SessionRecap.tsx.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useAuthGate } from '@/lib/auth/useAuthGate';
import { useToast } from '@/components/Toast';
import { sessionTitle } from '@/lib/format';
import {
  getCombatState,
  getCharacterSheet,
  getGrounding,
  getParticipants,
  getSession,
  getSessionEventsRaw,
} from '@/lib/api/dnd';
import { eventToLogRow, formatEventTimestamp as formatOpeningTimestamp } from '@/lib/rehydration';
import { matchCombatIntent, matchKeywordIntent } from '@/lib/dnd/intentFastPath';
import { DURABLE_GENERATION_ENABLED } from '@/lib/config';
import type { Participant } from '@/lib/api/types';
import type { QuickCheck } from '@/components/DiceTray';
import Pill from '@/components/Pill';
import PageSkeleton from '@/components/PageSkeleton';
import { type LogRow } from '@/components/ChatLog';
import DiceTray from '@/components/DiceTray';
import Composer, { type ComposeMode } from '@/components/Composer';
import ActionBar from './regions/ActionBar';
import ConfirmDialog from '@/components/ConfirmDialog';
import Drawer from '@/components/Drawer';
import SafetyBanner from './regions/SafetyBanner';
import { SessionControls, DmCombatControls } from './regions/TableControls';
import PartyStrip from './regions/PartyStrip';
import SceneStage from './regions/SceneStage';
import Offers from './regions/Offers';
import StoryLog from './regions/StoryLog';
import TopBar from './regions/TopBar';
import SuzuPresence from './regions/SuzuPresence';
import PlayShell from './PlayShell';
import { FOLD_SPECS } from './foldSpecs';
import { getPlacement, variantFor, type Moment, type RegionId, type TenantId } from './presets';
import {
  buildReadAloudBlock,
  deathSaveTally,
  groundingCreatureNames,
  isCombatEncounterUnstarted,
  isSessionDm,
  scanXCardTracking,
} from './format';
import { useSessionLifecycle } from './hooks/useSessionLifecycle';
import { useMyCharacter } from './hooks/useMyCharacter';
import { useRebindRefresh } from './hooks/useRebindRefresh';
import { useSafety } from './hooks/useSafety';
import { useTranscript } from './hooks/useTranscript';
import { useCombatState } from './hooks/useCombatState';
import { useSceneState } from './hooks/useSceneState';
import { useNarration } from './hooks/useNarration';
import { useDice } from './hooks/useDice';
import { useSceneActions } from './hooks/useSceneActions';
import { useCombatActions } from './hooks/useCombatActions';
import { useSessionEvents } from './hooks/useSessionEvents';
import { useMemberSheetDrawer } from './hooks/useMemberSheetDrawer';
import { useJournalDrawer } from './hooks/useJournalDrawer';
import { useFocusAnchors } from './hooks/useFocusAnchors';
import { usePlayLayout } from './hooks/usePlayLayout';
import { useRegionFolds } from './hooks/useRegionFolds';
import JournalPane, { JOURNAL_HEADING_ID } from '@/components/JournalPane';
import MemberSheetPanel, { MEMBER_SHEET_HEADING_ID } from '@/components/MemberSheetPanel';
import NextPartOffer from '@/components/NextPartOffer';
import TweaksPanel from '@/components/TweaksPanel';
import {
  SessionRecapTenant,
  SessionPausedEndedTenant,
  TurnStatusTenant,
  DeadStatusTenant,
  DurableRetryRowTenant,
} from './tenants/StatusAnnouncers';
import CastSpellTenant from './tenants/CastSpellTenant';
import SafetyControls from './tenants/SafetyControls';
import styles from './Play.module.css';

/**
 * A2 — preferred quick-check skill names shown in the dice tray.
 * These are surfaced when the bound character's sheet includes them; we pick
 * the four most-used out-of-combat checks. Snake_case matches the engine's
 * `skills[].name` format (the display name is title-cased from the sheet).
 */
const PREFERRED_QUICK_CHECK_NAMES = [
  'perception',
  'stealth',
  'investigation',
  'persuasion',
];

/**
 * Check Retry + Fail-Forward (2026-07-28 design section 7.1) — human-facing
 * copy for a locked check's sr-only reason span. Keyed by `SceneCheck.lock_reason`;
 * an unrecognised/absent reason falls back to the max_attempts line, same
 * fallback convention as the engine's own `complication_line`.
 */
// CHECK_LOCK_REASON_COPY moved to regions/Offers.tsx (TAV-PLAY-SHELL step 3)
// — its only consumer.

// POLL_FAILURE_GRACE_TICKS/GROUNDING_INVALIDATING_KINDS/parseOfferedCheckPayload
// moved into hooks/useSessionEvents.ts (TAV-PLAY-SHELL step 5 hook 11,
// Amendment A §A.2 row 11, A4) -- the poll was their only reader. scanXCardTracking
// (+ its NARRATION_BEAT_KINDS constant) moved to ./format.ts instead, not
// into the hook -- this file's own mount-effect rehydration branch still
// calls it too, so it can't live in either single-consumer file (same
// "shared by two files" reason as buildReadAloudBlock/isSessionLocked below).

// nowStamp moved to ./format.ts (TAV-PLAY-SHELL A3, useTranscript's own
// reason — see that file's header) -- shared by useTranscript's writers and
// useNarration's narrate()/narrateDurable()/onSendDmNarration (A5). No
// remaining reader in this file -- not imported here.

// buildReadAloudBlock moved to ./format.ts (TAV-PLAY-SHELL step 5 hook 4,
// same Kage-CR C2 reason as titleCaseSkill below) — useScene's `openScene`
// needs it and this file's own mount-effect rehydration branch still does
// too, so it can't live in either file alone.

// titleCaseSkill moved to ./format.ts (Kage-CR C2, 2026-09-21 review) — a
// leaf region importing it from here was a circular/upward dependency.

/**
 * TAV-COMBAT-VERB-NO-MECHANICS — render the scene's creature names into the
 * refusal line ("The Timberwolf", "A goblin and a wolf"). Deduped and capped
 * at three so a crowded encounter doesn't produce a sentence-long subject;
 * the overflow reads "and 2 others" rather than being silently dropped.
 * Names are the engine's authored display names, used verbatim.
 */
function listCreatureNames(names: readonly string[]): string {
  const uniq = [...new Set(names)];
  const shown = uniq.slice(0, 3);
  const rest = uniq.length - shown.length;
  const parts = rest > 0 ? [...shown, `${rest} other${rest === 1 ? '' : 's'}`] : shown;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// isSessionLocked moved to ./format.ts (TAV-PLAY-SHELL step 5 hook 4, same
// Kage-CR C2 reason as titleCaseSkill above) — useSceneActions' onMoveOn/
// onAttemptCheck, useDice's onRoll (A6) and useCombatActions' monster
// auto-driver (A2) each import it directly from format.ts now; page.tsx
// itself has no remaining direct caller.

export default function PlayPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : '';
  const { user } = useAuth();
  const username = user?.username ?? null;
  const { toast } = useToast();
  // reduced (useReducedMotion) moved into useNarration (A5) -- its one
  // consumer, revealText's fake-typewriter, moved with it. See that hook's
  // header.

  // TAV-PLAY-SHELL step 5, hook 1 of ~9 (decomposition plan §2.2): session
  // lifecycle (session/participants/page-load state, DM session controls,
  // the session-status poll, and every value/handler derived purely from
  // session/username) now lives in useSessionLifecycle. Same identifiers as
  // before, still destructured here -- every downstream reference in this
  // file (JSX, other effects/handlers) is unchanged.
  const {
    session, setSession, participants, setParticipants, state, setState,
    sessionActionBusy, endSessionConfirmOpen, setEndSessionConfirmOpen,
    xpFormOpen, setXpFormOpen, xpAmount, setXpAmount, xpReason, setXpReason,
    xpAmountValid, xpToggleBtnRef,
    // aiLevel is intentionally NOT destructured here -- nothing in page.tsx
    // reads the bare value (only aiOff, derived from it inside the hook).
    // It stays part of the hook's return (decomposition plan §2.2 lists it
    // as one of this hook's "crosses out" values) for useNarration/useCombat
    // to read once THEY are extracted and can consume it from context
    // instead of each re-deriving session.ai_assist_level locally (the
    // three still-local `const aiLevel = session.ai_assist_level` reads
    // inside narrate()/narrateDurable()/narrateDurableBeat() below are
    // that future work's extraction target, unrelated to this destructure).
    isDm, isHumanDM, isPaused, isEnded, sessionLocked, aiOff,
    refreshSessionAfterAction, onTogglePause, onConfirmEndSession, onAwardXp,
  } = useSessionLifecycle(sessionId);

  // TAV-PLAY-SHELL step 5, hook 2 of ~9: the bound character's id + sheet.
  // Still-thin hook (state only, see its own file) -- every setter call
  // site (mount effect, rebind handler, CastSpellPanel's onSheetChanged)
  // stays in page.tsx unchanged, same identifiers via destructuring.
  const { myCharacterIdStr, setMyCharacterIdStr, mySheet, setMySheet, noCharToastFiredRef } =
    useMyCharacter();
  const onRebindChanged = useRebindRefresh({ sessionId, username, setParticipants, setMyCharacterIdStr, setMySheet });

  // TAV-PLAY-SHELL step 5, hook 3 of ~9: the DDX-26 X-card safety signal.
  // The unified events poll's several setXCardEvent/setLatestNarrationSeq
  // calls now live in `useSessionEvents` (A4), reading these same setters
  // as plain `handlers` fields. The SafetyBanner JSX + its inline onDismiss
  // handler (render only) stay in page.tsx, reading these same identifiers
  // via destructuring. latestNarrationSeq/dismissedXCardSeq
  // (the bare VALUES) are intentionally NOT destructured -- page.tsx only
  // ever needed their setters plus xCardActive, which the hook already
  // derives from them internally; both stay in the hook's return type for
  // API-pairing consistency with their setters (aiLevel's precedent, hook 1).
  const {
    xCardEvent, setXCardEvent, setLatestNarrationSeq,
    setDismissedXCardSeq, xCardBusy, xCardBannerRef,
    xCardActive, onRaiseXCard,
  } = useSafety(session);

  // TAV-PLAY-SHELL step 5, hook 4 of ~9 (decomposition plan §2.2, amended by
  // Amendment A §A.2 row 4): the transcript -- log/appendLog + the durable-
  // poll ledgers (lastEventSeqRef/renderedSeqsRef/pendingByKeyRef) +
  // idRef/logRef + the DM-STREAM row writers
  // (upsertStreamNarration/clearStreamNarration/finalizeStreamNarration).
  // Composed ABOVE useCombatState/useSceneState (rows 5/6) per Amendment A
  // -- see hooks/useTranscript.ts's own header for the full scope and the
  // signature deviation from §2.2's abridged useTranscript(sessionId).
  // useSceneState's appendLog parameter and useSceneActions' appendLog/
  // renderedSeqsRef parameters are unchanged in shape (Amendment A §A.3
  // edges R3/R4, both "reorder only") -- they just read from this hook's
  // return now instead of a page.tsx-local useState/useRef.
  // `transcript` (the hook's own return object) is kept alongside the
  // destructure below -- useNarration takes it as one bundle (A5; same
  // "many fields, one hook" shape `combatStateResult` already uses for
  // useCombatActions below).
  const transcript = useTranscript();
  const {
    log, setLog, appendLog, logRef, lastEventSeqRef, renderedSeqsRef,
    pendingByKeyRef, clearStreamNarration,
  } = transcript;

  // TAV-NARRATION-DECOUPLE (2026-07-25): `narratorText` used to feed the top
  // NarratorStrip with the live-streaming narration; removed when the strip
  // was repurposed to a scene/combat status banner (ChatLog's
  // upsertStreamNarration/finalizeStreamNarration is now the SOLE live
  // narration surface — see useNarration.ts's subscribeToJob/narrate()/
  // revealText).
  // talking/thinking moved into useNarration (TAV-PLAY-SHELL step 5 hook 7,
  // Amendment A §A.2 row 7, A5) -- see that hook's destructure above.

  const [msg, setMsg] = useState('');
  const [mode, setMode] = useState<ComposeMode>('say');
  // S5.2: pending/error state for DM narration submission.
  const [dmNarrationPending, setDmNarrationPending] = useState(false);
  const [dmNarrationError, setDmNarrationError] = useState<string | null>(null);
  // S5.2: latch — we snap the composer mode to dm_narration exactly ONCE, on the
  // first session load, and never again (sessionId is fixed for the page's life,
  // so there is no "next session" here). Must NOT key on the session object
  // reference: refreshSessionAfterAction / the 4s poll install fresh Session
  // objects on routine refetches, and re-firing would clobber a human DM who has
  // manually switched the composer to OOC (Kage-CR). See the render-time
  // adjustment below.
  const [modeSynced, setModeSynced] = useState(false);
  // advantage moved into useDice (TAV-PLAY-SHELL step 5 hook 8, Amendment A
  // §A.2 row 8, A6) -- see that hook's destructure below.

  // TAV-PLAY-SHELL step 5, A7: the journal drawer (plan §1.9). Owns
  // journalEvents/journalSeenSeqsRef (A7 carry item (b) -- resolves the
  // `debt:` marker on useSessionEvents.ts's own handlers interface),
  // open/closeButtonRef (via useDrawer), and the close handler
  // -- see that hook's own header for the full DDX-22 scope. A9d E4: one
  // presentation at every width, no parameters.
  const journalDrawer = useJournalDrawer();

  // Iro MEDIUM-2: persistent turn-status text so one mounted live region mutates
  // in place instead of two regions mounting/unmounting on every poll cycle.

  // grounding/sceneAdvanceBusy/adventureComplete/completionSeries/checkBusy/
  // offeredCheckSkill/freeformOfferedCheck moved into useScene (TAV-PLAY-SHELL
  // step 5 hook 4) -- see the useScene() call below, right after appendLog.

  // TAV-PLAY-SHELL step 5, A7: the member-sheet drawer (plan §1.8).
  // TAV-PARTY-INLINE-SHEET: clicking a party card used to navigate to
  // /character/[id], reloading the whole session — this instead opens the
  // selected member's sheet in an inline drawer (mirrors the Journal drawer
  // above: always-mounted <aside>, scrim, focus-trap, Esc via
  // consumeEscape). The fetched sheet + the clicked row's display name
  // persist across a close (only cleared on the NEXT selection) so the
  // slide-out transition has a "from" state to animate, exactly like the
  // journal drawer's own events. See that hook's own header for the full
  // scope (selectedMemberSheet/-Name/-IsSelf/-Loading/-Error,
  // onSelectMember, onClose).
  // (called below, after `usePlayLayout` -- it needs the resolved `characterBlock`
  // placement; A9b fix round 1.)

  // TAV-PLAY-SHELL step 5, hook 5a of ~9 (decomposition plan §2.2, amended by
  // Amendment A §A.2 row 5 / §A.6): combat's state half. Composed ABOVE
  // useScene so useScene can take combatEngaged as a plain downward
  // parameter (Amendment A §A.1) -- see hooks/useCombatState.ts for the full
  // scope. Same identifiers as before, still destructured here -- every
  // downstream reference in this file (JSX, other effects/handlers) is
  // unchanged. `combatStateResult` (the hook's own return object) is kept
  // too -- useCombatActions below takes it as one bundled parameter rather
  // than ten more positional ones (documented deviation, see that hook's
  // header).
  const combatStateResult = useCombatState(myCharacterIdStr, participants, username);
  // setRefusedReason/combatBusyRef/monsterDrivingRef are NOT destructured
  // here -- page.tsx never calls them directly (only useCombatActions does,
  // via `combatStateResult` above). combatStateRef/pollIntervalRef are no
  // longer part of the hook's return at all (Kage-CR A2 IMPORTANT-3) --
  // both were declared-with-zero-readers outside useCombatState's own file;
  // they now stay fully internal to that hook. stateSeqRef IS still
  // destructured: the mount effect's initial combat fetch and the inline
  // onCombatStateUpdate/onCombatStateRefresh/onStateRefresh JSX handlers
  // below all bump it directly.
  const {
    combatId, setCombatId, combatState, setCombatState, combatBusy, setCombatBusy,
    refusedReason, outcomeChooserOpen, setOutcomeChooserOpen, stateSeqRef,
    combatEngaged, combatIsActive, round, targetableFoes, activeParticipant,
    activeIsMine, isPlayerTurn, isDying, anyMonsterDown, allHostilesDown, selfPcId,
  } = combatStateResult;

  // quickChecks (A2 — real quick-checks derived from the bound character's
  // sheet; null = not yet resolved, [] = DM-only/fetch failed) moved into
  // useDice (TAV-PLAY-SHELL step 5 hook 8, A6) -- see that hook's
  // destructure below. This file's mount effect still BUILDS the value
  // (the sheet fetch stays here, same as setGrounding/setMySheet), it just
  // writes through useDice's setQuickChecks now instead of a page.tsx-local
  // useState.

  // openingFiredRef moved into useScene (owns checkShouldOpen/openScene, its
  // only reader/writer).

  // PLAY-PERSIST §7: guards against a second rehydration within one mount
  // (e.g. a stray effect re-run). Rehydration runs once, synchronously before
  // the composer can be used, so a persisted row and its future live-append
  // counterpart never coexist in the same mount.
  const rehydratedRef = useRef(false);

  // lastEventSeqRef/renderedSeqsRef/pendingByKeyRef moved into useTranscript
  // (TAV-PLAY-SHELL step 5 hook 4, Amendment A §A.2 row 4) -- see that
  // hook's destructure above.
  //
  // journalSeenSeqsRef (DDX-20 F9+Recap Post-Review Fix, Kage-CR IMPORTANT /
  // Miko-QA MEDIUM, fold commit -- the SEPARATE ledger for journalEvents'
  // own merge-by-seq dedup, `useSessionEvents.ts`'s `pollDurable`, A4) moved
  // into `useJournalDrawer` (TAV-PLAY-SHELL A7 carry item (b)) -- see that
  // hook's own header for the full invariant (must stay in lockstep with
  // journalEvents on every DURABLE_GENERATION_ENABLED-reachable path) and
  // the journalDrawer destructure above.
  // activeJob/subscribedJobIdRef/turnKeyRef/lastDurableTurnRef/jobFailed/
  // pollFailureGraceRef/durableRetryRowRef/revealRef/narrationAbort all
  // moved into useNarration (TAV-PLAY-SHELL step 5 hook 7, Amendment A
  // §A.2 row 7, A5) -- see that hook's destructure above and its own file
  // for the full DDX-20/TAV-S1-ABORT-CLEAR rationale each used to carry
  // here.

  // rollBusyRef/rollBusy moved into useDice (TAV-PLAY-SHELL step 5 hook 8,
  // A6) -- see that hook's destructure below.

  // stateSeqRef/combatBusyRef/monsterDrivingRef/combatStateRef/pollIntervalRef
  // moved into useCombatState (TAV-PLAY-SHELL step 5 hook 5a) — see that
  // hook's destructure above. idRef moved into useTranscript
  // (TAV-PLAY-SHELL step 5 hook 4, Amendment A §A.2 row 4) — see that
  // hook's destructure above.

  // endCombatBtnRef/lastOpenerRef/beginCombatRef/composerRailAnchorRef/
  // dmPanelAnchorRef moved into useFocusAnchors (TAV-PLAY-SHELL A7, plan
  // §1.13) -- composed below, after useCombatState/useSceneState (whose
  // isDying/combatId/sceneHasEncounter/sceneHeadRef that hook's own two
  // rescue effects read as plain params) and before useCombatActions
  // (which takes composerRailAnchorRef/dmPanelAnchorRef from its return).

  // Kage-CR A6 IMPORTANT-1: diceRollPollIntervalRef briefly lived on
  // useDice's return, which inverted Amendment A §A.3 edge R4's principle
  // ("useSessionEvents owns the interval, not the ledger") -- useDice
  // neither read nor wrote it. Resolved outright, not deferred (A4 commit
  // 0): the poll effect, now in `hooks/useSessionEvents.ts`, owns a plain
  // effect-local interval id instead.

  // sceneHeadRef/checkWrapRef/transitionWrapRef/freeformCheckRef moved into
  // useScene (TAV-PLAY-SHELL step 5 hook 4) — see the useScene() call below.

  // prevActiveParticipantIdRef moved into useCombatActions (TAV-PLAY-SHELL
  // step 5 hook 5b) — private to the turn-change refocus effect it owns,
  // read/written nowhere else.
  // Iro CRITICAL-1: provenance gate for the turn-flip refocus effect below.
  // combatState is synced to EVERY client via the 4s poll, so without this the
  // refocus effect would also fire on bystander tabs (including a screen-reader
  // user mid-read on another player's turn). ActionRail's fire() (Composer.tsx)
  // and MonsterRow's fireAction() (DmNarrationPanel.tsx) set this to true
  // synchronously, at click time and BEFORE their mutation, only when focus was
  // inside their own rail — mirroring hadFocusInCheckWrap/hadFocusInTransitionWrap
  // above. The effect reads + clears it; `activeElement === body` is then a
  // CONFIRMATION of an already-known local cause, never a standalone signal.
  const localTurnActionRef = useRef(false);

  // logRef's sync effect and appendLog both moved into useTranscript
  // (TAV-PLAY-SHELL step 5 hook 4, Amendment A §A.2 row 4) — see that
  // hook's destructure above. combatStateRef's sync effect moved into
  // useCombatState (TAV-PLAY-SHELL step 5 hook 5a) — see that hook's own
  // file.

  // TAV-PLAY-SHELL step 5, hook 6 of ~9 (Amendment A §A.2 row 6): scene
  // state (grounding, checks, transitions). Called here (right after
  // useCombatState's destructure above) so the mount-load effect further
  // down can keep reading this hook's setGrounding/
  // diffAndExplainResolvedChecks/openScene/refocusSceneHeadIfStranded/
  // applyOfferedCheckSignal/checkWrapRef by the same names, unchanged --
  // and so `useSessionEvents` (A4, composed last) can take the same six as
  // plain `handlers` fields.
  //
  // Amendment A §A.1: the one derived boolean useSceneState reads off
  // combat's state -- `combatEngaged` comes straight from useCombatState's
  // destructure above (A2); the isCombatEngaged() call itself lives inside
  // that hook, not here.
  //
  // `sceneState` (the hook's own return object) is kept alongside the
  // destructure below -- useNarration and useSceneActions both take it as
  // one bundle (A5; see their own headers).
  const sceneState = useSceneState(sessionId, combatEngaged, appendLog);
  const {
    grounding, setGrounding, sceneAdvanceBusy, adventureComplete, completionSeries,
    checkBusy, offeredCheckSkill, setOfferedCheckSkill, freeformOfferedCheck,
    setFreeformOfferedCheck, sceneHeadRef, checkWrapRef, transitionWrapRef,
    freeformCheckRef, sceneHasEncounter, availableTransitions, availableChecks,
    diffAndExplainResolvedChecks, refreshGrounding, playOutcomeLine,
    onGroundingInvalidated, applyOfferedCheckSignal, openScene,
  } = sceneState;

  // TAV-PLAY-SHELL step 5, A7 (decomposition plan §2.2/§1.13): focus
  // anchors. Composed here -- immediately after useCombatState (row 5,
  // `isDying`/`combatId`) and useSceneState (row 6, `sceneHasEncounter`/
  // `sceneHeadRef`) are both available, and before useCombatActions (row
  // 10), which takes `composerRailAnchorRef`/`dmPanelAnchorRef` from this
  // hook's return as plain params -- see hooks/useFocusAnchors.ts's own
  // header for the full scope (the 5 stable anchor refs + the two
  // rAF-after-commit stranding-rescue effects + the adjacent rising-edge
  // toast, all one cluster in the decomposition plan's §1.13).
  const moment: Moment = combatIsActive ? 'combat' : 'exploring';
  const { row, layoutId } = usePlayLayout(moment);
  const {
    endCombatBtnRef, lastOpenerRef, beginCombatRef, composerRailAnchorRef, dmPanelAnchorRef,
    composerTextareaAnchorRef,
  } = useFocusAnchors(isDying, sceneHasEncounter, combatId, sceneHeadRef, combatIsActive, layoutId);

  // TAV-PLAY-SHELL step 5, hook 7 of ~9 (Amendment A §A.2 row 7):
  // narration. Composed BELOW useSceneState (narrate() reads
  // refreshGrounding/grounding/applyOfferedCheckSignal/etc off it) and
  // ABOVE useSceneActions (whose handleSceneAdvance/onMoveOn/onAttemptCheck
  // fire narrate/narrateDurableBeat as plain, already-declared parameters --
  // this composition order is what discharges the confirmBeatRef debt
  // marker A1b/A2/A3 carried forward; see useNarration.ts's and
  // useSceneActions.ts's own headers for the full A5 story).
  const narration = useNarration(
    sessionId, session, sceneState, transcript,
    msg, setMsg, dmNarrationPending, setDmNarrationPending, setDmNarrationError,
  );
  const {
    talking, thinking, onTurnSettled, setActiveJob,
    jobFailed, setJobFailed, subscribedJobIdRef, turnKeyRef,
    pollFailureGraceRef, durableRetryRowRef, narrationAbort, resumeThinking,
    subscribeToJob, narrate, narrateDurable, narrateDurableBeat,
    onRetryFailedTurn, onSendDmNarration,
  } = narration;

  // TAV-PLAY-SHELL step 5, hook 8 of ~9 (Amendment A §A.2 row 8): dice --
  // quickChecks, advantage, rollBusy (+ its ref), onRoll. Composed BELOW
  // useNarration (onRoll reads narrate/
  // narrateDurableBeat/talking as plain parameters, Amendment A §A.3 edge
  // R7 "forward under the amended order") and ABOVE useSceneActions, which
  // takes `advantage` from this hook's destructure below (edge R5, reorder
  // only -- the call site shape is unchanged, only where the value
  // originates moved). See hooks/useDice.ts's own header for the full
  // scope, including what it deliberately does NOT own yet
  // (useSessionEvents' still-inline poll body, A4).
  const dice = useDice(session, narrate, narrateDurableBeat, talking, combatBusy);
  const { quickChecks, setQuickChecks, advantage, setAdvantage, rollBusy, onRoll } = dice;

  // TAV-PLAY-SHELL step 5, hook 9 of ~9 (Amendment A §A.2 row 9): the two
  // player-facing handlers + the ADV-8 auto-advance narrator (the behaviour
  // half of A1's original useScene). Composed BELOW useNarration (takes
  // narrate/narrateDurableBeat as plain parameters) and ABOVE
  // useCombatActions (which reads handleSceneAdvance from here).
  const sceneActions = useSceneActions(
    session, sceneState, narrate, narrateDurableBeat, talking, advantage,
    appendLog, renderedSeqsRef,
  );
  const { handleSceneAdvance, onMoveOn, onAttemptCheck } = sceneActions;

  // ── load session + party ────────────────────────────────────────────────────
  // debt: mount effect stays here, not in useSessionLifecycle -- it also
  // seeds grounding/log/journal (useSceneState/useTranscript's concerns) in
  // one atomic sequence 553 tests pin the ordering of. ceiling: no additional
  // concern folded in. until: Backlog row TAV-PLAY-SHELL-MOUNT-EFFECT-ATOMIC-SEED-SPLIT is scheduled.
  // (Kage-CR A3 IMPORTANT-1, 2026-09-28: replaces "the atomic seeding
  // sequence is decomposed per-hook", which restated the owed work rather
  // than naming an observable trigger. Filing the row makes it observable
  // -- has the row moved off `todo`? See planning/Backlog.md and
  // useSessionLifecycle.ts's header for the full reasoning.)
  // (useCombatState landed at A2 -- this effect already writes through its
  // setCombatId/setCombatState/stateSeqRef, not local useState/useRef.)
  useEffect(() => {
    if (!username || !sessionId) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const s = await getSession(sessionId, ctrl.signal);
        if (ctrl.signal.aborted) return;
        if (!s) {
          setState('notfound');
          return;
        }
        setSession(s);
        const initialCombatId = s.active_combat_id ?? null;
        setCombatId(initialCombatId);
        setState('ok');

        // Fetch grounding, participants, and the raw event log (rehydration) in
        // parallel.
        const [g, party, rawEvents] = await Promise.all([
          getGrounding(sessionId, ctrl.signal),
          getParticipants(sessionId, ctrl.signal).catch(() => [] as Participant[]),
          getSessionEventsRaw(sessionId, ctrl.signal),
        ]);
        if (ctrl.signal.aborted) return;
        if (g) {
          setGrounding(g);
          // Check Retry + Fail-Forward Iro-A11y MAJOR-1: seed the
          // disappearance-explanation baseline on the VERY FIRST grounding
          // read too -- without this, prevCheckStatesRef would stay empty
          // through mount, and the first poll/refresh afterward would also
          // see an empty "prev" and wrongly treat a genuine transition (one
          // that happened between mount and that first tick) as an
          // unseen-before check, silently dropping the explanation.
          // diffAndExplainResolvedChecks comes from useScene's destructure
          // above (TAV-PLAY-SHELL step 5 hook 4) -- called here unchanged.
          diffAndExplainResolvedChecks(g);
        }
        setParticipants(party);

        // Sorted once, defensively (the engine's GET /events has no
        // ordering guarantee), and shared by both blocks below — Kage-CR
        // SUGGESTION (fold-pass polish): `journalSeed` and the transcript
        // block's own `sorted` used to be the identical
        // `[...rawEvents].sort(...)` computed twice. Behaviour-neutral: each
        // block below still only runs under its own original condition,
        // this only removes the duplicate computation.
        const sortedRawEvents = rawEvents
          ? [...rawEvents].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
          : null;

        // DDX-22: seed the Journal pane from the SAME rehydration fetch —
        // no separate request. JournalPane's derivations can assume
        // ascending seq (sortedRawEvents above).
        //
        // Post-review fix (Kage-CR IMPORTANT / Miko-QA MEDIUM, fold commit)
        // — journalSeenSeqsRef is seeded from this same sorted list so
        // pollDurable's first tick has something to dedup against instead of
        // starting from an empty set (see `useSessionEvents.ts`'s
        // `pollDurable`, A4). Flag-gated (Kage-CR SUGGESTION, this pass) —
        // journalSeenSeqsRef is only ever read from pollDurable, itself
        // reachable only when
        // DURABLE_GENERATION_ENABLED is true, so seeding it flag-OFF would
        // be behaviourally inert (see the invariant note on the ref's own
        // declaration above); gated explicitly anyway to match
        // renderedSeqsRef's own gate below rather than relying on "nobody
        // reads it anyway".
        if (sortedRawEvents) {
          journalDrawer.setJournalEvents(sortedRawEvents);
          if (DURABLE_GENERATION_ENABLED) {
            journalDrawer.journalSeenSeqsRef.current = new Set(
              sortedRawEvents.map((e) => e.seq ?? 0),
            );
          }
        }

        // PLAY-PERSIST §6.2 — rehydrate the transcript ONCE on mount, before the
        // opening path can fire. rawEvents === null means the engine was
        // unreachable — skip rehydration and render what we have (resilient,
        // never crash); the existing (unchanged) opening path still runs below.
        if (sortedRawEvents && !rehydratedRef.current) {
          const sorted = sortedRawEvents;
          const rows: LogRow[] = [];
          for (const e of sorted) {
            if (e.kind === 'opening_narrated') {
              // §6.4 — reconstruct the verbatim read-aloud from CURRENT grounding,
              // but only while the player is still on the scene it was shown for.
              // If they've advanced, showing the (different) current boxed_text
              // would misrepresent it as "the opening" — render a compact marker
              // instead so the log still records "the game opened here".
              const openingSceneId = (e.data?.['scene_id'] as string | undefined) || undefined;
              if (g && openingSceneId && openingSceneId === g.scene_id) {
                rows.push({
                  id: `ev${e.seq ?? 'opening'}-read-aloud`,
                  ts: formatOpeningTimestamp(e.created_at),
                  who: 'Scene',
                  kind: 'read_aloud',
                  text: buildReadAloudBlock(g),
                });
                for (const line of g.opening_lines ?? []) {
                  rows.push({
                    id: `ev${e.seq ?? 'opening'}-line-${line.npc_ref}`,
                    ts: formatOpeningTimestamp(e.created_at),
                    who: line.speaker_display_name,
                    kind: 'read_aloud_line',
                    text: line.line,
                  });
                }
              } else if (g) {
                rows.push({
                  id: `ev${e.seq ?? 'opening'}-marker`,
                  ts: formatOpeningTimestamp(e.created_at),
                  who: 'Scene',
                  kind: 'system',
                  text: `— ${g.adventure_title ?? 'the adventure'} · opening —`,
                });
              }
              continue;
            }
            const row = eventToLogRow(e);
            if (row) rows.push(row);
          }
          setLog(rows);
          rehydratedRef.current = true;
          // DDX-08 / T3: the events poll (`useSessionEvents.ts`, A4) only
          // appends seq > this — every rehydrated row (including any past
          // dice_roll) is already in `rows`, so start the poll's watermark
          // at the newest seq seen.
          lastEventSeqRef.current = sorted.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);

          // DDX-20 F9+Recap Design §2.2 — arm the durable reconcile ledger's
          // rule-1 dedup (reconcileEvents.ts, `renderedSeqs.has(seq)`) for
          // EVERY seq this rehydration just rendered. Without this,
          // `renderedSeqsRef` starts empty, so the FIRST flag-ON poll tick
          // (re-fetching the same history whenever the wire drops
          // `since_seq`) has no way to recognise it already rendered these
          // rows and re-appends all of them: the transcript doubles once,
          // then stabilizes (F9).
          //
          // This defense is PERMANENT, not a stopgap for a currently-known
          // bug (Kage-CR SUGGESTION, this pass — reworded from a "fixed
          // upstream, not yet deployed" framing that would read as stale the
          // day that ships): Tavern and the NekoNova proxy deploy
          // independently, so a flag-ON Tavern build can always meet a
          // not-yet-updated proxy in production regardless of what lands
          // upstream — the client can never assume the wire honours its
          // cursor. (The `since_seq` drop itself IS fixed upstream in
          // ProjectNekoNova `be4db8a`
          // (`feature/ddx-20-p1b-durable-runner`), not yet merged to main or
          // deployed as of this pass — cross-repo, tracked as its own
          // follow-up, not fixed in this repo — but whether it ships
          // doesn't change whether Tavern needs this defense.)
          //
          // Post-review comment fix (Kage-CR SUGGESTION, fold commit) — this
          // used to justify seeding from `sorted` (every event) rather than
          // `rows` (only the ones that produced a LogRow) by naming
          // opening_narrated/recap/rebind/session_start as "the exact hole
          // this closes". That was wrong: those four kinds all map to null
          // via eventToLogRow, so reconcileDurableEvents' rule 5
          // (appendIfRow -> null -> no row, reconcileEvents.ts:234-235)
          // marks their seq seen on the FIRST poll tick regardless of
          // whether mount pre-seeded them — pre-seeding them is harmless but
          // redundant, never "the hole". The kinds that actually risk a
          // VISIBLE duplicate on tick 1 are the ones eventToLogRow maps to a
          // real row (narration, player_action, dm_narration, dice_roll,
          // x_card, scene_advance, ...) with no pendingByKey match yet (a
          // fresh mount has none) — THOSE are what re-append as duplicates
          // if unseeded. `sorted` is still the right seed source (strictly
          // more robust: a superset that never needs the reader to
          // enumerate which kinds are safe to skip), just for that reason,
          // not the one originally written here.
          //
          // This is a client-side invariant, not a trust in the wire: it
          // fixes F9 even with the `since_seq` drop still in place, because
          // the ledger no longer depends on the cursor being honoured at
          // all. Flag-gated (the ledger is only ever read from
          // `pollDurable`, itself reachable only when the flag is on) —
          // seeding it flag-OFF would be inert but the dormancy contract is
          // byte-identity, so gate explicitly rather than relying on
          // "nobody reads it anyway".
          if (DURABLE_GENERATION_ENABLED) {
            for (const e of sorted) {
              if (e.seq != null) renderedSeqsRef.current.add(e.seq);
            }
            console.debug('ledger_seeded_from_rehydration', { count: sorted.length });
          }

          // DDX-26 — run the banner's active-computation over the REHYDRATED
          // history too (not just future poll ticks), so a reloading client
          // sees an active, undismissed X-card banner for a still-unresolved
          // signal. dismissedXCardSeq intentionally is NOT restored here — it
          // resets to null on every fresh mount (a reload re-surfaces an
          // unresolved signal, the safe direction per the design decision).
          const { xCard, narrationSeq } = scanXCardTracking(sorted);
          if (xCard) setXCardEvent(xCard);
          if (narrationSeq != null) setLatestNarrationSeq(narrationSeq);
        }

        // A2 — fetch the bound character's sheet to build real quick-checks.
        // The self participant carries character_id when a character is bound.
        const selfParticipant = party.find(
          (p) => p.username.toLowerCase() === username.toLowerCase(),
        );
        const boundCharId = selfParticipant?.character?.character_id ?? null;

        // B1-4: persist the stringified character_id for per-user turn resolution.
        setMyCharacterIdStr(boundCharId != null ? String(boundCharId) : null);
        if (boundCharId) {
          getCharacterSheet(boundCharId, username, ctrl.signal)
            .then((sheet) => {
              if (ctrl.signal.aborted) return;
              // T6 (DDX-12): stash the whole sheet regardless of the
              // quick-checks branch below — CastSpellPanel needs
              // is_spellcaster + spell_slots even for a sheet with no skills.
              setMySheet(sheet);
              if (!sheet?.skills?.length) {
                setQuickChecks([]);
                return;
              }
              // Build quick-checks from the preferred names, preserving order.
              const skillMap = new Map(
                sheet.skills.map((sk) => [sk.name.toLowerCase(), sk]),
              );
              const checks: QuickCheck[] = PREFERRED_QUICK_CHECK_NAMES
                .map((n) => {
                  const sk = skillMap.get(n);
                  if (!sk) return null;
                  // Title-case: "sleight_of_hand" → "Sleight of Hand"
                  const display = sk.name
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, (c) => c.toUpperCase());
                  // DDX-08 / T3: `skill` carries the raw engine slug — the
                  // server resolves its own modifier off the sheet at roll
                  // time, so `mod` here is DISPLAY-ONLY (never sent to /roll).
                  return { name: display, skill: sk.name, mod: sk.modifier };
                })
                .filter((c): c is QuickCheck => c !== null);
              setQuickChecks(checks);
            })
            .catch(() => {
              // Sheet fetch failed — hide quick-checks rather than show stale numbers.
              if (!ctrl.signal.aborted) setQuickChecks([]);
            });
        } else {
          // DM-only or no character bound: hide quick-checks + CastSpellPanel.
          setQuickChecks([]);
          setMySheet(null);
        }

        // If there's an active combat, fetch its state immediately.
        if (initialCombatId && !ctrl.signal.aborted) {
          const cs = await getCombatState(initialCombatId, ctrl.signal).catch(() => null);
          if (!ctrl.signal.aborted && cs) {
            stateSeqRef.current += 1;
            setCombatState(cs);
          }
        }

        // A1 — Opening scene trigger. Non-blocking: fire-and-forget so the
        // player can interact while the opening streams in the background.
        // openScene comes from useScene's destructure above (TAV-PLAY-SHELL
        // step 5 hook 4).
        if (g && !ctrl.signal.aborted) {
           
          void openScene(s, g, sessionId, ctrl.signal);
        }
      } catch (e) {
        if (ctrl.signal.aborted) return;
        const status = (e as { status?: number } | null)?.status;
        setState(status === 404 ? 'notfound' : 'error');
      }
    })();
    return () => ctrl.abort();
    // openScene intentionally omitted from deps: it reads session/username via
    // closure args, and adding it would re-run this load effect on every
    // narrate/session change (re-fetching the session). Matches login/page.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, sessionId]);

  // S5.2: once the session loads, snap the composer mode to 'dm_narration'
  // for human-DM seats so the tab is correct from the first render. Runs once
  // per newly-loaded session (not on every mode change) — adjusted during
  // render (not an effect) per React's documented pattern for "adjusting
  // state when a prop changes".
  if (session && !modeSynced) {
    setModeSynced(true);
    if (isSessionDm(session, username) && session.dm_mode === 'human') {
      setMode('dm_narration');
    }
  }

  // The combat-state poll (4s, foregrounded) moved into useCombatState
  // (TAV-PLAY-SHELL step 5 hook 5a) — same deps ([combatId] only), same
  // load-bearing comment, unchanged, in that hook's own file now.

  // journalVisible/closeJournal moved into useJournalDrawer (TAV-PLAY-SHELL
  // A7, plan §1.9) -- see the journalDrawer.open/journalDrawer.onClose
  // destructure/JSX call sites below. closeMemberSheet/onSelectMember moved
  // into useMemberSheetDrawer (A7, plan §1.8) -- see
  // memberSheetDrawer.onClose/memberSheetDrawer.onSelectMember below. Both
  // hooks' own headers carry the DDX-22/TAV-PARTY-INLINE-SHEET reasoning
  // this used to document inline here.

  // B1-4: fire-once toast when combat becomes active and the user has no
  // bound character (they can observe but not act). Amendment A §A.6: this
  // marker resolves at A2 -- combatState?.state is now a plain downward read
  // off useCombatState's destructure above, the same shape as reading any
  // other hook's return; it stays in page.tsx (not folded into either
  // useMyCharacter or useCombatState) because it is genuinely a cross-hook
  // consumer of both, not owned by either one.
  useEffect(() => {
    if (
      combatState?.state === 'active' &&
      myCharacterIdStr === null &&
      !noCharToastFiredRef.current
    ) {
      noCharToastFiredRef.current = true;
      toast({
        tone: 'info',
        message: 'You have no bound character — you can watch but not act.',
      });
    }
    // noCharToastFiredRef is the useRef object useMyCharacter's own useRef
    // call returns -- referentially stable across renders like any ref,
    // listed explicitly because the linter can't prove that through an
    // intermediate hook (same as the XP-guard effect above).
  }, [combatState?.state, myCharacterIdStr, toast, noCharToastFiredRef]);

  // checkShouldOpen/openScene moved into useSceneState (TAV-PLAY-SHELL step
  // 5 hook 6) -- see the useSceneState() call above, right after appendLog.
  // narrate/narrateDurable/narrateDurableBeat/subscribeToJob/revealText/
  // onRetryFailedTurn/onSendDmNarration moved into useNarration (hook 7,
  // A5) -- see the useNarration() call above, right after useSceneState's.

  // quickChecks/advantage/rollBusy/onRoll moved into useDice
  // (TAV-PLAY-SHELL step 5 hook 8, Amendment A §A.2 row 8, A6) -- see the
  // useDice() call above, right after useNarration's.

  // handleSceneAdvance/onMoveOn/onAttemptCheck (+ sceneAdvanceBusyRef/
  // checkBusyRef) moved into useScene (TAV-PLAY-SHELL step 5 hook 4) -- see
  // the useScene() call above, right after appendLog.

  // ── combat ──────────────────────────────────────────────────────────────────
  // TAV-PLAY-SHELL step 5, hook 5b of ~9 (decomposition plan §2.2, amended by
  // Amendment A §A.2 row 10 / §A.6): combat's behaviour half -- beginEncounter,
  // onCombatAction, onEndCombat, the monster auto-driver effect, and the
  // turn-change refocus effect. Composed here (after narrate/narrateDurableBeat
  // and handleSceneAdvance/playOutcomeLine/refreshGrounding from useScene are
  // already declared above) per §A.6's own note -- useNarration doesn't exist
  // yet (A5), so this is still page.tsx-local narrate/narrateDurableBeat, not
  // a hook's return. See hooks/useCombatActions.ts for the full scope and the
  // signature deviations from §A.6's abridged list (documented there).
  const { beginEncounter, onCombatAction, onEndCombat } = useCombatActions(
    session, username, myCharacterIdStr, combatStateResult,
    appendLog, narrate, narrateDurableBeat, handleSceneAdvance, playOutcomeLine,
    refreshGrounding, sceneHeadRef, composerRailAnchorRef, dmPanelAnchorRef,
    localTurnActionRef,
  );

  // TAV-PLAY-SHELL step 5, hook 11 of ~9 (decomposition plan §2.2, amended
  // by Amendment A §A.2 row 11) -- the unified durable events poll (+ its
  // flag-OFF legacy sibling). Composed LAST, after useCombatActions -- see
  // hooks/useSessionEvents.ts's own header for the full scope, the "one
  // named object, not positional params" reasoning, and why it is the one
  // hook in this series that takes handler callbacks instead of reading a
  // sibling hook's state.
  useSessionEvents(sessionId, state, {
    lastEventSeqRef, renderedSeqsRef, pendingByKeyRef, logRef, setLog, appendLog,
    clearStreamNarration,
    onGroundingInvalidated, applyOfferedCheckSignal, setOfferedCheckSkill,
    setFreeformOfferedCheck,
    setActiveJob, setJobFailed, onTurnSettled, subscribedJobIdRef,
    turnKeyRef, pollFailureGraceRef, narrationAbort, subscribeToJob,
    setXCardEvent, setLatestNarrationSeq,
    journalSeenSeqsRef: journalDrawer.journalSeenSeqsRef,
    setJournalEvents: journalDrawer.setJournalEvents,
  });

  // UIR2-TAV-11: the xpForm's own onKeyDown only fires while focus is inside
  // the form's DOM subtree (a native keydown that starts there and bubbles
  // stops before reaching document once that handler calls
  // e.stopPropagation() — see below). If focus moves elsewhere on the page
  // while the popover is still open (e.g. the user tabs or clicks out
  // without dismissing it first), that in-form handler never runs and Escape
  // does nothing. This document-level listener is the fallback: it only
  // attaches while xpFormOpen is true, and mirrors the in-form handler's
  // close + refocus-trigger behavior.
  //
  // r1 (Miko-QA adversarial gate, post-ship regression): this listener
  // originally assumed it composed safely with the other Escape-handling
  // overlays (journal, combat outcome chooser, end-session ConfirmDialog)
  // because "those call e.stopPropagation()". That was only true while those
  // overlays were IDLE — several deliberately did NOT stopPropagation()
  // while a request from them was in flight (so the user could watch/retry
  // it), and with no mutual-exclusion that "swallowed" Escape fell through
  // to this listener and silently closed the unrelated Award-XP popover.
  // r1's fix enumerated the 3 known overlays below.
  //
  // r2 (Miko-QA re-gate — enumeration is whack-a-mole): the r1 enumeration
  // wasn't exhaustive — 4 MORE Escape-handling overlays/menus in this
  // subtree (DmNarrationPanel's monster-attack menu, RebindCharacterButton,
  // Composer's player-attack menu, DmOverrideModal) had the identical shape
  // and leaked the same way. The real fix is structural, not enumerative:
  // EVERY Escape-handling overlay/menu/modal under /play now calls
  // e.stopPropagation() UNCONDITIONALLY on Escape — gating only the
  // close/state-change on its own busy flag, never the stopPropagation. That
  // means an Escape fired inside any such overlay is consumed at its own DOM
  // node and physically cannot reach this document-level listener, by
  // construction — no enumeration required. See ConfirmDialog.tsx,
  // DmOverrideModal.tsx, RebindCharacterButton.tsx, DmNarrationPanel.tsx,
  // Composer.tsx, and the outcome-chooser/xpForm handlers just above/below
  // in this file for the pattern.
  //
  // The 3-overlay guard below is KEPT as belt-and-suspenders (it's cheap and
  // still correct) but is no longer load-bearing for the invariant — if a
  // new Escape-handling overlay is ever added under /play and follows the
  // consume-your-own-Escape pattern, it does NOT need to be added here.
  // debt: stays here instead of moving into useSessionLifecycle -- the guard
  // below reads two overlay booleans owned by hooks composed BELOW it.
  // ceiling: no additional cross-concern read added.
  // until: §2.1's PlaySessionProvider exists (grep says it does not yet) so these become context reads, OR the 3-overlay guard is retired as the non-load-bearing belt-and-suspenders it already documents itself as.
  //
  // (A7, Kage-CR ruling 1: the previous `until:` -- "the journal drawer's own
  // hook exists" -- FIRED at A7 without discharging this. Ownership was never
  // the blocker; composition ORDER is: useSessionLifecycle is row 3,
  // useJournalDrawer row 6, useCombatState row 8. Full history: the ratchet
  // chain's `-> 2027` entry and Reviews "A7 — Kage-CR" ruling 1.)
  useEffect(() => {
    if (!xpFormOpen) return;
    const onDocumentKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (outcomeChooserOpen || endSessionConfirmOpen || journalDrawer.open) return;
      // Finding 2: mirrors the in-form handler's sessionActionBusy==='xp'
      // guard — an in-flight award shouldn't be dismissable via this
      // fallback path either.
      if (sessionActionBusy === 'xp') return;
      setXpFormOpen(false);
      xpToggleBtnRef.current?.focus();
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => document.removeEventListener('keydown', onDocumentKeyDown);
    // setXpFormOpen/xpToggleBtnRef are the useState setter / useRef object
    // useSessionLifecycle's OWN useState/useRef calls return -- both stable
    // across renders exactly like a locally-declared one, but the
    // exhaustive-deps rule can no longer prove that once they're returned
    // through an intermediate hook, so they're listed explicitly (TAV-PLAY-
    // SHELL step 5 hook 1; behaviour-neutral, both are referentially
    // stable).
  }, [xpFormOpen, outcomeChooserOpen, endSessionConfirmOpen, journalDrawer.open, sessionActionBusy, setXpFormOpen, xpToggleBtnRef]);

  // ── derived combat UI state ──────────────────────────────────────────────────
  // targetableFoes/isPlayerTurn/isDying/round/anyMonsterDown/allHostilesDown/
  // selfPcId/combatIsActive/activeParticipant/activeIsMine moved into
  // useCombatState (TAV-PLAY-SHELL step 5 hook 5a, Amendment A §A.6 "every
  // pure derivation off combatState") -- already destructured from that
  // hook's return above. activeParticipant/activeIsMine moved at A3 (Kage-CR
  // A2 IMPORTANT-2) -- this file used to carry a byte-identical second copy
  // right here; deleted, not just pointed-to. What's left here is
  // JSX-adjacent derived state §A.6 doesn't name as the hook's own: it stays
  // in page.tsx, recomputed off combatState/activeParticipant/activeIsMine/
  // isDying (all hook-sourced) the same cheap-recompute shape
  // myDeathSaveParticipant already used before this split (see
  // hooks/useCombatState.ts's own header for the full reasoning).

  // TAV-ATTACK-BUTTON-STALE: the viewer's own PC has already spent their
  // ACTION this turn — read straight off the combat-state wire's per-turn
  // action economy (`action_available`, engine DDX-06; resets at the start of
  // their own turn), never invented client-side. Strict === false so an old
  // combat-state payload without the field (absent -> undefined) keeps the
  // pre-fix behavior of leaving Attack enabled rather than wrongly locking it.
  const myActionSpent = activeIsMine && activeParticipant?.action_available === false;

  // Combat-UX Fixes 2026-07-27 §UI-states "Dead" row (Kage-CR/test-plan §4.2):
  // a dead PC is NOT the active-turn participant (is_active flips false at 3
  // failures, so `_advance` skips them — `activeParticipant`/`isDying` above
  // will never observe this state), so it needs its own lookup across the
  // full roster rather than piggybacking on activeParticipant. Precise
  // entity_id match only (mirrors activeIsMine's own match rule; no name
  // fallback needed here — this just gates a notice, not a mutation).
  const myDeathSaveParticipant =
    myCharacterIdStr != null
      ? (combatState?.participants.find(
          (p) => p.is_pc && p.entity_id === myCharacterIdStr,
        ) ?? null)
      : null;
  const isMyPcDead = myDeathSaveParticipant?.death_saves?.is_dead === true;

  // TAV-BUSY-DISABLED-FOCUS-PARK's death-save-row rescue (prevIsDyingRef +
  // its effect) moved into useFocusAnchors (TAV-PLAY-SHELL A7) -- see that
  // hook's own header/effect for the full reasoning; called above,
  // immediately after useSceneState.

  // Iro MEDIUM-2: derive the turn-status label during render so the single
  // persistent live region (rendered below) updates its text in place. null =
  // hidden. Derived (not effect+state) to avoid a set-state-in-effect cascade.
  //
  // Iro MAJOR-2 (Combat-UX Fixes 2026-07-27, Fix B follow-up): a plain "Your
  // turn!" when isDying is misleading — the player is at 0 HP and Attack/
  // Dodge/Dash are disabled-visible; they need to be told to roll a death
  // save. Kept STATIC per turn (no live successes/failures baked in here) —
  // ChatLog's own live region already announces each roll's outcome, so
  // folding the tally into this label too would double-announce the same
  // event through two separate aria-live regions.
  const turnStatusText: string | null =
    !combatId || combatState?.state !== 'active' || !activeParticipant
      ? null
      : activeIsMine
        ? isDying
          ? 'Your turn — you are down. Roll a death save.'
          : 'Your turn!'
        : activeParticipant.is_pc
          ? `Waiting on ${activeParticipant.name}'s turn...`
          : `Monster turn — ${activeParticipant.name}`;

  // round now comes from useCombatState's destructure above.

  // Determine valid "Move on" transitions from grounding (ADV-7T).
  // Show the button only when: no active combat AND at least one transition is available
  // that doesn't require an unresolved encounter.
  const activeEncounterId = combatState?.state === 'active'
    ? combatState.encounter_id
    : null;

  // Phase 4 Package B (Sora-Arch design §3 Fork 2) — does the CURRENT scene
  // define an authored combat encounter at all (any trigger, before it's
  // ever started)? Drives the "Begin an encounter"/"Stand and fight" button
  // below: originally a copy-only signal (which label to show), it is now
  // ALSO that button's render gate (TAVERN PLAY-UI NITS item a, 2026-07-23
  // pre-flight playthrough nit) — the button no longer mounts at all when
  // this is false. `beginEncounter`'s own logic/gating is still untouched
  // (no `manual` vs `on_enter` branching here either; Package B never
  // auto-starts). `sceneHasEncounter` itself now comes from useScene's
  // destructure above (TAV-PLAY-SHELL step 5 hook 4) — the two effects
  // below stay in page.tsx because they are genuinely cross-hook consumers
  // (also reading `combatId` from useCombatState's destructure), not owned
  // by either hook.

  // Iro-A11y MAJOR-2 — the "Begin an encounter"→"Stand and fight" reframe.
  // Originally this swapped the SAME button's text child in place while the
  // button itself stayed mounted; `sceneHasEncounter` is now ALSO that
  // button's mount/unmount condition (TAVERN PLAY-UI NITS item a above), so
  // the rising edge below now corresponds to the button APPEARING for the
  // first time, not just relabeling — arguably an even stronger case for
  // the toast, not a weaker one. Still fires the SAME toast infra
  // `applyOfferedCheckSignal` above uses (not a new shape) on the RISING
  // edge only (false -> true), and only while the button is actually
  // rendered (`!combatId` — beginEncounter's own gate, unchanged). Still
  // deliberately NOT a live region wrapped around the button itself: that
  // would double-announce on mount (the button's initial text is read once
  // when it first appears; wrapping it in aria-live would announce it
  // again immediately) — the toast remains the safe, out-of-band channel,
  // same reasoning as offeredCheckSkill's own toast above. No code change
  // needed below: the effect only reads `sceneHasEncounter`/`combatId`
  // state, never the DOM, so it fires identically whether the button's
  // presence is driven by a text swap or a real mount.
  // TAV-COMBAT-VERB-NO-MECHANICS — the combat-verb guard's gate and the scene's
  // authored creature names (plan §1.4). Both are pure reads of `grounding`
  // (format.ts); they stay here because `grounding` is a tier-6 concern neither
  // useCombatState nor useCombatActions owns (Amendment A §A.6).
  const combatEncounterUnstarted = useMemo(() => isCombatEncounterUnstarted(grounding), [grounding]);
  const sceneCreatureNames = useMemo(() => groundingCreatureNames(grounding), [grounding]);

  // The "Begin an encounter"->"Stand and fight" rising-edge toast
  // (prevSceneHasEncounterRef) and its Iro-A11y CRITICAL-1 falling-edge
  // focus-strand rescue (beginEncounterVisibleRef) both moved into
  // useFocusAnchors (TAV-PLAY-SHELL A7) -- see that hook's own header/
  // effects for the full reasoning; called above, immediately after
  // useSceneState.

  // availableTransitions/availableChecks moved into useScene (TAV-PLAY-SHELL
  // step 5 hook 4) -- see the useScene() call above, right after appendLog.
  // The composer's keyword-fast-path below (onSend) reads them by the same
  // names, from that call's destructure.

  // ── composer send ───────────────────────────────────────────────────────────
  /**
   * P1-PLAYFIX-2 §A.3/§A.4(c) — before falling through to narrate(), test the
   * player's free-text against a bounded, conservative keyword fast-path
   * SCOPED to the CURRENT scene's authored transitions (availableTransitions,
   * derived from grounding just above). On an unambiguous match, route
   * straight to the existing onMoveOn handler and skip narrate() entirely for
   * this beat — mutual exclusivity with the server's INTENT classifier is
   * required: onMoveOn does its own narrate() call with real mechanics
   * (suppress_intent:true), so calling narrate() here too would
   * double-advance the beat. On no confident match (including any
   * ambiguous/roleplay text, AND any check-implying text — P1-PLAYFIX-2 gate
   * fix, Kage #3 / Miko DEFECT-1: checks are never fast-pathed, see
   * intentFastPath.ts), fall through to narrate() — the server's INTENT
   * classifier there is what invites a check in-fiction via `offered_check`,
   * never an auto-roll.
   *
   * Placed after onMoveOn/availableTransitions in source order deliberately —
   * this callback's dependency array names both, which must already be
   * declared (`const`/`useCallback`) by this point in the component body.
   */
  const onSend = useCallback(() => {
    const text = msg.trim();
    if (!text || talking) return;
    // S5.2: DM narration mode is handled by its own async submit handler.
    if (mode === 'dm_narration') {
      void onSendDmNarration();
      return;
    }
    setMsg('');
    if (mode === 'ooc') {
      appendLog({ who: username ?? 'You', kind: 'system', text: `(ooc) ${text}` });
      return;
    }
    // TAV-COMBAT-VERB-NO-MECHANICS — runs BEFORE matchKeywordIntent, and the
    // order is load-bearing in both directions:
    //
    //   1. A combat declaration must never be read as movement. "I press
    //      forward and attack the goblin" contains a MOVE_ON_PHRASE, so with
    //      the old ordering a single-exit scene would ADVANCE past a live
    //      threat on an attack declaration — strictly worse than the bug this
    //      fixes.
    //   2. It must precede both flag branches, so neither narrateDurable nor
    //      narrate is ever reached: the fabricated prose is stopped by not
    //      being generated, which (with DM-STREAM revealing tokens as they
    //      arrive) is the only point where it CAN be stopped.
    //
    // Refuse-and-prompt only — this branch starts nothing. It withholds the
    // turn, says plainly why nothing landed, and hands the player the real
    // mechanical affordance. See matchCombatIntent's doc block for why a
    // client matcher rather than the (already-present, already-overridden)
    // server prompt guard, and for Leon's scope ruling.
    if (
      combatEncounterUnstarted &&
      !combatId &&
      matchCombatIntent(text, sceneCreatureNames)
    ) {
      appendLog({ who: username ?? 'You', kind: 'player', text, color: 'var(--accent)' });
      // Agreement is taken from the DEDUPED count listCreatureNames itself
      // renders — two refs to the same monster row read as one subject.
      const distinctCreatures = new Set(sceneCreatureNames).size;
      const named = distinctCreatures
        ? `${listCreatureNames(sceneCreatureNames)} ${distinctCreatures === 1 ? 'is' : 'are'} right there, but nothing`
        : 'Nothing';
      appendLog({
        who: 'Suzu',
        kind: 'system',
        text:
          `Combat hasn't started — ${named} you do lands until initiative is rolled. ` +
          `Use "Stand and fight" to begin the encounter, or take one of the exits.`,
      });
      toast({
        tone: 'warn',
        message: 'Combat hasn’t started yet — use "Stand and fight" to roll initiative.',
      });
      // Prompt half of refuse-and-prompt: land focus on the named control.
      // rAF so the log rows have committed first; guarded on the button
      // actually being rendered and enabled (a background grounding refresh
      // could have unmounted it between the keystroke and here).
      requestAnimationFrame(() => {
        const btn = beginCombatRef.current;
        if (btn && !btn.disabled) btn.focus();
      });
      return;
    }

    // DDX-20 Pass 2 — the intent fast-path (onMoveOn) is unaffected by the
    // flag either way; only the "falls through to a normal beat" branch
    // differs (durable job vs legacy SSE). Computed once, ahead of the
    // flag branch, since matchKeywordIntent is a pure read of `text` +
    // `availableTransitions` — no observable difference from computing it
    // here vs. its original post-appendLog position on the flag-OFF path.
    const intent = matchKeywordIntent(text, availableTransitions);

    if (DURABLE_GENERATION_ENABLED) {
      // narrateDurable owns the optimistic player-row append itself (it
      // needs to stamp `pendingKey` — the freshly-minted turn_key — onto
      // that row, which onSend cannot know ahead of time), so it is NOT
      // appended here on this branch (contrast the flag-OFF appendLog call
      // just below, which always runs on that path).
      if (intent?.type === 'transition') {
        appendLog({ who: username ?? 'You', kind: 'player', text, color: 'var(--accent)' });
        void onMoveOn(intent.to);
        return;
      }
      void narrateDurable(text, mode);
      return;
    }

    appendLog({ who: username ?? 'You', kind: 'player', text, color: 'var(--accent)' });
    if (intent?.type === 'transition') {
      void onMoveOn(intent.to);
      return;
    }
    void narrate(text, '', mode);
  }, [
    msg,
    talking,
    mode,
    username,
    appendLog,
    narrate,
    narrateDurable,
    onSendDmNarration,
    availableTransitions,
    onMoveOn,
    // TAV-COMBAT-VERB-NO-MECHANICS — the guard's gate + its copy inputs.
    combatEncounterUnstarted,
    combatId,
    sceneCreatureNames,
    toast,
    // beginCombatRef: now comes from useFocusAnchors' return (TAV-PLAY-SHELL
    // A7) rather than a page.tsx-local useRef() call -- same "linter can no
    // longer prove local-ref stability through an intermediate hook" pattern
    // this file's other hook-sourced refs already document (e.g.
    // xpToggleBtnRef). Stable across renders either way.
    beginCombatRef,
  ]);

  // The composer lock (`talking`/paused/ended/`dmNarrationPending`) no longer strands
  // focus: locked controls stay focusable and say so (`aria-disabled`, `lockProps` in
  // src/lib/a11y/lockProps.ts, used by Composer and CastSpellPanel; Iro A9c-2 N-2).

  // TAV-PLAY-SHELL step 6b, commit C4 (build brief §6.2): resolves the
  // layout PRESET (not just its id) for the current moment (the call sits above
  // useFocusAnchors, A9d-2 F2, which takes the id). `moment` is
  // `combatIsActive ? 'combat' : 'exploring'` per usePlayLayout's own
  // contract (Amendment A §A.1: combatIsActive, never combatEngaged).
  // `row` is read downstream, in the JSX below, by the regions/tenants
  // maps `<PlayShell>` renders from.
  const { foldedRegions, onToggleFold, unfold } = useRegionFolds();
  const revealSheet = useCallback(() => unfold('characterBlock'), [unfold]);
  const characterBlockIsLayer = getPlacement(row, 'characterBlock', moment).layer === true;
  const memberSheetDrawer = useMemberSheetDrawer(username, mySheet, !characterBlockIsLayer, revealSheet);

  // ── auth gate (UIR2-TAV-3) ──────────────────────────────────────────────────
  // A SEPARATE, earlier guard from the session `state` machine below — this
  // page never had ANY auth gate before, so it rendered its play UI (and the
  // party/DM panels, wired to `username`) even while `user` was null. Must
  // run after every hook above and before the session-state render guards,
  // without touching that state machine at all.
  const gate = useAuthGate({
    skeleton: <PageSkeleton variant="card" lines={4} />,
    label: 'Loading your table',
  });
  if (gate) return gate;

  // ── render states ───────────────────────────────────────────────────────────
  if (state === 'loading') return <PageSkeleton />;

  if (state === 'notfound' || state === 'error') {
    return (
      <div className={styles.fallback}>
        <h1 className={styles.fallbackTitle}>
          {state === 'notfound' ? 'That table has closed.' : 'The table is unreachable.'}
        </h1>
        <p className={styles.fallbackBody}>
          {state === 'notfound'
            ? 'This session no longer exists, or you are not at it.'
            : 'Something went wrong loading the session. Try again in a moment.'}
        </p>
        <Link href="/lobby" className={styles.fallbackLink}>
          ← Back to the lobby
        </Link>
      </div>
    );
  }

  const title = sessionTitle(session ?? {});
  // combatIsActive now comes from useCombatState's destructure above.

  // TAV-NARRATION-DECOUPLE (2026-07-25) — NarratorStrip's combat-status
  // banner: an "if easy" glance at turn order, derived straight from the
  // already-fetched combatState (no extra request). `combatState.initiative`
  // is the ordered list of participant_ids (mirrors CombatSession's own
  // initiative_order); mapped to display names and filtered defensively
  // (a stale/unknown id — e.g. a monster removed mid-encounter — just drops
  // out rather than rendering "undefined").
  const narratorInitiativeOrder = combatIsActive && combatState
    ? combatState.initiative
        .map((id) => combatState.participants.find((p) => p.participant_id === id)?.name)
        .filter((name): name is string => !!name)
    : [];

  // TAV-SOLO-DM-CAST-RAIL: a solo-table human DM who ALSO has a bound
  // character (the GM-PC pattern) keeps their DM controls (DmNarrationPanel /
  // ConditionsPanel below stay gated on isHumanDM alone) but additionally
  // gets the player rail (CastSpellPanel + Composer's combat action rail) so
  // they can drive their own PC. Turn-gating (isPlayerTurn, further down)
  // already keys off myCharacterIdStr — it's unaffected by this flag.
  const isDmPlayingOwnPc = isHumanDM && !!myCharacterIdStr && !!mySheet;

  // resumeThinking (DDX-20 §9 "Resuming Suzu's turn…" resume affordance)
  // moved into useNarration (TAV-PLAY-SHELL step 5 hook 7, Amendment A
  // §A.2 row 7, A5) -- pure derivation off that hook's own talking/
  // activeJob, so it moved with them. See that hook's destructure above.

  // Show Suzu commentary panel when AI is active ('full' or 'assist').
  // For 'assist': the strip renders but auto-narration is suppressed in narrate().
  const showSuzuPanel = !aiOff;

  // S5.2: composer mode list for the current seat.
  // Human DM: dm_narration + ooc (no roleplay modes — the DM narrates, not plays a PC).
  // All others: the standard say/act/ooc set.
  const composerModes: [ComposeMode, string][] = isHumanDM
    ? [['dm_narration', 'DM Narration'], ['ooc', 'OOC']]
    : [['say', 'Say'], ['act', 'Act'], ['ooc', 'OOC']];

  // anyMonsterDown/allHostilesDown now come from useCombatState's destructure
  // above (Amendment A §A.6).
  const statusPill = combatIsActive ? (
    <Pill tone="lav" dot><span className={styles.pillRound} aria-hidden>round {round ?? 1} · </span>combat</Pill>
  ) : (
    <Pill tone="muted" dot>
      exploring
    </Pill>
  );
  // Iro-A11y CRITICAL (review pass) — NarratorStrip's OWN combat line
  // already states "Round N" explicitly (see its `combatParts`); embedding
  // the full `statusPill` (which ALSO says "round N") in its `status` slot
  // restated the round twice in the same node — visually redundant for
  // sighted users, and (independent of NarratorStrip's aria-live="off"
  // combat gate, which only suppresses AUTOMATIC announcement) still
  // double-read verbatim by a screen reader user browsing the DOM manually.
  // Scoped to ONLY the NarratorStrip prop — the aiOffStatus fallback below
  // (ai_assist_level='off', no NarratorStrip/combat line rendered at all)
  // still uses the full `statusPill` with its round, visually. The round is
  // `aria-hidden` there (A9d-2, Iro A9d-1 MINOR-5): the initiative tracker in the
  // party strip is the one polite region that says it, in every row.
  const narratorStatusPill = combatIsActive ? (
    <Pill tone="lav" dot>
      combat
    </Pill>
  ) : statusPill;

  // selfPcId now comes from useCombatState's destructure above.

  // TAV-PLAY-SHELL step 6b, commit C4 (build brief §6.5) — `characterBlock`
  // is `layer:true` in story/phone (routed through the existing member-sheet
  // `<Drawer>`, unchanged) but grid-placed with NO layer in table (R20's
  // docked rail). `MemberSheetPanel` is a documented singleton on this page
  // ("never rendered twice at once") sharing one fixed heading id
  // (`MEMBER_SHEET_HEADING_ID`) — rendering it BOTH inside the Drawer AND
  // docked in the table rail simultaneously would violate that and duplicate
  // the id. The two renders are therefore mutually exclusive on this one
  // flag, which the row itself decides (resolved above, beside `usePlayLayout`).
  const memberSheetPanelNode = <MemberSheetPanel {...memberSheetDrawer.panelProps} />;

  // TAV-PLAY-SHELL step 6b, commit C4 (build brief §6.2–§6.4) — `regions`/
  // `tenants` are the only two things `<PlayShell>` knows: `RegionId ->
  // ReactNode` and `TenantId -> ReactNode`. Built here, where every piece's
  // own data/handlers already live; the shell itself never imports a region
  // component. The tenth region is one presets.ts row + one entry here.
  const regions: Partial<Record<RegionId, ReactNode>> = {
    safetyBanner: (
      <SafetyBanner
        active={xCardActive}
        event={xCardEvent}
        isDm={isDm}
        bannerRef={xCardBannerRef}
        onDismiss={() => {
          // Iro MAJOR-2: refocus BEFORE this button unmounts (setting
          // dismissedXCardSeq re-renders xCardActive to false, dropping
          // this button) — otherwise the browser force-blurs to <body>.
          xCardBannerRef.current?.focus({ preventScroll: true });
          if (xCardEvent) setDismissedXCardSeq(xCardEvent.seq);
        }}
      />
    ),
    topBar: (
      <TopBar
        title={title}
        journalOpen={journalDrawer.open}
        onToggleJournal={() => journalDrawer.setOpen((v) => !v)}
        paneId={journalDrawer.id}
        showSuzuPanel={showSuzuPanel}
        talking={talking}
        sceneName={grounding?.scene_name ?? null}
        objective={grounding?.objective ?? null}
        combatActive={combatIsActive}
        round={round}
        turnStatusText={turnStatusText}
        initiativeOrder={narratorInitiativeOrder}
        status={narratorStatusPill}
        statusPill={statusPill}
        variant={variantFor(row, 'topBar', moment)}
        settings={<TweaksPanel />}
      />
    ),
    partyStrip: (
      <>
        {/*
          debt: tableControls is layer:true in every row (D1) but renders in flow, as two tenants of the party and story slots — step 10's dismissible layer and its trigger do not exist yet, and a closed overlay would take the DM's session controls away.
          ceiling: exactly these two nodes; a THIRD in-flow layer tenant is the finding.
          until: step 10 lands TableControls as a real layer (plan §5 step 10, D1) — then both nodes leave this call site and the row's layer:true becomes their only placement.
        */}
        <SessionControls
          isDm={isDm}
          sessionActionBusy={sessionActionBusy}
          isEnded={isEnded}
          isPaused={isPaused}
          onTogglePause={() => void onTogglePause()}
          onEndSessionRequest={() => setEndSessionConfirmOpen(true)}
          xpToggleBtnRef={xpToggleBtnRef}
          xpFormOpen={xpFormOpen}
          setXpFormOpen={setXpFormOpen}
          xpAmount={xpAmount}
          setXpAmount={setXpAmount}
          xpReason={xpReason}
          setXpReason={setXpReason}
          xpAmountValid={xpAmountValid}
          onAwardXp={() => void onAwardXp()}
          sessionId={sessionId}
          participants={participants}
          username={username}
          startingLevel={session?.starting_level ?? 1}
          onCampaignFloorChanged={() => {
            void refreshSessionAfterAction();
            getParticipants(sessionId)
              .then(setParticipants)
              .catch(() => {
                /* non-fatal — roster refreshes on the next poll */
              });
          }}
        />
        <PartyStrip
          participants={participants}
          variant={variantFor(row, 'partyStrip', moment)}
          selfUsername={username}
          combatState={combatState}
          onSelectMember={memberSheetDrawer.onSelectMember}
          isDm={isDm}
          sessionId={sessionId}
          combatIsActive={combatIsActive}
          sessionLocked={sessionLocked}
          onRebindChanged={onRebindChanged}
          round={round}
          selfPcId={selfPcId}
        />
      </>
    ),
    // Build brief §5 S-d: table.characterBlock.variant='full' has no
    // implementation until step 7 — correct for the contract (R21 is the
    // end state), not a bug. Rendered only when NOT a layer (table); the
    // Drawer (in `layers` below) renders it when it IS a layer (story/phone).
    characterBlock: !characterBlockIsLayer ? memberSheetPanelNode : undefined,
    // R10: with AI assist off the presence is absent (the slot stays mounted, empty).
    suzuPresence: showSuzuPanel ? <SuzuPresence variant={variantFor(row, 'suzuPresence', moment)} talking={talking} /> : undefined,
    storyLog: (
      <>
        <StoryLog
          rows={log}
          thinking={thinking || resumeThinking}
          thinkingLabel={resumeThinking ? "Resuming Suzu's turn…" : undefined}
          participants={participants}
        />
        {/* debt: see the identical marker on `regions.partyStrip` above —
           this is the second of the two in-flow layer tenants it names. */}
        <DmCombatControls
          isHumanDM={isHumanDM}
          combatIsActive={combatIsActive}
          combatState={combatState}
          combatId={combatId}
          sessionId={sessionId}
          dmUsername={session?.dm_username ?? username ?? ''}
          overridePlayerVisible={session?.dm_override_player_visible ?? true}
          dmPanelAnchorRef={dmPanelAnchorRef}
          localTurnActionRef={localTurnActionRef}
          appendLog={appendLog}
          onCombatStateUpdate={(newState) => {
            stateSeqRef.current += 1;
            setCombatState(newState);
          }}
          onCombatStateRefresh={() => {
            if (!combatId) return;
            void (async () => {
              const cs = await getCombatState(combatId).catch(() => null);
              if (cs) {
                stateSeqRef.current += 1;
                setCombatState(cs);
              }
            })();
          }}
          combatBusy={combatBusy}
          sessionLocked={sessionLocked}
          onCombatBusyChange={setCombatBusy}
        />
      </>
    ),
    offers: (
      <Offers
        availableChecks={availableChecks}
        offeredCheckSkill={offeredCheckSkill}
        checkBusy={checkBusy}
        talking={talking}
        sessionLocked={sessionLocked}
        onAttemptCheck={(skill) => void onAttemptCheck(skill)}
        checkWrapRef={checkWrapRef}
        freeformOfferedCheck={freeformOfferedCheck}
        freeformCheckRef={freeformCheckRef}
        rollBusy={rollBusy}
        combatBusy={combatBusy}
        onRoll={(trigger) => void onRoll(trigger)}
        availableTransitions={availableTransitions}
        adventureComplete={adventureComplete}
        transitionWrapRef={transitionWrapRef}
        sceneAdvanceBusy={sceneAdvanceBusy}
        onMoveOn={(to) => void onMoveOn(to)}
        variant={variantFor(row, 'offers', moment)}
      />
    ),
    // S-d's sibling gap (build brief §5): `actionBar` is placed (non-null
    // area) in BOTH moments by every row, but the component itself still
    // only understands combat data — there is no "vitals" exploring-moment
    // rendering built yet (that is Composer's own step-11 "wrapped,
    // shrinks" territory). Mount condition UNCHANGED from pre-shell
    // page.tsx: combat only. The exploring-moment slot is a reserved,
    // empty grid cell until that step builds the content.
    actionBar:
      !(isHumanDM && !isDmPlayingOwnPc) && combatIsActive ? (
        <ActionBar
          targets={targetableFoes}
          onAction={onCombatAction}
          // DDX-25: reuse the rail's existing `busy` gate (same disabled
          // styling/aria as an in-flight combat action) to also lock it
          // out while the session is paused/ended.
          busy={combatBusy || sessionLocked}
          isPlayerTurn={isPlayerTurn}
          refusedReason={refusedReason}
          // Combat-UX Fixes 2026-07-27, Fix B.
          isDying={isDying}
          // TAV-ATTACK-BUTTON-STALE: server-side action economy.
          actionSpent={myActionSpent}
          deathSaves={deathSaveTally(activeParticipant)}
          variant={variantFor(row, 'actionBar', moment)}
          outerRailRef={composerRailAnchorRef}
          localTurnActionRef={localTurnActionRef}
        />
      ) : undefined,
    composer: (
      <Composer
        value={msg}
        onChange={setMsg}
        mode={mode}
        onMode={(m) => {
          setMode(m);
          // Clear any pending DM narration error when the DM switches modes.
          if (m !== 'dm_narration') setDmNarrationError(null);
        }}
        onSend={onSend}
        // DDX-25: a paused/ended session shouldn't accept turns — extend the
        // existing `talking` disabled-gate rather than inventing a new one.
        disabled={talking || sessionLocked}
        // TAV-PLAY-INPUT-LOCK-NO-FEEDBACK (2026-08-01): say WHY the input is
        // inert. Order matters — a locked session stays locked through a
        // narration beat, so the lock reason wins over the transient one.
        disabledReason={
          isEnded
            ? 'This session has ended.'
            : isPaused
              ? 'Session is paused.'
              : talking
                ? 'Suzu is narrating — one moment…'
                : null
        }
        availableModes={composerModes}
        pending={dmNarrationPending}
        sendError={mode === 'dm_narration' ? dmNarrationError : null}
        textareaAnchorRef={composerTextareaAnchorRef}
      />
    ),
    sceneStage: (
      <SceneStage
        sceneName={grounding?.scene_name ?? null}
        objective={grounding?.objective ?? null}
        sceneHeadRef={sceneHeadRef}
        combatIsActive={combatIsActive}
        activeEncounterId={activeEncounterId}
        sceneHasEncounter={sceneHasEncounter}
        combatBusy={combatBusy}
        endCombatBtnRef={endCombatBtnRef}
        outcomeChooserOpen={outcomeChooserOpen}
        setOutcomeChooserOpen={setOutcomeChooserOpen}
        lastOpenerRef={lastOpenerRef}
        allHostilesDown={allHostilesDown}
        anyMonsterDown={anyMonsterDown}
        onEndCombat={(key) => void onEndCombat(key)}
        beginCombatRef={beginCombatRef}
        onBeginEncounter={beginEncounter}
        talking={talking} sessionLocked={sessionLocked} rollBusy={rollBusy} round={round}
        variant={variantFor(row, 'sceneStage', moment)}
      />
    ),
  };

  const tenants: Partial<Record<TenantId, ReactNode>> = {
    sessionRecap: <SessionRecapTenant session={session} username={username} stepAside={combatIsActive} />,
    sessionPausedEnded: <SessionPausedEndedTenant isEnded={isEnded} isPaused={isPaused} />,
    turnStatus: (
      <TurnStatusTenant
        combatIsActive={combatIsActive}
        activeIsMine={activeIsMine}
        turnStatusText={turnStatusText}
      />
    ),
    deadStatus: <DeadStatusTenant combatIsActive={combatIsActive} isMyPcDead={isMyPcDead} />,
    durableRetryRow: (
      <DurableRetryRowTenant
        durableRetryRowRef={durableRetryRowRef}
        jobFailed={jobFailed}
        onRetryFailedTurn={onRetryFailedTurn}
      />
    ),
    castSpellPanel: (
      <CastSpellTenant
        isDmPlayingOwnPc={isDmPlayingOwnPc}
        isHumanDM={isHumanDM}
        combatIsActive={combatIsActive}
        combatState={combatState}
        combatId={combatId}
        myCharacterIdStr={myCharacterIdStr}
        mySheet={mySheet}
        username={username}
        isPlayerTurn={isPlayerTurn}
        combatBusy={combatBusy}
        sessionLocked={sessionLocked}
        onCast={(text) => appendLog({ who: username ?? 'you', kind: 'system', text })}
        onSheetChanged={setMySheet}
        onStateRefresh={() => {
          if (!combatId) return;
          void (async () => {
            const cs = await getCombatState(combatId).catch(() => null);
            if (cs) {
              stateSeqRef.current += 1;
              setCombatState(cs);
            }
          })();
        }}
        onBusyChange={setCombatBusy}
      />
    ),
    // T4p2: completion next-part offer (design doc §6.4) — a tenant of
    // `storyLog`, not `offers` (Amendment B.4, S6: `offers` is the one
    // region that goes `visible:false`; this is a distinct affordance).
    nextPartOffer:
      adventureComplete && completionSeries ? (
        <NextPartOffer
          series={completionSeries.series}
          next={completionSeries.next}
          className={styles.moveOnWrap}
          data-tenant="nextPartOffer"
        />
      ) : undefined,
    // debt: the dice are not rendered on the phone between A9d-2 N5 and N7: the stage is a one-row strip there (`inline`), and the tray (357px of dice and quick checks) was its tenant. ceiling: the commits between N5 and N7 of the fix round, none deployed; the harness's o:restControls and z:modeRow are red in that window by construction ("no Roll control and no dice tray").
    // until: N7 (Roll in the composer's mode row) puts the tray behind Roll in an anchored popover, and this line becomes the composer variant's choice.
    diceTray: variantFor(row, 'sceneStage', moment) === 'inline' ? undefined : (
      <div className={styles.diceWrap} data-tenant="diceTray">
        {/* A2 — real character skill modifiers; null=loading or []=DM-only hide checks */}
        <DiceTray
          onRoll={onRoll}
          quickChecks={quickChecks ?? []}
          advantage={advantage}
          onAdvantage={setAdvantage}
          disabled={talking || combatBusy || sessionLocked || rollBusy}
        />
      </div>
    ),
    safetyControls: <SafetyControls xCardBusy={xCardBusy} onRaiseXCard={onRaiseXCard} />,
  };

  return (
    <PlayShell
      row={row}
      moment={moment}
      regions={regions}
      tenants={tenants}
      foldSpecs={FOLD_SPECS}
      foldedRegions={foldedRegions}
      onToggleFold={onToggleFold}
      layers={
        <>
          {/* Both drawers go through the shared <Drawer> primitive
              (src/components/Drawer.tsx): always mounted (A5), `open` drives
              class + scrim + `inert` + dialog semantics together (A6). One
              presentation at every width (A9d E4). */}

          {/* DDX-22: Journal / Memory pane — right-edge slide-over at every
              width, opened from the header's "Open journal" toggle. */}
          <Drawer
            id={journalDrawer.id}
            open={journalDrawer.open}
            labelledBy={JOURNAL_HEADING_ID}
            onClose={journalDrawer.onClose}
            closeButtonRef={journalDrawer.closeButtonRef}
          >
            <JournalPane
              sessionId={sessionId}
              events={journalDrawer.journalEvents}
              grounding={grounding}
              onClose={journalDrawer.onClose}
              closeButtonRef={journalDrawer.closeButtonRef}
            />
          </Drawer>

          {/* TAV-PARTY-INLINE-SHEET: a right-edge slide-over drawer for a
              selected party member's sheet, the same presentation as the
              Journal. ALWAYS mounted (A5) — its CONTENT is the panel
              only when `characterBlock` is a LAYER this row (story/phone);
              table docks the panel into `regions.characterBlock` instead
              (mutually exclusive, see that singleton's own comment above),
              and `memberSheetDrawer.open` is false while docked. */}
          <Drawer
            id={memberSheetDrawer.id}
            open={memberSheetDrawer.open}
            labelledBy={MEMBER_SHEET_HEADING_ID}
            onClose={memberSheetDrawer.onClose}
            closeButtonRef={memberSheetDrawer.closeButtonRef}
          >
            {characterBlockIsLayer ? memberSheetPanelNode : null}
          </Drawer>

          {/* DDX-25: portal-rendered to document.body (ConfirmDialog does this
              internally) — position in the tree doesn't matter; kept here after
              all three panes purely for file readability. */}
          <ConfirmDialog
            open={endSessionConfirmOpen}
            tone="danger"
            title="End this session?"
            body="This ends the table for everyone at it. Players won't be able to act until a new session starts. This can't be undone from here."
            // DDX-25: deliberately NOT "End session" — the left-pane trigger
            // already has that accessible name, and both are on screen at once
            // while the dialog is open (mirrors DeleteCampaignButton's trigger
            // "Delete campaign" → confirm "Move to trash" convention).
            confirmLabel="End it"
            cancelLabel="Keep playing"
            busy={sessionActionBusy === 'end'}
            onConfirm={() => void onConfirmEndSession()}
            onCancel={() => setEndSessionConfirmOpen(false)}
          />
        </>
      }
    />
  );
}
