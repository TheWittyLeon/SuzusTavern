'use client';
/**
 * Composer (ST-063 / CUI-11) — the message composer at the bottom of the centre pane.
 *
 * Say / Act / OOC mode tabs change placeholder + routing: Say & Act go to Suzu's
 * DM pipeline; OOC stays at the table (never sent to the AI). Enter sends,
 * Shift+Enter is a newline. When combat is active the ActionRail exposes the
 * engine-backed combat actions (attack with target picker, dodge, dash, end turn);
 * spell casting in combat (ST-066) is deferred.
 *
 * ADV-7/8 (CUI-11): CombatTarget now mirrors CombatParticipantState fields so the
 * target picker can display live HP and filter by can_be_targeted. The onAction
 * callback receives the participant_id (not the name) as payload for attack so the
 * play page can send target_id to the engine (name fallback retained for compat).
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/Icon';
import styles from './Composer.module.css';

export type ComposeMode = 'say' | 'act' | 'ooc' | 'dm_narration';
export type CombatAction = 'attack' | 'dodge' | 'dash' | 'endturn';

export interface CombatTarget {
  id: string;
  name: string;
  hp?: number | null;
  maxHp?: number | null;
}

export interface ComposerCombat {
  targets: CombatTarget[];
  /** Called with action + payload. For 'attack', payload is the target id
   *  (participant_id) — the play page maps this to target_id on the engine request.
   *  Backward-compat: callers that only have a name may pass the name; the play
   *  page falls back to `target` (name) when no id is available. */
  onAction: (action: CombatAction, payload?: string) => void;
  busy?: boolean;
  /** Whether it is the player's turn (disables Attack/Dodge/Dash when false). */
  isPlayerTurn?: boolean;
  /** Reason text to surface when an action was refused by the engine. */
  refusedReason?: string | null;
}

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  mode: ComposeMode;
  onMode: (m: ComposeMode) => void;
  onSend: () => void;
  disabled?: boolean;
  combat?: ComposerCombat | null;
  /** Override the available mode tabs. Defaults to ['say','act','ooc'].
   *  Human-DM sessions supply ['dm_narration','ooc']. */
  availableModes?: [ComposeMode, string][];
  /** Inline error message to display above the composer (e.g. on 5xx). */
  sendError?: string | null;
  /** When true the send button shows a spinner (submit pending). */
  pending?: boolean;
}

const PLACEHOLDER: Record<ComposeMode, string> = {
  say: 'Say something. Suzu will narrate back.',
  act: 'I climb the chimney quietly…',
  ooc: 'Out-of-character. Visible to the table, not the world.',
  dm_narration: 'Narrate the scene as DM… (or speak as an NPC above)',
};

const DEFAULT_MODES: [ComposeMode, string][] = [
  ['say', 'Say'],
  ['act', 'Act'],
  ['ooc', 'OOC'],
];

