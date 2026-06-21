'use client';
/**
 * DiceTray (ST-017 / ST-065) — the right-pane dice roller.
 *
 * Buttons emit a roll request to the play screen, which performs the client-side
 * Die animation and logs the result into the chat (server-authoritative /roll is
 * deferred — there's no engine roll endpoint yet, so these rolls are flavour, and
 * combat math stays engine-owned via the combat routes). Quick-check rows roll a
 * named d20 with the listed modifier.
 */
import Icon, { type IconName } from '@/components/Icon';
import styles from './DiceTray.module.css';

export type Advantage = 'none' | 'adv' | 'dis';

export interface QuickCheck {
  name: string;
  mod: number;
}

export interface DiceTrayProps {
  onRoll: (sides: number, label?: string, mod?: number) => void;
  quickChecks?: QuickCheck[];
  advantage?: Advantage;
  onAdvantage?: (next: Advantage) => void;
  disabled?: boolean;
}

const DICE: { sides: number; icon: IconName }[] = [
  { sides: 4, icon: 'D4' },
  { sides: 6, icon: 'D6' },
  { sides: 8, icon: 'D8' },
  { sides: 10, icon: 'D10' },
  { sides: 12, icon: 'D12' },
  { sides: 20, icon: 'D20' },
];

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export default function DiceTray({
  onRoll,
  quickChecks = [],
  advantage = 'none',
  onAdvantage,
  disabled = false,
}: DiceTrayProps) {
  return (
    <div className={styles.tray}>
      <div className={styles.label}>Roll</div>
      <div className={styles.diceGrid}>
        {DICE.map(({ sides, icon }) => (
          <button
            key={sides}
            type="button"
            className={styles.die}
            aria-label={`Roll d${sides}`}
            onClick={() => onRoll(sides, `d${sides}`)}
            disabled={disabled}
          >
            <Icon name={icon} size={18} aria-hidden />
            <span>d{sides}</span>
          </button>
        ))}
      </div>

      {quickChecks.length > 0 && (
        <>
          <div className={styles.label} style={{ marginTop: 16 }}>
            Quick checks
          </div>
          <ul className={styles.checks}>
            {quickChecks.map((q) => (
              <li key={q.name}>
                <button
                  type="button"
                  className={styles.checkRow}
                  onClick={() => onRoll(20, q.name, q.mod)}
                  disabled={disabled}
                >
                  <span>{q.name}</span>
                  <b className={styles.mono}>{signed(q.mod)}</b>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className={styles.advRow} role="group" aria-label="Roll modifier">
        {(['adv', 'none', 'dis'] as Advantage[]).map((a) => (
          <button
            key={a}
            type="button"
            className={advantage === a ? `${styles.advPill} ${styles.advOn}` : styles.advPill}
            aria-pressed={advantage === a}
            onClick={() => onAdvantage?.(a)}
          >
            {a === 'adv' ? 'advantage' : a === 'dis' ? 'disadvantage' : 'straight'}
          </button>
        ))}
      </div>
    </div>
  );
}
