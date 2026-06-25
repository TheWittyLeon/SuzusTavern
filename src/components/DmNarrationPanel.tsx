'use client';
/**
 * DmNarrationPanel (S5.3) — Human-DM monster control surface.
 *
 * Rendered only when isDm && session.dm_mode === 'human' and combat is active.
 *
 * Features:
 *   - Monster roster: name, hp bar, conditions chip list
 *   - On the monster's turn: Attack (dropdown of living PCs), Skip, Move buttons
 *   - Speak-as-NPC: per-monster prompt that posts a dm_narration event with
 *     data.npc_name set so the ChatLog renders it as "${npc_name} (NPC)"
 *   - Inline error display on 400 refusals (not_npc_turn, npc_incapacitated, etc.)
 *   - Button convenience-state mirrors server truth; stale-click errors trigger a
 *     state refresh via the onStateRefresh callback
 *
 * Props:
 *   combatId     — active combat id
 *   combatState  — CombatState from the play page (polled + mutation-refreshed)
 *   sessionId    — for the dm_narration event POST
 *   onMessage    — append a message to the play-page chat log
 *   onStateUpdate — called with a new CombatState after a successful npc-action
 *   onStateRefresh — called when a stale error arrives; triggers a getCombatState poll
 */
import { useRef, useState } from 'react';
import { npcAction, postSessionEvent, setSessionPolicy } from '@/lib/api/dnd';
import type { CombatParticipantState, CombatState } from '@/lib/api/types';
import DmOverrideModal from '@/components/DmOverrideModal';
import Icon from '@/components/Icon';
import styles from './DmNarrationPanel.module.css';

export interface DmNarrationPanelProps {
  combatId: string;
  combatState: CombatState;
  sessionId: string;
  dmUsername: string;
  /** S5.4 — initial value from session.dm_override_player_visible (default true). */
  overridePlayerVisible?: boolean;
  onMessage: (text: string) => void;
  /** S5.4 — called with the resolved message after a successful override; caller
   *  should append this with kind='dm_override' so ChatLog renders it distinctly. */
  onOverrideMessage?: (text: string) => void;
  onStateUpdate: (state: CombatState) => void;
  onStateRefresh: () => void;
}

/** Engine refusal codes → readable copy. */
function refusalCopy(code: string): string {
  const map: Record<string, string> = {
    not_dm: 'Only the DM can drive monster turns.',
    not_npc_turn: "It's not this monster's turn.",
    npc_incapacitated: 'That monster is incapacitated.',
    npc_not_a_monster: 'That participant is not a monster.',
    target_required: 'Pick a target to attack.',
    combat_not_active: 'Combat is not active.',
  };
  return map[code] ?? `Action refused: ${code}`;
}

/** Living PC participants (valid attack targets). */
function livingPcTargets(participants: CombatParticipantState[]) {
  return participants.filter((p) => p.is_pc && p.is_alive && p.can_be_targeted);
}

interface MonsterRowProps {
  monster: CombatParticipantState;
  isCurrentTurn: boolean;
  pcTargets: CombatParticipantState[];
  combatId: string;
  sessionId: string;
  dmUsername: string;
  onMessage: (text: string) => void;
  onStateUpdate: (state: CombatState) => void;
  onStateRefresh: () => void;
}