function ActionRail({ combat }: { combat: ComposerCombat }) {
  const [targetOpen, setTargetOpen] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const attackBtnRef = useRef<HTMLButtonElement>(null);

  const notYourTurn = combat.isPlayerTurn === false;

  // A11Y (Iro HIGH-3): announce "Your turn" when the turn flips to the player.
  // The notYourTurn div disappearing does NOT trigger a live-region update.
  // A separate polite live-region that changes from "" → "Your turn — choose an action"
  // is the only reliable way to notify screen-reader users without interrupting narration.
  const prevNotYourTurnRef = useRef<boolean | null>(null);
  const [turnAnnounce, setTurnAnnounce] = useState('');
  useEffect(() => {
    const prev = prevNotYourTurnRef.current;
    // Only fire on the false→true transition (was waiting, now it's our turn).
    if (prev === true && !notYourTurn) {
      setTurnAnnounce('Your turn — choose an action');
      const t = setTimeout(() => setTurnAnnounce(''), 4000);
      return () => clearTimeout(t);
    }
    prevNotYourTurnRef.current = notYourTurn;
  }, [notYourTurn]);

  // Outside-click dismissal. mousedown (not click) so that opening the menu via
  // the Attack button's own click doesn't immediately re-close it, and so that
  // menu items — which live INSIDE railRef — are never dismissed before their
  // click fires.
  useEffect(() => {
    if (!targetOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) setTargetOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [targetOpen]);

  // APG menu-button: move focus into the menu when it opens (keyboard users).
  useEffect(() => {
    if (targetOpen) {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
  }, [targetOpen]);

  const fire = (a: CombatAction, payload?: string) => {
    combat.onAction(a, payload);
    setTargetOpen(false);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setTargetOpen(false);
      attackBtnRef.current?.focus();
    } else if (e.key === 'Tab') {
      // A11Y (Iro MEDIUM-1): APG menu-button — Tab closes the menu and lets focus
      // move naturally. Without this the popup stays open after Tab-out.
      setTargetOpen(false);
      // Don't preventDefault: let the browser advance focus as normal.
    }
  };

  // Attack is disabled when: busy, no targets, or not the player's turn.
  const attackDisabled = combat.busy || combat.targets.length === 0 || notYourTurn;
  // Non-attack actions (dodge/dash) are also gated on turn.
  const actionDisabled = combat.busy || notYourTurn;

  return (
    <div className={styles.rail} ref={railRef}>
      {/* A11Y (Iro HIGH-3): polite live-region fires once when it becomes the player's
          turn. Kept visually hidden; the text clears after 4s to avoid stale state. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className={styles.srOnly}
      >
        {turnAnnounce}
      </div>
      {/* Refused-action reason — perceivable (not colour-only), sr-accessible. */}
      {combat.refusedReason && (
        <div
          className={styles.refusedReason}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {combat.refusedReason}
        </div>
      )}
      {/* Turn indicator — polite because it's informational, not urgent. */}
      {notYourTurn && (
        <div className={styles.notYourTurn} aria-live="polite" aria-atomic="true">
          Waiting for your turn…
        </div>
      )}
      <div className={styles.railBtns}>
        <button
          ref={attackBtnRef}
          type="button"
          className={targetOpen ? `${styles.action} ${styles.actionOn}` : styles.action}
          onClick={() => !attackDisabled && setTargetOpen((o) => !o)}
          disabled={attackDisabled}
          aria-disabled={attackDisabled}
          aria-expanded={targetOpen}
          aria-haspopup="menu"
          aria-label={
            notYourTurn
              ? 'Attack (not your turn)'
              : combat.targets.length === 0
                ? 'Attack (no valid targets)'
                : 'Attack'
          }
        >
          <Icon name="Sword" size={13} /> Attack
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={() => fire('dodge')}
          disabled={actionDisabled}
          aria-disabled={actionDisabled}
          aria-label={notYourTurn ? 'Dodge (not your turn)' : 'Dodge'}
        >
          <Icon name="Shield" size={13} /> Dodge
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={() => fire('dash')}
          disabled={actionDisabled}
          aria-disabled={actionDisabled}
          aria-label={notYourTurn ? 'Dash (not your turn)' : 'Dash'}
        >
          <Icon name="Compass" size={13} /> Dash
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={() => fire('endturn')}
          disabled={actionDisabled}
          aria-disabled={actionDisabled}
          aria-label={notYourTurn ? 'End turn (not your turn)' : 'End turn'}
        >
          <Icon name="Check" size={13} /> End turn
        </button>
      </div>
      {targetOpen && (
        <div
          className={styles.pop}
          role="menu"
          aria-label="Attack — pick a target"
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
        >
          {combat.targets.map((t) => (
            <button
              key={t.id}
              type="button"
              className={styles.popRow}
              role="menuitem"
              // Pass the participant_id as payload; play page uses it as target_id.
              onClick={() => fire('attack', t.id)}
            >
              <span className={styles.popDot} aria-hidden />
              <span className={styles.popName}>{t.name}</span>
              {t.hp != null && t.maxHp != null && (
                <span className={styles.popMeta} aria-label={`${t.hp} of ${t.maxHp} HP`}>
                  {t.hp}/{t.maxHp}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Composer({
  value,
  onChange,
  mode,
  onMode,
  onSend,
  disabled = false,
  combat = null,
  availableModes,
  sendError = null,
  pending = false,
}: ComposerProps) {
  // Use caller-supplied mode list if provided; default to the standard 3-tab set.
  const MODES = availableModes ?? DEFAULT_MODES;
  const canSend = value.trim().length > 0 && !disabled && !pending;
  // Refs to the mode tab buttons so Arrow keys move DOM focus (not just
  // selection) to the newly-active tab — APG tablist contract (Iro S3.4).
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevCombatRef = useRef<ComposerCombat | null>(null);

  // A11Y (Iro MEDIUM-3): when ActionRail unmounts (combat ends), keyboard focus is
  // dropped to <body>. Detect the null transition and restore focus to the textarea
  // — the next logical interaction point after combat ends.
  useEffect(() => {
    const prev = prevCombatRef.current;
    if (prev !== null && combat === null) {
      // Only steal focus if it was last inside the Composer area (don't yank from unrelated UI).
      textareaRef.current?.focus();
    }
    prevCombatRef.current = combat;
  }, [combat]);

  return (
    <div className={styles.composer}>
      {combat && <ActionRail combat={combat} />}
      {/* S5.2: inline error banner — text is preserved in the textarea on error. */}
      {sendError && (
        <div
          className={styles.sendError}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {sendError}
        </div>
      )}
      <div className={styles.row}>
        <div
          className={styles.modes}
          role="tablist"
          aria-label="Compose mode"
          onKeyDown={(e) => {
            const order = MODES.map(([k]) => k);
            const idx = order.indexOf(mode);
            let next = idx;
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              next = (idx + 1) % order.length;
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              next = (idx - 1 + order.length) % order.length;
            }
            if (next !== idx) {
              onMode(order[next]);
              // Move focus to the newly-active tab, not just the selection.
              tabRefs.current[next]?.focus();
            }
          }}
        >
          {MODES.map(([k, lbl], i) => (
            <button
              key={k}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={mode === k}
              // Roving tabindex: only the active tab is in the tab order; the
              // others are reached with Arrow keys (APG tabs pattern).
              tabIndex={mode === k ? 0 : -1}
              className={mode === k ? `${styles.mode} ${styles.modeOn}` : styles.mode}
              onClick={() => onMode(k)}
            >
              {lbl}
            </button>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          className={styles.input}
          placeholder={PLACEHOLDER[mode] ?? ''}
          value={value}
          rows={1}
          aria-label={`Compose (${mode})`}
          disabled={disabled || pending}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
        <button
          type="button"
          className={styles.send}
          disabled={!canSend}
          aria-label={pending ? 'Sending…' : 'Send'}
          aria-busy={pending}
          onClick={onSend}
        >
          {pending ? (
            <span className={styles.sendSpinner} aria-hidden />
          ) : (
            <Icon name="Send" size={14} />
          )}
        </button>
      </div>
    </div>
  );
}
