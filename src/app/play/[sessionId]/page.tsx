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
  getGrounding,
  getParticipants,
  getSession,
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

const QUICK_CHECKS = [
  { name: 'Perception', mod: 3 },
  { name: 'Stealth', mod: 7 },
  { name: 'Investigation', mod: 4 },
  { name: 'Persuasion', mod: 1 },
];

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

  // Monotone sequence guard: combatState updates from polls must not overwrite
  // a more-recent mutation response. Mutations bump this; polls gate on it.
  const stateSeqRef = useRef(0);

  // Synchronous latch for double-tap protection on all combat mutating actions.
  // React state (combatBusy) only disables UI after a re-render; the ref closes
  // the race window between two taps in the same event-loop tick.
  const combatBusyRef = useRef(false);

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

        // Fetch grounding to power the "Move on" affordance.
        const g = await getGrounding(sessionId, ctrl.signal);
        if (!ctrl.signal.aborted) setGrounding(g);

        const party = await getParticipants(sessionId, ctrl.signal).catch(
          () => [] as Participant[],
        );
        if (!ctrl.signal.aborted) setParticipants(party);

        // If there's an active combat, fetch its state immediately.
        if (initialCombatId && !ctrl.signal.aborted) {
          const cs = await getCombatState(initialCombatId, ctrl.signal).catch(() => null);
          if (!ctrl.signal.aborted && cs) {
            stateSeqRef.current += 1;
            setCombatState(cs);
          }
        }
      } catch (e) {
        if (ctrl.signal.aborted) return;
        const status = (e as { status?: number } | null)?.status;
        setState(status === 404 ? 'notfound' : 'error');
      }
    })();
    return () => ctrl.abort();
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

  /** Stream one DM-narration beat; `mechanics` empty = pure roleplay beat. */
  const narrate = useCallback(
    async (playerMessage: string, mechanics: string, beatMode: ComposeMode) => {
      if (!session || !username) return;
      narrationAbort.current?.abort();
      const ctrl = new AbortController();
      narrationAbort.current = ctrl;
      setTalking(true);
      setThinking(true);
      setNarratorText('');

      const transcript = logRef.current.slice(-8).map((r) => `${r.who}: ${r.text}`);
      let full = '';
      let errored = false;
      let lastErrorReason: string | undefined;
      try {
        for await (const ev of streamDmNarration(
          {
            username,
            channel: session.channel,
            message: playerMessage,
            mechanics,
            transcript,
            mode: beatMode,
            session_id: session.session_id,
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
        const fallbackText =
          lastErrorReason === 'ai_off'
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
      sceneAdvanceBusyRef.current = true;
      setSceneAdvanceBusy(true);
      try {
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

        // After the player ends their turn, drive the monsters' turn.
        if (action === 'endturn') {
          const mres = await monsterTurn({ username, combat_id: combatId }).catch(() => null);
          const mmsg = mres?.message;
          // Surface monster's last_action in the log.
          const mla = mres?.state?.last_action;
          const mOutcome = mla
            ? ` ${mla.outcome}${mla.damage_dealt ? `, ${mla.damage_dealt} dmg` : ''}`
            : '';
          const mLogText = mmsg ?? (mla ? `${mla.actor_id}:${mOutcome}` : null);
          if (mres?.state) {
            stateSeqRef.current += 1;
            setCombatState(mres.state);
          }
          if (mres?.scene_advance && !sceneAdvance) {
            sceneAdvance = {
              fromScene: mres.scene_advance.from_scene,
              toScene: mres.scene_advance.to_scene,
              outcome: mres.scene_advance.outcome,
            };
          }
          if (mLogText) {
            appendLog({ who: 'Suzu', kind: 'system', text: mLogText });
            await narrate('(the enemies act)', mLogText, 'act');
          }
        }

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
        <div aria-live="polite">
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
        <div className={styles.sceneHead}>
          <span className={styles.kicker}>Scene</span>
          {grounding?.scene_name && (
            <span className={styles.sceneName}>{grounding.scene_name}</span>
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
                disabled={sceneAdvanceBusy}
                aria-busy={sceneAdvanceBusy}
                aria-disabled={sceneAdvanceBusy}
              >
                <Icon name="Compass" size={13} aria-hidden />
                {t.label ?? `Move on → ${t.to}`}
              </button>
            ))}
          </div>
        )}

        <div className={styles.diceWrap}>
          <DiceTray
            onRoll={onRoll}
            quickChecks={QUICK_CHECKS}
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
