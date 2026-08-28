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
  C3_GROUNDING_FIELD,
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
  rollDeathSave as combatDeathSave,
  postRoll,
  postXCard,
} from '@/lib/api/dnd';
import { streamDmNarration, postDmTurn, subscribeDmJob } from '@/lib/stream';
import { eventToLogRow, formatEventTimestamp as formatOpeningTimestamp } from '@/lib/rehydration';
import { matchCombatIntent, matchKeywordIntent } from '@/lib/dnd/intentFastPath';
import { DURABLE_GENERATION_ENABLED } from '@/lib/config';
import { mintTurnKey, saveTurnKey, clearTurnKey } from '@/lib/turnKey';
import { shouldClearAbortedStreamRow } from '@/lib/streamRowOwnership';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import {
  reconcileDurableEvents,
  applyReconcileResult,
  type PendingTurnEntry,
} from '@/lib/dnd/reconcileEvents';
import { engineErrorMessage, extractReason, isApiError } from '@/lib/dnd/engineError';
import { COMBAT_REFUSAL_REASON_MAP } from '@/lib/dnd/engineReasons';
import { isLivingTargetableFoe } from '@/lib/dnd/combatTargets';
import type {
  CharacterSheet,
  CombatState,
  EndCombatOutcome,
  EndSessionLevelUp,
  EngineSessionEvent,
  GroundingData,
  OfferedCheck,
  Participant,
  PendingGeneration,
  SceneCheck,
  Session,
  SeriesCompletionPointer,
  SeriesNextAdventure,
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
import CampaignFloorPanel from '@/components/CampaignFloorPanel';
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
 * Session-event kinds that can change scene affordances (available checks,
 * transitions/gated exits) and therefore require a `grounding` re-fetch when
 * they arrive over the `/events` poll.
 *
 * - `scene_advance` — the server-side cursor moved to a new scene.
 * - `beat_resolved` / `beat_done` / `beat_override` — the STRUCT-006 beat ledger
 *   changed. The beat classifier resolves required beats AFTER the narration
 *   turn is delivered (deliberate — see the durable poll effect), and resolving
 *   the last unmet required beat opens a previously-hidden anti-skip gate: a new
 *   exit + its check appear in grounding WITHOUT the cursor advancing. Without a
 *   re-fetch on these, a classifier-opened gate stays invisible until a manual
 *   page reload. All three are written `visibility="table"` by the engine, so
 *   they reach this feed. Both the durable and the flag-OFF/SSE poll branches
 *   share this predicate so the two paths can't drift.
 */
const GROUNDING_INVALIDATING_KINDS = new Set([
  'scene_advance',
  'beat_resolved',
  'beat_done',
  'beat_override',
  // Check Retry + Fail-Forward (2026-07-28 design section 7.4): a
  // resolved/locked check changes this scene's check rail. Without this, a
  // second client at the same table keeps showing a check as available
  // after another player already resolved it, and eats a 409 on click.
  'check_resolved',
]);

/**
 * Check Retry + Fail-Forward (2026-07-28 design section 7.1) — human-facing
 * copy for a locked check's sr-only reason span. Keyed by `SceneCheck.lock_reason`;
 * an unrecognised/absent reason falls back to the max_attempts line, same
 * fallback convention as the engine's own `complication_line`.
 */
const CHECK_LOCK_REASON_COPY: Record<string, string> = {
  nat1: 'A critical failure closed this approach.',
  fail_by_5: 'A decisive failure closed this approach.',
  max_attempts: 'Out of attempts.',
};

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
 * Phase 4 (Sora-Arch design §4 Fork 3) — parse an `offered_check` payload off
 * a durable `narration`/`dm_narration` session event's `data` (the field the
 * completed-job payload carries per the locked wire contract:
 * `{skill, dc: int|null, note: str|null}`). This is the durable-poll
 * counterpart to src/lib/stream.ts's identical SSE-side parsing — same
 * defensive posture: any missing/malformed shape simply returns null
 * (presence is a bonus, never a requirement), so a pre-Phase-4 engine/proxy
 * that doesn't send this field yet degrades to "no offer", never a crash.
 */
