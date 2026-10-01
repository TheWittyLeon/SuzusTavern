'use client';
/**
 * DiceTray (ST-017 / ST-065) — the right-pane dice roller.
 *
 * DDX-08 / T3: buttons emit a `RollTrigger` describing WHAT to roll — they no
 * longer compute an outcome. The play screen POSTs the trigger to the
 * server-authoritative /roll route (DDX-07); the engine resolves the dice AND
 * any character-sheet modifier and persists the result as a session event.
 * Every client (including the one that clicked) renders the roll from that
 * event stream, never from a local computation — see page.tsx's onRoll.
 * Quick-check rows carry the engine skill slug (`skill`) alongside the
 * display name/modifier so the request names a real sheet skill.
 */
import Icon, { type IconName } from '@/components/Icon';
import { useRovingToolbar } from '@/lib/a11y/useRovingToolbar';
import styles from './DiceTray.module.css';

export type Advantage = 'none' | 'adv' | 'dis';

export interface QuickCheck {
  /** Display name, title-cased (e.g. "Sleight of Hand"). */
  name: string;
  /** Engine skill slug, snake_case (e.g. "sleight_of_hand") — sent to /roll. */
  skill: string;
  /** Sheet modifier — display-only (the server independently resolves its
   *  own modifier off the character's sheet; this is never sent to /roll). */
  mod: number;
}

/** What to roll. The plain dice grid rolls a raw d{sides}; quick-check rows
 *  roll a named skill (server resolves the modifier + advantage). */
export type RollTrigger =
  | { kind: 'die'; sides: number }
  | { kind: 'check'; skill: string; label: string };

export interface DiceTrayProps {
  onRoll: (trigger: RollTrigger) => void;
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

const ADVANTAGES: Advantage[] = ['adv', 'none', 'dis'];

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
  // A9c C5 (Iro IMPORTANT-2): three toolbars, one tab stop each, instead of
  // 6 + N + 3 stops in front of the composer. Names, roles-of-the-buttons and
  // `aria-pressed` are unchanged.
  const dice = useRovingToolbar({
    label: 'Dice',
    itemCount: DICE.length,
  });
  const checks = useRovingToolbar({
    label: 'Quick checks',
    orientation: 'vertical',
    itemCount: quickChecks.length,
  });
  const adv = useRovingToolbar({ label: 'Roll modifier', itemCount: ADVANTAGES.length });
  // Iro A9c-1 IMPORTANT-1: `aria-disabled`, never native `disabled`. Native
  // disabled blurred the focused die on every roll (activeElement -> <body>)
  // and the roving hook then had no tab stop until the roll settled. This is
  // the X-card pattern: the button stays focusable, announces as disabled, and
  // the click is swallowed here. The synchronous double-submit latch for a
  // roll already in flight is `rollBusyRef` in useDice; this guard covers the
  // other reasons the tray is off (talking, combat busy, session locked).
  const press = (trigger: RollTrigger) => {
    if (disabled) return;
    onRoll(trigger);
  };
  const off = disabled || undefined;
  return (
    <div className={styles.tray}>
      <div className={styles.label}>Roll</div>
      <div className={styles.diceGrid} {...dice.toolbarProps}>
        {DICE.map(({ sides, icon }, i) => (
          <button
            key={sides}
            {...dice.itemProps(i)}
            type="button"
            className={styles.die}
            aria-label={`Roll d${sides}`}
            onClick={() => press({ kind: 'die', sides })}
            aria-disabled={off}
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
          <div {...checks.toolbarProps}>
            <ul className={styles.checks}>
              {quickChecks.map((q, i) => (
                <li key={q.name}>
                  {/* FIX-7 (Iro HIGH-1): aria-label conveys action + skill + modifier
                      so screen readers announce "Roll Perception check, modifier +3"
                      rather than just reading the visible label + modifier as separate
                      elements. Mirrors the aria-label="Roll d20" pattern on dice buttons. */}
                  <button
                    type="button"
                    {...checks.itemProps(i)}
                    className={styles.checkRow}
                    aria-label={`Roll ${q.name} check, modifier ${q.mod >= 0 ? '+' : ''}${q.mod}`}
                    onClick={() => press({ kind: 'check', skill: q.skill, label: q.name })}
                    aria-disabled={off}
                  >
                    <span>{q.name}</span>
                    <b className={styles.mono}>{signed(q.mod)}</b>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <div className={styles.advRow} {...adv.toolbarProps}>
        {ADVANTAGES.map((a, i) => {
          // UIR2-TAV-24: full word kept as the button's accessible name
          // (aria-label) — only the VISIBLE label shortens. "disadvantage"
          // (12 chars) was the one pill that didn't fit its ~1/3 share of the
          // 228px content column at desktop widths, wrapping onto its own
          // second row while advantage+straight stayed on the first (read as
          // two broken rows, not one clean group). Shortening it (and
          // "advantage" too, for a visually balanced group) keeps all three
          // on one row without shrinking the 44px touch target or the
          // spoken/announced label.
          const full = a === 'adv' ? 'advantage' : a === 'dis' ? 'disadvantage' : 'straight';
          const short = a === 'adv' ? 'Adv' : a === 'dis' ? 'Dis' : 'Straight';
          return (
            <button
              key={a}
              type="button"
              {...adv.itemProps(i)}
              className={advantage === a ? `${styles.advPill} ${styles.advOn}` : styles.advPill}
              aria-pressed={advantage === a}
              aria-label={full}
              onClick={() => onAdvantage?.(a)}
            >
              {short}
            </button>
          );
        })}
      </div>
    </div>
  );
}
