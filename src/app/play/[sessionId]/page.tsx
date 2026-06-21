'use client';
/**
 * Play session — /play/[sessionId] (ST-060–065, ST-071, ST-062).
 *
 * The immersive 3-pane table where Suzu runs the game:
 *   left   — party roster (ST-061) + initiative (ST-020)
 *   centre — narrator strip (ST-018/071) + chat log (ST-019) + composer (ST-063)
 *   right  — scene placeholder + dice tray (ST-017/065) + safety tools
 *
 * State machine: idle → composing → narrating → idle, with a combat overlay
 * (out-of-combat → in-combat{round}). The engine owns mechanical truth — combat
 * actions go to the engine, which returns a result string we both log and feed to
 * the DM-narration pipeline so Suzu narrates the resolved beat (ST-062). Narration
 * streams over SSE (one guarded chunk) and reveals word-by-word client-side.
 *
 * v1 honesty: combat results are engine chat-strings (no structured turn JSON yet),
 * dice are client-side flavour (no server /roll endpoint), and real-time is SSE +
 * local optimistic state (no WebSocket — ST-072 deferred).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { titleizeChannel } from '@/lib/format';
import {
  getSession,
  getParticipants,
  startCombat,
  spawnMonster,
  rollInitiative,
  monsterTurn,
  attack as combatAttack,
  dodge as combatDodge,
  dash as combatDash,
  endTurn as combatEndTurn,
} from '@/lib/api/dnd';
import { streamDmNarration } from '@/lib/stream';
import type { Participant, Session } from '@/lib/api/types';
import Icon from '@/components/Icon';
import Pill from '@/components/Pill';
import PageSkeleton from '@/components/PageSkeleton';
import NarratorStrip from '@/components/NarratorStrip';
import ChatLog, { type ChatLogHandle, type LogRow } from '@/components/ChatLog';
import PartyPanel from '@/components/PartyPanel';
import InitiativeTracker, { type InitEntry } from '@/components/InitiativeTracker';
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
  const [round, setRound] = useState<number | null>(null);
  const [monsters, setMonsters] = useState<CombatTarget[]>([]);
  const [combatBusy, setCombatBusy] = useState(false);

  const idRef = useRef(0);
  const chatLogRef = useRef<ChatLogHandle>(null);
  const revealRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const narrationAbort = useRef<AbortController | null>(null);
  // Latest-log ref so narrate() can read recent transcript without re-creating
  // itself on every log change. Synced in an effect (never written during render).
  const logRef = useRef<LogRow[]>([]);
  useEffect(() => {
    logRef.current = log;
  }, [log]);

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
        setCombatId(s.active_combat_id ?? null);
        if (s.active_combat_id) setRound(1);
        setState('ok');
        const party = await getParticipants(sessionId, ctrl.signal).catch(
          () => [] as Participant[],
        );
        if (!ctrl.signal.aborted) setParticipants(party);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        // A 404 means the table closed/expired (or you're not at it) → distinct
        // copy from a transport failure. ApiError carries the HTTP status. (H-2)
        const status = (e as { status?: number } | null)?.status;
        setState(status === 404 ? 'notfound' : 'error');
      }
    })();
    return () => ctrl.abort();
  }, [username, sessionId]);

  // Re-pin the chat to the latest line when returning to the Story view —
  // display:none zeroes the log's scrollTop, and the rows effect won't re-fire
  // on a bare tab switch (Tora S3.3 MAJOR-2). 'instant' so it snaps, not crawls.
  useEffect(() => {
    if (mobileView === 'log') chatLogRef.current?.scrollToBottom('instant');
  }, [mobileView]);

  // ── cleanup streams/intervals on unmount ────────────────────────────────────
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
          }
        }
      } catch {
        errored = true;
      }

      if (ctrl.signal.aborted) return;
      setThinking(false);
      setTalking(false);
      if (errored || !full.trim()) {
        appendLog({
          who: 'Suzu',
          kind: 'system',
          text: 'Suzu stepped away for a moment. Try again.',
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
      // Named d20 checks get a Suzu reaction; bare dice just sit in the log.
      // Skip while narrating OR while a combat action is in flight, so a stray
      // roll can't abort/race the combat narration.
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

  // ── combat ──────────────────────────────────────────────────────────────────
  const beginEncounter = useCallback(async () => {
    if (!session || !username || combatBusy) return;
    setCombatBusy(true);
    try {
      const started = await startCombat({ username, channel: session.channel });
      const newId = started.combat_id ?? session.active_combat_id ?? null;
      if (!newId) {
        toast({ tone: 'error', message: 'Could not start combat.' });
        return;
      }
      setCombatId(newId);
      setRound(1);
      // A simple default encounter so the action loop is playable.
      await spawnMonster({ username, combat_id: newId, monster: 'goblin', count: 2 }).catch(
        () => null,
      );
      setMonsters([
        { id: 'goblin-1', name: 'Goblin', hp: null, maxHp: null },
        { id: 'goblin-2', name: 'Goblin', hp: null, maxHp: null },
      ]);
      await rollInitiative({ username, combat_id: newId }).catch(() => null);
      appendLog({
        who: 'Suzu',
        kind: 'system',
        text: 'Combat begins — two goblins close in. Roll initiative.',
      });
      void narrate(
        'We are ambushed!',
        'Two goblins burst from cover and combat starts. Set the scene.',
        'act',
      );
    } catch {
      toast({ tone: 'error', message: 'Could not start combat.' });
    } finally {
      setCombatBusy(false);
    }
  }, [session, username, combatBusy, toast, appendLog, narrate]);

  const onCombatAction = useCallback(
    async (action: CombatAction, payload?: string) => {
      if (!session || !username || !combatId || combatBusy) return;
      setCombatBusy(true);
      try {
        let message = '';
        let playerLine = '';
        if (action === 'attack' && payload) {
          const res = await combatAttack({ username, combat_id: combatId, target: payload });
          message = res.message ?? `You attack ${payload}.`;
          playerLine = `I attack ${payload}.`;
        } else if (action === 'dodge') {
          const res = await combatDodge({ username, combat_id: combatId });
          message = res.message ?? 'You take the Dodge action.';
          playerLine = 'I dodge.';
        } else if (action === 'dash') {
          const res = await combatDash({ username, combat_id: combatId });
          message = res.message ?? 'You take the Dash action.';
          playerLine = 'I dash.';
        } else if (action === 'endturn') {
          const res = await combatEndTurn({ username, combat_id: combatId });
          message = res.message ?? 'You end your turn.';
          playerLine = 'I end my turn.';
        }
        appendLog({ who: username, kind: 'system', text: message });
        await narrate(playerLine, message, 'act');

        // After the player ends their turn, drive the monsters' turn too.
        if (action === 'endturn') {
          const mres = await monsterTurn({ username, combat_id: combatId }).catch(() => null);
          const mmsg = mres?.message;
          if (mmsg) {
            appendLog({ who: 'Suzu', kind: 'system', text: mmsg });
            await narrate('(the enemies act)', mmsg, 'act');
          }
          setRound((r) => (r ?? 1) + 1);
        }
      } catch {
        toast({ tone: 'error', message: 'That combat action did not land. Try again.' });
      } finally {
        setCombatBusy(false);
      }
    },
    [session, username, combatId, combatBusy, appendLog, narrate, toast],
  );

  // ── initiative entries (client-built; see InitiativeTracker note) ───────────
  const initEntries = useMemo<InitEntry[]>(() => {
    if (!combatId) return [];
    const self = (username ?? '').toLowerCase();
    const pcs: InitEntry[] = participants.map((p) => ({
      id: `pc-${p.username}`,
      name: p.character?.name ?? p.username,
      initiative: null,
      kind: 'pc',
      isYou: p.username.toLowerCase() === self,
    }));
    const mobs: InitEntry[] = monsters.map((m) => ({
      id: m.id,
      name: m.name,
      initiative: null,
      kind: 'monster',
    }));
    return [...pcs, ...mobs];
  }, [combatId, participants, monsters, username]);

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
  const statusPill = combatId ? (
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

  return (
    // id="main-content" so the global skip link has a valid target on /play too
    // (this route has no TavernShell <main id="main-content">) — Iro S3.4.
    <div id="main-content" className={`${styles.grid} ${mobileClass}`}>
      {/* mobile tab bar — switches which pane fills the single mobile column.
          aria-pressed exposes the active view to screen readers (S3.5). */}
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
        <PartyPanel participants={participants} selfUsername={username} />
        <InitiativeTracker entries={initEntries} round={round} />
      </aside>

      {/* CENTRE — narrator + log + composer */}
      <main id="play-pane-story" className={`${styles.pane} ${styles.center}`}>
        <NarratorStrip text={narratorText} talking={talking} status={statusPill} />
        <ChatLog ref={chatLogRef} rows={log} thinking={thinking} />
        <Composer
          value={msg}
          onChange={setMsg}
          mode={mode}
          onMode={setMode}
          onSend={onSend}
          disabled={talking}
          combat={
            combatId ? { targets: monsters, onAction: onCombatAction, busy: combatBusy } : null
          }
        />
      </main>

      {/* RIGHT — scene + dice + safety */}
      <aside id="play-pane-scene" className={`${styles.pane} ${styles.right}`}>
        <div className={styles.sceneHead}>
          <span className={styles.kicker}>Scene</span>
        </div>
        <div className={styles.scenePlaceholder}>
          <Icon name="Map" size={22} aria-hidden />
          <span>The tactical map arrives in a later sprint. Suzu narrates the scene above.</span>
        </div>

        {!combatId ? (
          <button
            type="button"
            className={styles.beginCombat}
            onClick={beginEncounter}
            disabled={combatBusy}
          >
            <Icon name="Sword" size={14} aria-hidden /> Begin an encounter
          </button>
        ) : (
          // role=status so the transition into combat is announced to SR users
          // who weren't focused here when it started (Iro S3.5 MAJOR-1).
          <div className={styles.combatNote} role="status" aria-live="polite">
            <Icon name="Sword" size={13} aria-hidden /> In combat · use the action rail in the composer
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