function MonsterRow({
  monster,
  isCurrentTurn,
  pcTargets,
  combatId,
  sessionId,
  dmUsername,
  onMessage,
  onStateUpdate,
  onStateRefresh,
}: MonsterRowProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetOpen, setTargetOpen] = useState(false);
  const [speakOpen, setSpeakOpen] = useState(false);
  const [speakText, setSpeakText] = useState('');
  const [speakPending, setSpeakPending] = useState(false);
  const [speakError, setSpeakError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const attackBtnRef = useRef<HTMLButtonElement>(null);

  const hpPct =
    monster.hp_max > 0
      ? Math.max(0, Math.min(100, (monster.hp_current / monster.hp_max) * 100))
      : 0;

  const fireAction = async (
    action: 'attack' | 'skip' | 'move',
    targetId?: string,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setTargetOpen(false);
    try {
      const res = await npcAction(combatId, {
        participant_id: monster.participant_id,
        action,
        target_id: targetId,
      });
      // The proxy may nest the state under data.state or surface it top-level.
      const newState =
        (res as { data?: { state?: CombatState } })?.data?.state ??
        (res as { state?: CombatState })?.state ??
        null;
      const msg =
        (res as { message?: string })?.message ??
        (res as { data?: { applied?: { message?: string } } })?.data?.applied?.message ??
        null;
      if (msg) onMessage(msg);
      if (newState) onStateUpdate(newState);
    } catch (err) {
      const body = (err as { body?: unknown } | null)?.body;
      const data = (body as { data?: { reason?: string; state?: CombatState } } | null)?.data;
      const reason = data?.reason;
      // If the engine returned a stale-turn error, refresh state then display it.
      if (reason === 'not_npc_turn' && data?.state) {
        onStateUpdate(data.state);
      } else if (reason === 'not_npc_turn') {
        onStateRefresh();
      }
      setError(refusalCopy(reason ?? ''));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const submitSpeak = async () => {
    const text = speakText.trim();
    if (!text || speakPending) return;
    setSpeakPending(true);
    setSpeakError(null);
    try {
      await postSessionEvent(sessionId, {
        kind: 'dm_narration',
        actor_username: dmUsername,
        data: { text, npc_name: monster.name },
        visibility: 'table',
      });
      // On success: append to log via the caller, clear text.
      onMessage(`[NPC – ${monster.name}] ${text}`);
      setSpeakText('');
      setSpeakOpen(false);
    } catch {
      setSpeakError('Could not send. Try again.');
    } finally {
      setSpeakPending(false);
    }
  };

  const isDown = !monster.is_alive;

  return (
    <div
      className={`${styles.monsterCard} ${isCurrentTurn ? styles.activeTurn : ''} ${isDown ? styles.down : ''}`}
      aria-label={`${monster.name}${isCurrentTurn ? ', current turn' : ''}${isDown ? ', defeated' : ''}`}
    >
      {/* Name + HP bar */}
      <div className={styles.monsterHeader}>
        <span className={styles.monsterName}>{monster.name}</span>
        {isCurrentTurn && (
          <span className={styles.turnBadge} aria-label="Current turn">
            Turn
          </span>
        )}
      </div>
      <div className={styles.hpRow}>
        <div
          className={styles.hpBar}
          role="meter"
          aria-label={`${monster.name} HP`}
          aria-valuenow={monster.hp_current}
          aria-valuemax={monster.hp_max}
          aria-valuemin={0}
        >
          <div
            className={`${styles.hpFill} ${hpPct <= 25 ? styles.hpLow : hpPct <= 60 ? styles.hpMid : ''}`}
            style={{ width: `${hpPct}%` }}
          />
        </div>
        <span className={styles.hpLabel} aria-hidden>
          {monster.hp_current}/{monster.hp_max}
        </span>
      </div>

      {/* Conditions */}
      {monster.conditions.length > 0 && (
        <div className={styles.conditions} aria-label={`Conditions: ${monster.conditions.join(', ')}`}>
          {monster.conditions.map((c) => (
            <span key={c} className={styles.conditionChip}>{c}</span>
          ))}
        </div>
      )}

      {/* Inline error */}
      {error && (
        <div className={styles.npcError} role="alert" aria-live="assertive">
          {error}
        </div>
      )}

      {/* Action buttons — only on this monster's turn */}
      {isCurrentTurn && !isDown && (
        <div className={styles.npcActions}>
          {/* Attack dropdown */}
          <div className={styles.npcAttackWrap}>
            <button
              ref={attackBtnRef}
              type="button"
              className={`${styles.npcBtn} ${styles.npcBtnAttack} ${targetOpen ? styles.npcBtnOn : ''}`}
              disabled={busy || pcTargets.length === 0}
              aria-disabled={busy || pcTargets.length === 0}
              aria-expanded={targetOpen}
              aria-haspopup="menu"
              aria-label={pcTargets.length === 0 ? 'Attack (no valid targets)' : 'Attack — pick target'}
              onClick={() =>
                !busy && pcTargets.length > 0 && setTargetOpen((o) => !o)
              }
            >
              <Icon name="Sword" size={12} aria-hidden /> Attack
            </button>
            {targetOpen && (
              <div
                className={styles.npcTargetMenu}
                role="menu"
                aria-label={`${monster.name} — pick target`}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setTargetOpen(false);
                    attackBtnRef.current?.focus();
                  }
                }}
              >
                {pcTargets.map((t) => (
                  <button
                    key={t.participant_id}
                    type="button"
                    className={styles.npcTargetItem}
                    role="menuitem"
                    onClick={() => void fireAction('attack', t.participant_id)}
                  >
                    <span className={styles.npcTargetDot} aria-hidden />
                    <span className={styles.npcTargetName}>{t.name}</span>
                    <span className={styles.npcTargetHp} aria-label={`${t.hp_current} of ${t.hp_max} HP`}>
                      {t.hp_current}/{t.hp_max}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className={styles.npcBtn}
            disabled={busy}
            aria-disabled={busy}
            aria-label="Skip monster turn"
            onClick={() => void fireAction('skip')}
          >
            Skip
          </button>
          <button
            type="button"
            className={styles.npcBtn}
            disabled={busy}
            aria-disabled={busy}
            aria-label="Move monster"
            onClick={() => void fireAction('move')}
          >
            <Icon name="Compass" size={12} aria-hidden /> Move
          </button>
        </div>
      )}

      {/* Speak-as-NPC */}
      {!isDown && (
        <div className={styles.speakWrap}>
          <button
            type="button"
            className={styles.speakToggle}
            aria-expanded={speakOpen}
            aria-label={`Speak as ${monster.name}`}
            onClick={() => {
              setSpeakOpen((o) => !o);
              setSpeakError(null);
            }}
          >
            <Icon name="Chat" size={11} aria-hidden />
            Speak as {monster.name}
          </button>
          {speakOpen && (
            <div className={styles.speakForm}>
              {speakError && (
                <div className={styles.speakError} role="alert">{speakError}</div>
              )}
              <textarea
                className={styles.speakInput}
                placeholder={`${monster.name} says…`}
                value={speakText}
                rows={2}
                aria-label={`${monster.name} dialogue`}
                disabled={speakPending}
                onChange={(e) => setSpeakText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submitSpeak();
                  }
                }}
              />
              <div className={styles.speakActions}>
                <button
                  type="button"
                  className={styles.speakSend}
                  disabled={!speakText.trim() || speakPending}
                  aria-busy={speakPending}
                  aria-label="Send NPC dialogue"
                  onClick={() => void submitSpeak()}
                >
                  {speakPending ? 'Sending…' : 'Send'}
                </button>
                <button
                  type="button"
                  className={styles.speakCancel}
                  disabled={speakPending}
                  onClick={() => {
                    setSpeakOpen(false);
                    setSpeakText('');
                    setSpeakError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DmNarrationPanel({
  combatId,
  combatState,
  sessionId,
  dmUsername,
  overridePlayerVisible = true,
  onMessage,
  onOverrideMessage,
  onStateUpdate,
  onStateRefresh,
}: DmNarrationPanelProps) {
  const monsters = combatState.participants.filter(
    (p) => !p.is_pc,
  );
  const pcTargets = livingPcTargets(combatState.participants);

  // S5.4: override modal state
  const [overrideOpen, setOverrideOpen] = useState(false);

  // S5.4: visibility toggle (optimistic local state, persisted via setSessionPolicy)
  const [overrideVisible, setOverrideVisible] = useState(overridePlayerVisible);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const handleOverrideSuccess = (
    message: string,
    newState: CombatState | undefined,
  ) => {
    setOverrideOpen(false);
    // Route override messages through the dedicated callback (dm_override kind)
    // so ChatLog renders them with the amber ruling treatment. Fall back to the
    // generic onMessage with a "DM ruled:" prefix if no dedicated callback is set.
    if (onOverrideMessage) {
      onOverrideMessage(message);
    } else {
      onMessage(`DM ruled: ${message}`);
    }
    if (newState) {
      onStateUpdate(newState);
    }
  };

  const handleToggleVisible = async () => {
    if (toggleBusy) return;
    const next = !overrideVisible;
    setOverrideVisible(next);  // optimistic
    setToggleBusy(true);
    setToggleError(null);
    try {
      await setSessionPolicy(sessionId, { dm_override_player_visible: next });
    } catch {
      // Rollback optimistic update on failure
      setOverrideVisible(!next);
      setToggleError('Could not update visibility. Try again.');
    } finally {
      setToggleBusy(false);
    }
  };

  return (
    <section
      className={styles.panel}
      aria-label="DM monster control"
    >
      <div className={styles.panelLabel}>Monster control</div>

      {/* S5.4: DM Override button + visibility toggle — DM-seat only (parent gates render) */}
      <div className={styles.dmControls}>
        <button
          type="button"
          className={styles.overrideBtn}
          aria-label="Open DM override modal"
          onClick={() => setOverrideOpen(true)}
        >
          <Icon name="Sword" size={11} aria-hidden /> DM Override
        </button>

        <label className={styles.visibilityToggle}>
          <input
            type="checkbox"
            className={styles.visibilityCheckbox}
            checked={overrideVisible}
            disabled={toggleBusy}
            aria-label="Show my overrides to players"
            onChange={() => void handleToggleVisible()}
          />
          <span className={styles.visibilityLabel}>
            Show overrides to players
          </span>
        </label>

        {toggleError && (
          <div className={styles.toggleError} role="alert">
            {toggleError}
          </div>
        )}
      </div>

      {monsters.length > 0 && monsters.map((m) => (
        <MonsterRow
          key={m.participant_id}
          monster={m}
          isCurrentTurn={m.participant_id === combatState.active_participant_id}
          pcTargets={pcTargets}
          combatId={combatId}
          sessionId={sessionId}
          dmUsername={dmUsername}
          onMessage={onMessage}
          onStateUpdate={onStateUpdate}
          onStateRefresh={onStateRefresh}
        />
      ))}

      {/* S5.4: Override modal — rendered at this level so it can see all participants */}
      <DmOverrideModal
        open={overrideOpen}
        combatId={combatId}
        participants={combatState.participants}
        defaultActorId={combatState.active_participant_id}
        onSuccess={handleOverrideSuccess}
        onClose={() => setOverrideOpen(false)}
      />
    </section>
  );
}