function parseOfferedCheckPayload(
  data: Record<string, unknown> | null | undefined,
): OfferedCheck | null {
  const raw = data?.['offered_check'];
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const skill = r['skill'];
  if (typeof skill !== 'string') return null;
  const dc = typeof r['dc'] === 'number' ? (r['dc'] as number) : undefined;
  const note = typeof r['note'] === 'string' ? (r['note'] as string) : undefined;
  return { skill, ...(dc !== undefined ? { dc } : {}), ...(note !== undefined ? { note } : {}) };
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
 * F5/LEVELUP-NO-MOMENT: build the end-session toast's level-up clause from
 * `POST /sessions/{id}/end`'s `data.level_ups` echo. Returns `null` when
 * nobody leveled (empty/absent — degrades gracefully, no clause appended).
 */
function levelUpsSummary(levelUps: EndSessionLevelUp[]): string | null {
  const parts = levelUps
    .filter((l): l is EndSessionLevelUp & { name: string } => !!l.name)
    .map((l) => `${l.name} (now level ${l.new_level ?? '?'})`);
  if (parts.length === 0) return null;
  return `Level up: ${parts.join(', ')} — see the party panel to choose new features.`;
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
  // TAV-NARRATION-DECOUPLE (2026-07-25): `narratorText` used to feed the top
  // NarratorStrip with the live-streaming narration; removed when the strip
  // was repurposed to a scene/combat status banner (ChatLog's
  // upsertStreamNarration/finalizeStreamNarration is now the SOLE live
  // narration surface — see subscribeToJob/narrate() below and revealText's
  // own comment).
  const [talking, setTalking] = useState(false);
  const [thinking, setThinking] = useState(false);

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
  // TAV-SLICE-END-ADVANCE-NULL / Kage-CR item 4: a terminal advance
  // (to_scene: null / completed: true) has no further "Move on" affordance —
  // latch this so a second click can't post another /advance (and narrate
  // another "adventure concludes" beat) indefinitely. Session-lifetime only;
  // a reload naturally resets it (the engine's own `progress.completed` is
  // the durable source of truth — this is just a UI repeat-guard).
  const [adventureComplete, setAdventureComplete] = useState(false);
  // T4p2: the /advance completion payload's series next-pointer (design doc
  // §6.4) — RENDER-ONLY addition, not a new interaction. Populated (never
  // required) alongside adventureComplete above; NextPartOffer degrades to
  // rendering nothing when this stays null (not in a series, or the field
  // is absent on an older engine/SUZU_DND_SERIES off). One series entry is
  // rendered — the first, matching `next_adventure`'s own single-series
  // flatten rule (design doc §6.4's "why next_adventure also exists").
  const [completionSeries, setCompletionSeries] = useState<{
    series: SeriesCompletionPointer;
    next: SeriesNextAdventure | null;
  } | null>(null);

  // P1-PLAYFIX (S2.4) — busy flag for the check-affordance row (Attempt: Survival, etc.).
  const [checkBusy, setCheckBusy] = useState(false);

  // P1-PLAYFIX-2 §A.5/§A.6 — the skill the server invited this turn (present
  // once the SSE payload carries an `offeredCheck`; forward-compatible, see
  // dnd.ts/types.ts). Cleared at the start of every new narrate() beat so a
  // stale offer never lingers past the turn it was made on. NEVER drives an
  // auto-roll — it only makes the matching "Attempt {skill}" button hard to miss.
  const [offeredCheckSkill, setOfferedCheckSkill] = useState<string | null>(null);

  // Phase 4 (Sora-Arch design §4 Fork 3; Miko-QA "the sleeper bug" fix) — a
  // skill Suzu invited this turn that is NOT one of the current scene's
  // AUTHORED checks (grounding.checks) — a freeform/unauthored offer. The
  // pre-Phase-4 client validated every offer against `availableChecks` and
  // silently DROPPED anything outside it; this state instead routes such an
  // offer to a dedicated "Attempt {skill}" affordance that rolls via the
  // always-available quickChecks/postRoll -> engine `/roll (kind=skill)`
  // primitive (never `/check`, which 400s `no_such_check` for anything
  // unauthored). Mutually exclusive with `offeredCheckSkill` above — see
  // `applyOfferedCheckSignal` below, which sets exactly one of the two per
  // offer and clears both at the top of every new beat.
  const [freeformOfferedCheck, setFreeformOfferedCheck] = useState<string | null>(null);

  // B1-4: the logged-in user's bound character_id (stringified) for per-user
  // turn resolution. Populated from the participants endpoint on load + on rebind.
  const [myCharacterIdStr, setMyCharacterIdStr] = useState<string | null>(null);

  // T6 (DDX-12): the bound character's own sheet, needed for CastSpellPanel
  // (is_spellcaster gate + spell_slots for the upcast range / live pips).
  // Populated by the same getCharacterSheet call that already builds
  // quickChecks below; refreshed by CastSpellPanel itself after a successful
  // cast (onSheetChanged), mirroring SpellSlotsPanel's onChanged contract.
  const [mySheet, setMySheet] = useState<CharacterSheet | null>(null);

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
  const memberSheetDialogRef = useRef<HTMLElement>(null);
  const memberSheetCloseBtnRef = useRef<HTMLButtonElement>(null);
  const memberSheetPreviouslyFocusedRef = useRef<HTMLElement | null>(null);

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
  // Iro MAJOR-1: the outcome chooser now has two openers ("End" and "Wrap
  // up") — capture whichever one actually opened it so Escape/Cancel refocus
  // the real opener instead of always the "End" button. `endCombatBtnRef`
  // stays as the fallback (e.g. if the chooser is ever opened programmatically).
  const lastOpenerRef = useRef<HTMLButtonElement | null>(null);

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
  // Phase 4 (Miko-QA "the sleeper bug" fix) — scroll anchor for the freeform
  // "Attempt {skill}" affordance (see `freeformOfferedCheck` below), mirrors
  // `checkWrapRef`'s identical role for the authored checks group.
  const freeformCheckRef = useRef<HTMLDivElement>(null);
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
   * drives the live `thinking`/`talking` UI + the chat log's live streaming
   * row (`upsertStreamNarration`, the SOLE narration surface post
   * TAV-NARRATION-DECOUPLE) and keeps `pendingByKeyRef`'s `narrationRowId`
   * in sync so that reconciliation can find this row when the durable event
   * lands.
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
   *
   * `precreateRow` (TAV-NARRATION-DECOUPLE Phase 2, 2026-07-26) — when true,
   * pre-create THIS turn's streaming anchor row and claim it in the ledger
   * (`entry.narrationRowId`) synchronously, before any await, so the poll's
   * reconciliation (rule 3) always finds a `streaming` row to REPLACE
   * (sub-case a) instead of appending a fresh one whole (sub-case c, the
   * pop-in). `true` for all four originating-client subscribes
   * (narrateDurable's 200 + 409-pivot, narrateDurableBeat's 200 + 409-pivot);
   * `false` for the poll's stateless resume-discovery subscribe (§4b) —
   * scoped OFF that path deliberately: on a reload the narration may already
   * exist server-side by the time this client discovers the job, so
   * pre-creating an anchor there risks an orphaned empty row racing a
   * same-tick append. See the design doc's §3 Phase 2 / §11 trade-offs.
   */
  const subscribeToJob = useCallback(
    async (
      jobId: string,
      ledgerKey: string,
      triggerSeq: number | undefined,
      origin: 'composer' | 'beat',
      precreateRow: boolean,
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
      clearStreamNarration(true);

      let full = '';
      let sawError = false;
      // Kage #3 — true once the FIRST chunk observes that the poll's own
      // reconciliation already claimed (appended) this turn's narration
      // before we got here (see reconcileEvents.ts rule 3 sub-case (c)).
      // Once true, every subsequent chunk is dropped for the chat log too —
      // the durable row the poll already appended is canonical, and (T1/
      // TAV-S1) mutating an already-visible (non aria-hidden, already
      // announced-once) row's text on every chunk would re-flood a screen
      // reader exactly like the bug `streaming:true` was built to prevent.
      // TAV-NARRATION-DECOUPLE: this is the only user-visible effect of the
      // race — a beat whose durable event lands before this client's first
      // SSE byte renders as one already-complete row instead of growing
      // token-by-token. See play.ddx20-durable-turn.test.tsx's
      // "poll-claim race" case for the non-vacuous proof that this stays a
      // single, correctly-reconciled row either way.
      let pollClaimedNarration = false;
      // TAV-S1-ABORT-CLEAR: this tail's OWN streaming row id (see narrate()'s
      // identical comment above) — only meaningful when we, not the poll,
      // own the live row.
      let ownStreamRowId: string | null = null;

      // TAV-NARRATION-DECOUPLE Phase 2 (2026-07-26) — pre-create THIS turn's
      // streaming anchor row and claim it in the ledger BEFORE the SSE tail
      // even starts, so the poll's reconcile (rule 3) always finds a
      // `streaming` row to REPLACE (sub-case a) rather than appending a
      // fresh one whole once no chunk has arrived yet (sub-case c, the
      // pop-in). Runs synchronously, after `clearStreamNarration(true)`
      // above (drops any superseded beat's stale row first) and before the
      // `for await` below suspends — so `entry.narrationRowId` is set before
      // the poll's setInterval tick could possibly run again, closing the
      // gap even tighter than the first-chunk claim below does.
      //
      // Why the SR-flood guard still holds: if the poll replaces this anchor
      // (sub-case a) before any chunk lands, the row's `id` in `log` is
      // swapped to the durable row's OWN fresh id (announce-once) — but
      // `streamRowIdRef.current` still holds the OLD anchor id. The first
      // chunk's `if (!streamRowIdRef.current)` check below is FALSE (an id
      // is still present), so it skips the poll-claimed-detection branch —
      // but `upsertStreamNarration(full)` then does a find-by-id against the
      // STALE anchor id, which no row matches anymore, so it silently no-ops
      // (see `upsertStreamNarration`'s `existingId` branch). The
      // already-announced durable row is never touched again. Identical
      // outcome to today's "poll replaced the streaming row mid-stream"
      // case — just reached from a pre-existing id instead of one the first
      // chunk minted.
      if (precreateRow) {
        upsertStreamNarration('');
        ownStreamRowId = streamRowIdRef.current;
        const precreateEntry = pendingByKeyRef.current.get(ledgerKey);
        if (precreateEntry && ownStreamRowId) {
          precreateEntry.narrationRowId = ownStreamRowId;
        }
        // §8 masked observability — correlation ids only, no prose/mechanics.
        console.debug('narration_anchor_precreated', {
          job_id: jobId,
          ledger_key: ledgerKey,
          origin,
        });
      }

      try {
        for await (const ev of subscribeDmJob(jobId, sessionId, { signal: ctrl.signal })) {
          if (ev.kind === 'chunk') {
            full = ev.text;
            // TAV-COMPOSING (Phase 1, 2026-07-26) — do NOT clear `thinking`
            // here unconditionally. On the poll-claim race (below) this
            // chunk's row is never rendered by THIS tail at all — clearing
            // on the bare event flashed the indicator off while the full
            // text was already sitting in the log (the "pops up then shows
            // the whole message" complaint). Clear only once something is
            // actually visible: either the poll-claimed detection just below
            // (the row is already on-screen, non-hidden), or the upsert below
            // that carries real (non-empty) text.
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
                  // TAV-COMPOSING — the poll already rendered this beat's
                  // narration as a real, visible (non-streaming) row; the
                  // composing cue has nothing left to cover.
                  setThinking(false);
                }
              }
              // Tora CRITICAL-1 (resurrection race) — same gate as narrate():
              // a stale/superseded tail can still deliver a trailing chunk
              // after a successor has synchronously aborted `ctrl` (readSSE
              // only re-checks `signal.aborted` once per `reader.read()`
              // chunk, not per SSE event). `ctrl.signal.aborted` flips
              // synchronously on `.abort()` regardless of generator
              // progress, so checking it here stops a stale tail from
              // re-minting/adopting a row a successor already owns.
              if (!pollClaimedNarration && !ctrl.signal.aborted) {
                upsertStreamNarration(full);
                // TAV-S1-ABORT-CLEAR: snapshot the row id THIS tail owns.
                ownStreamRowId = streamRowIdRef.current;
                // Keep the ledger's narrationRowId in sync with the live row
                // so reconcileDurableEvents (rule 3) can find-and-replace it
                // once the durable seq-bearing event lands on the poll.
                const entry = pendingByKeyRef.current.get(ledgerKey);
                if (entry && streamRowIdRef.current) {
                  entry.narrationRowId = streamRowIdRef.current;
                }
                // TAV-COMPOSING — clear once the row genuinely carries
                // visible text (guards a precreated anchor's first empty
                // upsert, and a stray empty first chunk in general).
                if (full.trim() !== '') setThinking(false);
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

      if (ctrl.signal.aborted) {
        // TAV-S1-ABORT-CLEAR: see narrate()'s identical comment — only clear
        // if a successor hasn't already claimed/replaced this ref.
        if (shouldClearAbortedStreamRow(streamRowIdRef.current, ownStreamRowId)) {
          clearStreamNarration(true);
        }
        return;
      }
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
        if (g) {
          setGrounding(g);
          // Check Retry + Fail-Forward Iro-A11y MAJOR-1: seed the
          // disappearance-explanation baseline on the VERY FIRST grounding
          // read too -- without this, prevCheckStatesRef would stay empty
          // through mount, and the first poll/refresh afterward would also
          // see an empty "prev" and wrongly treat a genuine transition (one
          // that happened between mount and that first tick) as an
          // unseen-before check, silently dropping the explanation.
          // Forward-reference-safe: diffAndExplainResolvedChecks is
          // declared later in this component, but this async closure only
          // executes after the whole component body has finished
          // evaluating for this render (same pattern as `openScene`'s own
          // documented forward reference near this same mount effect).
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

          // Scene panel objective / quick-checks AND gated exits/checks are
          // driven by `grounding` state. On the DURABLE path a scene_advance is
          // discovered HERE (via this poll), not through narrate()'s SSE
          // `sceneAdvancedSignal` — so without this refetch the Scene card lags
          // on the previous scene after the runner advances the cursor
          // server-side (the transcript shows the transition beat, but the
          // objective/quick-checks stay stale).
          //
          // STRUCT-006 (2026-07-24): the beat classifier resolves required
          // beats AFTER the narration turn is delivered (deliberate — grounding
          // hides gated exits, so no INTENT on the turn that opens a gate could
          // ever name that exit; zero added player latency). It writes
          // beat_resolved (source=classifier) / beat_done / beat_override
          // session events (all visibility="table", so they reach this feed),
          // and resolving the last unmet required beat opens a previously-hidden
          // anti-skip gate: a new exit + its check appear in grounding.
          // scene_advance alone did NOT cover this — the gate opens WITHOUT the
          // cursor moving — so a classifier-opened gate stayed invisible until a
          // manual page reload (the one thing that materially breaks the
          // feel-check). Re-fetching on the beat-ledger kinds too surfaces it
          // within one poll cycle (~4s).
          //
          // Keyed on `journalFresh` (seq-deduped) not `allNewEvents`, so it
          // fires ONCE per resolve rather than every tick under the NekoNova
          // `since_seq`-drop full-history refetch. Inlined (not
          // refreshGrounding()) because that useCallback is declared below this
          // effect — referencing it in the dep array would hit its TDZ.
          const invalidatesGrounding = journalFresh.some(
            (e) => e.kind != null && GROUNDING_INVALIDATING_KINDS.has(e.kind),
          );

          // Phase 4 (Sora-Arch design §4 Fork 3; Miko-QA "the sleeper bug"
          // fix, the single most important new client-side assertion in the
          // whole plan) — durable-poll parity for `offered_check`.
          // narrate()'s SSE path already surfaces this (src/lib/stream.ts);
          // the durable poll never read it at all, so a completed job's
          // check offer sat silently on the wire, unrendered. Only the
          // HIGHEST-seq narration/dm_narration event THIS TICK decides the
          // outcome — mirrors narrate() clearing offeredCheckSkill/
          // freeformOfferedCheck at the top of EVERY beat, then only
          // re-setting one at the bottom if THAT beat offered one: an older
          // beat's stale offer must never win over a newer beat's "no
          // offer" just because both landed in the same catch-up batch
          // (e.g. a backgrounded tab resuming several beats at once).
          let latestNarrationEvent: EngineSessionEvent | null = null;
          for (const e of journalFresh) {
            if (e.kind !== 'narration' && e.kind !== 'dm_narration') continue;
            if (!latestNarrationEvent || (e.seq ?? 0) > (latestNarrationEvent.seq ?? 0)) {
              latestNarrationEvent = e;
            }
          }
          const offerThisTick = latestNarrationEvent
            ? parseOfferedCheckPayload(latestNarrationEvent.data)
            : undefined; // no NEW narration beat this tick at all — leave offer state untouched

          if (invalidatesGrounding || offerThisTick) {
            // Iro MAJOR-1 parity: validate the offer against CURRENT
            // grounding, never the closure's `grounding` (this poll, like
            // narrate(), treats it as unreliable — see the effect's own
            // convention of always refetching fresh below).
            getGrounding(sessionId)
              .then((g) => {
                if (invalidatesGrounding) {
                  // Tora-Gesture CRITICAL-1 (2026-07-28): this setGrounding
                  // can unmount the check the player currently has focus on
                  // (another table member resolved/locked it, or a
                  // STRUCT-006 classifier did via roleplay -- no click on
                  // THIS client at all), stranding focus on <body> with no
                  // recovery. Same rescue onAttemptCheck's own click path
                  // already uses (page.tsx ~L3366+) -- capture synchronously
                  // right before the state update that may unmount, refocus
                  // after. `refocusSceneHeadIfStranded` is declared BELOW
                  // this effect in source, same safe forward-reference shape
                  // `applyOfferedCheckSignal` on the next line already uses
                  // (this closure only runs long after the whole component
                  // body -- and its consts -- have finished evaluating for
                  // this render; NOT safe to add to this effect's own deps
                  // array, see that array's existing TDZ comment).
                  const hadFocusInCheckWrap =
                    checkWrapRef.current?.contains(document.activeElement) ?? false;
                  setGrounding(g);
                  // Iro-A11y MAJOR-1: same forward-reference-safe shape as
                  // refocusSceneHeadIfStranded just below -- see
                  // diffAndExplainResolvedChecks's own declaration comment.
                  diffAndExplainResolvedChecks(g);
                  refocusSceneHeadIfStranded(hadFocusInCheckWrap);
                }
                if (offerThisTick) applyOfferedCheckSignal(offerThisTick, g);
              })
              .catch(() => {});
          }
          if (latestNarrationEvent && !offerThisTick) {
            // A new beat landed this tick and offered nothing — clear any
            // stale highlight from an earlier beat (mirrors narrate()'s
            // per-beat clear at the top of the SSE function).
            setOfferedCheckSkill(null);
            setFreeformOfferedCheck(null);
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
          // precreateRow: false (TAV-NARRATION-DECOUPLE Phase 2) — deliberately
          // scoped OFF this stateless resume path: the narration may already
          // exist server-side by the time a reload discovers the job, so
          // pre-creating an anchor here risks racing a same-tick append.
          // Resume pop-in stays possible but is rare/accepted (design §11).
          void subscribeToJob(
            pending.job_id,
            pending.turn_key,
            pending.trigger_seq,
            'composer',
            false,
          );
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
          // TAV-COMPOSING (Phase 1, 2026-07-26) — this turn's own ledger
          // entry is gone, so the beat resolved via the poll's reconciliation
          // (rule 3 sub-case a/b) BEFORE (or without) subscribeToJob's tail
          // ever clearing the indicator itself (e.g. the poll replaced a
          // precreated anchor before the first SSE chunk). Scoped to
          // `turnKeyRef` — the composer's own current turn — so it never
          // clears a DIFFERENT, still-in-flight beat's indicator; a beat's
          // own tail always self-clears at its SSE end (:973-ish) regardless.
          setThinking(false);
          setTalking(false);
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
        // STRUCT-006 (2026-07-24): mirror the durable poll's grounding
        // invalidation. On the flag-OFF/SSE path the beat classifier still runs
        // post-delivery (narration.py background thread + buffered) and writes
        // beat_resolved, so a classifier-opened gate would otherwise stay hidden
        // until reload here too. scene_advance normally reaches grounding via
        // narrate()'s sceneAdvancedSignal, but re-fetching on it here as well is
        // idempotent and also catches a cross-client advance this tab didn't
        // originate. `newOnes` is seq-deduped, so this fires once per change.
        if (newOnes.some((e) => e.kind != null && GROUNDING_INVALIDATING_KINDS.has(e.kind))) {
          getGrounding(sessionId)
            .then((g) => {
              // Tora-Gesture CRITICAL-1 (2026-07-28): SSE/flag-off mirror of
              // the durable poll's identical fix above -- capture focus
              // synchronously right before the state update that may
              // unmount a focused check (poll-driven removal, no click on
              // THIS client), refocus the scene heading after. Same
              // deliberate deps-array omission as `refocusSceneHeadIfStranded`
              // would trigger the same TDZ this effect's own deps-array
              // comment documents for `applyOfferedCheckSignal` -- safe to
              // call from inside this closure, not safe to list as a dep.
              const hadFocusInCheckWrap =
                checkWrapRef.current?.contains(document.activeElement) ?? false;
              setGrounding(g);
              // Iro-A11y MAJOR-1: same forward-reference-safe shape as
              // refocusSceneHeadIfStranded just below.
              diffAndExplainResolvedChecks(g);
              refocusSceneHeadIfStranded(hadFocusInCheckWrap);
            })
            .catch(() => {});
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
    //
    // Phase 4: `applyOfferedCheckSignal` (used by `pollDurable` above) is
    // deliberately omitted too — it's declared BELOW this effect in source
    // (same forward-reference shape as `openScene`'s own omission near the
    // mount effect above), so listing it here would hit the same dep-array
    // TDZ this comment already documents for `refreshGrounding`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // TAV-A11Y-USE-ESCAPE-CONSUME-HOOK: this drawer has no busy state to
        // gate on, so the close always fires alongside the unconditional
        // stopPropagation().
        consumeEscape(e, { onClose: closeJournal });
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

  // Focus management on open/close — mirrors the Journal drawer's effect
  // exactly: remember whatever was focused (always the clicked party card),
  // focus the drawer's close button after paint, restore focus on close.
  useEffect(() => {
    if (!memberSheetOpen) return;
    memberSheetPreviouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => memberSheetCloseBtnRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      memberSheetPreviouslyFocusedRef.current?.focus?.();
    };
  }, [memberSheetOpen]);

  // Esc + generic Tab-trap — mirrors onJournalKeyDown, reusing the same
  // JOURNAL_FOCUSABLE_SELECTOR (it's content-agnostic, not journal-specific).
  const onMemberSheetKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        consumeEscape(e, { onClose: closeMemberSheet });
        return;
      }
      if (e.key === 'Tab' && memberSheetDialogRef.current) {
        const focusables = Array.from(
          memberSheetDialogRef.current.querySelectorAll<HTMLElement>(JOURNAL_FOCUSABLE_SELECTOR),
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
    [closeMemberSheet],
  );

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

  /**
   * TAV-NARRATION-DECOUPLE (2026-07-25): the client-side fake-typewriter for
   * the buffered/non-streamMode legacy SSE beat (server sends the whole
   * accumulated text in one non-paced delta, see narrate()'s `else` branch
   * below). This used to reveal word-by-word into the top NarratorStrip's
   * now-removed `narratorText`; it now drives the SAME `upsertStreamNarration`
   * chat row the streamMode branch uses directly, so the buffered path keeps
   * a real live-streaming row in the chat log (its sole narration surface)
   * instead of the row popping in whole at `narrate()`'s post-loop finalize.
   * `streamRowIdRef` ends up set exactly as it would for a streamMode beat, so
   * the existing `finalizeStreamNarration(full)` call at the end of `narrate()`
   * still finalizes/announces it correctly — no new finalize path needed.
   *
   * TAV-COMPOSING (Phase 1, 2026-07-26): this starts the row EMPTY
   * (`upsertStreamNarration('')`) and grows it word-by-word, so `thinking`
   * must NOT clear the moment this function is called (the caller's `full`
   * argument is non-empty, but nothing visible exists yet) — it clears
   * itself, right here, once the first tick actually paints non-empty text.
   * Until then the composing cue stays up and covers the empty-anchor gap
   * (ChatLog renders `null` for a streaming row with no text — see its own
   * TAV-NARRATION-DECOUPLE Phase 2 guard).
   */
  const revealText = useCallback(
    (full: string) => {
      if (revealRef.current) clearInterval(revealRef.current);
      if (reduced) {
        upsertStreamNarration(full);
        if (full.trim() !== '') setThinking(false);
        return;
      }
      const tokens = full.split(/(\s+)/);
      let i = 0;
      upsertStreamNarration('');
      revealRef.current = setInterval(() => {
        i += 1;
        const shown = tokens.slice(0, i).join('');
        upsertStreamNarration(shown);
        if (shown.trim() !== '') setThinking(false);
        if (i >= tokens.length && revealRef.current) {
          clearInterval(revealRef.current);
          revealRef.current = null;
        }
      }, 26);
    },
    [reduced, upsertStreamNarration],
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
  // Check Retry + Fail-Forward (2026-07-28 design) — Iro-A11y MAJOR-1:
  // disappearance-explanation for a check resolved by someone OTHER than
  // this client's own click (a table-mate's action, or a STRUCT-006
  // classifier resolving the gating flag through roleplay -- no click on
  // THIS client at all). The acting client's own resolution gets the toast
  // + SILENT log row (onAttemptCheck, MAJOR-2, below); every OTHER client
  // only sees the check silently vanish from the rail unless this fires.
  // Keyed `${skill}-${dc}`, mirroring the engine's own check_key
  // convention (minus scene_id -- these refs are scene-scoped and reset on
  // scene change instead, see below).
  const lastDiffedSceneIdRef = useRef<string | null | undefined>(undefined);
  const prevCheckStatesRef = useRef<Map<string, string | undefined>>(new Map());
  const explainedResolvedKeysRef = useRef<Set<string>>(new Set());
  const ownResolvedCheckKeysRef = useRef<Set<string>>(new Set());

  const diffAndExplainResolvedChecks = useCallback(
    (g: GroundingData | null | undefined) => {
      const sceneId = g?.scene_id ?? null;
      if (sceneId !== lastDiffedSceneIdRef.current) {
        // Scene changed (or this is the very first call this mount) --
        // a check sharing the SAME skill+dc key in a DIFFERENT scene is a
        // different authored check entirely; start every ref fresh so
        // nothing carries over across the boundary. This also means the
        // very first diff of a fresh scene never spuriously "explains" a
        // check that was already resolved before this client ever looked
        // -- an empty prevCheckStatesRef means nothing counts as a
        // transition on that first pass (see `wasSeenBefore` below).
        lastDiffedSceneIdRef.current = sceneId;
        prevCheckStatesRef.current = new Map();
        explainedResolvedKeysRef.current = new Set();
        ownResolvedCheckKeysRef.current = new Set();
      }

      const prev = prevCheckStatesRef.current;
      const next = new Map<string, string | undefined>();
      for (const c of g?.checks ?? []) {
        if (!c || typeof c.skill !== 'string') continue;
        const key = `${c.skill}-${c.dc}`;
        next.set(key, c.state);
        const wasSeenBefore = prev.has(key);
        const wasResolved = prev.get(key) === 'resolved';
        const isResolved = c.state === 'resolved';
        // Double-append guard: `explainedResolvedKeysRef` is checked AND
        // set synchronously in the same pass as the transition check, so
        // even if two grounding fetches raced (both reading the same
        // pre-update `prev`), only the first to actually execute this loop
        // body can win the append -- diffAndExplainResolvedChecks itself
        // never awaits mid-diff, so the two calls can't interleave.
        if (
          isResolved &&
          !wasResolved &&
          wasSeenBefore &&
          !ownResolvedCheckKeysRef.current.has(key) &&
          !explainedResolvedKeysRef.current.has(key)
        ) {
          explainedResolvedKeysRef.current.add(key);
          appendLog({
            who: 'Suzu',
            kind: 'system',
            text: `✦ The ${titleCaseSkill(c.skill)} approach resolves.`,
          });
        }
      }
      prevCheckStatesRef.current = next;
    },
    [appendLog],
  );

  const refreshGrounding = useCallback(async (): Promise<GroundingData | null> => {
    if (!sessionId) return null;
    const g = await getGrounding(sessionId).catch(() => null);
    setGrounding(g);
    diffAndExplainResolvedChecks(g);
    return g;
  }, [sessionId, diffAndExplainResolvedChecks]);

  /**
   * DM-ARRIVAL-NARRATION — the last scene an arrival line was played for.
   *
   * Two independent code paths refresh grounding after an advance (onMoveOn,
   * and narrate()'s `sceneAdvancedSignal`), and the durable events poll can
   * refetch on the same transition, so the naive version double-plays the
   * line. Keyed on the SCENE rather than latched once per mount on purpose:
   * a genuine re-entry into a scene later in the session is a real arrival and
   * should play again — only the same seam replayed back-to-back is suppressed.
   */
  const lastArrivalSceneRef = useRef<string | null>(null);

  /**
   * DM-ARRIVAL-NARRATION — play the destination scene's authored arrival line,
   * deterministically. Returns true when it actually rendered one.
   *
   * WHY THIS EXISTS: the beat that CAUSES a scene advance is grounded on the
   * scene being LEFT. On the server-INTENT path the narration is generated
   * before the advance decision even exists, so the 2026-07-29 feel-check's
   * "I keep running towards the light" narrated the chase — correctly — while
   * the scene card had already flipped to The Keeper of the Wood. The journey
   * prose was never the bug; the ARRIVAL was missing, and no prompt tuning can
   * add it after the fact. So the arrival is authored content played verbatim,
   * with no model call: it cannot be displaced, cannot hallucinate, and costs
   * nothing at a seam where the session is already paying 65-156s a turn.
   *
   * Rendered as Suzu narration rather than `read_aloud`: that label is the
   * session-OPENING scene-set register (the full boxed_text block). An arrival
   * line is a narration beat that happens to be authored, and the player has
   * no reason to be shown the difference.
   *
   * Takes the grounding EXPLICITLY (never the `grounding` closure) — every
   * caller has just awaited refreshGrounding(), and setGrounding() is async,
   * so the closure value is still the scene we just left.
   *
   * KNOWN GAP, deliberate: the durable events poll is NOT a caller. It
   * refetches grounding for several reasons that are not advances (a
   * classifier-opened beat gate on the SAME scene, most of all), so calling
   * this from there would fire an arrival line mid-scene the first time any of
   * them happened. `DURABLE_GENERATION_ENABLED` is false, so narrate()'s SSE
   * signal and onMoveOn are the live advance paths and this is currently
   * complete; whoever flips that flag must add an advance-specific call there
   * (keyed on the scene_advance event, not on `invalidatesGrounding`).
   */
  const playArrivalLine = useCallback(
    (g: GroundingData | null): boolean => {
      const line = g?.arrival_line;
      const sceneId = g?.scene_id;
      if (typeof line !== 'string' || !line.trim()) return false;
      if (sceneId && lastArrivalSceneRef.current === sceneId) return false;
      lastArrivalSceneRef.current = sceneId ?? null;
      appendLog({ who: 'Suzu', kind: 'narration', text: line });
      return true;
    },
    [appendLog],
  );

  /**
   * Contract C3 (COMBAT-UX-FOLLOW-UP-1: rescue narration jarring, pinned
   * 2026-08-11) — the deterministic scripted rescue-transition line, built
   * on the SAME "authored content played verbatim" pattern as
   * `playArrivalLine` just above (the Backlog names it explicitly: "the
   * arrival-line pattern"). WF-A owns the engine mechanism that will
   * populate `C3_GROUNDING_FIELD` on `current_scene` (see that constant's
   * doc comment in `src/lib/api/dnd.ts` for the provisional-field-name
   * containment strategy) and has not shipped it yet — zero commits on
   * their side as of this pass — so this is currently INERT by construction,
   * the same bootstrapping state `playArrivalLine` itself started in.
   *
   * Bridges the gap `COMBAT-UX-FOLLOW-UP-1` describes: the DM's prose
   * currently continues the fight straight into the destination scene with
   * no acknowledgement of HOW the party got there (a rescue, not a walk),
   * which is a different narrative beat than "arriving" and is therefore
   * played as its OWN log row — it does not replace or gate
   * `playArrivalLine`; both may render for the same transition.
   *
   * Validator/consumer contract (client side of it): non-empty, ≤400 chars
   * (mirrors `opening_lines`'/`arrival_line`'s own engine-side ceiling — this
   * component re-checks it because C3 has no shipped engine validator yet to
   * rely on), and an explicit `null` degrades to absent exactly like
   * `arrival_line` (handled upstream in `normalizeGrounding`'s `typeof
   * === 'string'` guard, not re-checked here).
   */
  const lastRescueLineSceneRef = useRef<string | null>(null);
  const playRescueTransitionLine = useCallback(
    (g: GroundingData | null): boolean => {
      const line = g?.[C3_GROUNDING_FIELD];
      const sceneId = g?.scene_id;
      if (typeof line !== 'string' || !line.trim()) return false;
      // Kage SUGG-3 (2026-08-12): an over-ceiling authored line is dropped
      // SILENTLY below — from the author's seat "the feature just doesn't
      // appear", with nothing in the console pointing at why. Warn, scoped to
      // the actual length-drop branch only (not the absent/blank cases above,
      // which are the ordinary "no rescue line authored" path, not a defect).
      if (line.length > 400) {
        console.warn(
          `[C3] rescue-transition line for scene "${sceneId ?? 'unknown'}" is ${line.length} chars (ceiling 400) — dropped, not rendered.`,
        );
        return false;
      }
      if (sceneId && lastRescueLineSceneRef.current === sceneId) return false;
      lastRescueLineSceneRef.current = sceneId ?? null;
      appendLog({ who: 'Suzu', kind: 'narration', text: line });
      return true;
    },
    [appendLog],
  );

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
   * Phase 4 (Sora-Arch design §4 Fork 3; Miko-QA "the sleeper bug" fix) —
   * surface an `offered_check` signal from EITHER narration path: the
   * legacy/flag-OFF SSE beat (`narrate()`, below) or the durable
   * session-events poll (`pollDurable`, defined further UP in this
   * component — a genuine forward reference, safe because that effect only
   * INVOKES this closure well after the whole component body has finished
   * executing for this render; see the `openScene` comment near the mount
   * effect above for the identical established pattern). NEVER auto-rolls —
   * only makes the matching "Attempt {skill}" affordance impossible to
   * miss: either the authored highlighted chip (`offeredCheckSkill`), or —
   * the sleeper-bug fix — a dedicated freeform "Attempt {skill}" button
   * (`freeformOfferedCheck`) when the offered skill isn't one of THIS
   * scene's authored checks. The two are mutually exclusive; this function
   * is the ONLY writer of either, so every call sets exactly one and clears
   * the other.
   */
  const applyOfferedCheckSignal = useCallback(
    (signal: OfferedCheck, currentGrounding: GroundingData | null) => {
      const isAuthoredCheck = (currentGrounding?.checks ?? []).some(
        (c) => c.skill === signal.skill,
      );
      setOfferedCheckSkill(isAuthoredCheck ? signal.skill : null);
      setFreeformOfferedCheck(isAuthoredCheck ? null : signal.skill);
      toast({
        tone: 'info',
        message: `Suzu invites a ${titleCaseSkill(signal.skill)} check — the Attempt button is ready when you are.`,
        duration: 8000,
      });
      requestAnimationFrame(() => {
        (isAuthoredCheck ? checkWrapRef : freeformCheckRef).current?.scrollIntoView({
          block: 'nearest',
        });
      });
    },
    [toast],
  );

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
      // Drop any partial live-narration row left over from an aborted beat so
      // this beat starts a fresh bottom-of-chat row (never overwrites the old).
      clearStreamNarration(true);
      // P1-PLAYFIX-2 §A.6 — clear any stale offer from a previous beat; THIS
      // turn's response (if any) re-sets it below. Phase 4: clears the
      // freeform sibling too — `applyOfferedCheckSignal` is the only writer
      // of either, but only ONE beat's worth of clearing needs to happen
      // here regardless of which one a prior beat set.
      setOfferedCheckSkill(null);
      setFreeformOfferedCheck(null);

      const isOpening = opts?.kind === 'opening';

      const transcript = logRef.current.slice(-8).map((r) => `${r.who}: ${r.text}`);
      let full = '';
      let errored = false;
      let lastErrorReason: string | undefined;
      let offeredCheckSignal: OfferedCheck | undefined;
      let sceneAdvancedSignal = false;
      // TAV-S1-ABORT-CLEAR: this beat's OWN streaming row id, captured right
      // after upsertStreamNarration creates/updates it. A successor beat
      // always clears + replaces streamRowIdRef before this one's abort
      // check runs, so comparing against the CURRENT ref (not just clearing
      // unconditionally) tells us whether a successor has already claimed
      // it — clearing unconditionally here could otherwise delete a
      // successor's brand-new row instead of this beat's own.
      let ownStreamRowId: string | null = null;
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
            // TAV-COMPOSING (Phase 1, 2026-07-26) — same re-timing as
            // subscribeToJob above: don't clear on the bare event, clear once
            // real content is actually visible. The streamMode branch below
            // upserts the real accumulated text directly (no gap); the
            // buffered/revealText branch fake-types word-by-word starting
            // from '', so it clears itself internally once its first
            // non-empty tick paints (see revealText's own definition) —
            // clearing it here too would flash the indicator off during that
            // empty first tick, right as ChatLog's empty-anchor guard also
            // hides the row, leaving nothing on screen for one 26ms tick.
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
              // Tora CRITICAL-1 (resurrection race): `readSSE` only checks
              // `signal.aborted` once per `reader.read()` chunk, not per SSE
              // event — a single network read can carry 2+ buffered events,
              // so a stale/superseded beat's `for await` body can still run
              // AFTER a successor has synchronously aborted `ctrl` (and
              // cleared `streamRowIdRef`). `ctrl.signal.aborted` itself flips
              // synchronously the instant `.abort()` is called, regardless of
              // whether this async generator has noticed yet — so gating the
              // mutation on it (rather than relying solely on the post-loop
              // abort check) stops a stale beat from ever re-minting/adopting
              // a row after it's been superseded. Do NOT snapshot
              // `ownStreamRowId` in the aborted branch — this beat no longer
              // owns any row.
              if (!ctrl.signal.aborted) {
                // Mirror the live stream into a growing bottom-of-chat row.
                upsertStreamNarration(full);
                // TAV-S1-ABORT-CLEAR: snapshot the row id THIS beat owns right
                // after the synchronous upsert sets it.
                ownStreamRowId = streamRowIdRef.current;
                // TAV-COMPOSING — real accumulated text lands directly (no
                // fake-typewriter lag), so clear as soon as it's non-empty.
                if (full.trim() !== '') setThinking(false);
              }
            } else {
              // Flag-OFF / buffered path — fake-reveal, now driving the chat
              // streaming row directly (revealText, TAV-NARRATION-DECOUPLE)
              // instead of the removed narratorText bar. revealText itself
              // clears `thinking` once its first non-empty tick paints (see
              // its own TAV-COMPOSING comment) — do NOT also clear it here.
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

      if (ctrl.signal.aborted) {
        // TAV-S1-ABORT-CLEAR: an aborted beat with no successor would
        // otherwise leave a dangling aria-hidden streaming row that nothing
        // will ever finalize. Only clear if streamRowIdRef STILL points at
        // this beat's own row — if a successor beat already claimed/
        // replaced it (the normal supersede path), leave it alone.
        if (shouldClearAbortedStreamRow(streamRowIdRef.current, ownStreamRowId)) {
          clearStreamNarration(true);
        }
        return;
      }
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
        return;
      }

      if (streamRowIdRef.current) {
        // Kage-CR CRITICAL (review pass) — the buffered/non-streamMode path
        // drives its streaming row via revealText's setInterval (26ms
        // ticks), which is independent of the SSE loop above: a `done`
        // event can race ahead of the interval's next tick (e.g. the whole
        // beat's text is short, or `done` simply arrives before the next
        // 26ms boundary). Without clearing it HERE, that pending interval
        // fires AFTER finalizeStreamNarration below has already nulled
        // `streamRowIdRef` — its next `upsertStreamNarration` call then sees
        // no existing id and CREATES a brand-new (orphaned, aria-hidden)
        // streaming row that nothing ever finalizes, double-rendering
        // Suzu's prose. Truncating the reveal here (showing the full text
        // immediately instead of finishing the animation) is an acceptable
        // degradation — same "pops in whole" tradeoff already accepted for
        // the durable poll-claim race — the invariant that matters is
        // exactly ONE row. The streamMode branch above (~2091) already
        // clears this same ref for the identical reason; this mirrors it.
        if (revealRef.current) {
          clearInterval(revealRef.current);
          revealRef.current = null;
        }
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
        // DM-ARRIVAL-NARRATION — on THIS path the arrival line FOLLOWS the
        // beat rather than replacing it, and that is not a compromise: the
        // narration above was generated from the scene being LEFT, so it
        // legitimately narrates the player's journey ("I keep running towards
        // the light" -> the chase). What went missing on 2026-07-29 was the
        // landing, while the scene card had already flipped. Playing the
        // authored arrival here is what lets the prose catch up to the card.
        // Replacing it is not even available: the prose has already streamed.
        // C3 — the rescue-transition line (if any) plays FIRST: it narrates
        // how the party got here, `playArrivalLine` narrates arriving. Both
        // are independent authored beats for the same landing.
        playRescueTransitionLine(freshGrounding);
        playArrivalLine(freshGrounding);
      }

      // P1-PLAYFIX-2 §A.5/§A.6 — surface an offered check. Per §A.3 this NEVER
      // auto-rolls; it only makes the matching "Attempt {skill}" affordance
      // impossible to miss. Phase 4 (Miko-QA "the sleeper bug" fix):
      // `applyOfferedCheckSignal` no longer DROPS an offer whose skill isn't
      // one of this scene's authored checks — it routes to the freeform
      // "Attempt {skill}" affordance instead (`freeformOfferedCheck`).
      if (offeredCheckSignal) {
        // Iro MAJOR-1: validate against the freshly-fetched grounding when
        // this beat just advanced the scene — the `grounding` closure value
        // is stale until the next render (setGrounding() is async), so
        // validating against it here would wrongly treat a check authored on
        // the scene we JUST advanced to as unauthored/freeform.
        const currentGrounding = sceneAdvancedSignal ? freshGrounding : grounding;
        applyOfferedCheckSignal(offeredCheckSignal, currentGrounding);
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
      applyOfferedCheckSignal,
      playArrivalLine,
      playRescueTransitionLine,
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
        // precreateRow: true — this IS an originating (composer) subscribe,
        // just pivoted onto another client's job (TAV-NARRATION-DECOUPLE
        // Phase 2).
        void subscribeToJob(handle.job_id, `busy:${handle.job_id}`, handle.trigger_seq, 'composer', true);
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
      // precreateRow: true (TAV-NARRATION-DECOUPLE Phase 2) — the common
      // "type + send" path; pre-create the streaming anchor so the poll
      // always replaces (rule 3 sub-case a) instead of popping in whole.
      void subscribeToJob(handle.job_id, turnKey, undefined, 'composer', true);
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
        // precreateRow: true — originating (beat) subscribe pivoted onto
        // another client's job (TAV-NARRATION-DECOUPLE Phase 2).
        void subscribeToJob(handle.job_id, `busy:${handle.job_id}`, handle.trigger_seq, 'beat', true);
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
      // precreateRow: true (TAV-NARRATION-DECOUPLE Phase 2) — synthetic
      // beats originate client-side too; pre-create so the poll replaces
      // instead of popping in whole.
      void subscribeToJob(handle.job_id, turnKey, undefined, 'beat', true);
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
      // Kage-CR final round: recognise `code === 'unauthorized'` alongside a
      // direct 401/403, not a hand-copied status list — that code is
      // client.ts's UNIFIED refresh-failure classification (items 2/3:
      // 0/>=500/429 -> 'refresh_unavailable', everything else ->
      // 'unauthorized', including a refresh 422 from flask-jwt-extended's
      // default invalid-signature handler). Checking only status here would
      // let a 422-classified dead session fall through to the generic inline
      // error below instead of the sign-in redirect.
      const e = err as { status?: number; code?: string } | null;
      if (e?.status === 401 || e?.status === 403 || e?.code === 'unauthorized') {
        // Cookie expired — redirect to login per existing pattern.
        window.location.href = '/login';
        return;
      }
      // 5xx / network / refresh_unavailable: preserve text, show inline error.
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
      // UIR2-TAV-25 (CSS/overlap part): no success toast here. The
      // full-width, permanently-mounted xCardBanner set above already shows
      // "A safety signal was raised — the table eases off." the instant
      // xCardEvent updates — a second, DIFFERENT-toned corner toast saying
      // nearly the same thing was redundant AND is what caused the reported
      // overlap: the global Toast viewport is position:fixed bottom-right
      // (Toast.module.css), which sits directly over this pane's Safety
      // block/X-card button at desktop widths, and (being on its own 5s
      // timer, decoupled from xCardEvent/dismissedXCardSeq) could still be
      // visibly present after the raiser had already dismissed the banner —
      // reading as "persists after dismissed". The banner is the single
      // source of truth for this signal now; only a genuine failure (below)
      // still needs a one-off toast, since no banner event exists to show.
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
    async (toScene: string | null) => {
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
        // TAV-SLICE-END-ADVANCE-NULL (engine d41351f): the terminal-transition
        // shape is `completed: true` (always paired with `to_scene: null`) —
        // there is no destination scene because the adventure just ended.
        // Check `completed` directly rather than inferring it solely from
        // `to_scene === null`; OR both so a future engine revision that sent
        // one without the other (neither observed today) still degrades to
        // the completion branch rather than silently rendering the literal
        // "→ null" it exists to prevent.
        const isAdventureComplete = result.completed === true || result.to_scene === null;
        if (isAdventureComplete) {
          setAdventureComplete(true);
          // T4p2: render-only — capture the completion payload's series
          // pointer (design doc §6.4) if the engine sent one. Never gates
          // or alters any existing branch above/below; a response without
          // `series` (older engine, SUZU_DND_SERIES off, or genuinely not
          // in a series) just leaves this null and NextPartOffer renders
          // nothing.
          const firstSeries = result.series?.[0];
          if (firstSeries) {
            setCompletionSeries({
              series: firstSeries,
              next: result.next_adventure ?? null,
            });
          }
        }
        appendLog({
          who: 'Suzu',
          kind: 'system',
          text: isAdventureComplete
            // ⚖ neutral placeholder pending a product call on the real
            // completion copy — chosen here, not litigated by the backlog row.
            ? 'The adventure is complete.'
            : `The scene shifts: ${result.from_scene} → ${result.to_scene}`,
        });
        const advancedGrounding = await refreshGrounding();
        refocusSceneHeadIfStranded(hadFocusInTransitionWrap);
        // DM-ARRIVAL-NARRATION (Leon's ruling 2026-08-09: REPLACE the beat).
        // When the destination authors an arrival line, it IS the transition
        // narration and the synthetic beat below is skipped entirely — that
        // beat's player message is the literal string "We move on.", which no
        // player said, so there is nothing here for a model to react to that
        // authored prose does not do better, instantly, at a seam that
        // otherwise costs a full 65-156s turn. Scenes with no arrival line
        // fall through to exactly today's behaviour, so nothing authored
        // before this change moves.
        // C3 — plays first, same as the server-INTENT path above; does NOT
        // participate in the "replace the synthetic beat" ruling below (that
        // is scoped to `arrival_line` specifically), so it never gates the
        // `return`.
        playRescueTransitionLine(advancedGrounding);
        if (playArrivalLine(advancedGrounding)) return;
        // Kage #1 / Miko DEFECT-2: advanceScene() already moved the
        // scene server-side — suppress the INTENT classifier from advancing
        // it a second time off this confirmation beat.
        const transitionContext = isAdventureComplete
          ? `Scene advance: ${result.from_scene} → the adventure concludes. Narrate the ending.`
          : `Scene advance: ${result.from_scene} → ${result.to_scene}. Narrate the transition.`;
        if (DURABLE_GENERATION_ENABLED) {
          void narrateDurableBeat(
            'We move on.',
            transitionContext,
            'act',
            { suppressIntent: true, beat: 'scene_advance' },
          );
        } else {
          void narrate(
            'We move on.',
            transitionContext,
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
      playArrivalLine,
      playRescueTransitionLine,
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
        // F4/CHECK-DOUBLE-RENDER: seed the durable reconcile ledger with this
        // check's own event_seq BEFORE the next poll tick can observe the
        // same check_resolved event and re-append it — reconcileDurableEvents'
        // rule 1 (renderedSeqs.has(seq), reconcileEvents.ts) is what skips
        // the poll's duplicate once seeded; rule 5 (unconditional append for
        // check_resolved) is CORRECT for every OTHER client, this optimistic
        // append is the reason THIS client must pre-seed its own copy of the
        // dedup set. Flag-gated: renderedSeqsRef is only ever read from
        // pollDurable, itself reachable only when DURABLE_GENERATION_ENABLED
        // (see the ref's own declaration comment above) — seeding flag-OFF
        // would be inert but the dormancy contract is byte-identity, so gate
        // explicitly rather than relying on "nobody reads it anyway". Graceful
        // degrade: a null/absent event_seq (should not happen on the real
        // wire per ResolveCheckResult's own doc, but the type allows it)
        // simply skips the seed — the optimistic row below still renders
        // once either way, it just isn't deduped against a future poll
        // observation of the same event.
        if (DURABLE_GENERATION_ENABLED && result.event_seq != null) {
          renderedSeqsRef.current.add(result.event_seq);
        }
        appendLog({
          who: username,
          kind: 'system',
          text: result.description,
          ...(DURABLE_GENERATION_ENABLED && result.event_seq != null
            ? { seq: result.event_seq }
            : {}),
        });
        // Check Retry + Fail-Forward Iro-A11y MAJOR-1 (2026-07-28): mark this
        // key as "resolved via my own click" BEFORE refreshGrounding() below
        // runs the disappearance-explanation diff, so it skips explaining a
        // resolution *I* just caused -- I get the toast + silent row instead
        // (below), not the spectator-facing explanation row.
        if (result.success && result.flag_set.length > 0) {
          ownResolvedCheckKeysRef.current.add(`${skill}-${result.dc}`);
        }
        // refreshGrounding() BEFORE narrate() so the scene card / check row are
        // already current when Suzu's beat lands (the engine may have set a
        // flag and/or auto-advanced the scene — never assumed from `result`).
        await refreshGrounding();
        refocusSceneHeadIfStranded(hadFocusInCheckWrap);
        // Check Retry + Fail-Forward (2026-07-28 design section 7.3): the
        // "zero success signal" half of the cold-open bug report -- a check
        // that resolves successfully AND sets a flag gets an explicit
        // payoff. This also doubles as the explanation for why the button
        // is about to vanish from availableChecks (section 7.2's
        // hide-resolved a11y mitigation) once refreshGrounding() above
        // lands, rather than reading as a silent glitch.
        if (result.success && result.flag_set.length > 0) {
          toast({ tone: 'success', message: 'The way forward opens.' });
          // Iro-A11y MAJOR-2 (2026-07-28): `silent: true` keeps this row in
          // the transcript for sighted/scrollback readers but hides it from
          // ChatLog's own aria-live region -- without it, the SAME beat
          // announced through two independent aria-live="polite" regions
          // (the toast above, and this row) double-announces to a screen
          // reader. The toast is the one spoken channel for the acting
          // client; MAJOR-1's disappearance-explanation row (below) is the
          // spoken channel for everyone else at the table.
          appendLog({
            who: username,
            kind: 'system',
            text: '✦ The way forward opens.',
            silent: true,
          });
        }
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
        // F1/CAST-FAIL-SILENT: curated map wins for the known reasons.
        //
        // CORRECTION (2026-08-06, Kage-CR #3): this comment used to claim that
        // an unmapped 4xx refusal "now surfaces the engine's own ready-to-show
        // message". It does not, and has not since the proxy was written —
        // `api/routes/dnd_sessions.py::_handle_dnd_error` renames the engine's
        // `message` to `error`, and `engineErrorMessage`'s tier-2 branch probes
        // `body.message`. So refusals like 404 "Session not found." or 400
        // "Unknown skill 'x'." fall to the bare fallback below. Left as-is
        // rather than papered over with more curated copy: the real fix is
        // NEKONOVA-PROXY-DROPS-MESSAGE, filed for Leon. See engineReasons.ts
        // for the per-module breakdown.
        const fallback = 'Could not resolve that check.';
        const message = engineErrorMessage(err, {
          fallback,
          reasonMap: {
            no_such_check: `No ${skillLabel} check is available right now.`,
            freeform_session: 'No authored adventure to check against.',
            msm_disabled: 'Skill checks are not available right now.',
            // Check Retry + Fail-Forward (2026-07-28 design section 7.5):
            // curated copy wins over the engine's own 409 message (which
            // carries the narration-facing complication prose instead --
            // see engineError.ts's precedence).
            check_locked: 'That approach is closed — find another way.',
            check_resolved: "You've already settled that one.",
          },
        });
        toast({ tone: message === fallback ? 'error' : 'info', message });
        // Tora-Gesture MAJOR-1 (2026-07-28): a check_locked/check_resolved
        // 409 means THIS client's grounding is stale relative to the server
        // -- the button that just refused is still rendered plainly
        // "available" and stays clickable, inviting an identical re-click/
        // re-toast with zero self-correction until the next ~4s poll tick.
        // Self-correct immediately for these two reasons ONLY, mirroring the
        // success path's own refresh+refocus above -- every other reason
        // (no_such_check/freeform_session/msm_disabled/unmapped) is a
        // session- or scene-level refusal, not a per-check staleness
        // signal, so those keep the current (no-refresh) behaviour.
        const reason = isApiError(err) ? extractReason(err) : undefined;
        if (reason === 'check_locked' || reason === 'check_resolved') {
          await refreshGrounding();
          refocusSceneHeadIfStranded(hadFocusInCheckWrap);
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
      // combat_from_scene's 400/409 refusals (NekoNova-DnDEngine
      // routes/combat.py) set no data.reason, only a ready-to-show `message`
      // ("No encounter available for the current scene.", "A combat is already
      // active for this session.", …).
      //
      // CORRECTION (2026-08-06, Kage-CR #3): this comment used to say "the
      // 4xx-business branch below is what actually surfaces it". It doesn't —
      // `api/routes/dnd_combat.py::_handle_dnd_error` renames `message` to
      // `error` and tier-2 probes `body.message`, so every one of those
      // refusals currently shows the bare fallback. Real fix is
      // NEKONOVA-PROXY-DROPS-MESSAGE (filed); not patched over with curated
      // copy here because the engine's text is already the right words.
      toast({
        tone: 'error',
        message: engineErrorMessage(err, {
          fallback: 'Could not start combat.',
          // Kage-CR #4: reuse, don't re-type. A second literal of this string
          // in a batch whose whole point is one home for reason copy would
          // drift the moment either is reworded.
          reasonMap: { msm_disabled: COMBAT_REFUSAL_REASON_MAP.msm_disabled },
        }),
      });
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
            // F1/CAST-FAIL-SILENT: engineErrorMessage always returns a
            // non-empty string (curated reason, else the engine's own 4xx
            // message, else the fallback) — a bare "no data.reason" refusal
            // (e.g. a 404 "Combat or session not found." with no reason
            // code) used to fall through to `setRefusedReason(null)` here,
            // silently clearing the banner with nothing shown at all.
            setRefusedReason(
              engineErrorMessage(err, {
                // NOT "did not land" — that is the language of a MISSED attack
                // roll and was read as one. NOT "try again" either: the most
                // common refusal here (a spent action) cannot succeed until the
                // turn ends. This fires only for network/abort or a refusal
                // carrying no reason code at all.
                fallback: "That combat action didn't go through.",
                reasonMap: COMBAT_REFUSAL_REASON_MAP,
              }),
            );
            const body = (err as { body?: unknown } | null)?.body;
            const data = (body as { data?: { state?: CombatState } } | null)?.data;
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
        } else if (action === 'deathsave') {
          // Combat-UX Fixes 2026-07-27, Fix B: solo self-resolve — omit
          // target/target_id, cmd_deathsave resolves the caller's own downed
          // character first.
          const res = await combatDeathSave({ username, combat_id: combatId });
          newState = res.state ?? null;
          message = res.message ?? 'You roll a death save.';
          playerLine = 'I roll a death save.';
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
        // F1/CAST-FAIL-SILENT: same chokepoint as the attack sub-branch
        // above — always surfaces SOMETHING (curated/engine-message/
        // fallback), so a dodge/dash/endturn refusal with no reason code no
        // longer falls silently through the old `if (reason) … else toast`
        // split with nothing shown for the in-between case.
        setRefusedReason(
          engineErrorMessage(err, {
            // NOT "did not land" — that is the language of a MISSED attack
            // roll and was read as one. NOT "try again" either: the most
            // common refusal here (a spent action) cannot succeed until the
            // turn ends. This fires only for network/abort or a refusal
            // carrying no reason code at all.
            fallback: "That combat action didn't go through.",
            reasonMap: COMBAT_REFUSAL_REASON_MAP,
          }),
        );
        const body = (err as { body?: unknown } | null)?.body;
        const data = (body as { data?: { state?: CombatState } } | null)?.data;
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
      const result = await endSession(sessionId, { username, channel: session.channel });
      await refreshSessionAfterAction();
      // F5/LEVELUP-NO-MOMENT (D3 — END-SESSION-ONLY scope): refetch the
      // roster so a leveled-up character's stale level in PartyPanel is
      // corrected. Deliberately scoped to THIS handler, not folded into the
      // shared refreshSessionAfterAction above (which ALSO runs on pause/
      // resume/award-XP, where a party refetch would be unnecessary chatter
      // every time — see play.ddx25-session-controls's own regression pin on
      // those handlers' getParticipants call count). Non-fatal on failure:
      // the roster just stays stale until a future natural refresh; the
      // "Session ended." toast below still fires either way (the session DID
      // end) — never a double-toast for this secondary read.
      try {
        const party = await getParticipants(sessionId);
        setParticipants(party);
      } catch {
        // Swallowed — see comment above.
      }
      const summary = levelUpsSummary(result.level_ups ?? []);
      toast({
        tone: 'success',
        message: summary ? `Session ended. ${summary}` : 'Session ended.',
      });
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
  // F2/CAST-DEAD-TARGET: shared with CastSpellPanel's own target picker via
  // isLivingTargetableFoe (src/lib/dnd/combatTargets.ts) — Cast layers a
  // heal-downed-ally exception on top of the same base rule instead of
  // re-deriving it.
  const targetableFoes: CombatTarget[] = combatState
    ? combatState.participants
        .filter(isLivingTargetableFoe)
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

  // Combat-UX Fixes 2026-07-27, Fix B: the gate for the "Roll death save"
  // affordance — the viewer's own PC, on their turn, at 0 HP, not stable, not
  // dead (death_saves.is_dying already encodes exactly that on the wire).
  // Narrower than "downed" — a stabilised-but-still-0-HP PC is is_downed but
  // no longer is_dying, so the rail correctly stops offering the roll once
  // 3 successes land.
  const isDying = activeIsMine && activeParticipant?.death_saves?.is_dying === true;

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

  // Round from combatState is authoritative; fall back to 1 when no state yet.
  const round = combatState?.round ?? null;

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
  // auto-starts).
  const sceneHasEncounter = grounding?.encounter != null;

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
  }, [combatId, sceneHasEncounter]);

  // P1-PLAYFIX-2 §A.3: memoized (not a plain const) — the new onSend
  // keyword-fast-path useCallback below depends on this array, and a fresh
  // array literal every render would recreate onSend every render too.
  const availableTransitions = useMemo(
    () =>
      (combatState?.state !== 'active' && grounding?.transitions)
        ? grounding.transitions.filter((t) => {
            // NOTE (TAV-SCENE-TRANSITION-LEAKS-FLAG-SLUG, 2026-08-06): flag
            // gating is deliberately NOT done here. The engine owns it —
            // `engine/beats.py::available_transitions` evaluates a transition's
            // `requires: [flag, ...]` list and `routes/sessions.py` replaces
            // `current_scene["transitions"]` with that filtered subset before
            // grounding reaches the wire, so a flag-gated exit never arrives
            // here at all. A client-side copy would be dead code AND would
            // diverge from what the narrator sees (Suzu reads the same
            // server-filtered list). Seed adventures must spell the gate
            // `requires`, never the dead `requires_flag` key —
            // tests/test_seed_adventure_authoring.py enforces both.
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

  // P1-PLAYFIX §3.3.3 (S2.4) — authored skill checks for the current scene.
  // Same combat gating as "Move on": hidden during active combat (checks are
  // an exploration-beat affordance). P1-PLAYFIX-2 §A.3: memoized for the same
  // reason as availableTransitions above.
  //
  // D1a (Leon, product decision, 2026-07-19): ALL of the active scene's
  // authored checks now surface as first-class, player-invoked affordances —
  // no longer gated behind a narrator invite. A player can proactively
  // attempt any authored check for the scene without waiting for Suzu to
  // name it first. The check Suzu DOES invite this turn is still visually +
  // accessibly highlighted (`isOffered`, in the render loop below) —
  // `offeredCheckSkill` is now purely a highlight signal, not a visibility
  // gate. Deduped by skill+dc (a scene could theoretically list the same
  // check twice) and left in the scene's own authored order — no sort.
  // Generic quick-checks (separate panel) remain always-available player
  // agency and are NOT gated here either; the two panels are independent.
  //
  // Rehydration (fresh mount / reload mid-scene): grounding.checks comes
  // straight off the scene's authored data, unlike `offeredCheckSkill`
  // (ephemeral SSE-only, see src/lib/stream.ts — never written into a
  // durable session_events row, src/lib/rehydration.ts eventToLogRow) — so
  // the check buttons render correctly on a bare reload; only the
  // highlight is lost until Suzu next reasserts an invite.
  const availableChecks = useMemo(() => {
    if (combatState?.state === 'active') return [];
    const raw = grounding?.checks ?? [];
    const seen = new Set<string>();
    const deduped: SceneCheck[] = [];
    for (const c of raw) {
      // Check Retry + Fail-Forward (2026-07-28 design section 7.1/7.2): a
      // resolved check is removed from the rail entirely (Leon's pick --
      // a checkmarked row of dead buttons accumulates into visual debt).
      // `state` absent (pre-CHECK-RETRY server, flag off) always passes
      // through unchanged. `locked` deliberately stays in the list --
      // rendered disabled with a reason below, not hidden ("a vanished
      // button reads as a bug; a closed door reads as a consequence").
      // One filter here covers BOTH render surfaces (.checkWrap + the
      // chip row), since both derive from this same memo.
      if (c.state === 'resolved') continue;
      const key = `${c.skill}-${c.dc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(c);
    }
    return deduped;
  }, [combatState?.state, grounding]);

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
  const combatIsActive = !!combatId && combatState?.state !== 'ended';

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
  // F3/COMBAT-NO-AUTO-RESOLVE: advisory (never blocking) — surfaced when the
  // last hostile drops mid-combat. Reuses `targetableFoes` (isLivingTargetableFoe,
  // src/lib/dnd/combatTargets.ts), the SAME signal the attack rail's own
  // target picker already computes, rather than re-deriving "any living
  // enemy" a second way. Gated on state==='active' explicitly (not just
  // emptiness) — targetableFoes is ALSO empty before combat starts and after
  // it ends, for a different reason; this must not fire in either case.
  const allHostilesDown = combatState?.state === 'active' && targetableFoes.length === 0;
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
      {/* TAV-PLAY-LANDMARKS: stable landmark name so AT landmark navigation
          announces "Party and initiative, complementary" instead of a bare
          "complementary". */}
      <aside
        id="play-pane-party"
        className={`${styles.pane} ${styles.left}`}
        aria-label="Party and initiative"
      >
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
                // TAV-A11Y-USE-ESCAPE-CONSUME-HOOK (was a hand-rolled
                // Miko-QA gate Finding 2 / UIR2-TAV-11 r2 fix):
                // stopPropagation is unconditional; only the actual dismiss
                // stays gated on sessionActionBusy==='xp' (an in-flight
                // award shouldn't be dismissable mid-request).
                onKeyDown={(e) =>
                  consumeEscape(e, {
                    onClose: () => setXpFormOpen(false),
                    canClose: sessionActionBusy !== 'xp',
                    onRefocus: () => xpToggleBtnRef.current?.focus(),
                  })
                }
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
            {/* LVL-1 (T5): floor display/edit + "Apply floor now". Peer of
                GrantCurrencyPanel — same isDm gate, same disabled
                expression, self-contained panel. onChanged refetches the
                session (new starting_level on the summary) AND the roster
                (leveled members' PartyPanel badges) — mirrors the
                end-session handler's paired refetch. */}
            <CampaignFloorPanel
              sessionId={sessionId}
              // Kage n5: isDm implies a resolved username, but '' would be
              // the wrong wire shape (engine Field(min_length=1) → 422, not
              // a clean _err) — send the real value, never a fallback.
              username={username as string}
              participants={participants}
              startingLevel={session?.starting_level ?? 1}
              disabled={sessionActionBusy !== null || isEnded}
              onChanged={() => {
                void refreshSessionAfterAction();
                getParticipants(sessionId)
                  .then(setParticipants)
                  .catch(() => {
                    /* non-fatal — roster refreshes on the next poll */
                  });
              }}
            />
          </div>
        )}
        <PartyPanel
          participants={participants}
          selfUsername={username}
          combatState={combatState}
          onSelectMember={onSelectMember}
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
        {/* S5.5: NarratorStrip (now a scene/combat status banner — see the
            component's own doc comment) hidden when ai_assist_level='off'.
            When hidden, the combat status pill is surfaced inline so turn/round info
            remains visible. */}
        {showSuzuPanel ? (
          <NarratorStrip
            talking={talking}
            sceneName={grounding?.scene_name ?? null}
            objective={grounding?.objective ?? null}
            combatActive={combatIsActive}
            round={round}
            turnStatusText={turnStatusText}
            initiativeOrder={narratorInitiativeOrder}
            status={narratorStatusPill}
          />
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
            viewer's own roster entry, independent of whose turn it is. */}
        {combatIsActive && isMyPcDead && (
          <div role="status" aria-live="polite" aria-atomic="true" className={styles.deadStatus}>
            Your character has died.
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
        {/* TAV-CHECK-DISCOVERABILITY (Phase-1 #6, Leon "option A"): the SAME
            `availableChecks` the right Scene panel's `.checkWrap` group
            renders (P1-PLAYFIX §3.3.3 above), surfaced a SECOND time right
            above the composer. During play the player is looking at the
            narration/composer, not the right-side panel, so the authored
            "Attempt {skill}" buttons live there get missed — this is purely
            a more-discoverable second PLACEMENT of the identical
            affordance: same `onAttemptCheck` handler, same
            checkBusy/talking/sessionLocked disabled gate, same
            `availableChecks` (including its combat-active gate in the
            useMemo above — untouched here; the flee-checks-during-combat
            question is deferred to Phase 4). The side-panel `.checkWrap`
            group is left completely as-is — this does not replace it.
            A11Y: `aria-hidden` on the wrapper + `tabIndex={-1}` on every
            chip keep screen-reader/keyboard users on the ONE canonical
            `.checkWrap` group instead of hitting "Attempt Survival, DC 15"
            twice in the tab order for the exact same action — sighted/
            mouse/touch users still see and can click these chips fine,
            since aria-hidden only affects the accessibility tree, not
            visual rendering or pointer events. */}
        {availableChecks.length > 0 && (
          <div className={styles.checkChipsWrap} aria-hidden="true">
            <span className={styles.checkChipsLabel}>Available checks</span>
            {availableChecks.map((c) => {
              const isOffered = c.skill === offeredCheckSkill;
              // Check Retry + Fail-Forward (2026-07-28 design section 7.1):
              // same locked/last-attempt derivation as the canonical
              // .checkWrap group below -- this row is aria-hidden (a
              // sighted/mouse-only duplicate placement), so no sr-only
              // reason span here; disabled + the visible label change are
              // still needed for sighted/touch users.
              const isLocked = c.state === 'locked';
              // Miko-QA Finding 5 (2026-07-28): require state === 'available'
              // explicitly, not just !isLocked -- a partial/malformed wire
              // payload (attempts_used/max_attempts present, `state` absent)
              // must not render "last attempt" just because it also isn't
              // literally 'locked'.
              const isLastAttempt =
                c.state === 'available' &&
                c.max_attempts != null &&
                c.attempts_used != null &&
                c.attempts_used > 0 &&
                c.max_attempts - c.attempts_used === 1;
              return (
                <button
                  key={`check-chip-${c.skill}-${c.dc}`}
                  type="button"
                  tabIndex={-1}
                  className={`${styles.checkChip} ${isOffered && !isLocked ? styles.checkChipOffered : ''} ${isLocked ? styles.checkBtnLocked : ''}`}
                  onClick={() => {
                    // Iro-A11y MAJOR-3/MAJOR-4 mirror: this row is already
                    // tabIndex={-1} + aria-hidden (excluded from keyboard/AT
                    // entirely), so the Tab-reachability half of the fix
                    // doesn't apply here -- but `isLocked` still needs to
                    // come out of native `disabled` for the SAME visual
                    // contrast reason (the generic :disabled opacity rule
                    // applies to sighted MOUSE users regardless of
                    // aria-hidden), which means the click needs the same JS
                    // guard a removed native `disabled` no longer provides.
                    if (isLocked) return;
                    void onAttemptCheck(c.skill);
                  }}
                  disabled={checkBusy || talking || sessionLocked}
                  title={c.note}
                >
                  <Icon name="Check" size={12} aria-hidden />
                  {isLocked
                    ? `${titleCaseSkill(c.skill)}, DC ${c.dc} — closed`
                    : `Attempt ${titleCaseSkill(c.skill)}, DC ${c.dc}${isLastAttempt ? ' — last attempt' : ''}`}
                </button>
              );
            })}
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
                onClick={(e) => {
                  lastOpenerRef.current = e.currentTarget;
                  setOutcomeChooserOpen((v) => !v);
                }}
                disabled={combatBusy}
                aria-busy={combatBusy}
                aria-haspopup="true"
                aria-expanded={outcomeChooserOpen}
                aria-label="End combat — choose outcome"
              >
                End
              </button>
            </div>
            {/* F3/COMBAT-NO-AUTO-RESOLVE: advisory-only prompt (never auto-
                resolves — the DM still picks victory/defeat/retreat/etc.).
                Opens the SAME outcome chooser as the "End" button above;
                never disables Dodge/Dash/End-Turn (those live in the
                composer's action rail, entirely untouched by this banner). */}
            {allHostilesDown && (
              <div className={styles.autoResolvePrompt} role="status" aria-live="polite">
                <Icon name="Skull" size={13} aria-hidden /> All enemies are down.
                <button
                  type="button"
                  className={styles.autoResolvePromptBtn}
                  onClick={(e) => {
                    lastOpenerRef.current = e.currentTarget;
                    setOutcomeChooserOpen(true);
                  }}
                  disabled={combatBusy}
                  aria-busy={combatBusy}
                  // Deliberately distinct wording from the "End" button's own
                  // "End combat — choose outcome" aria-label above (not just
                  // decoration — a shared "End combat" substring would make
                  // the two controls indistinguishable by accessible name to
                  // a screen-reader user tabbing through, and ambiguous to
                  // any `getByRole('button', {name: /End combat/i})`-style
                  // query, same failure mode either way).
                  aria-label="All enemies are down — wrap up the fight and choose an outcome"
                >
                  Wrap up
                </button>
              </div>
            )}
            {/* B3-1: outcome chooser popover */}
            {outcomeChooserOpen && (
              <div
                className={styles.outcomeChooser}
                role="group"
                aria-label="Choose combat outcome"
                // Tora MAJOR-2: Escape closes the chooser and returns focus
                // to the trigger. TAV-A11Y-USE-ESCAPE-CONSUME-HOOK (was a
                // hand-rolled UIR2-TAV-11 r2 fix): stopPropagation is
                // unconditional; only the actual close stays gated on
                // `!combatBusy`.
                onKeyDown={(e) =>
                  consumeEscape(e, {
                    onClose: () => setOutcomeChooserOpen(false),
                    canClose: !combatBusy,
                    // Iro MAJOR-1: refocus whichever control actually opened the
                    // chooser ("End" or "Wrap up"), falling back to endCombatBtnRef
                    // if it was somehow opened without going through an onClick.
                    onRefocus: () => (lastOpenerRef.current ?? endCombatBtnRef.current)?.focus(),
                  })
                }
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
                    // Iro MAJOR-1: same opener-aware refocus as the Escape path above.
                    (lastOpenerRef.current ?? endCombatBtnRef.current)?.focus();
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
        ) : !combatId && sceneHasEncounter ? (
          // No combat at all, AND the current scene has an authored combat
          // encounter (`sceneHasEncounter`): offer to begin it. 2026-07-23
          // pre-flight playthrough nit (backlog "TAVERN PLAY-UI NITS") — this
          // button used to render on EVERY non-combat scene, so clicking it
          // on a scene with no authored encounter always 400'd
          // ("No encounter available for the current scene.", surfaced by
          // the catch below). Now the button is simply absent for those
          // scenes — the flee checks and scene-transition affordances
          // elsewhere in this pane already cover them, no placeholder
          // needed. Phase 4 Package B (Sora-Arch design §3 Fork 2) relabels
          // the SAME button "Stand and fight" so the moment reads as a
          // fight-or-flee choice rather than a generic "start a fight"
          // invite — no longer copy-only now that sceneHasEncounter also
          // gates the button's existence (in practice the button can now
          // only ever render with the "Stand and fight" label; the
          // "Begin an encounter" branch is kept as-is, unreachable, to keep
          // this fix to the two changes it was scoped to). `beginEncounter`'s
          // own logic/gating is still completely unchanged. Also disabled
          // while narration/session/other rolls are busy (talking/
          // sessionLocked/rollBusy), matching the sibling action rail below —
          // previously only `combatBusy` gated it, so a click could race an
          // in-flight narration and 409 on the durable turn-key guard.
          // Iro-A11y MINOR-1/MINOR-2: aria-busy is the adjudicated sibling
          // convention (own-busy-ref || talking; sessionLocked/rollBusy
          // deliberately excluded — those are OTHER things being busy, not
          // this control); aria-disabled mirrors `disabled` byte-for-byte,
          // same pairing as checkBtn/moveOnBtn/the freeform check button.
          <button
            ref={beginCombatRef}
            type="button"
            className={styles.beginCombat}
            onClick={beginEncounter}
            disabled={talking || combatBusy || sessionLocked || rollBusy}
            aria-busy={combatBusy || talking}
            aria-disabled={talking || combatBusy || sessionLocked || rollBusy}
          >
            <Icon name="Sword" size={14} aria-hidden />{' '}
            {sceneHasEncounter ? 'Stand and fight' : 'Begin an encounter'}
          </button>
        ) : null}

        {/* P1-PLAYFIX §3.3.3 (S2.4): authored skill-check affordances — shown
            whenever the current scene has authored checks and no combat is
            active (see availableChecks above). D1a: no longer gated behind a
            narrator invite — every authored check for the scene is a
            player-invoked button; the one Suzu invited this turn is just
            highlighted (isOffered below), not exclusively shown. When a
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
              // Check Retry + Fail-Forward (2026-07-28 design section 7.1):
              // locked checks stay in the list -- disabled, with the reason
              // available to screen readers. Absent `state` (pre-CHECK-RETRY
              // server) leaves isLocked/isLastAttempt both false, so nothing
              // here changes for a flag-OFF server.
              const isLocked = c.state === 'locked';
              // Miko-QA Finding 5 (2026-07-28): require state === 'available'
              // explicitly, not just !isLocked -- a partial/malformed wire
              // payload (attempts_used/max_attempts present, `state` absent)
              // must not render "last attempt" just because it also isn't
              // literally 'locked'.
              const isLastAttempt =
                c.state === 'available' &&
                c.max_attempts != null &&
                c.attempts_used != null &&
                c.attempts_used > 0 &&
                c.max_attempts - c.attempts_used === 1;
              const lockReasonId = isLocked ? `check-locked-${checkKey}` : undefined;
              const lockReasonText = isLocked
                ? (CHECK_LOCK_REASON_COPY[c.lock_reason ?? ''] ?? CHECK_LOCK_REASON_COPY.max_attempts)
                : undefined;
              const describedBy =
                [offeredId, noteId, lockReasonId].filter(Boolean).join(' ') || undefined;
              return (
                <button
                  key={checkKey}
                  type="button"
                  className={`${styles.checkBtn} ${isOffered && !isLocked ? styles.checkBtnOffered : ''} ${isLocked ? styles.checkBtnLocked : ''}`}
                  onClick={() => {
                    // Iro-A11y MAJOR-3/MAJOR-4 (2026-07-28): `isLocked` is
                    // deliberately NOT in the native `disabled` prop below
                    // (a locked check must stay Tab-reachable so its
                    // sr-only close reason is announced) -- the click is
                    // guarded here in JS instead of by the browser.
                    if (isLocked) return;
                    void onAttemptCheck(c.skill);
                  }}
                  disabled={checkBusy || talking || sessionLocked}
                  aria-busy={checkBusy || talking}
                  aria-disabled={isLocked || checkBusy || talking || sessionLocked}
                  aria-describedby={describedBy}
                  title={c.note}
                >
                  <Icon name="Check" size={13} aria-hidden />
                  {/* Iro Ship 2 MINOR-1: comma reads better in AT/TTS than parens. */}
                  {isLocked
                    ? `${titleCaseSkill(c.skill)}, DC ${c.dc} — closed`
                    : `Attempt ${titleCaseSkill(c.skill)}, DC ${c.dc}${isLastAttempt ? ' — last attempt' : ''}`}
                  {isOffered && (
                    <span id={offeredId} className="sr-only">Suzu invited this check.</span>
                  )}
                  {c.note && (
                    <span id={noteId} className="sr-only">{c.note}</span>
                  )}
                  {isLocked && (
                    <span id={lockReasonId} className="sr-only">{lockReasonText}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Phase 4 (Sora-Arch design §4 Fork 3; Miko-QA "the sleeper bug"
            fix — the single most important new client-side assertion in the
            whole plan) — a skill Suzu invited this turn that is NOT one of
            this scene's AUTHORED checks (a freeform/unauthored offer). The
            .checkWrap group above only ever renders `availableChecks`
            (grounding.checks) — silently dropping this offer instead of
            surfacing SOME affordance is exactly the bug this fixes. Routes
            through `onRoll` — the SAME quickChecks/postRoll → engine
            `/roll (kind=skill)` primitive used elsewhere on this page, NOT
            `onAttemptCheck` (`/check`, which 400s `no_such_check` for
            anything unauthored) — always-available, server-authoritative,
            no client-supplied DC. Deliberately NOT gated on combat state,
            mirroring the generic quick-checks panel below (also
            always-available) — Package B's own combat gate on the
            AUTHORED checks above is untouched.

            Iro-A11y MAJOR-1: when this scene ALSO has authored checks
            (availableChecks.length > 0), the authored .checkWrap group below
            renders back-to-back with this one — two adjacent
            role="group" blocks would collide on the exact same accessible
            name ("Skill check") without the skill-specific suffix here. The
            offeredCheckSkill/freeformOfferedCheck mutual-exclusivity only
            keeps the two OFFER states apart from each other; it says
            nothing about `availableChecks`, so this is a real, reachable
            case (exactly the scenario this phase targets), not a
            theoretical one. Visible `.checkLabel` text stays the generic
            "Skill check" for sighted users — only the accessible name
            differs. */}
        {freeformOfferedCheck && (
          <div
            ref={freeformCheckRef}
            className={styles.checkWrap}
            role="group"
            aria-label={`Skill check: ${titleCaseSkill(freeformOfferedCheck)}`}
          >
            <div className={styles.checkLabel}>Skill check</div>
            <button
              type="button"
              className={`${styles.checkBtn} ${styles.checkBtnOffered}`}
              onClick={() =>
                void onRoll({
                  kind: 'check',
                  skill: freeformOfferedCheck,
                  label: titleCaseSkill(freeformOfferedCheck),
                })
              }
              disabled={rollBusy || talking || combatBusy || sessionLocked}
              aria-busy={rollBusy || talking}
              aria-disabled={rollBusy || talking || combatBusy || sessionLocked}
            >
              <Icon name="Check" size={13} aria-hidden />
              {`Attempt ${titleCaseSkill(freeformOfferedCheck)}`}
              <span className="sr-only">Suzu invited this check.</span>
            </button>
          </div>
        )}

        {/* ADV-7T: "Move on" affordance — shown only when transitions are available
            and no combat is active.
            Iro Ship 2 MINOR-2: role="group" + aria-label mirrors the existing
            .outcomeChooser group pattern above.
            TAV-SLICE-END-ADVANCE-NULL / Kage-CR item 4: once a terminal
            advance has landed (adventureComplete), this affordance is gone
            entirely — there is nothing left to move on TO, and re-rendering
            it would let a second click post another /advance indefinitely. */}
        {availableTransitions.length > 0 && !adventureComplete && (
          <div
            ref={transitionWrapRef}
            className={styles.moveOnWrap}
            role="group"
            aria-label="Scene transition"
          >
            <div className={styles.moveOnLabel}>Scene transition</div>
            {availableTransitions.map((t, i) => (
              <button
                // t.to is NOT unique — an adventure can author two exits to the
                // same target scene (different labels), which collided under a
                // bare key={t.to} (React "two children with the same key"
                // warning, risking a dropped/duplicated exit button). Composite
                // with the label + index guarantees uniqueness.
                key={`${t.to}-${t.label ?? ''}-${i}`}
                type="button"
                className={styles.moveOnBtn}
                onClick={() => void onMoveOn(t.to)}
                disabled={sceneAdvanceBusy || talking || sessionLocked}
                aria-busy={sceneAdvanceBusy || talking}
                aria-disabled={sceneAdvanceBusy || talking || sessionLocked}
              >
                <Icon name="Compass" size={13} aria-hidden />
                {/* TAV-SLICE-END-ADVANCE-NULL: an unlabelled terminal
                    (`to: null`) exit must never render the literal string
                    "Move on → null" — fall back to neutral completion copy
                    instead. An authored `label` always wins either way. */}
                {t.label ?? (t.to === null ? 'Conclude the adventure' : `Move on → ${t.to}`)}
              </button>
            ))}
          </div>
        )}

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

      {/* TAV-PARTY-INLINE-SHEET: a right-edge slide-over drawer for a
          selected party member's sheet — clones the Journal drawer's shape
          exactly (always-mounted <aside>, scrim, dialog semantics, Tab-trap,
          Esc via consumeEscape, inert when closed) but unlike the Journal
          drawer has no separate mobile-tab presentation to reconcile with,
          so it's simply always the fixed drawer at any viewport width
          (Play.module.css's `.memberSheetDrawer` is not media-gated the way
          `.journalDrawer` is). */}
      {memberSheetOpen && (
        <div className={styles.memberSheetScrim} onClick={closeMemberSheet} />
      )}
      <aside
        id="play-pane-member-sheet"
        ref={memberSheetDialogRef}
        className={`${styles.memberSheetDrawer} ${
          memberSheetOpen ? styles.memberSheetDrawerOpen : ''
        }`}
        role={memberSheetOpen ? 'dialog' : undefined}
        aria-modal={memberSheetOpen ? true : undefined}
        aria-labelledby={MEMBER_SHEET_HEADING_ID}
        // Same jsdom-doesn't-implement-`inert` belt-and-suspenders as the
        // Journal drawer above — aria-hidden is honored by
        // dom-accessibility-api's isInaccessible() in both real browsers and
        // this repo's test environment.
        aria-hidden={memberSheetOpen ? undefined : true}
        inert={!memberSheetOpen}
        tabIndex={memberSheetOpen ? -1 : undefined}
        onKeyDown={memberSheetOpen ? onMemberSheetKeyDown : undefined}
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
