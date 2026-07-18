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
import { useReducedMotion } from '@/lib/useReducedMotion';
import { sessionTitle } from '@/lib/format';
import {
  advanceScene,
  combatFromScene,
  endCombat,
  getCombatState,
  getCharacterSheet,
  getGrounding,
  getParticipants,
  getSession,
  getSessionEvents,
  getSessionEventsRaw,
  getSessionEventsPage,
  postSessionEvent,
  // DDX-25: DM-only session lifecycle controls (pause/resume/end/xp award).
  pauseSession,
  resumeSession,
  endSession,
  awardSessionXp,
  resolveCheck,
  rollInitiative,
  monsterTurn,
  attack as combatAttack,
  dodge as combatDodge,
  dash as combatDash,
  endTurn as combatEndTurn,
  postRoll,
  postXCard,
} from '@/lib/api/dnd';
import { streamDmNarration, postDmTurn, subscribeDmJob } from '@/lib/stream';
import { eventToLogRow, formatEventTimestamp as formatOpeningTimestamp } from '@/lib/rehydration';
import { matchKeywordIntent } from '@/lib/dnd/intentFastPath';
import { DURABLE_GENERATION_ENABLED } from '@/lib/config';
import { mintTurnKey, saveTurnKey, clearTurnKey } from '@/lib/turnKey';
import {
  reconcileDurableEvents,
  applyReconcileResult,
  type PendingTurnEntry,
} from '@/lib/dnd/reconcileEvents';
import type {
  CharacterSheet,
  CombatParticipantState,
  CombatState,
  EndCombatOutcome,
  EngineSessionEvent,
  GroundingData,
  OfferedCheck,
  Participant,
  PendingGeneration,
  Session,
} from '@/lib/api/types';
import RebindCharacterButton from '@/components/RebindCharacterButton';
import type { QuickCheck, RollTrigger } from '@/components/DiceTray';
import Icon from '@/components/Icon';
import Pill from '@/components/Pill';
import PageSkeleton from '@/components/PageSkeleton';
import NarratorStrip from '@/components/NarratorStrip';
import CastSpellPanel from '@/components/CastSpellPanel';
import ConditionsPanel from '@/components/ConditionsPanel';
import GrantCurrencyPanel from '@/components/GrantCurrencyPanel';
import SessionRecap from '@/components/SessionRecap';
import ChatLog, { type ChatLogHandle, type LogRow } from '@/components/ChatLog';
import PartyPanel from '@/components/PartyPanel';
import InitiativeTracker from '@/components/InitiativeTracker';
import DiceTray, { type Advantage } from '@/components/DiceTray';
import Composer, {
  type ComposeMode,
  type CombatAction,
  type CombatTarget,
} from '@/components/Composer';
import DmNarrationPanel from '@/components/DmNarrationPanel';
import ConfirmDialog from '@/components/ConfirmDialog';
import JournalPane, { JOURNAL_HEADING_ID } from '@/components/JournalPane';
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

/** A1 — structural event kinds that indicate the scene hasn't started yet.
 * These are session/character SETUP events, not fiction — their presence must
 * NOT suppress the read-aloud opening. The engine emits `rebind` when a
 * character is bound/re-bound to a campaign (there is no `character_bound`
 * kind); both are listed so the gate matches engine reality regardless. */
const STRUCTURAL_EVENT_KINDS = new Set([
  'session_start',
  'session_created',
  'character_bound',
  'rebind',
  'opening_narrated',
]);

/** Poll interval in milliseconds. */
const POLL_INTERVAL_MS = 4000;

/**
 * DDX-20 §4d (Miko-QA finding c) — the poll-only failure-detection grace
 * window: consecutive poll ticks a client's OWN in-flight turn_key may go
 * unreflected in `pending_generation` (with no narration seq > trigger_seq
 * having landed) before it's treated as a died-silently job (Redis TTL
 * eviction, runner crash, or an SSE tail that closed without an error
 * frame — a proxy idle-timeout truncation, a backgrounded tab pausing the
 * EventSource). 2 ticks (~8s at the poll cadence above) absorbs ordinary
 * poll/commit timing lag without meaningfully delaying real-failure
 * detection for a beat that typically completes well within that window.
 */
const POLL_FAILURE_GRACE_TICKS = 2;

/**
 * DDX-22 — generic Tab-trap query for the Journal drawer. Unlike
 * ConfirmDialog's hardcoded 2-button trap (it always has exactly Cancel +
 * Confirm), the journal's focusable set varies with content (close button,
 * the notes textarea, a growing NPC/recap list has no interactive elements
 * of its own today but may in a later phase) — so the trap below queries
 * this selector fresh on every Tab keydown rather than caching two refs.
 */
const JOURNAL_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * DDX-26 — event kinds that count as a "narration beat" for the X-card
 * banner's auto-ease-off. Mirrors the engine's own soft-redirect auto-clear
 * EXACTLY (Kage IMPORTANT-2): the engine only clears soft_redirect on
 * 'dm_narration'/'narration' — NOT on 'player_action'. A player_action event
 * persists up front, before Suzu's narration streams back, so counting it
 * here would ease the banner off for the whole streaming turn (or
 * indefinitely on an abandoned turn) while the engine is still steering, and
 * could clear the banner on an ESCALATING player action — the opposite of
 * "the table eased off". Once the table has actually moved on to a new
 * narration beat, the banner steps aside on its own (no dismiss required) —
 * the raised signal is still permanent in the durable log (eventToLogRow's
 * 'x_card' case), only the live banner clears.
 */
const NARRATION_BEAT_KINDS = new Set(['dm_narration', 'narration']);

/**
 * DDX-26 — scan a batch of raw session events (any order, any kind) for the
 * highest-seq 'x_card' event and the highest-seq narration-beat event. Pure,
 * shared by both the mount-time rehydration path (full history) and the
 * recurring events poll (only the newly-observed slice) so "what's active"
 * is computed identically regardless of which path fed it. Seq+actor are
 * returned as one pair (never two independently-tracked values) so a batch
 * containing multiple x_card events always attributes the actor belonging
 * to the highest seq, never a stale one from an earlier raise in the batch.
 */
function scanXCardTracking(events: EngineSessionEvent[]): {
  xCard: { seq: number; actor?: string } | null;
  narrationSeq: number | null;
} {
  let xCard: { seq: number; actor?: string } | null = null;
  let narrationSeq: number | null = null;
  for (const e of events) {
    const seq = e.seq ?? 0;
    if (e.kind === 'x_card') {
      if (!xCard || seq > xCard.seq) xCard = { seq, actor: e.actor };
    } else if (e.kind && NARRATION_BEAT_KINDS.has(e.kind)) {
      if (narrationSeq == null || seq > narrationSeq) narrationSeq = seq;
    }
  }
  return { xCard, narrationSeq };
}

