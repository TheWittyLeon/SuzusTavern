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
import { useRef } from 'react';
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
  /**
   * A9d-2 N7 (Sora lever brief 2.3, Tora 4b): where the tray lives. `tray` (the default) is the stage's tenant, exactly as it always
   * was. `popover` is the Roll control's dialog on the phone: its three toolbars are ordered quick checks, roll modifier, DICE, in the DOM
   * and on screen, so the dice sit nearest the thumb (the popover opens upward from the composer); six dice across with 8px gaps, three by
   * two at 340px and under.
   */
  layout?: 'tray' | 'popover';
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

// Iro MINOR-2: the dice are a 3x2 grid; Up/Down step a row. One number drives
// both the CSS columns and the hook's row step so they cannot drift. A9d-2 (Tora
// A9d-1 MAJOR-1): that number is a row's to set (formerly `--play-dice-columns`, the phone row
// says 6: one row of six chips). The stylesheet is the source; the tray reads the
// column count the browser actually resolved, so the keys follow whatever the row
// asked for. DICE_COLUMNS is the default (and what jsdom, which resolves no grid, gets).
const DICE_COLUMNS = 3;

export default function DiceTray({
  onRoll,
  quickChecks = [],
  advantage = 'none',
  onAdvantage,
  disabled = false,
  layout = 'tray',
}: DiceTrayProps) {
  const popover = layout === 'popover';
  // A9c C5 (Iro IMPORTANT-2): three toolbars, one tab stop each, instead of
  // 6 + N + 3 stops in front of the composer. Names, roles-of-the-buttons and
  // `aria-pressed` are unchanged.
  const gridRef = useRef<HTMLDivElement>(null);
  const dice = useRovingToolbar({
    label: 'Dice',
    itemCount: DICE.length,
    // Read when a key is pressed: the resolved track list ("113px 113px 113px") has one token per
    // column. Nothing resolved (no layout engine, a detached node) is the default.
    columns: () => {
      const tracks = gridRef.current ? getComputedStyle(gridRef.current).gridTemplateColumns.trim().split(/\s+/) : [];
      return tracks.length > 1 ? tracks.length : DICE_COLUMNS;
    },
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
  const diceGrid = (
    <div
      ref={gridRef}
      className={popover ? `${styles.diceGrid} ${styles.diceGridPopover}` : styles.diceGrid}
      style={popover ? undefined : ({ '--dice-columns': DICE_COLUMNS } as React.CSSProperties)}
      {...dice.toolbarProps}
    >
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
  );

  const checkList =
    quickChecks.length > 0 ? (
      <>
        <div className={styles.label} style={popover ? undefined : { marginTop: 16 }}>
          Quick checks
        </div>
        <div {...checks.toolbarProps}>
          <ul className={styles.checks}>
            {quickChecks.map((q, i) => (
              <li key={q.name}>
                {/* FIX-7 (Iro HIGH-1): aria-label conveys action + skill + modifier so screen readers announce "Roll Perception check,
                    modifier +3" rather than just reading the visible label + modifier as separate elements. Mirrors the aria-label="Roll d20"
                    pattern on dice buttons. */}
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
    ) : null;

  const advRow = (
    <div className={popover ? `${styles.advRow} ${styles.advRowPopover}` : styles.advRow} {...adv.toolbarProps}>
      {ADVANTAGES.map((a, i) => {
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
  );

  // The tray (the stage's tenant): Roll label, dice, quick checks, modifier. The popover (the phone's Roll dialog): quick checks, modifier,
  // dice: the dice last, nearest the thumb.
  return popover ? (
    <div className={`${styles.tray} ${styles.trayPopover}`}>
      {checkList}
      {advRow}
      {diceGrid}
    </div>
  ) : (
    <div className={styles.tray}>
      <div className={styles.label}>Roll</div>
      {diceGrid}
      {checkList}
      {advRow}
    </div>
  );
}
