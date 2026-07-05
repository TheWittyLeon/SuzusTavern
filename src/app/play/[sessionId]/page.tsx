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
} from '@/lib/api/dnd';
import { streamDmNarration } from '@/lib/stream';
import { eventToLogRow, formatEventTimestamp as formatOpeningTimestamp } from '@/lib/rehydration';
import { matchKeywordIntent } from '@/lib/dnd/intentFastPath';
import type {
  CombatParticipantState,
  CombatState,
  EndCombatOutcome,
  GroundingData,
  OfferedCheck,
  Participant,
  Session,
} from '@/lib/api/types';
import RebindCharacterButton from '@/components/RebindCharacterButton';
import type { QuickCheck } from '@/components/DiceTray';
import Icon from '@/components/Icon';
import Pill from '@/components/Pill';
import PageSkeleton from '@/components/PageSkeleton';
import NarratorStrip from '@/components/NarratorStrip';
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

function nowStamp(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/** Roll a d20 honouring advantage/disadvantage (highest/lowest of two). */
function rollWithAdvantage(advantage: Advantage): number {
  if (advantage === 'none') return rollDie(20);
  const a = rollDie(20);
  const b = rollDie(20);
  return advantage === 'adv' ? Math.max(a, b) : Math.min(a, b);
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
  const [mobileView, setMobileView] = useState<'log' | 'party' | 'scene'>('log');

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

  // Iro Ship 2 CRITICAL-1: a resolved check / taken transition unmounts the
  // just-clicked button once `refreshGrounding()` recomputes availableChecks /
  // availableTransitions, dropping focus to <body> with no announcement.
  // `sceneHeadRef` is a stable, always-mounted anchor (mirrors the
  // `endCombatBtnRef` refocus pattern above); the wrap refs let each handler
  // capture "did this click originate inside my group" before the unmount.
  const sceneHeadRef = useRef<HTMLDivElement>(null);
  const checkWrapRef = useRef<HTMLDivElement>(null);
  const transitionWrapRef = useRef<HTMLDivElement>(null);

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
        { id, who: 'Suzu', kind: 'narration' as const, text, ts },
      ]);
    }
  }, []);
  const clearStreamNarration = useCallback((removeRow: boolean) => {
    const id = streamRowIdRef.current;
    streamRowIdRef.current = null;
    if (removeRow && id) setLog((prev) => prev.filter((r) => r.id !== id));
  }, []);

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

        // PLAY-PERSIST §6.2 — rehydrate the transcript ONCE on mount, before the
        // opening path can fire. rawEvents === null means the engine was
        // unreachable — skip rehydration and render what we have (resilient,
        // never crash); the existing (unchanged) opening path still runs below.
        if (rawEvents && !rehydratedRef.current) {
          const sorted = [...rawEvents].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
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
                  return { name: display, mod: sk.modifier };
                })
                .filter((c): c is QuickCheck => c !== null);
              setQuickChecks(checks);
            })
            .catch(() => {
              // Sheet fetch failed — hide quick-checks rather than show stale numbers.
              if (!ctrl.signal.aborted) setQuickChecks([]);
            });
        } else {
          // DM-only or no character bound: hide quick-checks.
          setQuickChecks([]);
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

  // Re-pin the chat to the latest line when returning to the Story view.
  useEffect(() => {
    if (mobileView === 'log') chatLogRef.current?.scrollToBottom('instant');
  }, [mobileView]);

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
        // Streamed path — the narration is already live in the bottom log;
        // finalize it with the complete text (no second row appended).
        upsertStreamNarration(full);
        clearStreamNarration(false);
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
      refreshGrounding,
      refocusSceneHeadIfStranded,
      grounding,
      toast,
    ],
  );

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
    try {
      await postSessionEvent(sessionId, {
        kind: 'dm_narration',
        actor_username: session.dm_username ?? username,
        data: { text },
        visibility: 'table',
      });
      // Optimistically append to the local log with distinct dm_narration kind.
      const actor = session.dm_username ?? username;
      appendLog({
        who: `DM (${actor})`,
        kind: 'dm_narration',
        text,
      });
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
  const onRoll = useCallback(
    (sides: number, label?: string, mod?: number) => {
      const modifier = mod ?? 0;
      const value = sides === 20 ? rollWithAdvantage(advantage) : rollDie(sides);
      const crit = sides === 20 && value === 20;
      const fumble = sides === 20 && value === 1;
      const lbl = label ?? `d${sides}`;
      appendLog({
        who: username ?? 'You',
        kind: 'roll',
        text: `${lbl}${modifier ? ` ${modifier >= 0 ? '+' : ''}${modifier}` : ''}`,
        color: 'var(--accent)',
        roll: { sides, value, modifier, crit, fumble, label: lbl },
      });
      // S5.5: skip auto-narration when AI is off or assist-only.
      const sessionAiLevel = session?.ai_assist_level;
      // DDX-25 R2 (D2): a paused/ended session must not auto-fire narration
      // either — the DiceTray `disabled` prop already blocks the click that
      // reaches here (see its own sessionLocked gate further down), but this
      // is checked again here too, mirroring the double-gate convention this
      // file already uses for `talking` in onMoveOn/onAttemptCheck.
      if (
        sides === 20 &&
        mod !== undefined &&
        !talking &&
        !combatBusy &&
        !isSessionLocked(session) &&
        sessionAiLevel !== 'off' &&
        sessionAiLevel !== 'assist'
      ) {
        const total = value + modifier;
        const mech = `${lbl} check: ${value} + ${modifier} = ${total}${
          crit ? ' (natural 20)' : fumble ? ' (natural 1)' : ''
        }. Narrate the outcome.`;
        void narrate(`I roll ${lbl}.`, mech, 'act');
      }
    },
    [advantage, username, talking, combatBusy, session, appendLog, narrate],
  );

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
      void narrate(
        'The scene changes.',
        `Scene advance: ${fromScene} → ${toScene}. Narrate the transition.`,
        'act',
        { suppressIntent: true },
      );
    },
    [appendLog, refreshGrounding, narrate],
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
        void narrate(
          'We move on.',
          `Scene advance: ${result.from_scene} → ${result.to_scene}. Narrate the transition.`,
          'act',
          { suppressIntent: true },
        );
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
    [session, username, talking, appendLog, refreshGrounding, refocusSceneHeadIfStranded, narrate, toast],
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
        void narrate(`I attempt a ${skillLabel} check.`, result.mechanics, 'act', {
          suppressIntent: true,
        });
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
      void narrate(
        'We are under attack!',
        `Combat starts. ${monsterNames} enter the scene. Set the scene.`,
        'act',
      );
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
  }, [session, username, toast, appendLog, narrate]);

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
        await narrate(playerLine, message, 'act');

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
    appendLog({ who: username ?? 'You', kind: 'player', text, color: 'var(--accent)' });

    const intent = matchKeywordIntent(text, availableTransitions);
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
    onSendDmNarration,
    availableTransitions,
    onMoveOn,
  ]);

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

  // DDX-25: session lifecycle status, read directly from the server-loaded
  // session (same "no stale snapshot" rule as aiLevel below) — status can now
  // change via the session controls without a full page reload.
  const isPaused = session?.status === 'paused';
  const isEnded = session?.status === 'ended';
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
                  if (e.key === 'Escape') {
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
                        setMyCharacterIdStr(
                          self?.character?.character_id != null
                            ? String(self.character.character_id)
                            : null,
                        );
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
        <ChatLog ref={chatLogRef} rows={log} thinking={thinking} />
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
        {/* S5.3 + S5.4: monster control panel — human DM seat only, during active combat. */}
        {isHumanDM && combatIsActive && combatState && combatId && (
          <DmNarrationPanel
            combatId={combatId}
            combatState={combatState}
            sessionId={sessionId}
            dmUsername={session?.dm_username ?? username ?? ''}
            overridePlayerVisible={session?.dm_override_player_visible ?? true}
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
          combat={
            // S5.2: human DM doesn't see the player action rail (Attack/Dodge/etc.).
            // The DmNarrationPanel above handles monster control separately.
            isHumanDM
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
            disabled={talking || combatBusy || sessionLocked}
          />
        </div>

        <div className={styles.safety}>
          <div className={styles.safetyLabel}>Safety</div>
          <p className={styles.safetyBody}>X-card · pause · rewind. Suzu listens.</p>
          <div className={styles.safetyBtns}>
            <button
              type="button"
              onClick={() => {
                appendLog({
                  who: username ?? 'You',
                  kind: 'system',
                  text: '(X-card raised — the table pauses.)',
                });
                toast({ tone: 'info', message: 'X-card noted. The table pauses.' });
              }}
            >
              X-card
            </button>
          </div>
        </div>
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