function nowStamp(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * P1-READALOUD: Build the verbatim read-aloud block text from grounding data.
 * Matches the authored structure the AI-off path used to produce (§3.2 of the
 * design doc), now shared by all session types (AI-on, AI-off, human-DM).
 * Pure function — no side effects.
 */
function buildReadAloudBlock(g: GroundingData): string {
  const lines: string[] = [];
  if (g.adventure_title) lines.push(`— ${g.adventure_title} —`);
  if (g.hook) lines.push(g.hook);
  if (g.scene_name) lines.push(`\nScene: ${g.scene_name}`);
  if (g.boxed_text) lines.push(g.boxed_text);
  if (g.objective) lines.push(`\nObjective: ${g.objective}`);
  return lines.filter(Boolean).join('\n');
}

/** Title-case an engine skill slug ('sleight_of_hand' -> 'Sleight Of Hand'). */
function titleCaseSkill(skill: string): string {
  return skill
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * DDX-25 R2 (D2-D4): true once the session has been paused or ended — no
 * further player action should be accepted. Extracted as a module-level pure
 * function (rather than only the render-scope `isPaused`/`isEnded`/
 * `sessionLocked` consts further down, which every player-action JSX gate
 * below still uses directly) so the callbacks declared earlier in this
 * component (onRoll, onMoveOn, onAttemptCheck) can reference the check too —
 * those are created before the render-scope consts are declared, so closing
 * over the later consts directly would be a temporal-dead-zone hazard.
 */
function isSessionLocked(s: Session | null | undefined): boolean {
  return s?.status === 'paused' || s?.status === 'ended';
}

/**
 * DDX-25 R3: order-independent structural equality for two session
 * snapshots. Used by the session-status poll below to decide whether a
 * freshly-fetched snapshot actually differs from what's already in state —
 * a no-op tick (nothing changed server-side) must not hand the tree a fresh
 * `session` object identity (see the poll's own comment for why that matters).
 * `Session` carries arbitrary engine passthrough fields (`[k: string]:
 * unknown`), so comparing a hand-picked subset (status, xp_pool, ...) risks
 * silently missing a field the UI later starts to depend on; comparing the
 * whole snapshot doesn't have that failure mode.
 */
export function sessionsEqual(
  a: Session | null | undefined,
  b: Session | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return stableKey(a) === stableKey(b);
}

/** JSON.stringify with object keys sorted at every level, so the same
 * logical value never compares as "different" purely because the engine (or
 * JS) happened to emit its keys in a different order. Inputs here are always
 * JSON-shaped (parsed HTTP responses / plain state) — no cycles, functions,
 * or Dates. */
function stableKey(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableKey).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableKey((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * Extract a human-readable refusal reason from a combat error body.
 * The engine returns data.reason as a machine code; we translate to plain English.
 */
function humanRefusalReason(code: string | undefined): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    not_your_turn: "It's not your turn.",
    no_target: 'You need to pick a target.',
    target_not_found: 'That target was not found.',
    target_down: 'That target is already down.',
    target_is_self: "You can't target yourself.",
    no_character_bound: 'No character is bound to this session.',
    actor_incapacitated: 'Your character is incapacitated.',
    combat_over: 'Combat has ended.',
    no_active_turn: 'No one has the active turn right now.',
    no_combat: 'No combat is active.',
    invalid_outcome: 'That outcome is not valid right now.',
    victory_refused: "Can't claim victory — no enemies are down.",
    msm_disabled: 'Multi-system content is not available for this session.',
  };
  return map[code] ?? `Action refused: ${code}`;
}

export default function PlayPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : '';
  const { user } = useAuth();
  const username = user?.username ?? null;
  const { toast } = useToast();
  const reduced = useReducedMotion();

  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'error' | 'notfound'>('loading');

  const [log, setLog] = useState<LogRow[]>([]);
  const [narratorText, setNarratorText] = useState('');
  const [talking, setTalking] = useState(false);
  const [thinking, setThinking] = useState(false);

  const [msg, setMsg] = useState('');
  const [mode, setMode] = useState<ComposeMode>('say');
  // S5.2: pending/error state for DM narration submission.
  const [dmNarrationPending, setDmNarrationPending] = useState(false);
  const [dmNarrationError, setDmNarrationError] = useState<string | null>(null);
  // S5.2: track whether the session has loaded so we can sync the initial
  // composer mode once (human DM should default to dm_narration, not 'say').
  const modeSyncedRef = useRef(false);
  const [advantage, setAdvantage] = useState<Advantage>('none');
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
  const journalDialogRef = useRef<HTMLElement>(null);
  const journalCloseBtnRef = useRef<HTMLButtonElement>(null);
  const journalPreviouslyFocusedRef = useRef<HTMLElement | null>(null);

  const [combatId, setCombatId] = useState<string | null>(null);
  const [combatState, setCombatState] = useState<CombatState | null>(null);
  const [combatBusy, setCombatBusy] = useState(false);
  const [refusedReason, setRefusedReason] = useState<string | null>(null);

  // Iro MEDIUM-2: persistent turn-status text so one mounted live region mutates
  // in place instead of two regions mounting/unmounting on every poll cycle.

  // Grounding for the "Move on" affordance (ADV-7T).
  const [grounding, setGrounding] = useState<GroundingData | null>(null);
  const [sceneAdvanceBusy, setSceneAdvanceBusy] = useState(false);

  // P1-PLAYFIX (S2.4) — busy flag for the check-affordance row (Attempt: Survival, etc.).
  const [checkBusy, setCheckBusy] = useState(false);

  // P1-PLAYFIX-2 §A.5/§A.6 — the skill the server invited this turn (present
  // once the SSE payload carries an `offeredCheck`; forward-compatible, see
  // dnd.ts/types.ts). Cleared at the start of every new narrate() beat so a
  // stale offer never lingers past the turn it was made on. NEVER drives an
  // auto-roll — it only makes the matching "Attempt {skill}" button hard to miss.
  const [offeredCheckSkill, setOfferedCheckSkill] = useState<string | null>(null);

  // B1-4: the logged-in user's bound character_id (stringified) for per-user
  // turn resolution. Populated from the participants endpoint on load + on rebind.
  const [myCharacterIdStr, setMyCharacterIdStr] = useState<string | null>(null);

  // T6 (DDX-12): the bound character's own sheet, needed for CastSpellPanel
  // (is_spellcaster gate + spell_slots for the upcast range / live pips).
  // Populated by the same getCharacterSheet call that already builds
  // quickChecks below; refreshed by CastSpellPanel itself after a successful
  // cast (onSheetChanged), mirroring SpellSlotsPanel's onChanged contract.
  const [mySheet, setMySheet] = useState<CharacterSheet | null>(null);

  // B3-1: outcome chooser state (null = chooser closed).
  const [outcomeChooserOpen, setOutcomeChooserOpen] = useState(false);

  // DDX-25: DM-only session lifecycle controls (pause/resume/end/xp award).
  // One shared busy flag (not 4 booleans) disables all 3 controls together
  // while any one is in flight — mirrors the single `combatBusy` flag already
  // used for combat mutations above.
  const [sessionActionBusy, setSessionActionBusy] = useState<
    'pause' | 'resume' | 'end' | 'xp' | null
  >(null);
  const [endSessionConfirmOpen, setEndSessionConfirmOpen] = useState(false);
  const [xpFormOpen, setXpFormOpen] = useState(false);
  const [xpAmount, setXpAmount] = useState('');
  const [xpReason, setXpReason] = useState('');

  // A2 — real quick-checks derived from the bound character's sheet.
  // null = not yet resolved; [] = DM-only (no character bound) or fetch failed.
  const [quickChecks, setQuickChecks] = useState<QuickCheck[] | null>(null);

  // A1 — fire-once gate: ensures the opening beat only streams once per mount
  // even under React StrictMode's double-invoke. The durable server-side event
  // is the canonical guard; this ref prevents a second fire within the same
  // component lifetime (e.g. StrictMode double-effect).
  const openingFiredRef = useRef(false);

  // PLAY-PERSIST §7: guards against a second rehydration within one mount
  // (e.g. a stray effect re-run). Rehydration runs once, synchronously before
  // the composer can be used, so a persisted row and its future live-append
  // counterpart never coexist in the same mount.
  const rehydratedRef = useRef(false);

  // B1-4: fire-once "no character bound" toast when combat becomes active.
  const noCharToastFiredRef = useRef(false);

  // DDX-08 / T3: highest session-event `seq` already rendered into the log
  // (set once by rehydration, then advanced by the dice-roll events poll
  // below). Lets the poll fetch the full event list every tick (the engine
  // has no "since seq" filter) while only ever appending NEW rows.
  const lastEventSeqRef = useRef(0);

  // DDX-20 (flag-ON only, DURABLE_GENERATION_ENABLED) — the reconciliation
  // ledger (Client Integration Design §3.1). Both refs, poll-safe: mutated
  // in place by reconcileDurableEvents inside the flag-ON poll branch below;
  // never touched on the flag-OFF path. renderedSeqsRef = every durable seq
  // already reflected in the log; pendingByKeyRef = turn_key (or a human-DM
  // beat's client_key) -> the in-flight optimistic row ids waiting to
  // reconcile. Populated by the Pass-2 durable turn path (onSend/narrate);
  // empty in this pass, so every poll tick falls to "append" (the reload /
  // cross-client branch) — correct and already covered by the reload-
  // reconstruction test in reconcileEvents.test.ts.
  const renderedSeqsRef = useRef<Set<number>>(new Set());
  const pendingByKeyRef = useRef<Map<string, PendingTurnEntry>>(new Map());
  // DDX-20 F9+Recap Post-Review Fix (Kage-CR IMPORTANT / Miko-QA MEDIUM,
  // fold commit) — a SEPARATE ledger for journalEvents' own merge-by-seq
  // dedup (pollDurable below). Cannot reuse renderedSeqsRef: that one tracks
  // the TRANSCRIPT log (reconcileDurableEvents' rule 1), a different array
  // with a different lifecycle from journalEvents (DDX-22's raw event feed,
  // covering every kind the transcript doesn't render too — recap,
  // scene_advance, npcs_introduced). Seeded at mount alongside journalEvents
  // itself (below); mutated key-by-key AS pollDurable iterates its batch —
  // mirrors reconcileDurableEvents' own rule 1, which is intra-tick safe for
  // the same reason: it checks-and-adds one event at a time instead of
  // computing a static "seen" snapshot once per tick. A missing `seq`
  // normalizes to the shared key `0` (see pollDurable for the justification)
  // rather than being treated as unconditionally unique.
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
  // DDX-20 Pass 2 — the in-flight job surfaced by the poll's
  // `pending_generation` block (Technical Design §2.2), promoted to real
  // state so the resume/busy affordance (§9) can render off it. Drives the
  // "Resuming Suzu's turn…" status ONLY when this client is not already
  // actively streaming its own beat (talking/thinking cover that case) —
  // see the render gate near the composer below.
  const [activeJob, setActiveJob] = useState<PendingGeneration | null>(null);
  // DDX-20 Pass 2 — guards against re-opening the SSE tail for a job this
  // client is already subscribed to (the poll re-observes the same
  // `pending_generation` block every ~4s while a beat is in flight; without
  // this guard each tick would open a fresh SSE connection). Cleared when
  // the tracked job resolves (subscribeToJob's own completion) or when a
  // later poll tick sees `pending_generation` go null.
  const subscribedJobIdRef = useRef<string | null>(null);
  // DDX-20 Pass 2 — the client-minted turn_key for THIS client's own
  // currently in-flight turn (§4c lifecycle: set on turn start, cleared once
  // the poll's reconciliation removes its ledger entry — i.e. the beat's
  // narration seq has been observed — or on failure/retry). null when no
  // turn owned by this tab is in flight.
  //
  // DDX-20 Pass 3 Finding 3 (Kage-CR SHOULD-FIX, carried not fixed this
  // pass — see fold commit for rationale) — this is a SINGLE ref shared by
  // both `narrateDurable` and `narrateDurableBeat`. A beat firing mid-
  // composer-turn (or vice versa) CLOBBERS whichever turn_key lost the
  // write race, so the §4d poll-failure-grace dead-job detector below (it
  // reads `turnKeyRef.current`) may silently stop tracking the turn that
  // lost the race — a job that dies with no SSE error (backgrounded tab,
  // proxy idle-timeout) then goes undetected for that turn. The primary
  // resume mechanism (stateless `pending_generation` poll-discovery, §4b) is
  // UNAFFECTED — it doesn't read this ref. `turnKey.ts`'s localStorage
  // persistence is ALSO single-slot (one key per session), so a proper fix
  // is more than swapping this ref for a Set: the §4c "clear once resolved"
  // watcher below and the localStorage save/clear calls in both
  // narrateDurable/narrateDurableBeat would all need to become
  // multi-key-aware. Deferred as a carried item — not forced into this
  // fold's scope. `play.ddx20-pass3-synthetic-beats.test.tsx` has a
  // characterization test locking today's clobber behavior so a future
  // refactor changes it deliberately, not by accident.
  const turnKeyRef = useRef<string | null>(null);
  // DDX-20 Pass 2 — the last composer-submitted (message, mode) this client
  // originated, kept so a retry-after-failed (§4d) can resubmit the SAME
  // content under a FRESH turn_key (mintTurnKey() is called fresh on every
  // narrateDurable() invocation — retry never reuses a turn_key).
  const lastDurableTurnRef = useRef<{ message: string; mode: ComposeMode } | null>(null);
  // DDX-20 Pass 2 — true when the most recent durable beat this client was
  // watching (its own, or one it subscribed to) ended in an SSE `error`
  // event, OR the poll-only failure detector below (Miko-QA finding c)
  // declared it dead. Drives the retry affordance (§4d / §9).
  const [jobFailed, setJobFailed] = useState(false);
  // DDX-20 Pass 2 (Miko-QA finding c) — poll-only failure-detection grace
  // counter for THIS client's own in-flight turn_key (see
  // POLL_FAILURE_GRACE_TICKS). Tracks the turn_key it's counting against so
  // a brand-new turn never inherits a stale count from a prior one.
  const pollFailureGraceRef = useRef<{ turnKey: string; nullTicks: number } | null>(null);

  // Synchronous double-submit latch for roll buttons (mirrors checkBusyRef /
  // sceneAdvanceBusyRef) — a roll is a real server write (persists a
  // `dice_roll` event), so a same-tick double-click must not fire it twice.
  const rollBusyRef = useRef(false);
  const [rollBusy, setRollBusy] = useState(false);

  // DDX-26 — durable X-card tracking, derived from the SAME events poll as
  // dice rolls (no new poll). `xCardEvent` pairs seq+actor so a batch never
  // attributes the wrong raiser (see scanXCardTracking above). Both this and
  // `latestNarrationSeq` are updated via the functional setState form
  // (`setXCardEvent((prev) => ...)`), which always reads the CURRENT
  // committed state at update time — the poll effect's deps are [sessionId,
  // state] (mirrors the dice-roll poll's own reasoning), so a plain closure
  // read of these values inside `poll()` would be stale; the functional
  // updater sidesteps that without needing a ref-mirror.
  const [xCardEvent, setXCardEvent] = useState<{ seq: number; actor?: string } | null>(null);
  const [latestNarrationSeq, setLatestNarrationSeq] = useState<number | null>(null);
  // Per-client dismiss, keyed to the seq it was raised for the seat's active
  // banner (dismisses only unnamed on the exact raise) — a NEW x_card (higher
  // seq) is a different raise and re-shows regardless of this value.
  const [dismissedXCardSeq, setDismissedXCardSeq] = useState<number | null>(null);
  // Synchronous double-submit latch for the X-card button (mirrors
  // rollBusyRef) — raising is a real server write (persists an `x_card`
  // event); a same-tick double-click must not fire it twice.
  const xCardBusyRef = useRef(false);
  const [xCardBusy, setXCardBusy] = useState(false);
  // Iro MAJOR-2: the banner wrapper is a PERMANENT, always-mounted anchor
  // (see the render below — only its children toggle) so it's stable
  // regardless of `mobileView`, mirroring the sceneHeadRef/endCombatBtnRef
  // refocus convention above. Dismiss unmounts the focused Dismiss button;
  // refocusing this wrapper (tabIndex={-1}) before that unmount lands focus
  // here instead of dropping it to <body>.
  const xCardBannerRef = useRef<HTMLDivElement>(null);

  // DDX-20 §4d/§9 (Iro MAJOR-1) — same permanently-mounted tabIndex={-1}
  // refocus-anchor pattern as xCardBannerRef above: onRetryFailedTurn
  // unmounts the Retry button (jobFailed flips false), which would
  // otherwise force-blur focus to <body>. Refocusing this wrapper BEFORE
  // that unmount keeps focus in the document.
  const durableRetryRowRef = useRef<HTMLDivElement>(null);

  // Monotone sequence guard: combatState updates from polls must not overwrite
  // a more-recent mutation response. Mutations bump this; polls gate on it.
  const stateSeqRef = useRef(0);

  // Synchronous latch for double-tap protection on all combat mutating actions.
  // React state (combatBusy) only disables UI after a re-render; the ref closes
  // the race window between two taps in the same event-loop tick.
  const combatBusyRef = useRef(false);
  // Guards the auto monster-turn driver so combatState updates mid-loop don't
  // spawn a second concurrent driver.
  const monsterDrivingRef = useRef(false);

  // Mirror of combatState kept in sync via an effect so the poll callback can
  // read the current state without being listed as a dep (avoids resetting the
  // interval on every state-string transition).
  const combatStateRef = useRef<CombatState | null>(null);

  const idRef = useRef(0);
  const chatLogRef = useRef<ChatLogHandle>(null);
  const revealRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const narrationAbort = useRef<AbortController | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tora MAJOR-2: ref for the "End" trigger button so focus returns to it when
  // the outcome chooser is closed via Escape.
  const endCombatBtnRef = useRef<HTMLButtonElement>(null);

  // DDX-25: ref for the "Award XP" trigger so focus returns to it when the
  // inline award form is dismissed via Escape (mirrors endCombatBtnRef).
  const xpToggleBtnRef = useRef<HTMLButtonElement>(null);

  // DDX-25 R2 (D5): synchronous latch mirroring combatBusyRef/checkBusyRef/
  // sceneAdvanceBusyRef above — `sessionActionBusy` (React state) only
  // disables the UI after a re-render, leaving a window where two clicks in
  // the same event-loop tick both fire the mutation. All three DM
  // session-lifecycle actions (pause/resume, end, award XP) share this one
  // ref, mirroring how they already share the one `sessionActionBusy` state
  // value declared above.
  const sessionActionBusyRef = useRef(false);

  // DDX-25 R2 (D1): interval handle for the session-status poll (separate
  // from pollIntervalRef, which is the combat-state poll's — the two run on
  // independent lifetimes: this one starts once the session has loaded and
  // keeps running until the session ends; the combat one only runs while a
  // combat is active).
  const sessionPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mirror of `session` kept in sync via an effect so the session-status poll
  // callback can read the current status without being a dep of the poll
  // effect (mirrors combatStateRef's role for the combat-state poll below).
  const sessionRef = useRef<Session | null>(null);

  // DDX-08 / T3: interval handle for the dice-roll events poll (separate
  // lifetime again — starts as soon as the session is loaded and runs for
  // the whole session, independent of combat/session-status polling).
  const diceRollPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Iro Ship 2 CRITICAL-1: a resolved check / taken transition unmounts the
  // just-clicked button once `refreshGrounding()` recomputes availableChecks /
  // availableTransitions, dropping focus to <body> with no announcement.
  // `sceneHeadRef` is a stable, always-mounted anchor (mirrors the
  // `endCombatBtnRef` refocus pattern above); the wrap refs let each handler
  // capture "did this click originate inside my group" before the unmount.
  const sceneHeadRef = useRef<HTMLDivElement>(null);
  const checkWrapRef = useRef<HTMLDivElement>(null);
  const transitionWrapRef = useRef<HTMLDivElement>(null);

  // Tora MAJOR-2: same stranded-focus problem as above, but at a combat
  // turn boundary — a rail button (player Attack/Dodge/Dash/End-turn, or DM
  // per-monster Attack/Skip/Move) that triggers a turn flip becomes
  // `disabled` and the browser force-blurs it to <body>. These anchor the
  // newly-enabled rail so `refocusOnTurnFlip` below (mirrors
  // `refocusSceneHeadIfStranded`'s rAF-after-commit stranding check) can land
  // focus there instead of forcing a full re-tab. Falls back to sceneHeadRef.
  const composerRailAnchorRef = useRef<HTMLDivElement>(null);
  const dmPanelAnchorRef = useRef<HTMLElement>(null);
  const prevActiveParticipantIdRef = useRef<string | null>(null);
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

  // Latest-log ref so narrate() can read recent transcript without re-creating
  // itself on every log change. Synced in an effect (never written during render).
  const logRef = useRef<LogRow[]>([]);
  useEffect(() => {
    logRef.current = log;
  }, [log]);

  // Keep combatStateRef in sync so the poll callback can read current state
  // without being a dep of the poll effect (which would reset the interval on
  // every state-string transition such as active→between_turns→active).
  useEffect(() => {
    combatStateRef.current = combatState;
  }, [combatState]);

  // DDX-25 R2 (D1): keep sessionRef in sync for the same reason — the
  // session-status poll effect below reads it without being a dep, so the
  // interval isn't reset every time `session` updates (which happens on
  // every poll tick itself, plus every DM mutation's own refetch).
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const appendLog = useCallback((row: Omit<LogRow, 'id' | 'ts'>) => {
    setLog((prev) => [...prev, { id: `r${(idRef.current += 1)}`, ts: nowStamp(), ...row }]);
  }, []);

  // DM-STREAM: while a narration streams, mirror it into a LIVE bottom-of-chat
  // row that grows token-by-token (so the reader sees Suzu narrate inline in the
  // conversation, not just in the top strip). The row is created on the first
  // chunk and updated in place; finalized (or removed on error) after the beat.
  //
  // T1 (TAV-S1) — screen-reader flood fix: the in-progress row is marked
  // `streaming: true` so ChatLog renders it `aria-hidden` (every token-by-
  // token delta re-announcing the growing text floods a screen reader).
  // `finalizeStreamNarration` below does NOT just flip that flag on the same
  // node — it swaps in a brand-new row (fresh id/key) carrying the complete
  // text, so React mounts a new, non-hidden DOM node and the finished
  // narration is announced exactly once, rather than being the very node
  // that was aria-hidden a moment ago (some AT/browser combos don't
  // re-announce a node whose aria-hidden merely flips off in place).
  const streamRowIdRef = useRef<string | null>(null);
  const upsertStreamNarration = useCallback((text: string) => {
    // Decide create-vs-update and mutate the id/ref OUTSIDE the state updater —
    // setLog's updater must stay pure (React/StrictMode may re-invoke it).
    const existingId = streamRowIdRef.current;
    if (existingId) {
      setLog((prev) => prev.map((r) => (r.id === existingId ? { ...r, text } : r)));
    } else {
      const id = `r${(idRef.current += 1)}`;
      const ts = nowStamp();
      streamRowIdRef.current = id;
      setLog((prev) => [
        ...prev,
        { id, who: 'Suzu', kind: 'narration' as const, text, ts, streaming: true },
      ]);
    }
  }, []);
  const clearStreamNarration = useCallback((removeRow: boolean) => {
    const id = streamRowIdRef.current;
    streamRowIdRef.current = null;
    if (removeRow && id) setLog((prev) => prev.filter((r) => r.id !== id));
  }, []);
  /** T1 (TAV-S1) — finalize a completed stream beat by REMOUNTING a fresh,
   *  non-hidden row in place of the aria-hidden streaming one (same position
   *  in the log, new id) rather than mutating the streaming row's text in
   *  place. See the streamRowIdRef comment above for why a fresh node matters
   *  for SR announcement. No-ops (and clears the ref) if the streaming row
   *  was somehow already removed from the log. */
  const finalizeStreamNarration = useCallback((text: string) => {
    const id = streamRowIdRef.current;
    streamRowIdRef.current = null;
    if (!id) return;
    const newId = `r${(idRef.current += 1)}`;
    setLog((prev) => {
      const idx = prev.findIndex((r) => r.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], id: newId, text, streaming: false };
      return next;
    });
  }, []);

  /**
   * DDX-20 Pass 2 — subscribe to a durable job's SSE tail (Client Integration
   * Design §6 `subscribeDmJob`). Used from THREE call sites, uniformly:
   *   (1) narrateDurable's own just-created/deduped-resumed job (originating client).
   *   (2) the 409-busy pivot (§4a) — subscribing to ANOTHER client's in-flight job.
   *   (3) the poll's stateless resume/don't-re-POST discovery (§4b) — mount/reload.
   * In every case SSE is a non-authoritative live accelerator (§3.3): the
   * durable poll (`pollDurable`) is what actually reconciles the finished
   * beat into the transcript via the ledger (rule 3) — this function only
   * drives the live `thinking`/`talking`/narratorText UI and keeps
   * `pendingByKeyRef`'s `narrationRowId` in sync so that reconciliation can
   * find this row when the durable event lands.
   *
   * `ledgerKey` is the turn_key when known (originating / mount-resume —
   * `PendingGeneration.turn_key` is always present); the 409-busy case does
   * not learn the OTHER client's real turn_key (the busy wire shape omits
   * it), so callers pass a synthetic per-job key there — rule 3 matches by
   * `triggerSeq`, not by the ledger map's key, so a synthetic key still
   * reconciles correctly (see reconcileEvents.ts's `findActiveNarrationEntry`).
   *
   * Defined ahead of the mount/poll effects below (moved up from its
   * original spot just after `narrate`) so both the events poll effect and
   * `narrateDurable` can reference it — a plain `const` is not hoisted, so
   * it must be declared before its first use in source order.
   *
   * `origin` (DDX-20 Pass 3 Finding 1) — 'composer' for `narrateDurable`'s
   * two call sites and the poll's stateless resume-discovery call (§4b;
   * origin is genuinely unknown there after a reload, so it defaults
   * conservatively to 'composer' — see that call site's own comment), 'beat'
   * for `narrateDurableBeat`'s two call sites. Drives whether an SSE-tail
   * `error` may surface the shared composer Retry banner.
   */
  const subscribeToJob = useCallback(
    async (
      jobId: string,
      ledgerKey: string,
      triggerSeq: number | undefined,
      origin: 'composer' | 'beat',
    ) => {
      // DDX-20 Pass 3 Finding 2 (Kage-CR MAJOR-1 / Miko-QA) — de-dupe by
      // job_id BEFORE touching anything else. A 409-busy-pivot (composer or
      // beat) can target a job THIS SAME CLIENT already subscribed to under
      // a DIFFERENT ledgerKey — the beat-6-in-flight/beat-2-409s-against-
      // job6 same-tab sequencing §3.3 documents as the normal combat->scene
      // case. Subscribing again would register a SECOND awaitingNarration
      // entry for one job: reconcileDurableEvents' findActiveNarrationEntry
      // only ever resolves the FIRST (insertion-order) match, so the other
      // orphans forever and can later hijack an unrelated LATER turn's
      // narration (see reconcileEvents.pass3-busy-pivot-orphan.test.ts) —
      // and re-subscribing would also reset the shared narrating UI (Iro
      // MAJOR-1) for a job that's already correctly driving it. A
      // DIFFERENT, not-yet-watched job_id (the genuine multi-tab pivot)
      // deliberately falls through to the normal reset below.
      for (const entry of pendingByKeyRef.current.values()) {
        if (entry.jobId === jobId && entry.awaitingNarration) {
          console.debug('subscribe_dedup_same_job', { job_id: jobId, ledger_key: ledgerKey, origin });
          return;
        }
      }

      subscribedJobIdRef.current = jobId;
      // Kage #3 — register INTENT to receive this turn's narration
      // SYNCHRONOUSLY, before any await. This is what closes the race where
      // the durable narration event could land on a poll tick BEFORE this
      // function's first SSE chunk arrives (network round-trip): without
      // `awaitingNarration` set here, reconcileDurableEvents' rule 3 has no
      // way to know a subscriber is coming and would fall through to a plain
      // "no match -> append", and the LATER-arriving SSE chunk would then
      // create a second, un-reconciled row for the same beat.
      pendingByKeyRef.current.set(ledgerKey, {
        ...pendingByKeyRef.current.get(ledgerKey),
        jobId,
        triggerSeq,
        awaitingNarration: true,
        origin,
      });

      narrationAbort.current?.abort();
      const ctrl = new AbortController();
      narrationAbort.current = ctrl;
      setTalking(true);
      setThinking(true);
      setNarratorText('');
      clearStreamNarration(true);

      let full = '';
      let sawError = false;
      // Kage #3 — true once the FIRST chunk observes that the poll's own
      // reconciliation already claimed (appended) this turn's narration
      // before we got here (see reconcileEvents.ts rule 3 sub-case (c)).
      // Once true, every subsequent chunk still updates the ephemeral
      // narratorText widget above but must NEVER touch the transcript log —
      // the durable row the poll already appended is canonical.
      let pollClaimedNarration = false;
      try {
        for await (const ev of subscribeDmJob(jobId, sessionId, { signal: ctrl.signal })) {
          if (ev.kind === 'chunk') {
            full = ev.text;
            setThinking(false);
            setNarratorText(full);
            if (!pollClaimedNarration) {
              if (!streamRowIdRef.current) {
                // First chunk. If the ledger entry is already gone (both
                // player+narration resolved via the poll) or already carries
                // a narrationRowId we didn't set (streamRowIdRef is still
                // null here, so it can't be ours) — the poll's
                // reconciliation got here first. Stop touching the
                // transcript for the rest of this tail.
                const preEntry = pendingByKeyRef.current.get(ledgerKey);
                if (!preEntry || preEntry.narrationRowId) {
                  pollClaimedNarration = true;
                }
              }
              if (!pollClaimedNarration) {
                upsertStreamNarration(full);
                // Keep the ledger's narrationRowId in sync with the live row
                // so reconcileDurableEvents (rule 3) can find-and-replace it
                // once the durable seq-bearing event lands on the poll.
                const entry = pendingByKeyRef.current.get(ledgerKey);
                if (entry && streamRowIdRef.current) {
                  entry.narrationRowId = streamRowIdRef.current;
                }
              }
            }
          } else if (ev.kind === 'error') {
            sawError = true;
          }
        }
      } catch (e) {
        sawError = true;
        console.error('[dm-turn] subscribe failed client-side:', e);
      }

      if (ctrl.signal.aborted) return;
      setThinking(false);
      setTalking(false);
      if (subscribedJobIdRef.current === jobId) subscribedJobIdRef.current = null;

      if (sawError && !pollClaimedNarration) {
        // §4d failure detection (SSE tail yields error). Drop the orphaned
        // streaming row and its ledger entry — a `failed` job never writes a
        // durable narration event, so nothing will ever reconcile it.
        // Guarded on !pollClaimedNarration — Kage #3: if the poll's own
        // reconciliation already rendered this beat's durable narration
        // before we got here, a LATE SSE error (the tail closing after its
        // job is already done) is not a real failure; nothing to clean up.
        clearStreamNarration(true);
        pendingByKeyRef.current.delete(ledgerKey);
        setNarratorText('');

        if (origin === 'beat') {
          // DDX-20 Pass 3 Finding 1 (Miko-QA/Kage-CR MUST-FIX) — a
          // beat-originated job's SSE-tail error drops SILENTLY (§3.1
          // "beats have no retry affordance"). Surfacing the shared
          // composer Retry banner here was wrong on two counts: (a) its
          // handler (onRetryFailedTurn) unconditionally replays via
          // narrateDurable — the COMPOSER function, which has no
          // mechanics/suppress_intent parameters at all, so a retried beat
          // silently lost both (double scene-advance for beats 2/3/4, a
          // mechanics-blind retry for 1/5/6); (b) it isn't this beat's
          // failure to surface — beats already silently skip when Suzu's
          // busy (§3.2); an SSE-tail error is the equivalent "give up
          // quietly" case. Masked per §10 — no mechanics/prose, just the
          // correlation id.
          console.debug('beat_narration_sse_error_dropped', { job_id: jobId, turn_key: ledgerKey });
        } else {
          // Never reuse this turn_key on retry (narrateDurable mints a
          // fresh one every call).
          setJobFailed(true);
          appendLog({
            who: 'Suzu',
            kind: 'system',
            text: 'Suzu stepped away for a moment. Try again.',
          });
        }
      }
    },
    [sessionId, clearStreamNarration, upsertStreamNarration, appendLog],
  );

  // ── load session + party ────────────────────────────────────────────────────
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
        if (g) setGrounding(g);
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
        // starting from an empty set (see pollDurable below). Flag-gated
        // (Kage-CR SUGGESTION, this pass) — journalSeenSeqsRef is only ever
        // read from pollDurable, itself reachable only when
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
          // DDX-08 / T3: the events poll below only appends seq > this —
          // every rehydrated row (including any past dice_roll) is already
          // in `rows`, so start the poll's watermark at the newest seq seen.
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
        // openScene is a useCallback declared below; this effect runs post-mount
        // (after the component body executes) so the forward reference is safe.
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
  // for human-DM seats so the tab is correct from the first render.
  // Runs once per session load (not on every mode change).
  useEffect(() => {
    if (modeSyncedRef.current || !session) return;
    modeSyncedRef.current = true;
    const thisDm = !!(session.dm_username && username &&
      session.dm_username.toLowerCase() === username.toLowerCase());
    if (thisDm && session.dm_mode === 'human') {
      setMode('dm_narration');
    }
  }, [session, username]);

  // ── combat state poll (4s, foregrounded) ────────────────────────────────────
  // Deps: [combatId] only — state transitions (active→between_turns→active) must
  // NOT reset the interval. The ended short-circuit is checked inside poll() via
  // combatStateRef so the effect never needs to observe combatState?.state.
  useEffect(() => {
    if (!combatId) return;

    const poll = async () => {
      if (document.hidden) return;
      // Short-circuit: if combat has ended, skip the fetch.
      if (combatStateRef.current?.state === 'ended') return;
      const mySeq = stateSeqRef.current;
      try {
        const cs = await getCombatState(combatId);
        // Only apply if no mutation has happened since we sent this request.
        if (stateSeqRef.current === mySeq) {
          setCombatState(cs);
        }
      } catch {
        // Poll errors are non-fatal — the next tick will retry.
      }
    };

    pollIntervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [combatId]);

  // ── session status poll (~4-5s, foregrounded) ───────────────────────────────
  // D1 (DDX-25 R2): session status (active/paused/ended) is server truth and,
  // before this, was only ever fetched once on mount plus after the acting
  // DM's own mutation (refreshSessionAfterAction) — a pause/resume/end was
  // therefore invisible to every OTHER open tab (a player's tab, or a second
  // DM tab) until a manual reload, which defeats the point of pausing.
  // Mirrors the combat-state poll immediately above: same cadence, same
  // document.hidden gate, same ref-mirror-so-the-callback-doesn't-reset-the-
  // interval shape, same non-fatal poll-error handling.
  //
  // No stateSeqRef-style monotone guard here (unlike the combat poll): a
  // combat mutation response carries fresher inline state that a
  // concurrently-in-flight (and thus stale) poll response must not clobber.
  // Session status has no such inline-fresher-response case — every consumer
  // (this poll AND every mutation handler's own refreshSessionAfterAction)
  // reads the exact same GET /sessions/{id}, so whichever call resolves last
  // is, by definition, the most current server truth. Refetch-wins is
  // correct here; there's no local optimistic write for a "stale" poll
  // response to stomp.
  //
  // Deps: [sessionId, state] only — session field changes (status, xp_pool,
  // ...) must NOT reset the interval; sessionRef lets the callback read the
  // current status (to know when to stop) without being a dep. `state`
  // (loading/ok/error/notfound) is set exactly once, in the mount effect
  // above, so including it only delays the first interval start until the
  // session has actually loaded — it never causes a later reset.
  //
  // NOTE: a targeted precursor to DDX-20's unified events poll — kept simple
  // and self-contained (own interval, own ref) so DDX-20 can later absorb it.
  //
  // DDX-25 R3: setSession(s) is now gated on sessionsEqual(s, sessionRef.current)
  // rather than called unconditionally. Before this fix, EVERY tick — even a
  // pure no-op one where nothing changed server-side — replaced `session`
  // with a freshly-deserialized object, so `session` got a new identity every
  // ~4s regardless. SessionRecap's effects depended on the whole `session`
  // object, so they re-fired on every tick and re-issued a REAL LLM-backed
  // "previously on" narration request indefinitely (live-observed: 20+
  // repeated recap requests per viewer, scaling with concurrent viewers). A
  // genuine status/xp_pool/dm_mode/... change still differs under
  // sessionsEqual (whole-object structural compare), so cross-tab
  // convergence on pause/resume/end (D1, ADV-4) is unaffected.
  useEffect(() => {
    if (!sessionId || state !== 'ok') return;

    const poll = async () => {
      if (document.hidden) return;
      // Stop polling once the session has ended — nothing left to converge on.
      if (sessionRef.current?.status === 'ended') return;
      try {
        const s = await getSession(sessionId);
        if (!sessionsEqual(s, sessionRef.current)) setSession(s);
      } catch {
        // Poll errors are non-fatal — the next tick will retry.
      }
    };

    sessionPollIntervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (sessionPollIntervalRef.current) {
        clearInterval(sessionPollIntervalRef.current);
        sessionPollIntervalRef.current = null;
      }
    };
  }, [sessionId, state]);

  // ── dice-roll events poll (4s, foregrounded) ────────────────────────────────
  // DDX-08 / T3: dice rolls are server-authoritative (POST /roll persists a
  // `dice_roll` session event, DDX-07) — this poll is what makes a roll
  // triggered on ANY client (including this one; onRoll never appends a row
  // locally) show up on EVERY client watching the session, without a reload.
  // Mirrors the session-status poll immediately above: same cadence, same
  // document.hidden gate, same cleanup-on-unmount shape.
  //
  // The engine's GET /events has no "since seq" filter, so every tick refetches
  // the full (capped) event list and appends only rows with seq strictly
  // greater than lastEventSeqRef.current (set once by rehydration, advanced
  // here after each tick). Only `dice_roll` and `x_card` (DDX-26) events are
  // rendered as ROWS by this poll — other kinds (player_action/narration/...)
  // are already reflected through their own optimistic-append/streaming paths
  // and are intentionally left to a future unified events poll (DDX-20) to
  // avoid duplicating rows for the client that originated them.
  //
  // DDX-26: this same tick also feeds `newOnes` (every kind, not just the
  // rendered ones) to scanXCardTracking so the X-card banner's active-state
  // (xCardEvent / latestNarrationSeq) converges on every open client — the
  // raiser's own tab included, since the raise handler only sets an
  // optimistic local value and relies on this poll for the durable/cross-tab
  // truth, exactly like onRoll relies on this poll for dice_roll rows.
  useEffect(() => {
    if (!sessionId || state !== 'ok') return;

    // DDX-20 (flag-ON only) — the unified events poll. Replaces the
    // full-refetch-and-filter legacy poll with the `since_seq` cursor
    // (Technical Design §2.2) and reconciles EVERY kind (not just
    // dice_roll/x_card) through the ledger (§3.2) so an originating client
    // never double-renders and a reload reconstructs purely from the poll.
    // Loops forward while `has_more` is true (cold-start / large-backlog
    // catch-up), same cursor-loop shape as the design's §6 mobile-parity
    // note. Never called on the flag-OFF path — see the early-return guard
    // in `poll` below, which is the ENTIRE flag-off diff to this effect.
    const pollDurable = async () => {
      try {
        let sinceSeq = lastEventSeqRef.current;
        let page = await getSessionEventsPage(sessionId, sinceSeq);
        let allNewEvents: EngineSessionEvent[] = [...page.events];
        let maxSeq = page.max_seq;
        let guard = 0;
        while (page.has_more && guard < 25) {
          guard += 1;
          const pageMax = page.events.reduce((m, e) => Math.max(m, e.seq ?? 0), sinceSeq);
          if (pageMax <= sinceSeq) break; // no forward progress — avoid an infinite loop
          sinceSeq = pageMax;
          page = await getSessionEventsPage(sessionId, sinceSeq);
          allNewEvents = allNewEvents.concat(page.events);
          maxSeq = Math.max(maxSeq, page.max_seq);
        }

        if (allNewEvents.length > 0) {
          // DDX-20 F9+Recap Design §2.4 — merge-by-seq, NOT a blind append.
          // This comment used to claim "the cursor read only ever returns
          // rows this client hasn't seen yet, so appending is correct here"
          // — that assumption doesn't hold in general (Kage-CR SUGGESTION,
          // this pass — reworded to lead with the permanent reason instead
          // of a "not yet deployed" framing that would read as stale the day
          // it ships): Tavern and the NekoNova proxy deploy independently,
          // so a flag-ON Tavern build can always meet a proxy that drops
          // `since_seq` (ProjectNekoNova/api/routes/dnd_sessions.py) before
          // it reaches the engine, no matter what lands upstream — this
          // defense is permanent, not contingent on any one deploy. (That
          // drop IS fixed upstream in ProjectNekoNova `be4db8a`
          // (`feature/ddx-20-p1b-durable-runner`), not yet merged to main or
          // deployed as of this pass — cross-repo, filed separately, not
          // fixed here — but whether it ships doesn't change whether Tavern
          // needs this defense.) So `allNewEvents` is the FULL session
          // history on EVERY poll tick under today's proxy. A blind
          // `[...prev, ...allNewEvents]` append therefore re-added the whole
          // history every ~4s: unbounded journalEvents growth, duplicate
          // React keys in deriveRecapHistory (`recap-${seq}`), and a fresh
          // array identity every tick even when nothing changed. This runs
          // BEFORE reconcileDurableEvents below, so the §2.2 ledger seed
          // above does NOT cover it — journalEvents needs its own dedup.
          // Same "don't trust the network" posture as §2.2: correct
          // regardless of what the wire actually returns.
          //
          // Post-review fix (Kage-CR IMPORTANT / Miko-QA MEDIUM, fold
          // commit) — the dedup used to build `seen` ONCE from `prev` and
          // never update it while filtering `allNewEvents`, so it only
          // deduped ACROSS ticks, never WITHIN one: the has_more catch-up
          // loop above reproduces exactly that when the wire drops
          // `since_seq` (an identical page gets refetched and concat'd onto
          // `allNewEvents` before this runs). Separately, `e.seq == null`
          // used to short-circuit straight to "fresh", so a malformed/
          // legacy no-seq event bypassed dedup ENTIRELY and re-appended
          // every tick, unbounded, for as long as the session stayed
          // mounted — worse than the has_more case, which at least
          // self-limits after 2 fetches. Fixed by mirroring
          // reconcileDurableEvents' own rule 1 (reconcileEvents.ts):
          // check-and-add one key at a time via journalSeenSeqsRef (seeded
          // at mount alongside journalEvents, above) instead of computing a
          // static snapshot once per tick.
          //
          // Seq normalizes via `?? 0` (matching reconcileEvents.ts:151 and
          // lastEventSeqRef's own convention above), not treated as
          // unconditionally unique when missing. Trade-off, stated plainly
          // (Kage-CR SUGGESTION, this pass — corrected from a "window"
          // framing that understated the blast radius): key `0` is poisoned
          // for the WHOLE MOUNT once anything claims it, not just within one
          // poll batch — and the poisoning event can come from the
          // rehydration seed above (journalSeenSeqsRef's mount-time `?? 0`
          // normalization of the rehydrated history) just as easily as from
          // a later poll tick, so every LATER genuinely-distinct null-seq
          // event is dropped for the rest of the session once that happens,
          // not merely within a shared batch. Accepted because (a) this is
          // dormant BY CONSTRUCTION, not just "hasn't happened yet":
          // `msm.session_events.seq` is `bigint NOT NULL`
          // (NekoNova-DnDEngine db/migrations/msm/001_schema.sql:415), its
          // sole writer `_log_session_event_locked`
          // (engine/msm_repo.py:1498-1568, whose own inline comment states
          // it is "the SOLE assigner of msm.session_events.seq") always
          // computes
          // `seq` inline via `COALESCE(MAX(seq), 0) + 1`, the legacy
          // fallback synthesizes a 1-based seq from row order, and the
          // NekoNova proxy only ever filters whole events — it never
          // rewrites fields — so neither engine path can structurally emit
          // a null seq, and (b) the alternative (today's pre-fix behavior:
          // null-seq events exempt from dedup entirely) is the strictly
          // worse, ACTUALLY-reachable bug this fixes.
          //
          // console.debug hoisted above setJournalEvents (Kage-CR
          // SUGGESTION) — state updaters must stay pure; React 19
          // StrictMode double-invokes them to catch exactly this, and would
          // have double-logged in dev. `journalFresh` is computed here (a
          // plain, already-decided array) so the updater below only ever
          // does a deterministic append + sort — no Set mutation, no
          // logging, safe to double-invoke.
          const journalFresh: EngineSessionEvent[] = [];
          for (const e of allNewEvents) {
            const key = e.seq ?? 0;
            if (journalSeenSeqsRef.current.has(key)) continue;
            journalSeenSeqsRef.current.add(key);
            journalFresh.push(e);
          }
          // §10 observability — the live tell for the NekoNova since_seq
          // drop (fresh 0, fetched N on every tick with no real new
          // activity); flips to fetched:0 the day that hop is fixed. Now
          // also catches the null-seq variant above (Kage-CR SUGGESTION —
          // previously silent for it: a null-seq event always counted as
          // "fresh" under the old filter, so fetched and fresh stayed
          // numerically equal even on a 100%-redundant tick, and the has_more
          // duplicate case never shrank `fresh` either since `seen` was never
          // updated intra-batch). Masked: counts only, never prose/mechanics.
          if (journalFresh.length < allNewEvents.length) {
            console.debug('poll_page_redundant', {
              fetched: allNewEvents.length,
              fresh: journalFresh.length,
            });
          }
          if (journalFresh.length > 0) {
            setJournalEvents((prev) =>
              [...prev, ...journalFresh].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
            );
          }

          // §10 observability (Kage-CR low suggestion) — snapshot which
          // beat-origin ledger keys are still awaiting narration BEFORE
          // reconciling, so we can log `beat_narration_reconciled` for any
          // that resolve (deleted from the ledger) this tick. Masked: no
          // mechanics/prose, just seq + the turn_key correlation id.
          const beatKeysAwaitingBefore = [...pendingByKeyRef.current.entries()]
            .filter(([, e]) => e.origin === 'beat' && e.awaitingNarration)
            .map(([key]) => key);

          const result = reconcileDurableEvents(
            allNewEvents,
            renderedSeqsRef.current,
            pendingByKeyRef.current,
            (id) => logRef.current.find((r) => r.id === id),
          );
          if (result.appended.length > 0 || result.stamped.length > 0) {
            setLog((prev) => applyReconcileResult(prev, result));
          }
          for (const key of beatKeysAwaitingBefore) {
            if (!pendingByKeyRef.current.has(key)) {
              console.debug('beat_narration_reconciled', { seq: result.maxSeqSeen, turn_key: key });
            }
          }
          const { xCard, narrationSeq } = scanXCardTracking(allNewEvents);
          if (xCard) {
            setXCardEvent((prev) => (!prev || xCard.seq > prev.seq ? xCard : prev));
          }
          if (narrationSeq != null) {
            setLatestNarrationSeq((prev) =>
              prev == null || narrationSeq > prev ? narrationSeq : prev,
            );
          }
        }

        lastEventSeqRef.current = Math.max(lastEventSeqRef.current, maxSeq, sinceSeq);

        // §2.2/§4b — surface pending_generation as real state (Pass 2 —
        // drives the resume/busy affordance). Masked observability per §10:
        // never log data.text/prose, only the correlation id + seq.
        // Kage #5: only touch state when job_id/status actually changed —
        // otherwise every ~4s tick constructs a NEW object (even when the
        // job is unchanged) and forces a re-render for nothing, mirroring
        // the same no-op-guard discipline the flag-OFF session-status poll
        // already applies via sessionsEqual().
        const pending = page.pending_generation;
        setActiveJob((prev) => {
          if (prev === pending) return prev;
          if (
            prev &&
            pending &&
            prev.job_id === pending.job_id &&
            prev.status === pending.status &&
            prev.trigger_seq === pending.trigger_seq
          ) {
            return prev;
          }
          return pending;
        });

        // §4b — stateless poll-discovery, the primary resume mechanism:
        // subscribe (never POST) to an in-flight job this client is not
        // already tailing. Covers three cases uniformly via the
        // subscribedJobIdRef guard: (1) a fresh mount/reload discovering
        // another client's (or this tab's own PRIOR reload's) turn — the
        // "don't-re-POST" rule; (2) this client's own just-created job,
        // where narrateDurable already set subscribedJobIdRef before this
        // tick runs, so the guard correctly no-ops here; (3) the 409-busy
        // pivot's own subscribe, same no-op guard.
        if (pending && pending.job_id !== subscribedJobIdRef.current) {
          console.debug('turn_resumed_from_pending', {
            job_id: pending.job_id,
            trigger_seq: pending.trigger_seq,
          });
          // origin: 'composer' — a stateless poll-resume genuinely cannot
          // tell whether the discovered job was a composer turn or a
          // synthetic beat (no server-side marker exists, and this client's
          // own lastDurableTurnRef/turnKeyRef are reset across a reload
          // anyway). Defaulting to 'composer' preserves pre-fix behavior
          // here (out of Finding 1's scope, which is the explicit
          // narrateDurable/narrateDurableBeat call sites below) — worst case
          // on a genuine beat-job SSE error post-reload is a Retry banner
          // whose click no-ops (onRetryFailedTurn already guards on a null
          // lastDurableTurnRef), not a wrong-content resubmit.
          void subscribeToJob(pending.job_id, pending.turn_key, pending.trigger_seq, 'composer');
        } else if (!pending) {
          subscribedJobIdRef.current = null;
        }

        // §4c turn_key lifecycle — clear once THIS client's own in-flight
        // turn resolved (reconcileDurableEvents' rules 2/3 above removed its
        // ledger entry once the narration seq was observed).
        if (turnKeyRef.current && !pendingByKeyRef.current.has(turnKeyRef.current)) {
          clearTurnKey(sessionId);
          turnKeyRef.current = null;
          pollFailureGraceRef.current = null;
        }

        // §4d, mechanism 2 (Miko-QA finding c) — poll-only failure detection.
        // Only meaningful while THIS client still owns an unresolved turn
        // (the completion branch just above already handles the success
        // case). If `pending_generation` doesn't reflect our turn_key this
        // tick, count it; once that streak reaches POLL_FAILURE_GRACE_TICKS
        // with STILL no narration having landed, treat the job as dead —
        // same cleanup + retry affordance as subscribeToJob's SSE-error path.
        // This is what catches a job that died where NO client is actively
        // holding its SSE tail to observe an `error` frame (reload after a
        // silent failure, a tab backgrounded long enough for the browser to
        // pause/kill the EventSource, a proxy idle-timeout truncation).
        if (turnKeyRef.current && pendingByKeyRef.current.has(turnKeyRef.current)) {
          const ownTurnKey = turnKeyRef.current;
          if (pending?.turn_key === ownTurnKey) {
            // Confirmed alive this tick — reset the grace counter.
            pollFailureGraceRef.current = { turnKey: ownTurnKey, nullTicks: 0 };
          } else {
            const grace =
              pollFailureGraceRef.current?.turnKey === ownTurnKey
                ? pollFailureGraceRef.current
                : { turnKey: ownTurnKey, nullTicks: 0 };
            grace.nullTicks += 1;
            pollFailureGraceRef.current = grace;

            if (grace.nullTicks >= POLL_FAILURE_GRACE_TICKS) {
              console.debug('turn_failed_poll_grace', { turn_key: ownTurnKey });
              // Abort a live SSE tail if one is still (uselessly) open for
              // this job — mirrors subscribeToJob's own cleanup.
              if (subscribedJobIdRef.current) {
                narrationAbort.current?.abort();
                subscribedJobIdRef.current = null;
              }
              pendingByKeyRef.current.delete(ownTurnKey);
              clearTurnKey(sessionId);
              turnKeyRef.current = null;
              pollFailureGraceRef.current = null;
              clearStreamNarration(true);
              setNarratorText('');
              setTalking(false);
              setThinking(false);
              setActiveJob(null);
              setJobFailed(true);
              appendLog({
                who: 'Suzu',
                kind: 'system',
                text: 'Suzu stepped away for a moment. Try again.',
              });
            }
          }
        } else if (pollFailureGraceRef.current && pollFailureGraceRef.current.turnKey !== turnKeyRef.current) {
          // Stale counter from a resolved/abandoned turn — drop it so a
          // future turn starts its own grace count from zero.
          pollFailureGraceRef.current = null;
        }
      } catch {
        // Poll errors are non-fatal — the next tick will retry (same
        // convention as the flag-OFF branch below).
      }
    };

    const poll = async () => {
      if (document.hidden) return;
      if (DURABLE_GENERATION_ENABLED) {
        await pollDurable();
        return;
      }
      try {
        const events = await getSessionEventsRaw(sessionId);
        if (!events || events.length === 0) return;
        const newOnes = events
          .filter((e) => (e.seq ?? 0) > lastEventSeqRef.current)
          .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        if (newOnes.length === 0) return;
        // Miko poll-churn fix: this used to run BEFORE the newOnes.length
        // guard above, so a fresh (but content-identical) array from
        // getSessionEventsRaw re-rendered the whole page + re-ran all 3
        // JournalPane derivations on EVERY 4s tick forever, even when
        // nothing new happened. Mirrors the sibling session-status poll's
        // own sessionsEqual no-op guard: only touch state when something
        // actually changed. The mount-time rehydration effect already seeds
        // journalEvents once on load — this only keeps it current on ticks
        // that have real new activity.
        setJournalEvents([...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)));
        const rows = newOnes
          .filter((e) => e.kind === 'dice_roll' || e.kind === 'x_card')
          .map(eventToLogRow)
          .filter((r): r is LogRow => r !== null);
        if (rows.length > 0) {
          setLog((prev) => [...prev, ...rows]);
        }
        const { xCard, narrationSeq } = scanXCardTracking(newOnes);
        if (xCard) {
          setXCardEvent((prev) => (!prev || xCard.seq > prev.seq ? xCard : prev));
        }
        if (narrationSeq != null) {
          setLatestNarrationSeq((prev) =>
            prev == null || narrationSeq > prev ? narrationSeq : prev,
          );
        }
        lastEventSeqRef.current = newOnes.reduce(
          (m, e) => Math.max(m, e.seq ?? 0),
          lastEventSeqRef.current,
        );
      } catch {
        // Poll errors are non-fatal — the next tick will retry.
      }
    };

    diceRollPollIntervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (diceRollPollIntervalRef.current) {
        clearInterval(diceRollPollIntervalRef.current);
        diceRollPollIntervalRef.current = null;
      }
    };
    // DDX-20 Pass 2: `subscribeToJob`/`appendLog`/`clearStreamNarration` are
    // listed (all `[]`-stable useCallbacks, so this never resets the
    // interval in practice) — matches this effect's existing convention of
    // NOT listing the many plain imported functions it also calls
    // (getSessionEventsPage, eventToLogRow, scanXCardTracking,
    // reconcileDurableEvents, applyReconcileResult) since those aren't
    // component-scoped values ESLint tracks the same way.
  }, [sessionId, state, subscribeToJob, appendLog, clearStreamNarration]);

  // Re-pin the chat to the latest line when returning to the Story view.
  useEffect(() => {
    if (mobileView === 'log') chatLogRef.current?.scrollToBottom('instant');
  }, [mobileView]);

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

  // Focus management on open/close — mirrors ConfirmDialog exactly: remember
  // whatever was focused (in practice, always the toggle button below, since
  // that's the only way to open), focus the drawer's close button after
  // paint, and restore focus on close via the effect's own cleanup (fires
  // for EVERY path journalOpen flips false: Esc, scrim click, or the close
  // button itself) — one source of truth instead of three ad-hoc refocuses.
  useEffect(() => {
    if (!journalOpen) return;
    journalPreviouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => journalCloseBtnRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      journalPreviouslyFocusedRef.current?.focus?.();
    };
  }, [journalOpen]);

  // Esc + a generic Tab-trap (only while acting as the desktop drawer —
  // never wired on the mobile tab, see the conditional onKeyDown prop below).
  // The trap queries focusable descendants fresh on every Tab (content is
  // dynamic — the notes textarea, a growing NPC/recap list), unlike
  // ConfirmDialog's hardcoded 2-button trap.
  const onJournalKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeJournal();
        return;
      }
      if (e.key === 'Tab' && journalDialogRef.current) {
        const focusables = Array.from(
          journalDialogRef.current.querySelectorAll<HTMLElement>(JOURNAL_FOCUSABLE_SELECTOR),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [closeJournal],
  );

  // B1-4: fire-once toast when combat becomes active and the user has no bound
  // character (they can observe but not act).
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
  }, [combatState?.state, myCharacterIdStr, toast]);

  // ── cleanup streams on unmount ───────────────────────────────────────────────
  // pollIntervalRef is owned by the combatId effect above — its cleanup already
  // runs on combatId change and on unmount. Don't double-clear it here; doing so
  // trips a Strict Mode bug where the []-dep cleanup fires between the poll
  // effect's double-invoke and its real mount, leaving no cleanup for real unmount.
  useEffect(
    () => () => {
      if (revealRef.current) clearInterval(revealRef.current);
      narrationAbort.current?.abort();
    },
    [],
  );

  const revealText = useCallback(
    (full: string) => {
      if (revealRef.current) clearInterval(revealRef.current);
      if (reduced) {
        setNarratorText(full);
        return;
      }
      const tokens = full.split(/(\s+)/);
      let i = 0;
      setNarratorText('');
      revealRef.current = setInterval(() => {
        i += 1;
        setNarratorText(tokens.slice(0, i).join(''));
        if (i >= tokens.length && revealRef.current) {
          clearInterval(revealRef.current);
          revealRef.current = null;
        }
      }, 26);
    },
    [reduced],
  );

  /**
   * Refetch grounding after a scene advance so the Scene card updates.
   *
   * Defined ahead of `narrate` (moved up from its original spot just below
   * the scene-advance handlers) so `narrate` can call it directly when a
   * beat's SSE response carries a `sceneAdvanced` signal (P1-PLAYFIX-2 §A.5/§A.7).
   *
   * Iro MAJOR-1: returns the freshly-fetched grounding so callers that need
   * to validate against CURRENT state right after a refresh (e.g. narrate()'s
   * offered_check check) don't have to rely on the `grounding` closure value,
   * which is stale until the next render commits this call's setGrounding().
   */
  const refreshGrounding = useCallback(async (): Promise<GroundingData | null> => {
    if (!sessionId) return null;
    const g = await getGrounding(sessionId).catch(() => null);
    setGrounding(g);
    return g;
  }, [sessionId]);

  /**
   * Iro Ship 2 CRITICAL-1 — refocus the scene heading if a `refreshGrounding()`
   * refresh unmounted the button the user was just on, stranding focus on
   * <body>. `hadFocusInGroup` MUST be captured synchronously by the caller
   * BEFORE any await (the browser focuses a clicked button synchronously, so
   * that's the only reliable moment to know which group had focus).
   * The stranding check itself runs inside a rAF so it observes the DOM
   * *after* React's commit — checking immediately after an `await` can race
   * the commit and false-negative. Only acts if focus actually landed on
   * <body> (i.e. was truly dropped) — if the user had already tabbed
   * elsewhere in the interim, activeElement is that element, not <body>, and
   * we leave it alone.
   *
   * Defined ahead of `narrate` (P1-PLAYFIX-2 gate fix, Iro CRITICAL-1) so
   * narrate() can call it directly after its own sceneAdvanced-triggered
   * refreshGrounding(), mirroring onMoveOn/onAttemptCheck below.
   */
  const refocusSceneHeadIfStranded = useCallback((hadFocusInGroup: boolean) => {
    if (!hadFocusInGroup) return;
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) {
        sceneHeadRef.current?.focus();
      }
    });
  }, []);

  /**
   * Stream one DM-narration beat; `mechanics` empty = pure roleplay beat.
   *
   * A1: optional `opts.kind` can be 'opening' — when set:
   *   - No player log row is appended (opening is system-authored).
   *   - `message` sent to the proxy is '' (opening beats have no player message).
   *   - The proxy writes the durable `opening_narrated` event marker on success.
   *   - On error, a neutral "Suzu hasn't joined yet" system row is appended.
   *
   * FIX-1: accepts optional `opts.session` to override the closure `session` value.
   * This is required for the opening-scene call where session state is still null
   * at mount time; all other callers omit it and fall back to the closure value.
   *
   * P1-PLAYFIX-2 §A.5/§A.7 (A.2 reconciliation): the SSE response may carry
   * `offeredCheck` and/or `sceneAdvanced`/`advancedTo`. Both are handled AFTER
   * the narration text is appended so the beat reads in order: Suzu's words
   * land, THEN the UI reacts to what she signalled.
   */
  const narrate = useCallback(
    async (
      playerMessage: string,
      mechanics: string,
      beatMode: ComposeMode,
      opts?: { kind?: 'beat' | 'opening'; session?: Session; suppressIntent?: boolean },
    ) => {
      // FIX-1: use the override session when supplied (opening call), otherwise
      // fall back to the closure value (all subsequent player/combat calls).
      const activeSession = opts?.session ?? session;
      if (!activeSession || !username) return;

      // S5.2: human-DM sessions do NOT route through the LLM pipeline at all.
      // S5.5: ai_assist_level='off' or 'assist' also suppresses auto-fire narration.
      //   'off'    → full interlock; no LLM calls (server enforces; client matches).
      //   'assist' → no auto-fire; only explicit DM invocation (future affordance).
      //              Sprint 5 ships assist = no auto-fire (same gate as off for now).
      // Read directly from activeSession (server truth) — no separate useState copy.
      const aiLevel = activeSession.ai_assist_level;
      if (activeSession.dm_mode === 'human' || aiLevel === 'off' || aiLevel === 'assist') return;

      // Iro Ship 2 CRITICAL-1: capture BEFORE any await in this function — a
      // `sceneAdvanced` signal below triggers refreshGrounding(), which can
      // recompute availableChecks/availableTransitions and unmount whichever
      // button the player was just on. This mirrors onMoveOn/onAttemptCheck's
      // own capture exactly; the browser focuses a clicked button
      // synchronously, so this is the only reliable moment to know which
      // group had it.
      const hadFocusInCheckWrap = checkWrapRef.current?.contains(document.activeElement) ?? false;
      const hadFocusInTransitionWrap =
        transitionWrapRef.current?.contains(document.activeElement) ?? false;

      narrationAbort.current?.abort();
      const ctrl = new AbortController();
      narrationAbort.current = ctrl;
      setTalking(true);
      setThinking(true);
      setNarratorText('');
      // Drop any partial live-narration row left over from an aborted beat so
      // this beat starts a fresh bottom-of-chat row (never overwrites the old).
      clearStreamNarration(true);
      // P1-PLAYFIX-2 §A.6 — clear any stale offer from a previous beat; THIS
      // turn's response (if any) re-sets it below.
      setOfferedCheckSkill(null);

      const isOpening = opts?.kind === 'opening';

      const transcript = logRef.current.slice(-8).map((r) => `${r.who}: ${r.text}`);
      let full = '';
      let errored = false;
      let lastErrorReason: string | undefined;
      let offeredCheckSignal: OfferedCheck | undefined;
      let sceneAdvancedSignal = false;
      try {
        for await (const ev of streamDmNarration(
          {
            username,
            channel: activeSession.channel,
            // Opening beats MUST send empty message — the proxy enforces this.
            message: isOpening ? '' : playerMessage,
            mechanics,
            transcript,
            mode: beatMode,
            session_id: activeSession.session_id,
            ...(isOpening ? { kind: 'opening' as const } : {}),
            // Kage #1 / Miko DEFECT-2 — true only on the client's own synthetic
            // confirmation beats (onMoveOn/onAttemptCheck/handleSceneAdvance);
            // tells the server's INTENT classifier not to advance the scene a
            // second time for a beat that already advanced it via its own
            // dedicated endpoint.
            suppress_intent: opts?.suppressIntent ?? false,
          },
          { signal: ctrl.signal },
        )) {
          if (ev.kind === 'chunk') {
            full = ev.text;
            setThinking(false);
            if (ev.streamMode) {
              // DM-STREAM: the server is already pacing the reveal
              // token-by-token — set the cumulative text directly instead of
              // running the client-side fake typewriter (which would double
              // up the reveal and lag behind the real stream). Clear any
              // typewriter interval left over from a prior non-streamed beat.
              if (revealRef.current) {
                clearInterval(revealRef.current);
                revealRef.current = null;
              }
              setNarratorText(full);
              // Mirror the live stream into a growing bottom-of-chat row.
              upsertStreamNarration(full);
            } else {
              // Flag-OFF / buffered path — unchanged fake-reveal.
              revealText(full);
            }
            if (ev.offeredCheck) offeredCheckSignal = ev.offeredCheck;
            if (ev.sceneAdvanced) sceneAdvancedSignal = true;
          } else if (ev.kind === 'error') {
            errored = true;
            lastErrorReason = ev.reason;
          }
        }
      } catch (e) {
        errored = true;
        // OBS-1: never swallow the reason — this catch is exactly where
        // "instant stepped-away with zero trace" failures land (aborted
        // fetches, exhausted connection pool, proxy refusals). Console gets
        // the real exception; the fallback row gets a debug suffix on the
        // local stack so playtests can report the cause verbatim.
        lastErrorReason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
         
        console.error('[dm-narration] beat failed client-side:', e);
      }

      if (ctrl.signal.aborted) return;
      setThinking(false);
      setTalking(false);
      if (errored || !full.trim()) {
        // Drop any partial live-streamed row before showing the fallback.
        clearStreamNarration(true);
        const fallbackText = isOpening
          ? "Suzu hasn't joined yet — try a move and she'll catch up."
          : lastErrorReason === 'ai_off'
            ? 'This table runs without AI narration — you and your DM drive the scene.'
            : // OBS-1: on the local stack, show the captured failure reason in
              // the log row itself so a playtest report carries the cause
              // verbatim (prod keeps the friendly copy only).
              `Suzu stepped away for a moment. Try again.${
                process.env.NEXT_PUBLIC_DEPLOY_ENV === 'local' && lastErrorReason
                  ? ` (debug: ${lastErrorReason})`
                  : ''
              }`;
        appendLog({
          who: 'Suzu',
          kind: 'system',
          text: fallbackText,
        });
        setNarratorText('');
        return;
      }

      if (streamRowIdRef.current) {
        // Streamed path — the narration is already live in the bottom log as
        // an aria-hidden streaming row. T1 (TAV-S1): finalize by REMOUNTING a
        // fresh, non-hidden row (new id) in its place rather than mutating
        // the same node's text — the fresh node is what the SR announces
        // exactly once (see finalizeStreamNarration's own comment).
        finalizeStreamNarration(full);
      } else {
        // Buffered / flag-OFF path — append the finished narration as before.
        appendLog({ who: 'Suzu', kind: 'narration', text: full });
      }

      // P1-PLAYFIX-2 §A.5/§A.7 (A.2 reconciliation) — the server already
      // narrated the transition in-fiction on THIS turn (server-side INTENT)
      // when `sceneAdvanced` is true; just catch the scene card / affordances
      // up. Never call narrate() again here — `full` above IS the narration
      // for this beat, calling it again would double-narrate.
      // Iro MAJOR-1: keep the freshly-fetched grounding here (not the closure
      // value below) — refreshGrounding()'s returned data is used for the
      // offered_check validation just below so a check offered on the
      // NEWLY-advanced scene isn't wrongly dropped as "not authored".
      let freshGrounding: GroundingData | null = null;
      if (sceneAdvancedSignal) {
        freshGrounding = await refreshGrounding();
        // Iro Ship 2 CRITICAL-1: mirror onMoveOn/onAttemptCheck — refocus the
        // scene heading if the refresh above stranded focus on <body>.
        refocusSceneHeadIfStranded(hadFocusInCheckWrap || hadFocusInTransitionWrap);
      }

      // P1-PLAYFIX-2 §A.5/§A.6 — surface an offered check. Per §A.3 this NEVER
      // auto-rolls; it only makes the matching "Attempt {skill}" affordance
      // impossible to miss. Defensive: only surface when the offered skill is
      // actually one of THIS scene's authored checks — never trust the signal
      // blindly. Uses the toast/aria-live channel (not a stolen DOM focus) so
      // screen-reader users get the invite without yanking focus off the
      // composer mid-conversation.
      if (offeredCheckSignal) {
        // Iro MAJOR-1: validate against the freshly-fetched grounding when
        // this beat just advanced the scene — the `grounding` closure value
        // is stale until the next render (setGrounding() is async), so
        // validating against it here would wrongly drop a check authored on
        // the scene we JUST advanced to.
        const currentGrounding = sceneAdvancedSignal ? freshGrounding : grounding;
        const isAuthoredCheck = (currentGrounding?.checks ?? []).some(
          (c) => c.skill === offeredCheckSignal.skill,
        );
        if (isAuthoredCheck) {
          setOfferedCheckSkill(offeredCheckSignal.skill);
          toast({
            tone: 'info',
            message: `Suzu invites a ${titleCaseSkill(offeredCheckSignal.skill)} check — the Attempt button is ready when you are.`,
            duration: 8000,
          });
          requestAnimationFrame(() => {
            checkWrapRef.current?.scrollIntoView({ block: 'nearest' });
          });
        }
      }
    },
    [
      session,
      username,
      revealText,
      appendLog,
      upsertStreamNarration,
      clearStreamNarration,
      finalizeStreamNarration,
      refreshGrounding,
      refocusSceneHeadIfStranded,
      grounding,
      toast,
    ],
  );

  /**
   * DDX-20 Pass 2 — the flag-ON durable turn path (Client Integration Design
   * §4/§5/§6). Mints+persists a `turn_key`, appends the optimistic player row
   * (carrying `pendingKey`), POSTs `/api/narration/dm/turn`, and handles all
   * three create outcomes:
   *   - created (deduped:false)  → subscribe to the fresh job's SSE tail.
   *   - resumed (deduped:true)   → same subscribe path; the engine's
   *     `ON CONFLICT` returned the SAME job this client already started
   *     (e.g. a stray double-fire) — not a new turn, just a resume.
   *   - busy (409)               → the 409-subscribe-pivot (§4a): the
   *     optimistic row is orphaned (never got a seq — the busy guard fires
   *     BEFORE the player_action write), so it's removed and the composer
   *     text restored; then subscribe to the OTHER client's in-flight job so
   *     this client still watches it finish.
   *
   * Mirrors `narrate()`'s own AI-eligibility gate (dm_mode/ai_assist_level)
   * so a human-DM/AI-off table behaves identically to today: the player's
   * row still appears, no job is ever created.
   */
  const narrateDurable = useCallback(
    async (playerMessage: string, beatMode: ComposeMode) => {
      if (!session || !username || !sessionId) return;

      const aiLevel = session.ai_assist_level;
      const aiEligible =
        session.dm_mode !== 'human' && aiLevel !== 'off' && aiLevel !== 'assist';

      if (!aiEligible) {
        // Mirrors narrate()'s own early-return for a human-DM/AI-off table —
        // onSend always shows the player's row regardless; no job is created
        // so there is nothing to reconcile (no pendingKey stamped).
        appendLog({ who: username, kind: 'player', text: playerMessage, color: 'var(--accent)' });
        return;
      }

      // Miko-QA finding (b) — mirrors narrate()'s own pattern: flip
      // talking/thinking SYNCHRONOUSLY, before any await. Previously this
      // only happened inside subscribeToJob, which does not run until AFTER
      // `postDmTurn` resolves — leaving the entire network round-trip
      // uncovered by onSend's `if (!text || talking) return` guard, so a
      // second Enter fired during that window minted a SECOND turn_key and
      // fired a SECOND POST (busy-pivot only cleans this up when the
      // server's busy-guard has already committed, which is not guaranteed).
      setTalking(true);
      setThinking(true);

      setJobFailed(false);
      lastDurableTurnRef.current = { message: playerMessage, mode: beatMode };

      const turnKey = mintTurnKey();
      saveTurnKey(sessionId, turnKey);
      turnKeyRef.current = turnKey;

      const rowId = `r${(idRef.current += 1)}`;
      setLog((prev) => [
        ...prev,
        {
          id: rowId,
          who: username,
          kind: 'player' as const,
          text: playerMessage,
          ts: nowStamp(),
          color: 'var(--accent)',
          pendingKey: turnKey,
        },
      ]);
      pendingByKeyRef.current.set(turnKey, { playerRowId: rowId });

      let handle: Awaited<ReturnType<typeof postDmTurn>>;
      try {
        handle = await postDmTurn({
          username,
          channel: session.channel,
          session_id: sessionId,
          message: playerMessage,
          mode: beatMode,
          turn_key: turnKey,
        });
      } catch (e) {
        console.error('[dm-turn] create failed client-side:', e);
        setLog((prev) => prev.filter((r) => r.id !== rowId));
        pendingByKeyRef.current.delete(turnKey);
        clearTurnKey(sessionId);
        turnKeyRef.current = null;
        setMsg(playerMessage);
        // Release the guard set synchronously above — no subscribeToJob will
        // ever run on this path to clear it, so it must be reset here.
        setTalking(false);
        setThinking(false);
        toast({ tone: 'error', message: 'Could not reach Suzu. Your message was not sent.' });
        return;
      }

      if ('busy' in handle) {
        // §4a — 409-subscribe-pivot. This client's just-appended optimistic
        // row for the NEW turn is orphaned (the busy guard fires before the
        // player_action write) — remove it and restore the composer text
        // rather than leaving a permanently-unreconciled row.
        setLog((prev) => prev.filter((r) => r.id !== rowId));
        pendingByKeyRef.current.delete(turnKey);
        clearTurnKey(sessionId);
        turnKeyRef.current = null;
        setMsg(playerMessage);
        toast({
          tone: 'info',
          message: "Suzu is still responding — your message wasn't sent, try again in a moment.",
        });
        setActiveJob({
          turn_key: '',
          job_id: handle.job_id,
          status: handle.status,
          trigger_seq: handle.trigger_seq,
          started_at: new Date().toISOString(),
        });
        void subscribeToJob(handle.job_id, `busy:${handle.job_id}`, handle.trigger_seq, 'composer');
        return;
      }

      // Created or deduped-resumed — this IS this client's own active turn.
      // triggerSeq is unknown from a 200 create/dedup response (only the 409
      // busy shape carries it); reconcileDurableEvents treats an
      // undefined triggerSeq as "match unconditionally", which is correct
      // here — there is no ambiguity, this is the only turn this client owns.
      setActiveJob({
        turn_key: handle.turn_key,
        job_id: handle.job_id,
        status: handle.status === 'final' ? 'streaming' : handle.status,
        trigger_seq: 0,
        started_at: new Date().toISOString(),
      });
      void subscribeToJob(handle.job_id, turnKey, undefined, 'composer');
    },
    [session, username, sessionId, appendLog, subscribeToJob, toast],
  );

  /**
   * DDX-20 Pass 3 (Synthetic-Beat Design §7 step 2) — a thin durable sibling
   * of `narrateDurable` for the six non-composer "synthetic beat" call sites
   * (roll-confirm, scene-transition x2, check-confirm, combat-start,
   * end-turn — Pass-3 §2's per-beat table). Same AI-eligibility gate, same
   * synchronous `talking`/`thinking` flip before any await (Miko-QA finding
   * (b) discipline), same `mintTurnKey`/`saveTurnKey`/`turnKeyRef` and
   * `postDmTurn` → `subscribeToJob(job_id, turnKey)` on 200. Differs from
   * `narrateDurable` in exactly four ways (§7 step 2):
   *   (a) forwards `mechanics` + `suppress_intent` in the `/dm/turn` payload
   *       — the composer path never carries either;
   *   (b) does NOT append an optimistic player row — each beat already keeps
   *       its own client-only `appendLog` SYSTEM row (§2 player-row policy).
   *       Registers a ledger entry with NO `playerRowId` so the existing
   *       reconcile rule-2 else-branch appends the durable `player_action`
   *       exactly once, with zero reconcile-code changes (§5);
   *   (c) a 409 is *subscribe-and-drop* (§3.1) — there is no composer text to
   *       restore and no optimistic player row to remove for a synthetic
   *       beat, so (unlike narrateDurable's 409-subscribe-pivot) this never
   *       mutates the composer and never shows a retry affordance;
   *   (d) the network-error (non-409) path clears the ledger entry + turnKey
   *       and releases `talking`/`thinking` but — UNLIKE narrateDurable's own
   *       catch block — never toasts and never restores composer text. This
   *       is intentional, not an oversight: there was never any composer
   *       text to restore, and per §3.1 beats have no retry/error affordance
   *       at all, so surfacing a toast here would be new, beat-specific UI
   *       this design deliberately doesn't add.
   *
   * DDX-20 Pass 3 Finding 1 (Miko-QA/Kage-CR MUST-FIX) — this function must
   * NEVER write `jobFailed`/`lastDurableTurnRef`. Those are composer-retry
   * state (`onRetryFailedTurn` replays `lastDurableTurnRef` through
   * `narrateDurable`, which has no `mechanics`/`suppress_intent` params at
   * all); a beat writing them would either clobber a genuine composer
   * failure's retry payload with beat content, or cause a later beat SSE
   * error to surface the composer's Retry banner. `subscribeToJob`'s
   * `origin: 'beat'` argument (both call sites below) is what actually
   * suppresses the Retry banner for a beat's own SSE-tail error — see its
   * definition above.
   */
  const narrateDurableBeat = useCallback(
    async (
      playerLine: string,
      mechanics: string,
      beatMode: ComposeMode,
      opts?: { suppressIntent?: boolean; beat?: string },
    ) => {
      if (!session || !username || !sessionId) return;

      const aiLevel = session.ai_assist_level;
      const aiEligible =
        session.dm_mode !== 'human' && aiLevel !== 'off' && aiLevel !== 'assist';
      if (!aiEligible) {
        // Mirrors narrate()'s own no-op early-return for a human-DM/AI-off
        // table — the caller already appended its own system row before
        // reaching here, so there is nothing further to do.
        return;
      }

      // Miko-QA finding (b) — flip talking/thinking SYNCHRONOUSLY, before any
      // await (see narrateDurable's own comment on this above).
      setTalking(true);
      setThinking(true);

      // Finding 1 — deliberately NOT touching jobFailed/lastDurableTurnRef
      // here (see the JSDoc above): those are composer-retry state and a
      // beat must never clobber or drive them.

      const turnKey = mintTurnKey();
      saveTurnKey(sessionId, turnKey);
      turnKeyRef.current = turnKey;

      // §2 player-row policy — no optimistic player row for a synthetic
      // beat; register a ledger entry with NO playerRowId so the poll's
      // durable player_action is appended exactly once (reconcile rule-2
      // else-branch, reconcileEvents.ts:121-124) instead of stamped.
      pendingByKeyRef.current.set(turnKey, {});

      const beatTag = opts?.beat ?? 'unknown';
      // §10 observability — masked: never mechanics/prose, just the
      // correlation id + beat tag + boolean.
      console.debug('beat_turn_started', {
        turn_key: turnKey,
        beat: beatTag,
        suppress_intent: opts?.suppressIntent ?? false,
      });

      let handle: Awaited<ReturnType<typeof postDmTurn>>;
      try {
        handle = await postDmTurn({
          username,
          channel: session.channel,
          session_id: sessionId,
          message: playerLine,
          mechanics,
          mode: beatMode,
          turn_key: turnKey,
          suppress_intent: opts?.suppressIntent ?? false,
        });
      } catch (e) {
        console.error('[dm-turn] beat create failed client-side:', e);
        pendingByKeyRef.current.delete(turnKey);
        clearTurnKey(sessionId);
        turnKeyRef.current = null;
        // Release the guard set synchronously above — no subscribeToJob will
        // ever run on this path to clear it, so it must be reset here.
        setTalking(false);
        setThinking(false);
        return;
      }

      if ('busy' in handle) {
        // §3.1 subscribe-and-drop. This beat's mechanical action already
        // committed durably in a PRIOR request (the roll/advanceScene/
        // resolveCheck/combat action ran and wrote its own durable events
        // before this call fired) — only the trailing flavor narration is
        // skipped. No text-restore, no row-removal (there was never an
        // optimistic player row), no retry affordance.
        pendingByKeyRef.current.delete(turnKey);
        clearTurnKey(sessionId);
        turnKeyRef.current = null;
        console.debug('beat_turn_busy_409', { beat: beatTag, inflight_job_id: handle.job_id });
        setActiveJob({
          turn_key: '',
          job_id: handle.job_id,
          status: handle.status,
          trigger_seq: handle.trigger_seq,
          started_at: new Date().toISOString(),
        });
        void subscribeToJob(handle.job_id, `busy:${handle.job_id}`, handle.trigger_seq, 'beat');
        return;
      }

      // Created or deduped-resumed — this IS this beat's own active turn.
      setActiveJob({
        turn_key: handle.turn_key,
        job_id: handle.job_id,
        status: handle.status === 'final' ? 'streaming' : handle.status,
        trigger_seq: 0,
        started_at: new Date().toISOString(),
      });
      void subscribeToJob(handle.job_id, turnKey, undefined, 'beat');
    },
    [session, username, sessionId, subscribeToJob],
  );

  /**
   * DDX-20 Pass 2 (§4d) — retry-after-failed. A `failed` job's turn_key is
   * deduped-forever server-side, so retry MUST mint a NEW one — narrateDurable
   * always does (mintTurnKey() is called fresh on every invocation), so a
   * plain resubmit of the last content is sufficient here.
   *
   * Iro MAJOR-1: `setJobFailed(false)` unmounts the Retry button this click
   * handler is attached to. If the button (or something inside it) still has
   * focus at that moment, the browser force-blurs to <body> the instant it's
   * removed. Refocus the permanently-mounted `durableRetryRowRef` wrapper
   * FIRST — mirrors the xCardBannerRef Dismiss-button pattern above exactly
   * (refocus-before-unmount, not after).
   */
  const onRetryFailedTurn = useCallback(() => {
    if (durableRetryRowRef.current?.contains(document.activeElement)) {
      durableRetryRowRef.current.focus({ preventScroll: true });
    }
    const last = lastDurableTurnRef.current;
    setJobFailed(false);
    if (last) void narrateDurable(last.message, last.mode);
  }, [narrateDurable]);

  // ── S5.2: DM narration submit handler ───────────────────────────────────────
  /**
   * Called when the human DM sends a dm_narration beat via the composer.
   * Posts to POST /api/dnd/sessions/{id}/events (the existing proxy passthrough).
   * Makes ZERO calls to /api/narration/* — the DM authors the text directly.
   * Text is preserved in `msg` on error (cleared only on success).
   */
  const onSendDmNarration = useCallback(async () => {
    const text = msg.trim();
    if (!text || !sessionId || !session || !username || dmNarrationPending) return;
    setDmNarrationPending(true);
    setDmNarrationError(null);
    // DDX-20 §3.3 (flag-ON only) — stamp a client-minted client_key into the
    // POSTed event's data so ledger rule 4 can dedup this DM's own optimistic
    // row against the durable poll row once it round-trips back (the proxy
    // passthrough forwards `data` untouched; the engine persists it verbatim).
    // Flag-OFF: `clientKey` is always undefined below, so `data` is always
    // exactly `{text}` — byte-identical to the pre-DDX-20 request body.
    const clientKey = DURABLE_GENERATION_ENABLED ? mintTurnKey() : undefined;
    try {
      await postSessionEvent(sessionId, {
        kind: 'dm_narration',
        actor_username: session.dm_username ?? username,
        data: clientKey ? { text, client_key: clientKey } : { text },
        visibility: 'table',
      });
      const actor = session.dm_username ?? username;
      if (clientKey) {
        // Flag-ON: append with pendingKey so the poll's reconciliation ledger
        // (rule 4) stamps this row instead of double-rendering it once the
        // durable dm_narration event lands.
        const rowId = `r${(idRef.current += 1)}`;
        setLog((prev) => [
          ...prev,
          {
            id: rowId,
            who: `DM (${actor})`,
            kind: 'dm_narration' as const,
            text,
            ts: nowStamp(),
            pendingKey: clientKey,
          },
        ]);
        pendingByKeyRef.current.set(clientKey, { playerRowId: rowId });
      } else {
        // Flag-OFF (unchanged) — optimistically append with the distinct
        // dm_narration kind; the poll never renders dm_narration rows on
        // this path (unified-poll rendering is flag-gated), so there is no
        // reconciliation to set up.
        appendLog({
          who: `DM (${actor})`,
          kind: 'dm_narration',
          text,
        });
      }
      setMsg(''); // clear only on success
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      if (status === 401 || status === 403) {
        // Cookie expired — redirect to login per existing pattern.
        window.location.href = '/login';
        return;
      }
      // 5xx / network: preserve text in textarea, show inline error.
      setDmNarrationError('Could not send narration. Try again.');
    } finally {
      setDmNarrationPending(false);
    }
  }, [msg, sessionId, session, username, dmNarrationPending, appendLog]);

  // ── A1: opening scene ───────────────────────────────────────────────────────

  /**
   * Gate: should the opening beat fire this mount?
   * Returns true only when:
   *   - grounding has a scene_id + boxed_text (there's a scene to open)
   *   - getSessionEvents returns no `opening_narrated` event
   *   - AND no non-structural fiction events exist (belt-and-braces)
   * Returns false on any error (fail safe: don't speculate, render silence).
   */
  const checkShouldOpen = useCallback(
    async (sid: string, g: GroundingData, signal: AbortSignal): Promise<boolean> => {
      // No authored scene — nothing to open.
      if (!g.scene_id || !g.boxed_text) return false;
      // Per-lifetime ref guard catches StrictMode double-invoke within one mount.
      if (openingFiredRef.current) return false;

      // FIX-4: getSessionEvents now returns null on error (engine unreachable).
      // Treat null as fail-safe: don't open when we can't confirm the session state.
      const events = await getSessionEvents(sid, signal);
      if (events === null) return false; // engine unreachable → fail safe, don't open
      if (signal.aborted) return false;

      // Durable marker exists: opening already ran.
      if (events.some((e) => e.event_type === 'opening_narrated')) return false;

      // Belt-and-braces: any non-structural event means play already started.
      const hasFiction = events.some(
        (e) => e.event_type && !STRUCTURAL_EVENT_KINDS.has(e.event_type),
      );
      if (hasFiction) return false;

      return true;
    },
    [],
  );

  /**
   * A1 / P1-READALOUD — Open the scene on first load. Fire-and-forget; non-blocking.
   *
   * Unified verbatim path (Option A from §3 of the design doc): renders the
   * authored boxed_text block instantly for ALL session types (AI, AI-off,
   * human-DM). No LLM call on open. Suzu's narration fires on the player's
   * first action instead (normal beat via onSend/onRoll).
   *
   * Idempotency: guarded by openingFiredRef (in-memory, per-mount) AND the
   * durable `opening_narrated` session event (survives remounts). The
   * semantics of opening_narrated shift from "AI opening streamed" to
   * "read-aloud shown", but the gate mechanic is unchanged.
   */
  const openScene = useCallback(
    async (s: Session, g: GroundingData, sid: string, signal: AbortSignal) => {
      const shouldOpen = await checkShouldOpen(sid, g, signal);
      if (!shouldOpen || signal.aborted) return;

      // Latch: prevent a second fire from StrictMode double-invoke or any
      // concurrent call within the same component lifetime.
      openingFiredRef.current = true;

      // Step 1 — render the verbatim read-aloud block (authored, byte-identical,
      // same for every session type). No typewriter; player reads at their pace.
      appendLog({
        who: 'Scene',
        kind: 'read_aloud',
        text: buildReadAloudBlock(g),
      });

      // Step 2 — render optional authored NPC opening lines, verbatim, in order.
      for (const line of g.opening_lines ?? []) {
        if (signal.aborted) return;
        appendLog({
          who: line.speaker_display_name,
          kind: 'read_aloud_line',
          text: line.line,
        });
      }

      // Step 3 — write durable marker (best-effort, non-fatal on failure).
      // Semantics: "read-aloud has been shown for this scene opening". The
      // event kind is unchanged so the engine allowlist stays frozen.
      if (!signal.aborted) {
        void postSessionEvent(sid, {
          kind: 'opening_narrated',
          data: { scene_id: g.scene_id, source: 'read_aloud_verbatim' },
        }).catch(() => {/* non-fatal */});
      }

      // Step 4 — NO AI opening call. The next narrate() fires when the player
      // sends their first action via onSend / onRoll (existing paths, unchanged).
      // That call is a normal beat with is_opening=False; Suzu reacts to the
      // player rather than re-describing the room.
    },
    [checkShouldOpen, appendLog],
  );

  // ── dice ────────────────────────────────────────────────────────────────────
  // DDX-08 / T3: rolls are server-authoritative (POST /roll persists a
  // `dice_roll` session event, DDX-07/DDX-08). This handler only forwards the
  // trigger — it does NOT append a row to the log or compute an outcome. The
  // result is rendered by the dice-roll events poll above, exactly like on
  // every other client watching this session, so the roller sees their own
  // roll the same way everyone else does and a roll from client A always
  // shows up on client B without a reload.
  const onRoll = useCallback(
    async (trigger: RollTrigger) => {
      // rollBusyRef: synchronous double-submit latch (mirrors checkBusyRef /
      // sceneAdvanceBusyRef) — a roll is a real server write, so a same-tick
      // double-click must not fire it twice.
      if (!session || !username || rollBusyRef.current || isSessionLocked(session)) return;
      rollBusyRef.current = true;
      setRollBusy(true);
      try {
        const advantageWire: 'straight' | 'advantage' | 'disadvantage' =
          advantage === 'adv' ? 'advantage' : advantage === 'dis' ? 'disadvantage' : 'straight';

        if (trigger.kind === 'check') {
          const result = await postRoll(session.session_id, {
            username,
            kind: 'skill',
            skill: trigger.skill,
            advantage: advantageWire,
          });
          // S5.5: skip auto-narration when AI is off or assist-only.
          const sessionAiLevel = session.ai_assist_level;
          // DDX-25 R2 (D2): a paused/ended session must not auto-fire
          // narration either — the DiceTray `disabled` prop already blocks
          // the click that reaches here (see its own sessionLocked gate
          // further down), but this is checked again here too, mirroring the
          // double-gate convention this file already uses for `talking` in
          // onMoveOn/onAttemptCheck.
          if (
            !talking &&
            !combatBusy &&
            !isSessionLocked(session) &&
            sessionAiLevel !== 'off' &&
            sessionAiLevel !== 'assist'
          ) {
            if (DURABLE_GENERATION_ENABLED) {
              void narrateDurableBeat(
                `I roll ${trigger.label}.`,
                `${result.description} Narrate the outcome.`,
                'act',
                { beat: 'roll' },
              );
            } else {
              void narrate(
                `I roll ${trigger.label}.`,
                `${result.description} Narrate the outcome.`,
                'act',
              ); // byte-unchanged legacy path
            }
          }
        } else if (trigger.sides === 20) {
          // Plain d20 button: a bare (unmodified) d20 — kind='raw' with no
          // notation still honours the advantage/disadvantage pill
          // server-side, it just has no character/modifier attached.
          await postRoll(session.session_id, {
            username,
            kind: 'raw',
            advantage: advantageWire,
          });
        } else {
          // Any other plain die (d4/d6/d8/d10/d12): notation always wins
          // over `kind` server-side and rolls straight — advantage only
          // applies to the d20 case above (mirrors the pre-DDX-08 behaviour).
          await postRoll(session.session_id, {
            username,
            notation: `1d${trigger.sides}`,
          });
        }
      } catch {
        toast({ tone: 'error', message: 'Could not roll — try again.' });
      } finally {
        rollBusyRef.current = false;
        setRollBusy(false);
      }
    },
    [session, username, advantage, talking, combatBusy, narrate, narrateDurableBeat, toast],
  );

  // ── safety: X-card (DDX-26) ──────────────────────────────────────────────
  // Durable, cross-client safety signal. Deliberately NOT gated on
  // sessionLocked/talking — a safety tool must stay reachable regardless of
  // table state. xCardBusyRef: synchronous double-submit latch (mirrors
  // rollBusyRef) — this is a real server write (persists an `x_card` event),
  // so a same-tick double-click must not fire it twice.
  const onRaiseXCard = useCallback(async () => {
    if (!session || xCardBusyRef.current) return;
    xCardBusyRef.current = true;
    setXCardBusy(true);
    try {
      const result = await postXCard(session.session_id);
      // Optimistic local banner — the events poll above will also observe
      // this same event (durable truth) and converge every other open tab,
      // exactly like a dice roll converges via the same poll.
      // Kage IMPORTANT-1: the engine (and the BFF passthrough) nests the
      // event under `.event` — read seq/actor from there, never off the
      // top-level result, or this optimistic banner silently never fires.
      const seq = result?.event?.seq;
      if (seq != null) {
        const xCard = { seq, actor: result?.event?.actor ?? username ?? undefined };
        setXCardEvent((prev) => (!prev || xCard.seq > prev.seq ? xCard : prev));
      }
      toast({ tone: 'info', message: 'X-card noted. The table eases off.' });
    } catch {
      toast({ tone: 'error', message: 'Could not raise the X-card — try again.' });
    } finally {
      xCardBusyRef.current = false;
      setXCardBusy(false);
    }
  }, [session, username, toast]);

  // ── scene advance (ADV-7T / CUI-12) ─────────────────────────────────────────

  /**
   * Handle an ADV-8 auto-advance (scene_advance != null on a combat response).
   * Surfaced as a system log beat + grounding refresh + DM narration.
   */
  const handleSceneAdvance = useCallback(
    async (fromScene: string, toScene: string, outcome?: string) => {
      const label = outcome ? ` (${outcome})` : '';
      appendLog({
        who: 'Suzu',
        kind: 'system',
        text: `The scene shifts: ${fromScene} → ${toScene}${label}`,
      });
      await refreshGrounding();
      // Kage #1 / Miko DEFECT-2: this beat only narrates a transition the
      // caller's own scene_advance already performed server-side — suppress
      // the server's INTENT classifier from advancing the scene AGAIN.
      if (DURABLE_GENERATION_ENABLED) {
        void narrateDurableBeat(
          'The scene changes.',
          `Scene advance: ${fromScene} → ${toScene}. Narrate the transition.`,
          'act',
          { suppressIntent: true, beat: 'scene_advance' },
        );
      } else {
        void narrate(
          'The scene changes.',
          `Scene advance: ${fromScene} → ${toScene}. Narrate the transition.`,
          'act',
          { suppressIntent: true },
        ); // byte-unchanged legacy path
      }
    },
    [appendLog, refreshGrounding, narrate, narrateDurableBeat],
  );

  /** Manual "Move on" button handler (ADV-7T). */
  // sceneAdvanceBusyRef: separate ref latch for Move on (uses its own state,
  // not combatBusyRef, since scene advance can coexist with combat logic).
  const sceneAdvanceBusyRef = useRef(false);

  const onMoveOn = useCallback(
    async (toScene: string) => {
      if (!session || !username || sceneAdvanceBusyRef.current) return;
      // FIX-2: guard against clicking Move on while an opening stream is in flight.
      // Without this, a race between the opening narration and a scene transition
      // leaves the opening_narrated marker unwritten → re-fires on the next mount.
      if (talking) return;
      // DDX-25 R2 (D2): a paused/ended session must not advance the scene —
      // mirrors the `sessionLocked` gate now applied to this button's
      // `disabled` prop further down; kept here too as defense-in-depth
      // (same double-gate convention as the `talking` check just above).
      if (isSessionLocked(session)) return;
      // Iro Ship 2 CRITICAL-1: capture BEFORE the await — refreshGrounding()
      // below may recompute availableTransitions and unmount the clicked
      // button, so this is the last reliable moment to know it had focus.
      const hadFocusInTransitionWrap =
        transitionWrapRef.current?.contains(document.activeElement) ?? false;
      try {
        // FIX-3: latch INSIDE the try so the finally always resets them.
        sceneAdvanceBusyRef.current = true;
        setSceneAdvanceBusy(true);
        const result = await advanceScene(session.session_id, { to_scene: toScene });
        appendLog({
          who: 'Suzu',
          kind: 'system',
          text: `The scene shifts: ${result.from_scene} → ${result.to_scene}`,
        });
        await refreshGrounding();
        refocusSceneHeadIfStranded(hadFocusInTransitionWrap);
        // Kage #1 / Miko DEFECT-2: advanceScene() above already moved the
        // scene server-side — suppress the INTENT classifier from advancing
        // it a second time off this confirmation beat.
        if (DURABLE_GENERATION_ENABLED) {
          void narrateDurableBeat(
            'We move on.',
            `Scene advance: ${result.from_scene} → ${result.to_scene}. Narrate the transition.`,
            'act',
            { suppressIntent: true, beat: 'scene_advance' },
          );
        } else {
          void narrate(
            'We move on.',
            `Scene advance: ${result.from_scene} → ${result.to_scene}. Narrate the transition.`,
            'act',
            { suppressIntent: true },
          ); // byte-unchanged legacy path
        }
      } catch (err) {
        const status = (err as { status?: number } | null)?.status;
        if (status === 400) {
          // freeform_session or unknown_scene — quiet info, not a crash.
          toast({ tone: 'info', message: 'No authored adventure to advance through.' });
        } else if (status === 503) {
          toast({ tone: 'info', message: 'Scene advancement is not available right now.' });
        } else {
          toast({ tone: 'error', message: 'Could not advance the scene.' });
        }
      } finally {
        sceneAdvanceBusyRef.current = false;
        setSceneAdvanceBusy(false);
      }
    },
    [
      session,
      username,
      talking,
      appendLog,
      refreshGrounding,
      refocusSceneHeadIfStranded,
      narrate,
      narrateDurableBeat,
      toast,
    ],
  );

  /**
   * P1-PLAYFIX §3.3.3 (S2.4) — check affordance handler ("Attempt: Survival (DC 12)").
   * Resolves the authored check via the engine (DC + skill match are engine-side —
   * the client only names the skill), narrates the real result, then MUST
   * refreshGrounding() so the client learns any flag/auto-advance from the
   * refreshed scene state rather than inferring it from the check response.
   */
  const checkBusyRef = useRef(false);

  const onAttemptCheck = useCallback(
    async (skill: string) => {
      // DDX-25 R2 (D2): isSessionLocked(session) added alongside the existing
      // talking gate — a paused/ended session must not resolve a check either
      // (mirrors the `sessionLocked` gate now on this button's disabled prop).
      if (!session || !username || checkBusyRef.current || talking || isSessionLocked(session)) return;
      const skillLabel = titleCaseSkill(skill);
      // Iro Ship 2 CRITICAL-1: capture BEFORE the await — refreshGrounding()
      // below may recompute availableChecks and unmount the clicked button,
      // so this is the last reliable moment to know it had focus.
      const hadFocusInCheckWrap = checkWrapRef.current?.contains(document.activeElement) ?? false;
      try {
        checkBusyRef.current = true;
        setCheckBusy(true);
        const result = await resolveCheck(session.session_id, {
          skill,
          actor_username: username,
          advantage: advantage === 'adv' ? true : undefined,
          disadvantage: advantage === 'dis' ? true : undefined,
        });
        appendLog({ who: username, kind: 'system', text: result.description });
        // refreshGrounding() BEFORE narrate() so the scene card / check row are
        // already current when Suzu's beat lands (the engine may have set a
        // flag and/or auto-advanced the scene — never assumed from `result`).
        await refreshGrounding();
        refocusSceneHeadIfStranded(hadFocusInCheckWrap);
        // Kage #1 / Miko DEFECT-2: resolveCheck() above already resolved the
        // check (and any resulting flag/auto-advance) server-side — suppress
        // the INTENT classifier from acting on this confirmation beat too.
        if (DURABLE_GENERATION_ENABLED) {
          void narrateDurableBeat(`I attempt a ${skillLabel} check.`, result.mechanics, 'act', {
            suppressIntent: true,
            beat: 'check_confirm',
          });
        } else {
          void narrate(`I attempt a ${skillLabel} check.`, result.mechanics, 'act', {
            suppressIntent: true,
          }); // byte-unchanged legacy path
        }
      } catch (err) {
        const status = (err as { status?: number } | null)?.status;
        const body = (err as { body?: unknown } | null)?.body;
        const reason = (body as { data?: { reason?: string } } | null)?.data?.reason;
        if (status === 400 && reason === 'no_such_check') {
          toast({ tone: 'info', message: `No ${skillLabel} check is available right now.` });
        } else if (status === 400) {
          toast({ tone: 'info', message: 'No authored adventure to check against.' });
        } else if (status === 503) {
          toast({ tone: 'info', message: 'Skill checks are not available right now.' });
        } else {
          toast({ tone: 'error', message: 'Could not resolve that check.' });
        }
      } finally {
        checkBusyRef.current = false;
        setCheckBusy(false);
      }
    },
    [
      session,
      username,
      talking,
      advantage,
      appendLog,
      refreshGrounding,
      refocusSceneHeadIfStranded,
      narrate,
      narrateDurableBeat,
      toast,
    ],
  );

  // ── combat ──────────────────────────────────────────────────────────────────
  /**
   * ADV-6: Begin an encounter from the current scene's authored encounter block.
   * Now also initialises combatState from the response's data.state (CUI-11).
   */
  const beginEncounter = useCallback(async () => {
    if (!session || !username || combatBusyRef.current) return;
    combatBusyRef.current = true;
    // Tora MINOR-2: increment seq at mutation START so any in-flight poll is discarded.
    stateSeqRef.current += 1;
    setCombatBusy(true);
    setRefusedReason(null);
    try {
      const result = await combatFromScene({ session_id: session.session_id });
      const newId = result.combat_id;
      setCombatId(newId);
      // Initialise combatState from the engine response if it carries structured state;
      // else fetch it immediately. (Proxy passes through data.state once engine is updated.)
      if ('state' in result && result.state) {
        stateSeqRef.current += 1;
        setCombatState(result.state as CombatState);
      } else {
        // Fallback: explicit fetch for the structured state.
        const cs = await getCombatState(newId).catch(() => null);
        if (cs) {
          stateSeqRef.current += 1;
          setCombatState(cs);
        }
      }
      const initRes = await rollInitiative({ username, combat_id: newId }).catch(() => null);
      // Use the state from the initiative response if the engine emits it;
      // avoids a separate getCombatState round-trip (M2).
      const csAfterInit = initRes?.state ?? (await getCombatState(newId).catch(() => null));
      if (csAfterInit) {
        stateSeqRef.current += 1;
        setCombatState(csAfterInit);
      }
      const monsterNames = result.monsters.map((m) => m.name).join(', ') || 'enemies';
      appendLog({
        who: 'Suzu',
        kind: 'system',
        text: `Combat begins — ${monsterNames} close in. Roll initiative.`,
      });
      if (DURABLE_GENERATION_ENABLED) {
        void narrateDurableBeat(
          'We are under attack!',
          `Combat starts. ${monsterNames} enter the scene. Set the scene.`,
          'act',
          { beat: 'combat_start' },
        );
      } else {
        void narrate(
          'We are under attack!',
          `Combat starts. ${monsterNames} enter the scene. Set the scene.`,
          'act',
        ); // byte-unchanged legacy path
      }
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      if (status === 400) {
        toast({ tone: 'info', message: "There's no scripted encounter here." });
      } else {
        toast({ tone: 'error', message: 'Could not start combat.' });
      }
    } finally {
      combatBusyRef.current = false;
      setCombatBusy(false);
    }
  }, [session, username, toast, appendLog, narrate, narrateDurableBeat]);

  const onCombatAction = useCallback(
    async (action: CombatAction, payload?: string) => {
      if (!session || !username || !combatId || combatBusyRef.current) return;
      combatBusyRef.current = true;
      // Tora MINOR-2: increment seq at mutation START so any in-flight poll is discarded.
      stateSeqRef.current += 1;
      setCombatBusy(true);
      setRefusedReason(null);

      try {
        let message = '';
        let playerLine = '';
        let newState: CombatState | null | undefined;
        let sceneAdvance: { fromScene: string; toScene: string; outcome?: string } | null = null;

        if (action === 'attack' && payload) {
          // payload is the participant_id (from the target menu item's id).
          // We send target_id as the preferred path; target (name) as fallback.
          const target = combatState?.participants.find((p) => p.participant_id === payload);
          const targetName = target?.name ?? payload;
          let res;
          try {
            res = await combatAttack({
              username,
              combat_id: combatId,
              target: targetName,
              target_id: payload,
            });
          } catch (err) {
            // Surface refused-action reason from the error body.
            const body = (err as { body?: unknown } | null)?.body;
            const data = (body as { data?: { reason?: string; state?: CombatState } } | null)?.data;
            const reason = humanRefusalReason(data?.reason);
            setRefusedReason(reason);
            if (data?.state) {
              stateSeqRef.current += 1;
              setCombatState(data.state);
            }
            return;
          }
          newState = res.state ?? null;
          if (res.scene_advance) {
            sceneAdvance = {
              fromScene: res.scene_advance.from_scene,
              toScene: res.scene_advance.to_scene,
              outcome: res.scene_advance.outcome,
            };
          }
          // Surface what happened from last_action.
          const la = newState?.last_action;
          const outcomeText = la
            ? ` (${la.outcome}${la.damage_dealt ? `, ${la.damage_dealt} dmg` : ''})`
            : '';
          message = res.message ?? `You attack ${targetName}.${outcomeText}`;
          playerLine = `I attack ${targetName}.`;
        } else if (action === 'dodge') {
          const res = await combatDodge({ username, combat_id: combatId });
          newState = res.state ?? null;
          message = res.message ?? 'You take the Dodge action.';
          playerLine = 'I dodge.';
        } else if (action === 'dash') {
          const res = await combatDash({ username, combat_id: combatId });
          newState = res.state ?? null;
          message = res.message ?? 'You take the Dash action.';
          playerLine = 'I dash.';
        } else if (action === 'endturn') {
          const res = await combatEndTurn({ username, combat_id: combatId });
          newState = res.state ?? null;
          if (res.scene_advance) {
            sceneAdvance = {
              fromScene: res.scene_advance.from_scene,
              toScene: res.scene_advance.to_scene,
              outcome: res.scene_advance.outcome,
            };
          }
          message = res.message ?? 'You end your turn.';
          playerLine = 'I end my turn.';
        }

        if (newState) {
          stateSeqRef.current += 1;
          setCombatState(newState);
        }

        appendLog({ who: username, kind: 'system', text: message });
        // DDX-20 Pass 3 §3.3 — flag-OFF this `await` serializes end-turn
        // narration ahead of the scene-advance call just below (preserved
        // verbatim). Flag-ON, `narrateDurableBeat` returns after the job is
        // CREATED, not after narration completes, so it is fired-and-forgot
        // (`void`, no `await`) here — the accepted trade-off documented in
        // Pass-3 §3.3: beat 2 (scene-advance) may 409 subscribe-and-drop
        // against this beat's still-streaming narration; the scene still
        // advances (its durable `scene_advance` event is independent). Do
        // NOT try to serialize these — that re-couples the beats for a
        // cosmetic gain the single-slot model already bounds.
        if (DURABLE_GENERATION_ENABLED) {
          void narrateDurableBeat(playerLine, message, 'act', { beat: 'end_turn' });
        } else {
          await narrate(playerLine, message, 'act'); // byte-unchanged legacy path
        }

        // Monsters' turns (after the player ends theirs) are driven uniformly by
        // the auto monster-turn effect below — it picks up whenever combatState
        // shows a non-PC active turn, including at combat start when monsters win
        // initiative.

        // ADV-8 auto-advance: scene_advance != null means combat resolved + scene moved.
        if (sceneAdvance) {
          await handleSceneAdvance(sceneAdvance.fromScene, sceneAdvance.toScene, sceneAdvance.outcome);
        }

        // If combat ended, refresh grounding for the "Move on" affordance.
        if (newState?.state === 'ended') {
          void refreshGrounding();
        }
      } catch (err) {
        const body = (err as { body?: unknown } | null)?.body;
        const data = (body as { data?: { reason?: string; state?: CombatState } } | null)?.data;
        const reason = humanRefusalReason(data?.reason);
        if (reason) {
          setRefusedReason(reason);
        } else {
          toast({ tone: 'error', message: 'That combat action did not land. Try again.' });
        }
        if (data?.state) {
          stateSeqRef.current += 1;
          setCombatState(data.state);
        }
      } finally {
        combatBusyRef.current = false;
        setCombatBusy(false);
      }
    },
    [
      session,
      username,
      combatId,
      combatState,
      appendLog,
      narrate,
      narrateDurableBeat,
      toast,
      handleSceneAdvance,
      refreshGrounding,
    ],
  );

  /**
   * B3-1: Explicit "End combat" — posts /combat/{id}/end with a DM-chosen outcome.
   * Previously hardcoded 'unresolved'; now driven by the outcome chooser.
   */
  const onEndCombat = useCallback(async (outcome: EndCombatOutcome = 'unresolved') => {
    if (!combatId || !username || combatBusyRef.current) return;
    combatBusyRef.current = true;
    // Tora MINOR-2: increment seq at mutation START so any in-flight poll is discarded.
    stateSeqRef.current += 1;
    setCombatBusy(true);
    // Tora MINOR-1: do NOT close the chooser here — only close on success so the
    // user can retry on engine error without re-opening the panel.
    try {
      const result = await endCombat(combatId, { username, outcome });
      if (result.state) {
        stateSeqRef.current += 1;
        setCombatState(result.state);
      }
      const outcomeLabel = result.outcome
        ? result.outcome.charAt(0).toUpperCase() + result.outcome.slice(1)
        : 'Unresolved';
      appendLog({
        who: 'Suzu',
        kind: 'system',
        text: `Combat ended. ${outcomeLabel}.`,
      });
      // Tora MINOR-1: close on SUCCESS only.
      setOutcomeChooserOpen(false);
      if (result.scene_advance) {
        await handleSceneAdvance(
          result.scene_advance.from_scene,
          result.scene_advance.to_scene,
          result.scene_advance.outcome,
        );
      } else {
        void refreshGrounding();
      }
    } catch (err) {
      const body = (err as { body?: unknown } | null)?.body;
      const data = (body as { data?: { reason?: string } } | null)?.data;
      const reason = data?.reason;
      if (reason === 'victory_refused') {
        toast({ tone: 'error', message: "Can't claim victory — no enemies are down yet." });
      } else {
        toast({ tone: 'error', message: 'Could not end combat.' });
      }
      // Tora MINOR-1: chooser stays open on error so the user can retry.
    } finally {
      combatBusyRef.current = false;
      setCombatBusy(false);
    }
  }, [combatId, username, appendLog, handleSceneAdvance, refreshGrounding, toast]);

  /**
   * DDX-25: refetch the session after any lifecycle mutation (pause/resume/
   * end/xp). The engine's pause/resume/end/xp routes resolve to only
   * `{message: string}` (see the dnd.ts wrapper comment), never the updated
   * Session, so a plain GET is the only way to observe the new status/
   * xp_pool — mirrors the rebind flow's `getParticipants` re-fetch above.
   *
   * D8 (DDX-25 R2): this swallows its own failure (`.catch(() => null)`) by
   * design — every caller's mutation already succeeded server-side by the
   * time this runs, so a failed refetch must not surface as an error toast
   * for an action that, in fact, worked. The tradeoff: on a refetch failure,
   * the acting tab briefly shows a success toast without the paused
   * banner/composer-disable reflecting it yet. Left as-is rather than
   * retried inline — the D1 session-status poll (added alongside this fix)
   * corrects it within one cycle (~4-5s) without extra retry logic here.
   */
  const refreshSessionAfterAction = useCallback(async () => {
    const s = await getSession(sessionId).catch(() => null);
    if (s) setSession(s);
  }, [sessionId]);

  /**
   * DDX-25: Pause ⇄ Resume toggle. DM-only — enforced at the render site via
   * the same `isDm` gate every other DM-only control in this file already
   * uses (B2-4).
   */
  const onTogglePause = useCallback(async () => {
    // DDX-25 R2 (D5): sessionActionBusyRef closes the synchronous double-tap
    // window that `sessionActionBusy` (React state) can't — mirrors
    // combatBusyRef/checkBusyRef/sceneAdvanceBusyRef elsewhere in this file.
    if (!session || !username || sessionActionBusy || sessionActionBusyRef.current) return;
    sessionActionBusyRef.current = true;
    const pausing = session.status !== 'paused';
    setSessionActionBusy(pausing ? 'pause' : 'resume');
    try {
      if (pausing) {
        await pauseSession(sessionId, { username, channel: session.channel });
      } else {
        await resumeSession(sessionId, { username, channel: session.channel });
      }
      await refreshSessionAfterAction();
      toast({ tone: 'success', message: pausing ? 'Session paused.' : 'Session resumed.' });
    } catch {
      // D7: the engine may be refusing because the true state already moved
      // (e.g. a 404 "already paused/not active") — refetch so a stale label
      // ("Pause" shown when the session is in fact already paused) self-
      // corrects instead of lingering until a manual reload or the next D1
      // poll tick.
      await refreshSessionAfterAction();
      toast({
        tone: 'error',
        message: pausing
          ? 'Could not pause the session. Try again in a moment.'
          : 'Could not resume the session. Try again in a moment.',
      });
    } finally {
      setSessionActionBusy(null);
      sessionActionBusyRef.current = false;
    }
  }, [session, username, sessionId, sessionActionBusy, refreshSessionAfterAction, toast]);

  /** DDX-25: End session — semi-destructive, confirmed via ConfirmDialog. */
  const onConfirmEndSession = useCallback(async () => {
    // DDX-25 R2 (D5): see onTogglePause's comment above — same synchronous
    // ref-guard, now also closing the gap this handler previously had no
    // busy-guard of ANY kind (not even the React-state one).
    if (!session || !username || sessionActionBusyRef.current) return;
    sessionActionBusyRef.current = true;
    setSessionActionBusy('end');
    try {
      await endSession(sessionId, { username, channel: session.channel });
      await refreshSessionAfterAction();
      toast({ tone: 'success', message: 'Session ended.' });
    } catch {
      toast({ tone: 'error', message: 'Could not end the session. Try again in a moment.' });
    } finally {
      setSessionActionBusy(null);
      setEndSessionConfirmOpen(false);
      sessionActionBusyRef.current = false;
    }
  }, [session, username, sessionId, refreshSessionAfterAction, toast]);

  /**
   * DDX-25: Award XP — a session-level party pool (`session.xp_pool`), NOT
   * per-character. The engine's cmd_xp adds `amount` straight to the pool
   * (engine/commands/session_commands.py); the pool is only split across
   * participants when the session later ends (cmd_endsession's
   * xp_per_player). `reason` is optional free text logged with the award.
   * Amount is floored at 1 (not 0) client-side — the engine's own cmd_xp
   * rejects <= 0 with a plain-text refusal that doesn't cleanly surface as
   * an HTTP error, so this avoids that ambiguous edge entirely.
   */
  const onAwardXp = useCallback(async () => {
    // DDX-25 R2 (D5): ref-guard first (see onTogglePause's comment) — this is
    // the highest-priority instance of the gap: the engine's xp_pool write is
    // unconditionally additive (`xp_pool += amount`, no idempotency guard), so
    // a double-fire here GUARANTEES a double award, unlike pause/resume's
    // conditional-UPDATE self-heal.
    if (!session || !username || sessionActionBusyRef.current) return;
    const amount = Math.trunc(Number(xpAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ tone: 'error', message: 'Enter a whole number greater than zero.' });
      return;
    }
    sessionActionBusyRef.current = true;
    setSessionActionBusy('xp');
    try {
      await awardSessionXp(sessionId, {
        username,
        channel: session.channel,
        amount,
        reason: xpReason.trim() || undefined,
      });
      await refreshSessionAfterAction();
      toast({ tone: 'success', message: `Awarded ${amount} XP to the party pool.` });
      setXpFormOpen(false);
      setXpAmount('');
      setXpReason('');
    } catch {
      toast({ tone: 'error', message: 'Could not award XP. Try again in a moment.' });
    } finally {
      setSessionActionBusy(null);
      sessionActionBusyRef.current = false;
    }
  }, [session, username, sessionId, xpAmount, xpReason, refreshSessionAfterAction, toast]);

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
  // Miko-QA adversarial gate (post-ship regression, fixed here): this
  // listener originally assumed it composed safely with the other
  // Escape-handling overlays (journal, combat outcome chooser,
  // end-session ConfirmDialog) because "those call e.stopPropagation()".
  // That's only true while those overlays are IDLE — the outcome chooser
  // (Tora MINOR-1, `!combatBusy` guard) and ConfirmDialog (`!busy` guard)
  // both deliberately do NOT stopPropagation() while a request from them is
  // in flight, so the user can watch/retry it. With no mutual-exclusion,
  // that "swallowed" Escape fell through to this listener and silently
  // closed the unrelated Award-XP popover. Fix: no-op here whenever another
  // Escape-handling overlay is on screen — if that overlay is idle it will
  // already have stopPropagation()'d before we'd ever run; if it's busy, its
  // Escape is intentionally inert and must not fall through to us either.
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
  }, [xpFormOpen, outcomeChooserOpen, endSessionConfirmOpen, journalOpen, sessionActionBusy]);

  // Auto-drive monster turns. Whenever combat is active and the current turn
  // belongs to a living NPC, run that monster's turn — looping through all
  // consecutive NPC turns until it's a PC's turn or combat ends. Without this,
  // a combat where monsters win initiative is stuck at the start (the player is
  // never reached) and monster turns between rounds never advance.
  //
  // S5.3: skip the auto-driver entirely when dm_mode === 'human' — the DM
  // drives monster turns manually via the DmNarrationPanel (npc-action route).
  useEffect(() => {
    if (!combatState || combatState.state !== 'active' || !combatId || !username) return;
    // Human DM: monster turns are driven by the DmNarrationPanel, not auto.
    // S5.5: ai_assist_level='off' or 'assist' also suppresses auto monster drive.
    // For 'off': no AI; for 'assist': no auto-fire (manual DM invocation only).
    const autoAiLevel = session?.ai_assist_level;
    // DDX-25: a paused/ended session freezes the whole table — the DM-side
    // monster auto-driver must halt too, not just player actions, or monsters
    // keep acting until the next PC turn while the banner reads "paused".
    if (session?.dm_mode === 'human' || autoAiLevel === 'off' || autoAiLevel === 'assist' || isSessionLocked(session)) return;
    // Only monsterDrivingRef guards here — NOT combatBusyRef. A player's end-turn
    // completes with combatBusyRef still set while it hands off to a monster's
    // turn; gating on it would stall the hand-off. The active.is_pc check below
    // already prevents this from firing during the player's own turn.
    if (monsterDrivingRef.current) return;
    const active = combatState.participants.find(
      (p) => p.participant_id === combatState.active_participant_id,
    );
    if (!active || active.is_pc || !active.is_alive) return;

    monsterDrivingRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        // Hard cap defends against an engine that fails to advance the turn.
        for (let i = 0; i < 20 && !cancelled; i += 1) {
          const mres = await Promise.resolve(
            monsterTurn({ username, combat_id: combatId }),
          ).catch(() => null);
          if (!mres) break;
          const mla = mres.state?.last_action;
          const mLog =
            mres.message ??
            (mla
              ? `${mla.actor_id}: ${mla.outcome}${mla.damage_dealt ? `, ${mla.damage_dealt} dmg` : ''}`
              : null);
          if (mLog) appendLog({ who: 'Suzu', kind: 'system', text: mLog });
          if (mres.state) {
            stateSeqRef.current += 1;
            setCombatState(mres.state);
          }
          if (mres.scene_advance) {
            await handleSceneAdvance(
              mres.scene_advance.from_scene,
              mres.scene_advance.to_scene,
              mres.scene_advance.outcome,
            );
            break;
          }
          const st = mres.state;
          if (!st || st.state !== 'active') break;
          const next = st.participants.find((p) => p.participant_id === st.active_participant_id);
          if (!next || next.is_pc || !next.is_alive) break; // reached the player / nobody to drive
        }
      } finally {
        monsterDrivingRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [combatState, combatId, username, session, appendLog, handleSceneAdvance]);

  // Tora MAJOR-2: refocus the newly-enabled rail's container when a combat
  // action flips the active turn and disabling the just-clicked button
  // stranded focus on <body>. Reacts to combatState.active_participant_id
  // changing rather than hooking into onCombatAction/MonsterRow.fireAction
  // directly — both mutation paths already funnel into setCombatState (via
  // onStateUpdate / the response's own newState), so one generic effect here
  // covers a player Attack/Dodge/Dash/End-turn AND a DM per-monster
  // Attack/Skip/Move without touching either handler's control flow (kept
  // intentionally narrow per the review guardrail on this item). Mirrors
  // refocusSceneHeadIfStranded's rAF-after-commit stranding check, falling
  // back to sceneHeadRef when neither rail applies to this viewer.
  useEffect(() => {
    const active = combatId && combatState?.state !== 'ended' ? combatState : null;
    const current = active?.active_participant_id ?? null;
    const prev = prevActiveParticipantIdRef.current;
    prevActiveParticipantIdRef.current = current;

    // Consume the provenance flag on every pass (even early-return ones) so a
    // local click that didn't end up changing the active participant can't
    // leak forward and get misattributed to a later, unrelated turn change.
    const causedByLocalClick = localTurnActionRef.current;
    localTurnActionRef.current = false;

    if (prev == null || current == null || prev === current) return;
    // Provenance gate (Iro CRITICAL-1): only proceed when THIS client's own
    // disabling click caused this transition — never for a transition that
    // arrived purely via the poll (another client's action).
    if (!causedByLocalClick) return;

    const isDmSeat = !!(
      session?.dm_username &&
      username &&
      session.dm_username.toLowerCase() === username.toLowerCase() &&
      session?.dm_mode === 'human'
    );
    const newActiveParticipant =
      active?.participants.find((p) => p.participant_id === current) ?? null;
    // Ownership gate (Iro CRITICAL-1): reuses the `activeIsMine` pattern below
    // — the composer/cast rail is only refocused when the newly active
    // participant is THIS viewer's OWN bound PC, never another player's rail
    // for their turn. This also subsumes the old dmPlayingOwnPc/hasComposerRail
    // check: a DM with a bound PC gets this branch exactly when it becomes
    // their own PC's turn.
    const newActiveIsMine =
      !!newActiveParticipant?.is_pc &&
      myCharacterIdStr != null &&
      newActiveParticipant.entity_id === myCharacterIdStr;

    requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      if (newActiveIsMine) {
        composerRailAnchorRef.current?.focus({ preventScroll: true });
      } else if (!newActiveParticipant?.is_pc && isDmSeat) {
        dmPanelAnchorRef.current?.focus({ preventScroll: true });
      } else {
        sceneHeadRef.current?.focus({ preventScroll: true });
      }
    });
  }, [combatState, combatId, session, username, myCharacterIdStr]);

  // ── derived combat UI state ──────────────────────────────────────────────────

  // Participants that are valid targets (living, targetable enemies).
  const targetableFoes: CombatTarget[] = combatState
    ? combatState.participants
        .filter((p): p is CombatParticipantState =>
          !p.is_pc && p.can_be_targeted && p.is_alive,
        )
        .map((p) => ({
          id: p.participant_id,
          name: p.name,
          hp: p.hp_current,
          maxHp: p.hp_max,
        }))
    : [];

  // B1-4: per-user turn resolution.
  // Find the active participant; it's MY turn only when the active participant
  // is a PC whose entity_id matches my bound character_id (stringified).
  // Out of combat: always enabled. DM/no-character: never their turn during combat.
  const activeParticipant = combatState?.participants.find(
    (p) => p.is_active_turn,
  ) ?? null;

  const activeIsMine =
    activeParticipant?.is_pc === true &&
    myCharacterIdStr != null &&
    activeParticipant.entity_id === myCharacterIdStr;

  const isPlayerTurn = combatState?.state === 'active'
    ? activeIsMine
    : true; // out of combat: always enabled

  // Iro MEDIUM-2: derive the turn-status label during render so the single
  // persistent live region (rendered below) updates its text in place. null =
  // hidden. Derived (not effect+state) to avoid a set-state-in-effect cascade.
  const turnStatusText: string | null =
    !combatId || combatState?.state !== 'active' || !activeParticipant
      ? null
      : activeIsMine
        ? 'Your turn!'
        : activeParticipant.is_pc
          ? `Waiting on ${activeParticipant.name}'s turn...`
          : `Monster turn — ${activeParticipant.name}`;

  // Round from combatState is authoritative; fall back to 1 when no state yet.
  const round = combatState?.round ?? null;

  // Determine valid "Move on" transitions from grounding (ADV-7T).
  // Show the button only when: no active combat AND at least one transition is available
  // that doesn't require an unresolved encounter.
  const activeEncounterId = combatState?.state === 'active'
    ? combatState.encounter_id
    : null;

  // P1-PLAYFIX-2 §A.3: memoized (not a plain const) — the new onSend
  // keyword-fast-path useCallback below depends on this array, and a fresh
  // array literal every render would recreate onSend every render too.
  const availableTransitions = useMemo(
    () =>
      (combatState?.state !== 'active' && grounding?.transitions)
        ? grounding.transitions.filter((t) => {
            if (!t.requires_encounter_resolved) return true;
            // If the encounter that gates this transition is resolved, allow it.
            const enc = grounding.encounter_state as Record<string, { status?: string }> | null;
            if (!enc) return false;
            const st = enc[t.requires_encounter_resolved]?.status ?? '';
            return st.startsWith('resolved_');
          })
        : [],
    [combatState?.state, grounding],
  );

  // P1-PLAYFIX §3.3.3 (S2.4) — authored skill checks offered by the current scene.
  // Same combat gating as "Move on": hidden during active combat (checks are
  // an exploration-beat affordance). P1-PLAYFIX-2 §A.3: memoized for the same
  // reason as availableTransitions above.
  // DM-driven gating (Leon, explicit): the authored scene check is only
  // actionable once Suzu has invited it in the fiction — `offeredCheckSkill`
  // is set when she names the check in her narration OR the player's action
  // maps to it (both go through the offered_check signal, validated against
  // this scene's authored checks). Before that, the dice stay in the DM's
  // hands: no "Attempt {skill}" button. Never during active combat. Generic
  // quick-checks (separate panel) remain always-available player agency and
  // are NOT gated here.
  //
  // Rehydration (fresh mount / reload mid-scene): `offeredCheckSkill` starts
  // null and is NOT restored from persisted history. The offered_check signal
  // only exists in the ephemeral SSE narration payload (src/lib/stream.ts) —
  // it is never written into a durable session_events row (see
  // src/lib/rehydration.ts eventToLogRow: narration events only carry
  // text/who), so there is nothing clean to rehydrate it from. This is a
  // deliberate accept, not an oversight: strictly honoring "DM must invite
  // it" means a bare reload shows no authored-check button until Suzu next
  // offers it (her next beat, or the player's next action re-triggering the
  // offer) — never inferring an invitation that isn't freshly reasserted.
  const availableChecks = useMemo(
    () =>
      combatState?.state !== 'active' && offeredCheckSkill
        ? (grounding?.checks ?? []).filter((c) => c.skill === offeredCheckSkill)
        : [],
    [combatState?.state, grounding, offeredCheckSkill],
  );

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
  ]);

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
  const combatIsActive = !!combatId && combatState?.state !== 'ended';

  // B2-4: is the logged-in user the session DM?
  const isDm = !!(session?.dm_username && username &&
    session.dm_username.toLowerCase() === username.toLowerCase());

  // S5.2: human DM = DM seat + dm_mode 'human'. When true:
  //   - composer modes swap to ['DM Narration', 'OOC']
  //   - AI narrate() path is gated off (early return in narrate())
  //   - DmNarrationPanel renders in the centre pane during combat
  const isHumanDM = isDm && session?.dm_mode === 'human';

  // TAV-SOLO-DM-CAST-RAIL: a solo-table human DM who ALSO has a bound
  // character (the GM-PC pattern) keeps their DM controls (DmNarrationPanel /
  // ConditionsPanel below stay gated on isHumanDM alone) but additionally
  // gets the player rail (CastSpellPanel + Composer's combat action rail) so
  // they can drive their own PC. Turn-gating (isPlayerTurn, further down)
  // already keys off myCharacterIdStr — it's unaffected by this flag.
  const isDmPlayingOwnPc = isHumanDM && !!myCharacterIdStr && !!mySheet;

  // DDX-26 — X-card banner active-state: the raised signal is still the
  // newest "beat" on the table (no later narration beat has superseded it)
  // AND this client hasn't already dismissed THIS specific raise (dismissal
  // is keyed to seq, so a fresh higher-seq x_card always re-shows even if a
  // stale one was dismissed — this is what fixes UIR2-TAV-25's
  // persists-after-dismiss bug: the old client-local toast had no seq to key
  // off at all). Mirrors the engine's own soft-redirect auto-clear: once
  // `latestNarrationSeq` overtakes the raise, the table has "eased off" and
  // the banner steps aside on its own, no dismiss required.
  const xCardActive =
    xCardEvent != null &&
    (latestNarrationSeq == null || xCardEvent.seq > latestNarrationSeq) &&
    xCardEvent.seq > (dismissedXCardSeq ?? -1);

  // DDX-25: session lifecycle status, read directly from the server-loaded
  // session (same "no stale snapshot" rule as aiLevel below) — status can now
  // change via the session controls without a full page reload.
  const isPaused = session?.status === 'paused';
  const isEnded = session?.status === 'ended';

  // DDX-20 §9 — "Resuming Suzu's turn…" resume affordance. Reuses the SAME
  // thinking waveform row as the shipped narrate() path (distinct copy),
  // shown ONLY when there is a known in-flight job (mount/reload discovery
  // or the 409-busy pivot) that this client is not ALREADY rendering via its
  // own talking/thinking state (avoids a double "narrating…"/"Resuming…"
  // flash — narrateDurable's own subscribeToJob sets talking/thinking
  // synchronously in the same tick it sets activeJob, so this only fires for
  // the genuinely-passive discovery case). Always false when the flag is off
  // (activeJob is never set on the flag-OFF path).
  const resumeThinking = DURABLE_GENERATION_ENABLED && !talking && activeJob != null;
  // A paused OR ended session shouldn't accept ANY player action — gates the
  // composer, combat action rail, skill-check, move-on, dice-tray, rebind (all
  // further down) and the DM-side monster auto-driver (via isSessionLocked).
  const sessionLocked = isPaused || isEnded;
  // DDX-25: inline validation for the Award XP form's submit button — the
  // engine's own cmd_xp rejects <= 0 with a plain-text refusal, so the floor
  // is set at 1 client-side rather than relying on that ambiguous edge.
  const xpAmountNum = Math.trunc(Number(xpAmount));
  const xpAmountValid = xpAmount.trim() !== '' && Number.isFinite(xpAmountNum) && xpAmountNum > 0;

  // S5.5: AI assist level read directly from server-loaded session (no stale snapshot).
  // 'off'    → hide ALL AI surfaces; no LLM calls (NarratorStrip, auto-narration, etc.)
  // 'assist' → no auto-fire; AI available only on explicit DM invocation (future affordance).
  // 'full'   → standard AI path unchanged.
  // Read directly from session.ai_assist_level every render cycle — NOT a useState copy.
  const aiLevel = session?.ai_assist_level ?? 'full';
  // True when AI surfaces should be hidden entirely from the UI.
  const aiOff = aiLevel === 'off';
  // Show Suzu commentary panel when AI is active ('full' or 'assist').
  // For 'assist': the strip renders but auto-narration is suppressed in narrate().
  const showSuzuPanel = !aiOff;

  // S5.2: composer mode list for the current seat.
  // Human DM: dm_narration + ooc (no roleplay modes — the DM narrates, not plays a PC).
  // All others: the standard say/act/ooc set.
  const composerModes: [ComposeMode, string][] = isHumanDM
    ? [['dm_narration', 'DM Narration'], ['ooc', 'OOC']]
    : [['say', 'Say'], ['act', 'Act'], ['ooc', 'OOC']];

  // B3-1: Victory is disabled when no monster is down (engine would 400 victory_refused).
  const anyMonsterDown = !!combatState?.participants.some(
    (p) => !p.is_pc && !p.is_alive,
  );
  const statusPill = combatIsActive ? (
    <Pill tone="lav" dot>
      round {round ?? 1} · combat
    </Pill>
  ) : (
    <Pill tone="muted" dot>
      exploring
    </Pill>
  );

  const mobileClass =
    mobileView === 'scene'
      ? styles.showScene
      : mobileView === 'party'
        ? styles.showParty
        : mobileView === 'journal'
          ? styles.showJournal
          : styles.showLog;

  // Find the selfParticipantId for the "you" badge in the tracker.
  // B1-4: prefer entity_id match (precise); fall back to name match for older engine.
  const selfPcId =
    (myCharacterIdStr != null
      ? combatState?.participants.find(
          (p) => p.is_pc && p.entity_id === myCharacterIdStr,
        )?.participant_id
      : undefined) ??
    combatState?.participants.find(
      (p) =>
        p.is_pc &&
        participants.some(
          (part) =>
            part.username.toLowerCase() === (username ?? '').toLowerCase() &&
            part.character?.name?.toLowerCase() === p.name.toLowerCase(),
        ),
    )?.participant_id ??
    null;

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

      {/* DDX-26 — durable, cross-client X-card banner.
          Iro CRITICAL-1: HOISTED here, as a sibling of .mobileTabs directly
          inside the top-level .grid (its own "banner" grid-area — see
          Play.module.css), so it renders on EVERY mobile tab + desktop
          regardless of `mobileView`. It used to live inside <main
          id="play-pane-story"> (.center), which is display:none on mobile
          unless the Story tab is active — so a participant on another tab
          (INCLUDING THE RAISER, whose X-card button lives in the Scene pane)
          got no banner and no SR announcement at all.
          Iro MAJOR-1/MINOR-1: the wrapper is PERMANENTLY mounted with
          role="status" + aria-live="polite" + aria-atomic="true" — only the
          CHILDREN (text + Dismiss button) toggle in/out. Some AT skip an
          announcement when the whole live region is inserted with text
          already in place; a stable, always-present region + content churn
          is the reliable pattern (mirrors ToastViewport in Toast.tsx). The
          `:empty` rule in Play.module.css collapses it to zero footprint
          without display:none/visibility:hidden (both of which would also
          remove it from the a11y tree, defeating the point).
          Iro MAJOR-2: tabIndex={-1} + ref makes this wrapper a stable
          refocus anchor (mirrors sceneHeadRef/endCombatBtnRef) — Dismiss
          refocuses here before its own button unmounts, so focus never
          drops to <body>.
          Discreet by design: aria-live="polite" (not assertive — must not
          interrupt), state conveyed by TEXT never color alone. Anonymous to
          players; the DM additionally sees the raiser (never leaked to a
          non-DM client — isDm is the same gate DmNarrationPanel/session
          controls already use). Per-client dismiss only hides THIS raise
          (see xCardActive's seq-keyed comment above) — the event itself is
          permanent in the transcript via eventToLogRow's 'x_card' case. */}
      <div
        ref={xCardBannerRef}
        tabIndex={-1}
        className={styles.xCardBanner}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {xCardActive && xCardEvent && (
          <>
            <span className={styles.xCardBannerText}>
              A safety signal was raised — the table eases off.
              {isDm && xCardEvent.actor ? ` X-card raised by ${xCardEvent.actor}.` : ''}
            </span>
            <button
              type="button"
              className={styles.xCardBannerDismiss}
              onClick={() => {
                // Iro MAJOR-2: refocus BEFORE this button unmounts (setting
                // dismissedXCardSeq re-renders xCardActive to false, dropping
                // this button) — otherwise the browser force-blurs to <body>.
                xCardBannerRef.current?.focus({ preventScroll: true });
                setDismissedXCardSeq(xCardEvent.seq);
              }}
              aria-label="Dismiss safety signal banner"
            >
              Dismiss
            </button>
          </>
        )}
      </div>

      {/* LEFT — party + initiative */}
      <aside id="play-pane-party" className={`${styles.pane} ${styles.left}`}>
        <div className={styles.sessionHead}>
          <Link href="/lobby" className={styles.back} aria-label="Leave session">
            <Icon name="Chevron" size={14} style={{ transform: 'rotate(180deg)' }} />
          </Link>
          <div>
            <div className={styles.kicker}>Session</div>
            <div className={styles.sessionTitle}>{title}</div>
          </div>
          {/* DDX-22: Journal drawer toggle — visible to every seat (not
              isDm-gated like .sessionControls below; the journal is a
              per-player surface, not a DM tool). Desktop-only in practice:
              the drawer chrome it opens is media-gated to >880px, so this
              button simply has no visual effect at mobile widths (the 4th
              mobile tab above is how the journal is reached there). */}
          <button
            type="button"
            className={styles.journalToggleBtn}
            onClick={() => setJournalOpen((v) => !v)}
            aria-haspopup="dialog"
            aria-expanded={journalOpen}
            aria-controls="play-pane-journal"
            aria-label="Open journal"
          >
            <Icon name="Lantern" size={16} aria-hidden />
          </button>
        </div>
        {/* DDX-25: DM-only session lifecycle controls (Pause/Resume, End,
            Award XP). Reuses the isDm gate computed above (B2-4) — the same
            gate DmNarrationPanel/the rebind buttons already use — so non-DM
            players never see this group. Kept in its own "Session controls"
            group, visually and semantically distinct from the combat outcome
            chooser (right pane, styles.outcomeChooser): session lifecycle and
            a single fight's outcome are different concepts and must not be
            confused. */}
        {isDm && (
          <div
            className={styles.sessionControls}
            role="group"
            aria-label="Session controls"
          >
            <div className={styles.sessionControlsLabel}>Session</div>
            <div className={styles.sessionControlsBtns}>
              <button
                type="button"
                className={styles.sessionControlBtn}
                onClick={() => void onTogglePause()}
                disabled={sessionActionBusy !== null || isEnded}
                aria-busy={sessionActionBusy === 'pause' || sessionActionBusy === 'resume'}
              >
                <Icon name="Pulse" size={13} aria-hidden />
                {sessionActionBusy === 'pause'
                  ? 'Pausing…'
                  : sessionActionBusy === 'resume'
                    ? 'Resuming…'
                    : isPaused
                      ? 'Resume'
                      : 'Pause'}
              </button>
              <button
                type="button"
                className={`${styles.sessionControlBtn} ${styles.sessionControlBtnDanger}`}
                onClick={() => setEndSessionConfirmOpen(true)}
                disabled={sessionActionBusy !== null || isEnded}
              >
                <Icon name="Power" size={13} aria-hidden />
                End session
              </button>
              <button
                ref={xpToggleBtnRef}
                type="button"
                className={styles.sessionControlBtn}
                onClick={() => setXpFormOpen((v) => !v)}
                disabled={sessionActionBusy !== null || isEnded}
                aria-haspopup="true"
                aria-expanded={xpFormOpen}
              >
                <Icon name="Sparkle" size={13} aria-hidden />
                Award XP
              </button>
            </div>
            {xpFormOpen && (
              <form
                className={styles.xpForm}
                aria-label="Award session XP"
                onKeyDown={(e) => {
                  // Miko-QA gate, Finding 2: guard on sessionActionBusy==='xp'
                  // for consistency with the two sibling busy-guarded
                  // patterns (outcome chooser's `!combatBusy`, ConfirmDialog's
                  // `!busy`) — Escape shouldn't dismiss the popover mid-award.
                  if (e.key === 'Escape' && sessionActionBusy !== 'xp') {
                    e.stopPropagation();
                    setXpFormOpen(false);
                    xpToggleBtnRef.current?.focus();
                  }
                }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void onAwardXp();
                }}
              >
                <label className={`label ${styles.xpLabel}`} htmlFor="xp-amount-input">
                  XP amount
                </label>
                <input
                  id="xp-amount-input"
                  className="input"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={xpAmount}
                  disabled={sessionActionBusy === 'xp'}
                  onChange={(e) => setXpAmount(e.target.value)}
                />
                <label className={`label ${styles.xpLabel}`} htmlFor="xp-reason-input">
                  Reason (optional)
                </label>
                <input
                  id="xp-reason-input"
                  className="input"
                  type="text"
                  value={xpReason}
                  disabled={sessionActionBusy === 'xp'}
                  onChange={(e) => setXpReason(e.target.value)}
                />
                <div className={styles.xpFormBtns}>
                  <button
                    type="submit"
                    className={styles.sessionControlBtn}
                    disabled={sessionActionBusy === 'xp' || !xpAmountValid}
                    aria-busy={sessionActionBusy === 'xp'}
                  >
                    {sessionActionBusy === 'xp' ? 'Awarding…' : 'Award'}
                  </button>
                  <button
                    type="button"
                    className={styles.sessionControlBtn}
                    disabled={sessionActionBusy === 'xp'}
                    onClick={() => {
                      setXpFormOpen(false);
                      xpToggleBtnRef.current?.focus();
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {/* T12 (DDX-23t): DM grants gold to a chosen party member's
                character. Session-scoped, not combat-scoped — sits in this
                same isDm "Session controls" group as Award XP (not gated on
                isHumanDM/combatIsActive like ConditionsPanel, since granting
                gold is a session-economy action available to any DM seat).
                Self-contained (own busy-latch/toast), renders nothing when
                no participant has a bound character yet. */}
            <GrantCurrencyPanel
              sessionId={sessionId}
              participants={participants}
              disabled={sessionActionBusy !== null || isEnded}
            />
          </div>
        )}
        <PartyPanel
          participants={participants}
          selfUsername={username}
          combatState={combatState}
        />
        {/* B2-4: rebind affordances — one "Change character" button per party row.
            Self sees their own row's button always; DM sees all rows. */}
        {participants.length > 0 && (
          <div className={styles.rebindSection}>
            {participants.map((p) => {
              // Non-DM players only see the button on their own row.
              const isSelf = p.username.toLowerCase() === (username ?? '').toLowerCase();
              if (!isSelf && !isDm) return null;
              return (
                <div key={p.username} className={styles.rebindRow}>
                  <span className={styles.rebindName}>{p.character?.name ?? p.username}</span>
                  <RebindCharacterButton
                    sessionId={sessionId}
                    targetUsername={p.username}
                    selfUsername={username ?? ''}
                    isDm={isDm}
                    combatActive={combatIsActive && combatState?.state === 'active'}
                    // DDX-25 R2 (D2-D4): a paused/ended session must not allow
                    // a rebind either — mirrors every other player-action gate
                    // above (Composer, combat rail, skill check, Move on,
                    // DiceTray) which all now extend `sessionLocked`.
                    sessionLocked={sessionLocked}
                    onChanged={async () => {
                      // Kage T-IMP-1: `session` does not need re-fetching here. The engine
                      // reads campaign_members fresh on each combat action, so only the
                      // participants list (for party panel display) and myCharacterIdStr
                      // (for per-user turn resolution) need to be refreshed.
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
                        // populated once on load (~line 584) and only otherwise
                        // refreshed by CastSpellPanel's own onSheetChanged after a
                        // cast. Without refetching here, a rebind to a DIFFERENT
                        // character out-of-combat leaves mySheet (spell_slots etc.)
                        // pointing at the PREVIOUS character until some unrelated
                        // mutation happens to refresh it — CastSpellPanel could
                        // offer the wrong slots once combat starts. Refetch via the
                        // same getCharacterSheet call the load path uses.
                        if (newCharId) {
                          const sheet = await getCharacterSheet(newCharId, username ?? '').catch(
                            () => null,
                          );
                          setMySheet(sheet);
                        } else {
                          setMySheet(null);
                        }
                      }
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
        {/* ADV-7/8: structured tracker when combatState available; legacy shim otherwise. */}
        {combatState && combatState.participants.length > 0 ? (
          <InitiativeTracker
            participants={combatState.participants}
            round={round}
            selfParticipantId={selfPcId}
          />
        ) : null}
      </aside>

      {/* CENTRE — narrator + log + composer */}
      <main id="play-pane-story" className={`${styles.pane} ${styles.center}`}>
        {/* S5.5: NarratorStrip (Suzu commentary panel) hidden when ai_assist_level='off'.
            When hidden, the combat status pill is surfaced inline so turn/round info
            remains visible. */}
        {showSuzuPanel ? (
          <NarratorStrip text={narratorText} talking={talking} status={statusPill} />
        ) : (
          <div className={styles.aiOffStatus} role="status" aria-live="polite">
            {statusPill}
          </div>
        )}
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
        <ChatLog
          ref={chatLogRef}
          rows={log}
          thinking={thinking || resumeThinking}
          thinkingLabel={resumeThinking ? "Resuming Suzu's turn…" : undefined}
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
              turnStatusText === 'Your turn!'
                ? styles.myTurnStatus
                : styles.offTurnStatus
            }
          >
            {turnStatusText}
          </div>
        )}
        {/* Tora MAJOR-1: DmNarrationPanel + ConditionsPanel are the DM-side
            controls; wrapped in one labeled group so AT users browsing by
            landmark/group get a "DM" vs "your character" cue now that both
            rails can co-render for a solo human-DM playing their own PC
            (TAV-SOLO-DM-CAST-RAIL). This wrapper is a single flex child of
            `.center`, so `.center`'s own gap no longer applies between the two
            panels — `.dmControlsGroup` restores it (Kage). Each panel still
            carries its own visible kicker ("Monster control"/"Conditions");
            this only adds the outer semantic grouping + restored spacing. */}
        {isHumanDM && combatIsActive && combatState && combatId && (
          <div role="group" aria-label="DM controls" className={styles.dmControlsGroup}>
            {/* S5.3 + S5.4: monster control panel — human DM seat only, during active combat. */}
            <DmNarrationPanel
              combatId={combatId}
              combatState={combatState}
              sessionId={sessionId}
              dmUsername={session?.dm_username ?? username ?? ''}
              overridePlayerVisible={session?.dm_override_player_visible ?? true}
              panelRef={dmPanelAnchorRef}
              localTurnActionRef={localTurnActionRef}
              onMessage={(text) =>
                appendLog({ who: 'Suzu', kind: 'system', text })
              }
              onOverrideMessage={(text) =>
                appendLog({
                  who: `DM (${session?.dm_username ?? username ?? 'DM'})`,
                  kind: 'dm_override',
                  text: `DM ruled: ${text}`,
                })
              }
              onStateUpdate={(newState) => {
                stateSeqRef.current += 1;
                setCombatState(newState);
              }}
              onStateRefresh={async () => {
                if (!combatId) return;
                const cs = await getCombatState(combatId).catch(() => null);
                if (cs) {
                  stateSeqRef.current += 1;
                  setCombatState(cs);
                }
              }}
            />
            {/* T7 (DDX-17e): condition apply/remove — human DM seat only, during
                active combat. Mounts alongside DmNarrationPanel (both DM-only,
                not mutually exclusive with it — a DM can drive a monster's turn
                AND apply/remove a condition). Chips themselves render for every
                client via InitiativeTracker; this panel is the mutate surface. */}
            <ConditionsPanel
              combatId={combatId}
              dmUsername={session?.dm_username ?? username ?? ''}
              participants={combatState.participants}
              disabled={combatBusy || sessionLocked}
              onApplied={(text) => appendLog({ who: 'Suzu', kind: 'system', text })}
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
                  }
                : null
          }
        />
      </main>

      {/* RIGHT — scene + "Move on" + dice + safety */}
      <aside id="play-pane-scene" className={`${styles.pane} ${styles.right}`}>
        {/* FIX-8 (MEDIUM-1): aria-label surfaces the scene name to AT so the
            "Scene" kicker (now aria-hidden) doesn't duplicate it on screen readers.
            Scene name rendered as <p> (block element) so AT pauses between the
            name and objective.
            Iro Ship 2 CRITICAL-1: tabIndex={-1} + ref makes this a programmatic
            focus anchor — refocusSceneHeadIfStranded() lands here when a
            resolved check / taken transition unmounts the control the user
            was just on. */}
        <div
          ref={sceneHeadRef}
          tabIndex={-1}
          className={styles.sceneHead}
          aria-label={grounding?.scene_name ? `Scene: ${grounding.scene_name}` : 'Scene'}
        >
          <span className={styles.kicker} aria-hidden>Scene</span>
          {grounding?.scene_name && (
            <p className={styles.sceneName}>{grounding.scene_name}</p>
          )}
          {/* A1 — surface the current objective below the scene name (free win). */}
          {grounding?.objective && (
            <span className={styles.sceneObjective}>{grounding.objective}</span>
          )}
        </div>
        <div className={styles.scenePlaceholder}>
          <Icon name="Map" size={22} aria-hidden />
          <span>The tactical map arrives in a later sprint. Suzu narrates the scene above.</span>
        </div>

        {/* Active combat: show combat note + B3-1 outcome chooser. */}
        {combatIsActive ? (
          <>
            <div className={styles.combatNote} role="status" aria-live="polite">
              <Icon name="Sword" size={13} aria-hidden /> In combat · use the action rail in the composer
              {/* B3-1: "End" opens the outcome chooser. Tora MAJOR-2: ref so focus
                  returns here when the chooser is dismissed via Escape. */}
              <button
                ref={endCombatBtnRef}
                type="button"
                className={styles.endCombatBtn}
                onClick={() => setOutcomeChooserOpen((v) => !v)}
                disabled={combatBusy}
                aria-busy={combatBusy}
                aria-haspopup="true"
                aria-expanded={outcomeChooserOpen}
                aria-label="End combat — choose outcome"
              >
                End
              </button>
            </div>
            {/* B3-1: outcome chooser popover */}
            {outcomeChooserOpen && (
              <div
                className={styles.outcomeChooser}
                role="group"
                aria-label="Choose combat outcome"
                onKeyDown={(e) => {
                  // Tora MAJOR-2: Escape closes the chooser and returns focus to the trigger.
                  if (e.key === 'Escape' && !combatBusy) {
                    e.stopPropagation();
                    setOutcomeChooserOpen(false);
                    endCombatBtnRef.current?.focus();
                  }
                }}
              >
                <div className={styles.outcomeChooserLabel}>How does this fight end?</div>
                {(
                  [
                    {
                      key: 'victory' as EndCombatOutcome,
                      label: 'Victory',
                      sub: 'You finished the foes.',
                      disabled: !anyMonsterDown,
                      disabledTip: 'No enemies are down yet.',
                    },
                    {
                      key: 'retreat' as EndCombatOutcome,
                      label: 'Retreat',
                      sub: 'Fall back; you live to fight again.',
                      disabled: false,
                      disabledTip: undefined,
                    },
                    {
                      key: 'parley' as EndCombatOutcome,
                      label: 'Parley',
                      sub: 'Talk it out.',
                      disabled: false,
                      disabledTip: undefined,
                    },
                    {
                      key: 'flee' as EndCombatOutcome,
                      label: 'Flee',
                      sub: 'Run; consequences possible.',
                      disabled: false,
                      disabledTip: undefined,
                    },
                    {
                      key: 'unresolved' as EndCombatOutcome,
                      label: 'Unresolved',
                      sub: 'End the fight without a verdict.',
                      disabled: false,
                      disabledTip: undefined,
                    },
                  ] as {
                    key: EndCombatOutcome;
                    label: string;
                    sub: string;
                    disabled: boolean;
                    disabledTip?: string;
                  }[]
                ).map(({ key, label, sub, disabled, disabledTip }) => {
                  // Iro HIGH-2: each disabled option gets a visually-hidden description
                  // so the reason is conveyed to AT (title= is not reliably read).
                  const tipId = disabledTip ? `outcome-tip-${key}` : undefined;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={styles.outcomeOption}
                      onClick={() => void onEndCombat(key)}
                      disabled={combatBusy || disabled}
                      aria-disabled={disabled || combatBusy}
                      aria-describedby={disabled && tipId ? tipId : undefined}
                    >
                      <span className={styles.outcomeLabel}>{label}</span>
                      <span className={styles.outcomeSub}>{sub}</span>
                      {/* Iro HIGH-2: sr-only description for disabled state (title= only
                          is not reliably announced by AT). */}
                      {disabled && disabledTip && (
                        <span id={tipId} className="sr-only">{disabledTip}</span>
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={styles.outcomeCancel}
                  onClick={() => {
                    setOutcomeChooserOpen(false);
                    endCombatBtnRef.current?.focus();
                  }}
                  disabled={combatBusy}
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        ) : activeEncounterId ? (
          // Between fights but encounter_id still set — shouldn't happen post-fix.
          <div className={styles.combatNote} role="status" aria-live="polite">
            <Icon name="Sword" size={13} aria-hidden /> Combat ended
          </div>
        ) : !combatId ? (
          // No combat at all: offer to begin one.
          <button
            type="button"
            className={styles.beginCombat}
            onClick={beginEncounter}
            disabled={combatBusy}
            aria-busy={combatBusy}
          >
            <Icon name="Sword" size={14} aria-hidden /> Begin an encounter
          </button>
        ) : null}

        {/* P1-PLAYFIX §3.3.3 (S2.4): authored skill-check affordances — shown only
            when the current scene offers checks and no combat is active. When a
            scene offers two skills for one outcome (e.g. Stealth OR Survival),
            both render as alternative buttons; either resolves the beat.
            Iro Ship 2 MINOR-2: role="group" + aria-label mirrors the existing
            .outcomeChooser group pattern above. */}
        {availableChecks.length > 0 && (
          <div ref={checkWrapRef} className={styles.checkWrap} role="group" aria-label="Skill check">
            <div className={styles.checkLabel}>Skill check</div>
            {availableChecks.map((c) => {
              // Iro MINOR-1: a scene authoring two checks with the same skill
              // (different DC) collided on `c.skill` alone for key/noteId/
              // offeredId. Key by skill+dc — stable and unique per authored
              // check within a scene.
              const checkKey = `${c.skill}-${c.dc}`;
              // Iro Ship 2 MAJOR-1: `note` was only reachable via native title=
              // (not reliably announced by AT, invisible on touch). Mirror the
              // outcomeChooser's sr-only + aria-describedby pattern instead.
              const noteId = c.note ? `check-note-${checkKey}` : undefined;
              // P1-PLAYFIX-2 §A.5/§A.6 — highlight the check Suzu invited this
              // turn. A second sr-only span (not color alone) carries the
              // invite to screen readers; toast() already announced it once
              // via aria-live when the offer landed (see narrate()).
              const isOffered = c.skill === offeredCheckSkill;
              const offeredId = isOffered ? `check-offered-${checkKey}` : undefined;
              const describedBy = [offeredId, noteId].filter(Boolean).join(' ') || undefined;
              return (
                <button
                  key={checkKey}
                  type="button"
                  className={`${styles.checkBtn} ${isOffered ? styles.checkBtnOffered : ''}`}
                  onClick={() => void onAttemptCheck(c.skill)}
                  disabled={checkBusy || talking || sessionLocked}
                  aria-busy={checkBusy || talking}
                  aria-disabled={checkBusy || talking || sessionLocked}
                  aria-describedby={describedBy}
                  title={c.note}
                >
                  <Icon name="Check" size={13} aria-hidden />
                  {/* Iro Ship 2 MINOR-1: comma reads better in AT/TTS than parens. */}
                  {`Attempt ${titleCaseSkill(c.skill)}, DC ${c.dc}`}
                  {isOffered && (
                    <span id={offeredId} className="sr-only">Suzu invited this check.</span>
                  )}
                  {c.note && (
                    <span id={noteId} className="sr-only">{c.note}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ADV-7T: "Move on" affordance — shown only when transitions are available
            and no combat is active.
            Iro Ship 2 MINOR-2: role="group" + aria-label mirrors the existing
            .outcomeChooser group pattern above. */}
        {availableTransitions.length > 0 && (
          <div
            ref={transitionWrapRef}
            className={styles.moveOnWrap}
            role="group"
            aria-label="Scene transition"
          >
            <div className={styles.moveOnLabel}>Scene transition</div>
            {availableTransitions.map((t) => (
              <button
                key={t.to}
                type="button"
                className={styles.moveOnBtn}
                onClick={() => void onMoveOn(t.to)}
                disabled={sceneAdvanceBusy || talking || sessionLocked}
                aria-busy={sceneAdvanceBusy || talking}
                aria-disabled={sceneAdvanceBusy || talking || sessionLocked}
              >
                <Icon name="Compass" size={13} aria-hidden />
                {t.label ?? `Move on → ${t.to}`}
              </button>
            ))}
          </div>
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

      {/* DDX-22: Journal / Memory pane — right-edge slide-over drawer on
          desktop (position:fixed, entirely OUT of the .grid's flow above —
          the grid's columns/areas are untouched) + 4th mobile tab (joins the
          existing .left/.center/.right pane-collapse group via
          styles.journalPane). Always mounted, even while closed/inactive, so
          the desktop slide-out transition has a "from" state to animate —
          `inert` removes it from the tab order/a11y tree whenever it isn't
          actually presented (see journalVisible above). Dialog SEMANTICS
          (role/aria-modal/focus-trap) are wired ONLY while acting as the
          desktop drawer (`journalOpen`) — the mobile tab is a plain pane,
          matching Story/Party/Scene, never a dialog.
          Miko LOW-MED / Iro (cross-breakpoint desync): the visual
          `.journalDrawerOpen` class + the scrim's render condition key off
          `journalVisible` (not `journalOpen`) — after the CRITICAL-1 fix
          above, `journalOpen` can only be set true via the desktop toggle,
          but a journal opened via the MOBILE tab (`mobileView==='journal'`)
          and then resized up past 880px would otherwise leave the drawer
          transformed off-screen (no `.journalDrawerOpen`) while still
          `inert={false}` — a focusable-but-invisible drawer. Keying both off
          the SAME `journalVisible` value used for `inert`/`aria-hidden`
          means the two can never desync, regardless of when the breakpoint
          crosses. This does not change desktop open/close via the toggle
          button: opening sets `journalOpen` true, which also makes
          `journalVisible` true (it's `journalOpen || ...`), and closing
          clears both together. */}
      {journalVisible && (
        <div className={styles.journalScrim} onClick={closeJournal} />
      )}
      <aside
        id="play-pane-journal"
        ref={journalDialogRef}
        className={`${styles.journalPane} ${styles.journalDrawer} ${
          journalVisible ? styles.journalDrawerOpen : ''
        }`}
        role={journalOpen ? 'dialog' : undefined}
        aria-modal={journalOpen ? true : undefined}
        // Iro MINOR-5: unconditional (was `journalOpen ? ... : undefined`)
        // so the region is named in the mobile-tab presentation too, not
        // just while acting as the desktop dialog — harmless when `inert`/
        // `aria-hidden` removes it from the tree entirely.
        aria-labelledby={JOURNAL_HEADING_ID}
        // Belt-and-suspenders: `inert` is the real mechanism (blocks focus +
        // pointer events + a11y-tree presence natively in every evergreen
        // browser), but jsdom does not implement its side effects at all
        // (confirmed: neither jsdom nor dom-accessibility-api reference
        // `inert`) — without aria-hidden too, a closed-but-mounted drawer's
        // content (e.g. the notes textarea) would still surface in any
        // role-based test query, colliding with the Composer's own textbox.
        // aria-hidden alone IS honored by dom-accessibility-api's
        // isInaccessible(), so pairing them is correct in both real browsers
        // and this test environment, not merely a test workaround.
        aria-hidden={journalVisible ? undefined : true}
        inert={!journalVisible}
        tabIndex={journalOpen ? -1 : undefined}
        onKeyDown={journalOpen ? onJournalKeyDown : undefined}
      >
        <JournalPane
          sessionId={sessionId}
          events={journalEvents}
          grounding={grounding}
          onClose={closeJournal}
          closeButtonRef={journalCloseBtnRef}
        />
      </aside>

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
