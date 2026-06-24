'use client';
/**
 * Play session — /play/[sessionId] (ST-060–065, ST-071, ST-062 / CUI-11/12 / ADV-7T/8).
 *
 * The immersive 3-pane table where Suzu runs the game:
 *   left   — party roster (ST-061) + initiative (ST-020 / CUI-11)
 *   centre — narrator strip (ST-018/071) + chat log (ST-019) + composer (ST-063)
 *   right  — scene card + "Move on" affordance (ADV-7T) + dice tray + safety tools
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
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { titleizeChannel } from '@/lib/format';
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
  postSessionEvent,
  rollInitiative,
  monsterTurn,
  attack as combatAttack,
  dodge as combatDodge,
  dash as combatDash,
  endTurn as combatEndTurn,
} from '@/lib/api/dnd';
import { streamDmNarration } from '@/lib/stream';
import type {
  CombatParticipantState,
  CombatState,
  GroundingData,
  Participant,
  Session,
} from '@/lib/api/types';
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

/** A1 — structural event kinds that indicate the scene hasn't started yet. */
const STRUCTURAL_EVENT_KINDS = new Set([
  'session_start',
  'character_bound',
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
  const [advantage, setAdvantage] = useState<Advantage>('none');
  const [mobileView, setMobileView] = useState<'log' | 'party' | 'scene'>('log');

  const [combatId, setCombatId] = useState<string | null>(null);
  const [combatState, setCombatState] = useState<CombatState | null>(null);
  const [combatBusy, setCombatBusy] = useState(false);
  const [refusedReason, setRefusedReason] = useState<string | null>(null);

  // Grounding for the "Move on" affordance (ADV-7T).
  const [grounding, setGrounding] = useState<GroundingData | null>(null);
  const [sceneAdvanceBusy, setSceneAdvanceBusy] = useState(false);

  // A2 — real quick-checks derived from the bound character's sheet.
  // null = not yet resolved; [] = DM-only (no character bound) or fetch failed.
  const [quickChecks, setQuickChecks] = useState<QuickCheck[] | null>(null);

  // A1 — fire-once gate: ensures the opening beat only streams once per mount
  // even under React StrictMode's double-invoke. The durable server-side event
  // is the canonical guard; this ref prevents a second fire within the same
  // component lifetime (e.g. StrictMode double-effect).
  const openingFiredRef = useRef(false);

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

  const appendLog = useCallback((row: Omit<LogRow, 'id' | 'ts'>) => {
    setLog((prev) => [...prev, { id: `r${(idRef.current += 1)}`, ts: nowStamp(), ...row }]);
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

        // Fetch grounding, participants, and combat state in parallel.
        const [g, party] = await Promise.all([
          getGrounding(sessionId, ctrl.signal),
          getParticipants(sessionId, ctrl.signal).catch(() => [] as Participant[]),
        ]);
        if (ctrl.signal.aborted) return;
        if (g) setGrounding(g);
        setParticipants(party);

        // A2 — fetch the bound character's sheet to build real quick-checks.
        // The self participant carries character_id when a character is bound.
        const selfParticipant = party.find(
          (p) => p.username.toLowerCase() === username.toLowerCase(),
        );
        const boundCharId = selfParticipant?.character?.character_id ?? null;
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
          // eslint-disable-next-line react-hooks/immutability
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

  // Re-pin the chat to the latest line when returning to the Story view.
  useEffect(() => {
    if (mobileView === 'log') chatLogRef.current?.scrollToBottom('instant');
  }, [mobileView]);

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
   */
  const narrate = useCallback(
    async (
      playerMessage: string,
      mechanics: string,
      beatMode: ComposeMode,
      opts?: { kind?: 'beat' | 'opening'; session?: Session },
    ) => {
      // FIX-1: use the override session when supplied (opening call), otherwise
      // fall back to the closure value (all subsequent player/combat calls).
      const activeSession = opts?.session ?? session;
      if (!activeSession || !username) return;
      narrationAbort.current?.abort();
      const ctrl = new AbortController();
      narrationAbort.current = ctrl;
      setTalking(true);
      setThinking(true);
      setNarratorText('');

      const isOpening = opts?.kind === 'opening';

      const transcript = logRef.current.slice(-8).map((r) => `${r.who}: ${r.text}`);
      let full = '';
      let errored = false;
      let lastErrorReason: string | undefined;
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
          },
          { signal: ctrl.signal },
        )) {
          if (ev.kind === 'chunk') {
            full = ev.text;
            setThinking(false);
            revealText(full);
          } else if (ev.kind === 'error') {
            errored = true;
            lastErrorReason = ev.reason;
          }
        }
      } catch {
        errored = true;
      }

      if (ctrl.signal.aborted) return;
      setThinking(false);
      setTalking(false);
      if (errored || !full.trim()) {
        const fallbackText = isOpening
          ? "Suzu hasn't joined yet — try a move and she'll catch up."
          : lastErrorReason === 'ai_off'
            ? 'This table runs without AI narration — you and your DM drive the scene.'
            : 'Suzu stepped away for a moment. Try again.';
        appendLog({
          who: 'Suzu',
          kind: 'system',
          text: fallbackText,
        });
        setNarratorText('');
      } else {
        appendLog({ who: 'Suzu', kind: 'narration', text: full });
      }
    },
    [session, username, revealText, appendLog],
  );

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
   * A1 — Open the scene on first load. Fire-and-forget; non-blocking.
   *
   * AI/full path: streams an opening narration via narrate(..., {kind:'opening'}).
   *   The proxy writes the durable `opening_narrated` event on success.
   * AI-off path: renders the scene locally from grounding data, then writes
   *   the marker client-side via postSessionEvent (best-effort).
   */
  const openScene = useCallback(
    async (s: Session, g: GroundingData, sid: string, signal: AbortSignal) => {
      const shouldOpen = await checkShouldOpen(sid, g, signal);
      if (!shouldOpen || signal.aborted) return;

      // Latch: prevent a second fire from the StrictMode double-invoke or
      // any concurrent call within the same component lifetime.
      openingFiredRef.current = true;

      const aiLevel = s.ai_assist_level;

      if (aiLevel === 'off' || !aiLevel) {
        // ── AI-off path: client-render from grounding ──────────────────────
        const lines: string[] = [];
        if (g.adventure_title) lines.push(`— ${g.adventure_title} —`);
        if (g.hook) lines.push(g.hook);
        if (g.scene_name) lines.push(`\nScene: ${g.scene_name}`);
        if (g.boxed_text) lines.push(g.boxed_text);
        if (g.objective) lines.push(`\nObjective: ${g.objective}`);

        if (!signal.aborted) {
          appendLog({
            who: 'Suzu',
            kind: 'system',
            text: lines.filter(Boolean).join('\n'),
          });
          // Write the durable marker client-side (best-effort — non-fatal on failure).
          void postSessionEvent(sid, {
            kind: 'opening_narrated',
            data: { scene_id: g.scene_id, source: 'client_render' },
          }).catch(() => {/* non-fatal */});
        }
      } else {
        // ── AI/full path: stream the opening narration ─────────────────────
        // narrate() with kind:'opening' sends empty message + kind field.
        // The proxy writes the opening_narrated marker on stream success.
        // FIX-1: pass the live session param `s` so narrate() doesn't read
        // from the React state closure (which is still null at mount time).
        void narrate('', '', 'act', { kind: 'opening', session: s });
      }
    },
    [checkShouldOpen, appendLog, narrate],
  );

  // ── composer send ───────────────────────────────────────────────────────────
  const onSend = useCallback(() => {
    const text = msg.trim();
    if (!text || talking) return;
    setMsg('');
    if (mode === 'ooc') {
      appendLog({ who: username ?? 'You', kind: 'system', text: `(ooc) ${text}` });
      return;
    }
    appendLog({ who: username ?? 'You', kind: 'player', text, color: 'var(--accent)' });
    void narrate(text, '', mode);
  }, [msg, talking, mode, username, appendLog, narrate]);

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
      if (sides === 20 && mod !== undefined && !talking && !combatBusy) {
        const total = value + modifier;
        const mech = `${lbl} check: ${value} + ${modifier} = ${total}${
          crit ? ' (natural 20)' : fumble ? ' (natural 1)' : ''
        }. Narrate the outcome.`;
        void narrate(`I roll ${lbl}.`, mech, 'act');
      }
    },
    [advantage, username, talking, combatBusy, appendLog, narrate],
  );

  // ── scene advance (ADV-7T / CUI-12) ─────────────────────────────────────────

  /** Refetch grounding after a scene advance so the Scene card updates. */
  const refreshGrounding = useCallback(async () => {
    if (!sessionId) return;
    const g = await getGrounding(sessionId).catch(() => null);
    setGrounding(g);
  }, [sessionId]);

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
      void narrate(
        'The scene changes.',
        `Scene advance: ${fromScene} → ${toScene}. Narrate the transition.`,
        'act',
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
        void narrate(
          'We move on.',
          `Scene advance: ${result.from_scene} → ${result.to_scene}. Narrate the transition.`,
          'act',
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
    [session, username, appendLog, refreshGrounding, narrate, toast],
  );

  // ── combat ──────────────────────────────────────────────────────────────────
  /**
   * ADV-6: Begin an encounter from the current scene's authored encounter block.
   * Now also initialises combatState from the response's data.state (CUI-11).
   */
  const beginEncounter = useCallback(async () => {
    if (!session || !username || combatBusyRef.current) return;
    combatBusyRef.current = true;
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

  /** Explicit "End combat" — posts /combat/{id}/end with outcome='retreat'. */
  const onEndCombat = useCallback(async () => {
    if (!combatId || !username || combatBusyRef.current) return;
    combatBusyRef.current = true;
    setCombatBusy(true);
    try {
      const result = await endCombat(combatId, { username, outcome: 'unresolved' });
      if (result.state) {
        stateSeqRef.current += 1;
        setCombatState(result.state);
      }
      appendLog({
        who: 'Suzu',
        kind: 'system',
        text: `Combat ended. ${result.outcome ?? 'Unresolved'}.`,
      });
      if (result.scene_advance) {
        await handleSceneAdvance(
          result.scene_advance.from_scene,
          result.scene_advance.to_scene,
          result.scene_advance.outcome,
        );
      } else {
        void refreshGrounding();
      }
    } catch {
      toast({ tone: 'error', message: 'Could not end combat.' });
    } finally {
      combatBusyRef.current = false;
      setCombatBusy(false);
    }
  }, [combatId, username, appendLog, handleSceneAdvance, refreshGrounding, toast]);

  // Auto-drive monster turns. Whenever combat is active and the current turn
  // belongs to a living NPC, run that monster's turn — looping through all
  // consecutive NPC turns until it's a PC's turn or combat ends. Without this,
  // a combat where monsters win initiative is stuck at the start (the player is
  // never reached) and monster turns between rounds never advance.
  useEffect(() => {
    if (!combatState || combatState.state !== 'active' || !combatId || !username) return;
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
  }, [combatState, combatId, username, appendLog, handleSceneAdvance]);

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

  // Determine if it's the local player's turn (for disabling actions).
  const selfPcParticipant = combatState?.participants.find(
    (p) => p.is_pc && p.is_active_turn,
  );
  // We can't reliably map username → participant_id without a /bind API response,
  // so we approximate: it's "your turn" when any PC has is_active_turn — in a
  // solo-play session this is always the right answer. Multi-player tables will
  // need the character bind endpoint to fully resolve this.
  const isPlayerTurn = combatState?.state === 'active'
    ? (selfPcParticipant != null)
    : true; // out of combat: always enabled

  // Round from combatState is authoritative; fall back to 1 when no state yet.
  const round = combatState?.round ?? null;

  // Determine valid "Move on" transitions from grounding (ADV-7T).
  // Show the button only when: no active combat AND at least one transition is available
  // that doesn't require an unresolved encounter.
  const activeEncounterId = combatState?.state === 'active'
    ? combatState.encounter_id
    : null;

  const availableTransitions = (combatState?.state !== 'active' && grounding?.transitions)
    ? grounding.transitions.filter((t) => {
        if (!t.requires_encounter_resolved) return true;
        // If the encounter that gates this transition is resolved, allow it.
        const enc = grounding.encounter_state as Record<string, { status?: string }> | null;
        if (!enc) return false;
        const st = enc[t.requires_encounter_resolved]?.status ?? '';
        return st.startsWith('resolved_');
      })
    : [];

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

  const title = titleizeChannel(session?.channel);
  const combatIsActive = !!combatId && combatState?.state !== 'ended';
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
  const selfPcId =
    combatState?.participants.find(
      (p) =>
        p.is_pc &&
        participants.some(
          (part) =>
            part.username.toLowerCase() === (username ?? '').toLowerCase() &&
            part.character?.name?.toLowerCase() === p.name.toLowerCase(),
        ),
    )?.participant_id ?? null;

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
        <PartyPanel
          participants={participants}
          selfUsername={username}
          combatState={combatState}
        />
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
        <NarratorStrip text={narratorText} talking={talking} status={statusPill} />
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
        <Composer
          value={msg}
          onChange={setMsg}
          mode={mode}
          onMode={setMode}
          onSend={onSend}
          disabled={talking}
          combat={
            combatIsActive
              ? {
                  targets: targetableFoes,
                  onAction: onCombatAction,
                  busy: combatBusy,
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
            name and objective. */}
        <div
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

        {/* Active combat: show combat note + End combat option. */}
        {combatIsActive ? (
          <div className={styles.combatNote} role="status" aria-live="polite">
            <Icon name="Sword" size={13} aria-hidden /> In combat · use the action rail in the composer
            {/* CUI-13: explicit "End combat" */}
            <button
              type="button"
              className={styles.endCombatBtn}
              onClick={onEndCombat}
              disabled={combatBusy}
              aria-busy={combatBusy}
              aria-label="End combat"
            >
              End
            </button>
          </div>
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

        {/* ADV-7T: "Move on" affordance — shown only when transitions are available
            and no combat is active. */}
        {availableTransitions.length > 0 && (
          <div className={styles.moveOnWrap}>
            <div className={styles.moveOnLabel}>Scene transition</div>
            {availableTransitions.map((t) => (
              <button
                key={t.to}
                type="button"
                className={styles.moveOnBtn}
                onClick={() => void onMoveOn(t.to)}
                disabled={sceneAdvanceBusy || talking}
                aria-busy={sceneAdvanceBusy || talking}
                aria-disabled={sceneAdvanceBusy || talking}
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
            disabled={talking || combatBusy}
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
    </div>
  );
}
