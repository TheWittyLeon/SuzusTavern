'use client';
/**
 * Composer (ST-063) — the message composer at the bottom of the centre pane.
 *
 * Say / Act / OOC mode tabs change placeholder + routing: Say & Act go to Suzu's
 * DM pipeline; OOC stays at the table (never sent to the AI). Enter sends,
 * Shift+Enter is a newline. When combat is active the ActionRail exposes the
 * engine-backed combat actions (attack with target picker, dodge, dash, end turn);
 * spell casting in combat (ST-066) is deferred.
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/Icon';
import styles from './Composer.module.css';

export type ComposeMode = 'say' | 'act' | 'ooc';
export type CombatAction = 'attack' | 'dodge' | 'dash' | 'endturn';

export interface CombatTarget {
  id: string;
  name: string;
  hp?: number | null;
  maxHp?: number | null;
}

export interface ComposerCombat {
  targets: CombatTarget[];
  onAction: (action: CombatAction, payload?: string) => void;
  busy?: boolean;
}

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  mode: ComposeMode;
  onMode: (m: ComposeMode) => void;
  onSend: () => void;
  disabled?: boolean;
  combat?: ComposerCombat | null;
}

const PLACEHOLDER: Record<ComposeMode, string> = {
  say: 'Say something. Suzu will narrate back.',
  act: 'I climb the chimney quietly…',
  ooc: 'Out-of-character. Visible to the table, not the world.',
};

const MODES: [ComposeMode, string][] = [
  ['say', 'Say'],
  ['act', 'Act'],
  ['ooc', 'OOC'],
];

function ActionRail({ combat }: { combat: ComposerCombat }) {
  const [targetOpen, setTargetOpen] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const attackBtnRef = useRef<HTMLButtonElement>(null);

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
    }
  };

  return (
    <div className={styles.rail} ref={railRef}>
      <div className={styles.railBtns}>
        <button
          ref={attackBtnRef}
          type="button"
          className={targetOpen ? `${styles.action} ${styles.actionOn}` : styles.action}
          onClick={() => setTargetOpen((o) => !o)}
          disabled={combat.busy || combat.targets.length === 0}
          aria-expanded={targetOpen}
          aria-haspopup="menu"
        >
          <Icon name="Sword" size={13} /> Attack
        </button>
        <button type="button" className={styles.action} onClick={() => fire('dodge')} disabled={combat.busy}>
          <Icon name="Shield" size={13} /> Dodge
        </button>
        <button type="button" className={styles.action} onClick={() => fire('dash')} disabled={combat.busy}>
          <Icon name="Compass" size={13} /> Dash
        </button>
        <button type="button" className={styles.action} onClick={() => fire('endturn')} disabled={combat.busy}>
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
              onClick={() => fire('attack', t.name)}
            >
              <span className={styles.popDot} aria-hidden />
              <span className={styles.popName}>{t.name}</span>
              {t.hp != null && t.maxHp != null && (
                <span className={styles.popMeta}>
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
}: ComposerProps) {
  const canSend = value.trim().length > 0 && !disabled;
  // Refs to the mode tab buttons so Arrow keys move DOM focus (not just
  // selection) to the newly-active tab — APG tablist contract (Iro S3.4).
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  return (
    <div className={styles.composer}>
      {combat && <ActionRail combat={combat} />}
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
          className={styles.input}
          placeholder={PLACEHOLDER[mode]}
          value={value}
          rows={1}
          aria-label={`Compose (${mode})`}
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
          aria-label="Send"
          onClick={onSend}
        >
          <Icon name="Send" size={14} />
        </button>
      </div>
    </div>
  );
}
