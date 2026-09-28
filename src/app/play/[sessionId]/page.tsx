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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type {
  CharacterSheet,
  EngineSessionEvent,
  Participant,
} from '@/lib/api/types';
import type { QuickCheck } from '@/components/DiceTray';
import Icon from '@/components/Icon';
import Pill from '@/components/Pill';
import PageSkeleton from '@/components/PageSkeleton';
import CastSpellPanel from '@/components/CastSpellPanel';
import SessionRecap from '@/components/SessionRecap';
import { type LogRow } from '@/components/ChatLog';
import DiceTray from '@/components/DiceTray';
import Composer, { type ComposeMode } from '@/components/Composer';
import ConfirmDialog from '@/components/ConfirmDialog';
import Drawer from '@/components/Drawer';
import SafetyBanner from './regions/SafetyBanner';
import { SessionControls, DmCombatControls } from './regions/TableControls';
import PartyStrip from './regions/PartyStrip';
import SceneStage from './regions/SceneStage';
import Offers from './regions/Offers';
import StoryLog from './regions/StoryLog';
import { SessionHead, TopBar } from './regions/TopBar';
import { buildReadAloudBlock, scanXCardTracking } from './format';
import { useSessionLifecycle } from './hooks/useSessionLifecycle';
import { useMyCharacter } from './hooks/useMyCharacter';
import { useSafety } from './hooks/useSafety';
import { useTranscript } from './hooks/useTranscript';
import { useCombatState } from './hooks/useCombatState';
import { useSceneState } from './hooks/useSceneState';
import { useNarration } from './hooks/useNarration';
import { useDice } from './hooks/useDice';
import { useSceneActions } from './hooks/useSceneActions';
import { useCombatActions } from './hooks/useCombatActions';
import { useSessionEvents } from './hooks/useSessionEvents';
import JournalPane, { JOURNAL_HEADING_ID } from '@/components/JournalPane';
import MemberSheetPanel, { MEMBER_SHEET_HEADING_ID } from '@/components/MemberSheetPanel';
import NextPartOffer from '@/components/NextPartOffer';
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
  // idRef/logRef/chatLogRef + the DM-STREAM row writers
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
    pendingByKeyRef, chatLogRef, clearStreamNarration,
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
  const [mobileView, setMobileView] = useState<'log' | 'party' | 'scene' | 'journal'>('log');

  // DDX-22: Journal / Memory pane. `journalEvents` mirrors the SAME raw
  // session-event log rehydration + the dice-roll/events poll already fetch
  // below (getSessionEventsRaw) — no new poll is added for this. `journalOpen`
  // is the DESKTOP drawer's own open/closed state; it is intentionally
  // independent of `mobileView` (the drawer and the mobile tab are two
  // different presentations of the same always-mounted <aside>, gated apart
  // by CSS media queries — see Play.module.css).
  const [journalEvents, setJournalEvents] = useState<EngineSessionEvent[]>([]);
  const [journalOpen, setJournalOpen] = useState(false);
  // TAV-PLAY-SHELL step 2: the dialog ref + previously-focused ref both
  // moved into <Drawer> (Tab-trap query + focus restore are now its own
  // internal concern) — journalCloseBtnRef stays here because it is ALSO
  // passed straight through to <JournalPane>, which renders the actual
  // close <button ref={closeButtonRef}>.
  const journalCloseBtnRef = useRef<HTMLButtonElement>(null);

  // Iro MEDIUM-2: persistent turn-status text so one mounted live region mutates
  // in place instead of two regions mounting/unmounting on every poll cycle.

  // grounding/sceneAdvanceBusy/adventureComplete/completionSeries/checkBusy/
  // offeredCheckSkill/freeformOfferedCheck moved into useScene (TAV-PLAY-SHELL
  // step 5 hook 4) -- see the useScene() call below, right after appendLog.

  // TAV-PARTY-INLINE-SHEET: clicking a party card used to navigate to
  // /character/[id], reloading the whole session — this instead opens the
  // selected member's sheet in an inline drawer (mirrors the Journal drawer
  // below: always-mounted <aside>, gated by `memberSheetOpen`/
  // `memberSheetVisible`, scrim, focus-trap, Esc via consumeEscape). The
  // fetched sheet + the clicked row's display name persist across a close
  // (only cleared on the NEXT selection) so the slide-out transition has a
  // "from" state to animate, exactly like `journalEvents` above.
  const [memberSheetOpen, setMemberSheetOpen] = useState(false);
  const [selectedMemberSheet, setSelectedMemberSheet] = useState<CharacterSheet | null>(null);
  const [selectedMemberName, setSelectedMemberName] = useState<string | null>(null);
  // LVL (Aoi gap B): whether the drawer is showing the viewer's OWN sheet —
  // drives MemberSheetPanel's pending-choices callout (the read-only drawer
  // can't resolve choices; for your own row it must at least point at the
  // character page that can).
  const [selectedMemberIsSelf, setSelectedMemberIsSelf] = useState(false);
  const [memberSheetLoading, setMemberSheetLoading] = useState(false);
  const [memberSheetError, setMemberSheetError] = useState(false);
  // TAV-PLAY-SHELL step 2: dialog ref + previously-focused ref moved into
  // <Drawer> — see the matching comment on journalCloseBtnRef above.
  const memberSheetCloseBtnRef = useRef<HTMLButtonElement>(null);

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
  // DDX-20 F9+Recap Post-Review Fix (Kage-CR IMPORTANT / Miko-QA MEDIUM,
  // fold commit) — a SEPARATE ledger for journalEvents' own merge-by-seq
  // dedup (`useSessionEvents.ts`'s `pollDurable`, A4). Cannot reuse
  // renderedSeqsRef: that one tracks
  // the TRANSCRIPT log (reconcileDurableEvents' rule 1), a different array
  // with a different lifecycle from journalEvents (DDX-22's raw event feed,
  // covering every kind the transcript doesn't render too — recap,
  // scene_advance, npcs_introduced). Seeded at mount alongside journalEvents
  // itself (below); mutated key-by-key AS pollDurable iterates its batch —
  // mirrors reconcileDurableEvents' own rule 1, which is intra-tick safe for
  // the same reason: it checks-and-adds one event at a time instead of
  // computing a static "seen" snapshot once per tick. A missing `seq`
  // normalizes to the shared key `0` (see `useSessionEvents.ts`'s
  // `pollDurable` for the justification) rather than being treated as
  // unconditionally unique.
  //
  // Invariant (Kage-CR SUGGESTION, this pass): journalEvents and this ref
  // must stay in lockstep on every path reachable while
  // DURABLE_GENERATION_ENABLED is true, or pollDurable's merge-by-seq dedup
  // silently desyncs from what's actually rendered. Today that's the
  // mount-time seed (paired in the same `if` block) and pollDurable's own
  // merge (paired via the check-and-add loop that runs before its
  // setJournalEvents call). The flag-OFF poll's own setJournalEvents is
  // exempt ONLY because this ref is never read flag-OFF — not a license to
  // skip pairing on a future writer that IS reachable flag-ON. No test
  // asserts this pairing directly (only its observable effect via
  // pollDurable's dedup counters), so a writer that forgets it would break
  // dedup silently.
  const journalSeenSeqsRef = useRef<Set<number>>(new Set());
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
  // hook's destructure above. idRef/chatLogRef moved into useTranscript
  // (TAV-PLAY-SHELL step 5 hook 4, Amendment A §A.2 row 4) — see that
  // hook's destructure above.

  // Tora MAJOR-2: ref for the "End" trigger button so focus returns to it when
  // the outcome chooser is closed via Escape.
  const endCombatBtnRef = useRef<HTMLButtonElement>(null);
  // Iro MAJOR-1: the outcome chooser now has two openers ("End" and "Wrap
  // up") — capture whichever one actually opened it so Escape/Cancel refocus
  // the real opener instead of always the "End" button. `endCombatBtnRef`
  // stays as the fallback (e.g. if the chooser is ever opened programmatically).
  const lastOpenerRef = useRef<HTMLButtonElement | null>(null);

  // Kage-CR A6 IMPORTANT-1: diceRollPollIntervalRef briefly lived on
  // useDice's return, which inverted Amendment A §A.3 edge R4's principle
  // ("useSessionEvents owns the interval, not the ledger") -- useDice
  // neither read nor wrote it. Resolved outright, not deferred (A4 commit
  // 0): the poll effect, now in `hooks/useSessionEvents.ts`, owns a plain
  // effect-local interval id instead.

  // sceneHeadRef/checkWrapRef/transitionWrapRef/freeformCheckRef moved into
  // useScene (TAV-PLAY-SHELL step 5 hook 4) — see the useScene() call below.

  // TAV-COMBAT-VERB-NO-MECHANICS — the "Stand and fight" button itself. The
  // guard's whole contract is refuse-AND-PROMPT: withholding the turn is only
  // half of it, so on a refusal we move focus onto the control the refusal
  // names. Legitimate change-of-context (it follows the player's own Send
  // activation, not a focus event), and it is the only thing that makes the
  // prompt reachable for a keyboard/screen-reader player without hunting.
  const beginCombatRef = useRef<HTMLButtonElement>(null);

  // Tora MAJOR-2: same stranded-focus problem as above, but at a combat
  // turn boundary — a rail button (player Attack/Dodge/Dash/End-turn, or DM
  // per-monster Attack/Skip/Move) that triggers a turn flip becomes
  // `disabled` and the browser force-blurs it to <body>. These anchor the
  // newly-enabled rail so `refocusOnTurnFlip` below (mirrors
  // `refocusSceneHeadIfStranded`'s rAF-after-commit stranding check) can land
  // focus there instead of forcing a full re-tab. Falls back to sceneHeadRef.
  const composerRailAnchorRef = useRef<HTMLDivElement>(null);
  const dmPanelAnchorRef = useRef<HTMLElement>(null);
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
    refocusSceneHeadIfStranded, applyOfferedCheckSignal, openScene,
  } = sceneState;

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
    talking, setTalking, thinking, setThinking, setActiveJob,
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
          setJournalEvents(sortedRawEvents);
          if (DURABLE_GENERATION_ENABLED) {
            journalSeenSeqsRef.current = new Set(sortedRawEvents.map((e) => e.seq ?? 0));
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
    const thisDm = !!(session.dm_username && username &&
      session.dm_username.toLowerCase() === username.toLowerCase());
    if (thisDm && session.dm_mode === 'human') {
      setMode('dm_narration');
    }
  }

  // The combat-state poll (4s, foregrounded) moved into useCombatState
  // (TAV-PLAY-SHELL step 5 hook 5a) — same deps ([combatId] only), same
  // load-bearing comment, unchanged, in that hook's own file now.

  // Re-pin the chat to the latest line when returning to the Story view.
  // chatLogRef listed (TAV-PLAY-SHELL A3): now sourced from useTranscript's
  // destructure, so exhaustive-deps can no longer prove it's a stable ref
  // object the way a page.tsx-local useRef() call is. Same object identity
  // every render either way — zero behaviour change.
  useEffect(() => {
    if (mobileView === 'log') chatLogRef.current?.scrollToBottom('instant');
  }, [mobileView, chatLogRef]);

  // DDX-22 — Journal: true whenever the journal is actually presented to the
  // user in ANY form (open desktop drawer OR the active mobile tab). Drives
  // `inert` on the always-mounted <aside> below so a CLOSED-but-still-mounted
  // desktop drawer (kept mounted purely so its slide-out transition has a
  // "from" state) is removed from the tab order / a11y tree, while the
  // mobile tab (governed entirely by CSS, not `journalOpen`) is never
  // accidentally made inert by the drawer's own closed state.
  const journalVisible = journalOpen || mobileView === 'journal';

  // "Close" is one unified action regardless of which presentation is active:
  // on desktop it closes the drawer; on the mobile tab (where there's no
  // drawer to close) it's the natural "back to the table" affordance,
  // switching back to Story. Neither branch is a no-op-turned-bug at the
  // OTHER breakpoint's default state.
  const closeJournal = useCallback(() => {
    setJournalOpen(false);
    setMobileView((v) => (v === 'journal' ? 'log' : v));
  }, []);

  // TAV-PLAY-SHELL step 2: focus management (remember/restore + focus the
  // close button on open) and the Esc+Tab-trap keydown handler both moved
  // into <Drawer> — it owns both internally now, driven by the `open`/
  // `onClose`/`closeButtonRef` props passed at the JSX call site below.

  // TAV-PARTY-INLINE-SHEET: "close" only flips the open flag — the fetched
  // sheet/name/error state stay mounted (mirrors closeJournal not clearing
  // journalEvents) so the drawer's slide-out transition has a "from" state,
  // and re-opening the SAME member instantly shows their last-loaded sheet
  // instead of flashing back to loading.
  const closeMemberSheet = useCallback(() => {
    setMemberSheetOpen(false);
    // Kage n3: don't leave the previous selection's self-flag lingering
    // between opens (always re-set on open, but stale state is stale state).
    setSelectedMemberIsSelf(false);
  }, []);

  // TAV-PLAY-SHELL step 2: focus management + Esc/Tab-trap moved into
  // <Drawer> — see the matching comment above closeJournal.

  // TAV-PARTY-INLINE-SHEET: PartyPanel's card onClick. The viewer's own row
  // reuses the already-loaded `mySheet` (no extra hop); any other member's
  // row fetches their sheet fresh via the same getCharacterSheet call the
  // rebind-onChanged path above already uses. Errors surface inline in the
  // drawer (MemberSheetPanel's own error branch) rather than a toast — the
  // drawer is already the "here's what went wrong" surface.
  const onSelectMember = useCallback(
    (p: Participant) => {
      if (!p.character) return;
      setMemberSheetOpen(true);
      setSelectedMemberName(p.character.name ?? p.username);
      const isSelf = p.username.toLowerCase() === (username ?? '').toLowerCase();
      setSelectedMemberIsSelf(isSelf);
      if (isSelf && mySheet) {
        setSelectedMemberSheet(mySheet);
        setMemberSheetError(false);
        setMemberSheetLoading(false);
        return;
      }
      setSelectedMemberSheet(null);
      setMemberSheetError(false);
      setMemberSheetLoading(true);
      getCharacterSheet(String(p.character.character_id), username ?? '')
        .then((sheet) => {
          setSelectedMemberSheet(sheet);
          setMemberSheetLoading(false);
        })
        .catch(() => {
          setMemberSheetError(true);
          setMemberSheetLoading(false);
        });
    },
    [username, mySheet],
  );

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
    checkWrapRef, setGrounding, diffAndExplainResolvedChecks,
    refocusSceneHeadIfStranded, applyOfferedCheckSignal, setOfferedCheckSkill,
    setFreeformOfferedCheck,
    setActiveJob, setJobFailed, setThinking, setTalking, subscribedJobIdRef,
    turnKeyRef, pollFailureGraceRef, narrationAbort, subscribeToJob,
    setXCardEvent, setLatestNarrationSeq,
    journalSeenSeqsRef, setJournalEvents,
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
  // debt: stays here instead of moving into useSessionLifecycle -- it also
  // reads the journal drawer's journalOpen, which this hook doesn't own.
  // ceiling: no additional cross-concern read added. until: the journal
  // drawer's own hook exists. (outcomeChooserOpen's half of this resolved at
  // A2 -- it is now a plain downward read off useCombatState's destructure
  // above, same shape as any other hook consumer, not a blocker anymore.)
  useEffect(() => {
    if (!xpFormOpen) return;
    const onDocumentKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (outcomeChooserOpen || endSessionConfirmOpen || journalOpen) return;
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
  }, [xpFormOpen, outcomeChooserOpen, endSessionConfirmOpen, journalOpen, sessionActionBusy, setXpFormOpen, xpToggleBtnRef]);

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

  // TAV-BUSY-DISABLED-FOCUS-PARK (1.7 audit): the "Roll death save" row —
  // button AND pips — is gated purely on `isDying`, so the roll that SAVES you
  // unmounts the control you just pressed and drops focus to <body>. Verified
  // live on .226: a natural 20 revived at 1 HP and focus was stranded.
  //
  // The sibling effect above cannot cover this. It is keyed on
  // `active_participant_id` CHANGING, and a stabilize does not change it —
  // `make_death_save`'s 20-crit / 3rd-success branch sets current_hp = 1 and
  // clears the counters WITHOUT advancing the turn. So this is a genuinely
  // different transition: same participant, `isDying` true -> false.
  //
  // Gated on the stranding check alone, deliberately: it can only ever fire
  // when focus is ALREADY lost, so unlike the turn-change effect it needs no
  // provenance flag and can never steal focus from anywhere. The rail anchor
  // survives — only the deathSaveRow child unmounts.
  const prevIsDyingRef = useRef(false);
  useEffect(() => {
    const was = prevIsDyingRef.current;
    prevIsDyingRef.current = isDying;
    if (!was || isDying) return;
    requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      composerRailAnchorRef.current?.focus({ preventScroll: true });
    });
  }, [isDying]);

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
  // TAV-COMBAT-VERB-NO-MECHANICS — the precise gate for the combat-verb
  // guard, deliberately NOT `sceneHasEncounter`. That flag is only "this
  // scene authors an encounter block", which stays true after the fight is
  // over; refusing "I attack" over a resolved encounter and pointing at
  // "Stand and fight" would be actively wrong. This mirrors NekoNova's
  // `core/dm_narrator.py::combat_encounter_unstarted` exactly — kind must be
  // `combat`, and the encounter must have NO `encounter_state` entry at all
  // (an entry is stamped `unresolved` the moment combat starts and becomes
  // `resolved_*` after, so PRESENCE either way means "not our case").
  // `grounding.encounter_state` is the flattened
  // `campaign.progress.encounter_state` (see dnd.ts normalizeGrounding),
  // i.e. the same dict the engine hands the narrator.
  //
  // `combatEncounterUnstarted`/`sceneCreatureNames` below read `grounding`
  // (from useScene's destructure above) but stay in page.tsx -- they exist
  // for the combat-verb guard (plan §1.4) and read `grounding`, a tier-6
  // concern neither useCombatState (tier 5, composed above useScene) nor
  // useCombatActions (composed after useScene, but not named as this
  // derivation's owner in Amendment A §A.6) can claim -- not scene's either.
  const combatEncounterUnstarted = useMemo(() => {
    const enc = grounding?.encounter;
    if (!enc || typeof enc !== 'object') return false;
    if (enc.kind !== 'combat') return false;
    const encId = typeof enc.id === 'string' ? enc.id : '';
    if (!encId) return false;
    const encState = grounding?.encounter_state;
    if (!encState || typeof encState !== 'object') return true;
    return !(encId in encState);
  }, [grounding]);

  // The scene's authored creature names, for the guard's tier-2 (targeted)
  // matcher. `monsters_resolved` is projected flavor-only by the engine
  // (project_monster_for_wire) and is present pre-combat — see
  // creatureKeywords' doc block. Defensive: any non-array/odd shape yields [].
  const sceneCreatureNames = useMemo<string[]>(() => {
    const raw = (grounding?.encounter as { monsters_resolved?: unknown } | null | undefined)
      ?.monsters_resolved;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((m) => (m && typeof m === 'object' ? (m as { name?: unknown }).name : undefined))
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
  }, [grounding]);

  const prevSceneHasEncounterRef = useRef(sceneHasEncounter);
  useEffect(() => {
    if (sceneHasEncounter && !prevSceneHasEncounterRef.current && !combatId) {
      toast({
        tone: 'warn',
        message: 'This scene can turn into a fight — "Stand and fight" is ready when you are.',
      });
    }
    prevSceneHasEncounterRef.current = sceneHasEncounter;
  }, [sceneHasEncounter, combatId, toast]);

  // Iro-A11y CRITICAL-1 — focus-strand on unmount. Making `sceneHasEncounter`
  // a MOUNT condition (not just a copy signal, see above) means the button
  // can disappear out from under a focused user: a background poll/grounding
  // refresh moving the scene to one with no encounter, OR the button's own
  // successful click (which sets combatId, taking the SAME ternary branch to
  // `null`), can both unmount it while it may still hold focus. The browser
  // force-blurs to <body> in that case and nothing recovers it. Unlike
  // `refocusSceneHeadIfStranded` above (called synchronously from inside a
  // click handler, which captures `hadFocusInGroup` BEFORE its own state
  // update because several sibling groups could have had focus), this effect
  // has no single triggering user gesture to race — poll, click, and scene
  // advance can all independently flip the button's visibility — so it
  // instead watches the computed visibility itself and reacts on the
  // FALLING edge (true -> false), using the same rAF-after-commit +
  // `document.activeElement === document.body` check to avoid stomping a
  // user who had already tabbed elsewhere in the interim. Seeded to `false`
  // so the first render (whatever `sceneHasEncounter` happens to be on
  // mount) can never satisfy the falling-edge condition — no refocus fires
  // on initial mount.
  const beginEncounterVisibleRef = useRef(false);
  useEffect(() => {
    const nowVisible = !combatId && sceneHasEncounter;
    if (beginEncounterVisibleRef.current && !nowVisible) {
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) {
          sceneHeadRef.current?.focus();
        }
      });
    }
    beginEncounterVisibleRef.current = nowVisible;
    // sceneHeadRef: same "stable but linter can't prove it" reason as the
    // turn-change refocus effect above.
  }, [combatId, sceneHasEncounter, sceneHeadRef]);

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
  ]);

  // NOTE (TAV-PLAY-INPUT-LOCK-NO-FEEDBACK review, 2026-08-01): the composer
  // lock (`talking`/paused/ended/`dmNarrationPending`) strands keyboard focus
  // on <body> when it disables the control the user was on — a real gap (Iro
  // MAJOR-1), deliberately NOT patched inline here: a naive rising-edge
  // refocus fires on session load and teleports the DM to the scene heading
  // on every send (Kage IMPORTANT-3). Tracked as its own story
  // (TAV-COMPOSER-FOCUS-STRAND) with the design constraints: route through
  // refocusSceneHeadIfStranded's provenance flag, restore toward the
  // composer/ChatLog on the falling edge, and pin it with a test.

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
    <Pill tone="lav" dot>
      round {round ?? 1} · combat
    </Pill>
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
  // still uses the full `statusPill` with its round, since nothing else on
  // that path states it.
  const narratorStatusPill = combatIsActive ? (
    <Pill tone="lav" dot>
      combat
    </Pill>
  ) : statusPill;

  const mobileClass =
    mobileView === 'scene'
      ? styles.showScene
      : mobileView === 'party'
        ? styles.showParty
        : mobileView === 'journal'
          ? styles.showJournal
          : styles.showLog;

  // selfPcId now comes from useCombatState's destructure above.

  return (
    <div id="main-content" className={`${styles.grid} ${mobileClass}`}>
      {/* mobile tab bar */}
      <div className={styles.mobileTabs} role="group" aria-label="Play view">
        <button
          type="button"
          className={mobileView === 'log' ? styles.tabOn : undefined}
          aria-pressed={mobileView === 'log'}
          aria-controls="play-pane-story"
          onClick={() => setMobileView('log')}
        >
          <Icon name="Chat" size={13} aria-hidden /> Story
        </button>
        <button
          type="button"
          className={mobileView === 'party' ? styles.tabOn : undefined}
          aria-pressed={mobileView === 'party'}
          aria-controls="play-pane-party"
          onClick={() => setMobileView('party')}
        >
          <Icon name="Users" size={13} aria-hidden /> Party
        </button>
        <button
          type="button"
          className={mobileView === 'scene' ? styles.tabOn : undefined}
          aria-pressed={mobileView === 'scene'}
          aria-controls="play-pane-scene"
          onClick={() => setMobileView('scene')}
        >
          <Icon name="Map" size={13} aria-hidden /> Scene
        </button>
        {/* DDX-22: 4th mobile tab — joins the existing group exactly like the
            three above (same aria-pressed/aria-controls/44px-target shape). */}
        <button
          type="button"
          className={mobileView === 'journal' ? styles.tabOn : undefined}
          aria-pressed={mobileView === 'journal'}
          aria-controls="play-pane-journal"
          onClick={() => setMobileView('journal')}
        >
          <Icon name="Lantern" size={13} aria-hidden /> Journal
        </button>
      </div>

      {/* TAV-PLAY-SHELL step 3: region extracted verbatim to
          regions/SafetyBanner.tsx — see its own doc comment for the DDX-26/
          Iro CRITICAL-1/MAJOR-1/MAJOR-2 history (hoisted here as a sibling
          of .mobileTabs, own "banner" grid-area, permanently mounted,
          stable refocus anchor). State/refs/the refocus-before-unmount
          sequencing all stay here in page.tsx. */}
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

      {/* LEFT — party + initiative */}
      {/* TAV-PLAY-LANDMARKS: stable landmark name so AT landmark navigation
          announces "Party and initiative, complementary" instead of a bare
          "complementary". */}
      <aside
        id="play-pane-party"
        className={`${styles.pane} ${styles.left}`}
        aria-label="Party and initiative"
      >
        {/* TAV-PLAY-SHELL step 3: region extracted verbatim to
            regions/TopBar.tsx's SessionHead export. */}
        <SessionHead
          title={title}
          journalOpen={journalOpen}
          onToggleJournal={() => setJournalOpen((v) => !v)}
        />
        {/* TAV-PLAY-SHELL step 3: region extracted verbatim to
            regions/TableControls.tsx's SessionControls export (DDX-25 DM-only
            session lifecycle controls + GrantCurrencyPanel + CampaignFloorPanel).
            State/refs/handlers stay in page.tsx. */}
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
        {/* TAV-PLAY-SHELL step 3: region extracted verbatim to
            regions/PartyStrip.tsx (PartyPanel + rebind affordances +
            InitiativeTracker, decomposition plan §2.3 "survives as-is"). */}
        <PartyStrip
          participants={participants}
          selfUsername={username}
          combatState={combatState}
          onSelectMember={onSelectMember}
          isDm={isDm}
          sessionId={sessionId}
          combatIsActive={combatIsActive}
          sessionLocked={sessionLocked}
          onRebindChanged={() => {
            void (async () => {
              // Kage T-IMP-1: `session` does not need re-fetching here. The
              // engine reads campaign_members fresh on each combat action,
              // so only the participants list (for party panel display) and
              // myCharacterIdStr (for per-user turn resolution) need to be
              // refreshed.
              const updated = await getParticipants(sessionId).catch(() => null);
              if (updated) {
                setParticipants(updated);
                const self = updated.find(
                  (q) => q.username.toLowerCase() === (username ?? '').toLowerCase(),
                );
                const newCharId =
                  self?.character?.character_id != null
                    ? String(self.character.character_id)
                    : null;
                setMyCharacterIdStr(newCharId);
                // Miko additional: mySheet was left stale on rebind — it's
                // populated once on load and only otherwise refreshed by
                // CastSpellPanel's own onSheetChanged after a cast. Without
                // refetching here, a rebind to a DIFFERENT character
                // out-of-combat leaves mySheet (spell_slots etc.) pointing
                // at the PREVIOUS character until some unrelated mutation
                // happens to refresh it. Refetch via the same
                // getCharacterSheet call the load path uses.
                if (newCharId) {
                  const sheet = await getCharacterSheet(newCharId, username ?? '').catch(
                    () => null,
                  );
                  setMySheet(sheet);
                } else {
                  setMySheet(null);
                }
              }
            })();
          }}
          round={round}
          selfPcId={selfPcId}
        />
      </aside>

      {/* CENTRE — narrator + log + composer */}
      <main id="play-pane-story" className={`${styles.pane} ${styles.center}`}>
        {/* TAV-PLAY-SHELL step 3: region extracted verbatim to
            regions/TopBar.tsx's TopBar export (S5.5 NarratorStrip / aiOffStatus
            fallback). */}
        <TopBar
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
        />
        {/* FIX-8 (MEDIUM-2): aria-label on the live region so AT announces the
            context ("Session recap") before reading the content changes. */}
        <div aria-live="polite" aria-label="Session recap">
          {session && (
            <SessionRecap
              key={session.session_id}
              session={session}
              username={username}
              variant="strip"
            />
          )}
        </div>
        <StoryLog
          ref={chatLogRef}
          rows={log}
          thinking={thinking || resumeThinking}
          thinkingLabel={resumeThinking ? "Resuming Suzu's turn…" : undefined}
          participants={participants}
        />
        {/* DDX-25: ONE persistent live region for session pause/end — mirrors
            the Iro MEDIUM-2 turn-status pattern just below (always mounted,
            only the text/class swap in place) so AT users get exactly one
            announcement on the transition, not a mount/unmount per render.
            Visible to every seat, not just the DM — it's the reason the
            composer/action rail below gets disabled. */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={
            isEnded
              ? styles.sessionEndedStatus
              : isPaused
                ? styles.sessionPausedStatus
                : 'sr-only'
          }
        >
          {isEnded
            ? 'Session ended. The DM can start a new one from the dashboard.'
            : isPaused
              ? "Session paused by the DM — you can't act until it resumes."
              : ''}
        </div>
        {/* Iro MEDIUM-2: ONE persistent live region for turn status. Stays mounted
            throughout combat; only the text and className change in place. This
            prevents the 4s poll from re-triggering AT announcements on every
            combatState object replacement when the text hasn't actually changed.
            null text = hidden (opacity:0 + aria-hidden via CSS would also work,
            but clearing text is the simplest AT-safe approach). */}
        {combatIsActive && (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={
              // Iro MAJOR-2: was an exact string match on 'Your turn!', which
              // silently fell through to offTurnStatus styling for the new
              // isDying label. Key off activeIsMine directly instead — both
              // "your turn" variants (normal + dying) style as your-turn.
              activeIsMine ? styles.myTurnStatus : styles.offTurnStatus
            }
          >
            {turnStatusText}
          </div>
        )}
        {/* Combat-UX Fixes 2026-07-27 §UI-states "Dead" row (Kage-CR/test-plan
            §4.2, previously dropped): a dead PC never becomes the active-turn
            participant again, so this can't reuse the turnStatusText live
            region above — it needs its own always-checked gate keyed on the
            viewer's own roster entry, independent of whose turn it is.
            TAV-PLAY-A11Y-DEADSTATUS-NOT-ALWAYS-MOUNTED: the wrapper used to
            be gated on `combatIsActive && isMyPcDead` too (not just its
            text), which dropped the live region itself the instant combat
            ended while isMyPcDead stayed true — a "mount whenever
            combatIsActive" fix would still do that (Iro-A11y). Matches
            .durableRetryRow's actual pattern below instead: the wrapper
            mounts unconditionally; only the CONTENT is gated. Empty text
            collapses to zero footprint via .deadStatus:empty in
            Play.module.css. */}
        <div role="status" aria-live="polite" aria-atomic="true" className={styles.deadStatus}>
          {combatIsActive && isMyPcDead ? 'Your character has died.' : null}
        </div>
        {/* TAV-PLAY-SHELL step 3: region extracted verbatim to
            regions/TableControls.tsx's DmCombatControls export (Tora MAJOR-1
            DM-side combat controls: DmNarrationPanel + ConditionsPanel).
            State/refs/handlers stay in page.tsx. */}
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
        {/* T6 (DDX-12): cast-in-combat picker — bound caster only, during active
            combat. Mirrors DmNarrationPanel's mount gate immediately above (same
            spot in the layout, mutually exclusive: a human DM sees the monster
            panel, a caster PC sees this) — UNLESS the DM also has a bound
            character (TAV-SOLO-DM-CAST-RAIL's GM-PC pattern), in which case
            both mount side by side. Disabled (not hidden) off-turn, same
            convention as the ActionRail inside Composer below. */}
        {(isDmPlayingOwnPc || !isHumanDM) &&
          combatIsActive &&
          combatState &&
          combatId &&
          myCharacterIdStr &&
          mySheet?.is_spellcaster && (
            // Tora MAJOR-1: CastSpellPanel is a "your character" control,
            // grouped the same way as the DM controls above — pairs with
            // Composer's own internally-labeled "Your character's actions"
            // rail group just below.
            <div role="group" aria-label="Your character's controls">
              <CastSpellPanel
                combatId={combatId}
                characterId={myCharacterIdStr}
                username={username ?? ''}
                participants={combatState.participants}
                spellSlots={mySheet.spell_slots}
                isPlayerTurn={isPlayerTurn}
                disabled={combatBusy || sessionLocked}
                onCast={(text) => appendLog({ who: username ?? 'you', kind: 'system', text })}
                onSheetChanged={setMySheet}
                onStateRefresh={async () => {
                  const cs = await getCombatState(combatId).catch(() => null);
                  if (cs) {
                    stateSeqRef.current += 1;
                    setCombatState(cs);
                  }
                }}
                onBusyChange={setCombatBusy}
              />
            </div>
          )}
        {/* DDX-20 §9/§4d — retry-after-failed affordance (flag-ON only;
            jobFailed is never set on the flag-OFF path). Retrying mints a
            FRESH turn_key (narrateDurable always does) — the failed one is
            deduped-forever server-side. role="status" + aria-live="polite"
            so a screen reader announces the failure + retry option once,
            mirroring the file's other persistent live-region status rows
            (e.g. the session-paused/ended banner above).
            Iro MAJOR-1: PERMANENTLY mounted (contents toggle, not the
            wrapper itself) with tabIndex={-1} — same xCardBannerRef pattern
            as the safety-signal banner above. onRetryFailedTurn refocuses
            this wrapper BEFORE unmounting the Retry button, so focus never
            drops to <body>. .durableRetryRow:empty collapses it to zero
            footprint (no padding/border/margin) without display:none/
            visibility:hidden, which would also pull it out of the a11y tree. */}
        {DURABLE_GENERATION_ENABLED && (
          <div
            ref={durableRetryRowRef}
            tabIndex={-1}
            className={styles.durableRetryRow}
            role="status"
            aria-live="polite"
          >
            {jobFailed && (
              <>
                <span id="durable-retry-message">Suzu&apos;s last reply didn&apos;t come through.</span>
                <button
                  type="button"
                  className="btn"
                  onClick={onRetryFailedTurn}
                  aria-describedby="durable-retry-message"
                >
                  Retry
                </button>
              </>
            )}
          </div>
        )}
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
          railRef={composerRailAnchorRef}
          localTurnActionRef={localTurnActionRef}
          combat={
            // S5.2: human DM doesn't see the player action rail (Attack/Dodge/etc.).
            // The DmNarrationPanel above handles monster control separately —
            // UNLESS the DM also has a bound character (isDmPlayingOwnPc), in
            // which case they get the rail for their own PC's turn too.
            isHumanDM && !isDmPlayingOwnPc
              ? null
              : combatIsActive
                ? {
                    targets: targetableFoes,
                    onAction: onCombatAction,
                    // DDX-25: reuse the rail's existing `busy` gate (same
                    // disabled styling/aria as an in-flight combat action) to
                    // also lock it out while the session is paused/ended.
                    busy: combatBusy || sessionLocked,
                    isPlayerTurn,
                    refusedReason,
                    // Combat-UX Fixes 2026-07-27, Fix B.
                    isDying,
                    // TAV-ATTACK-BUTTON-STALE: server-side action economy.
                    actionSpent: myActionSpent,
                    deathSaves: activeParticipant?.death_saves
                      ? {
                          successes: activeParticipant.death_saves.successes,
                          failures: activeParticipant.death_saves.failures,
                        }
                      : null,
                  }
                : null
          }
        />
      </main>

      {/* RIGHT — scene + "Move on" + dice + safety */}
      {/* TAV-PLAY-LANDMARKS: stable landmark name (distinct from the inner
          sceneHeadRef div's dynamic scene-name aria-label below — that's a
          focus anchor, a different node; the landmark itself just needs a
          short, unchanging name). */}
      <aside
        id="play-pane-scene"
        className={`${styles.pane} ${styles.right}`}
        aria-label="Scene"
      >
        {/* TAV-PLAY-SHELL step 3: region extracted verbatim to
            regions/SceneStage.tsx -- placeholder content only (plan §5 step 3),
            not the real §4 stage design. Scene head + .scenePlaceholder +
            the combat-note/outcome-chooser/"Stand and fight" ternary --
            today's stand-in for "what's happening on stage". State/refs/
            handlers stay in page.tsx. */}
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
          talking={talking}
          sessionLocked={sessionLocked}
          rollBusy={rollBusy}
        />


        {/* TAV-PLAY-SHELL step 3: region extracted verbatim to
            regions/Offers.tsx (checks + freeform-offer + transitions).
            State/refs/handlers stay in page.tsx.
            TAV-PLAY-SHELL step 4: this is now the SOLE placement -- the
            aria-hidden, tabIndex={-1} composer-adjacent duplicate that used
            to render directly above (a second, sighted/mouse-only copy of
            the same buttons, added for TAV-CHECK-DISCOVERABILITY / Phase-1
            #6) is deleted. Invariant A13 no longer reads "both exist,
            exactly one is reachable" -- there is only one. */}
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
        />


        {/* T4p2: completion next-part offer (design doc §6.4) — mounts in the
            gap the "Move on" affordance above leaves once adventureComplete
            latches. RENDER addition only: no new interaction, no altered
            flow — its CTA is the same working /modules?adventure=<ref> deep
            link built in Phase 1 (see NextPartOffer.tsx's own doc comment
            for why, given /next-act is broken tonight and unproxied). */}
        {adventureComplete && completionSeries && (
          <NextPartOffer
            series={completionSeries.series}
            next={completionSeries.next}
            className={styles.moveOnWrap}
          />
        )}

        <div className={styles.diceWrap}>
          {/* A2 — real character skill modifiers; null=loading or []=DM-only hide checks */}
          <DiceTray
            onRoll={onRoll}
            quickChecks={quickChecks ?? []}
            advantage={advantage}
            onAdvantage={setAdvantage}
            disabled={talking || combatBusy || sessionLocked || rollBusy}
          />
        </div>

        <div className={styles.safety}>
          <div className={styles.safetyLabel}>Safety</div>
          <p className={styles.safetyBody}>X-card · pause · rewind. Suzu listens.</p>
          <div className={styles.safetyBtns}>
            {/* DDX-26: durable, cross-client — a bare local appendLog/toast
                (the old behavior) was the bug: no other client ever saw it,
                and the toast had no way to know it had been "resolved" so it
                lingered (UIR2-TAV-25). postXCard persists an `x_card` session
                event; the banner above + the events poll are what every
                client (including this one) actually renders from. */}
            <button
              type="button"
              onClick={() => void onRaiseXCard()}
              disabled={xCardBusy}
              aria-busy={xCardBusy}
            >
              X-card
            </button>
          </div>
        </div>
      </aside>

      {/* TAV-PLAY-SHELL step 2: both drawers below now go through the
          shared <Drawer> primitive (src/components/Drawer.tsx) — see its
          own doc comment for the full A5 (always mounted)/A6 (`visible`
          drives class+scrim+inert, `open` drives dialog semantics)
          reasoning this replaces verbatim from the two hand-rolled
          <aside>s that used to be here. */}

      {/* DDX-22: Journal / Memory pane — right-edge slide-over drawer on
          desktop + 4th mobile tab (joins the existing .left/.center/.right
          pane-collapse group via the journalPane className, still applied
          here since Play.module.css's `.showJournal .journalPane` mobile
          rule targets it — Drawer's own `mobileTabFallback` prop is what
          hands the >880px fixed-drawer chrome off to that in-flow pane
          layout below the breakpoint). */}
      <Drawer
        id="play-pane-journal"
        open={journalOpen}
        visible={journalVisible}
        labelledBy={JOURNAL_HEADING_ID}
        onClose={closeJournal}
        closeButtonRef={journalCloseBtnRef}
        mobileTabFallback
        className={styles.journalPane}
      >
        <JournalPane
          sessionId={sessionId}
          events={journalEvents}
          grounding={grounding}
          onClose={closeJournal}
          closeButtonRef={journalCloseBtnRef}
        />
      </Drawer>

      {/* TAV-PARTY-INLINE-SHEET: a right-edge slide-over drawer for a
          selected party member's sheet — unlike the Journal drawer has no
          separate mobile-tab presentation to reconcile with, so `open` and
          `visible` are simply the same value: it's the fixed drawer at any
          viewport width. */}
      <Drawer
        id="play-pane-member-sheet"
        open={memberSheetOpen}
        visible={memberSheetOpen}
        labelledBy={MEMBER_SHEET_HEADING_ID}
        onClose={closeMemberSheet}
        closeButtonRef={memberSheetCloseBtnRef}
      >
        <MemberSheetPanel
          sheet={selectedMemberSheet}
          loading={memberSheetLoading}
          error={memberSheetError}
          memberName={selectedMemberName}
          isSelf={selectedMemberIsSelf}
          onClose={closeMemberSheet}
          closeButtonRef={memberSheetCloseBtnRef}
        />
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
    </div>
  );
}
