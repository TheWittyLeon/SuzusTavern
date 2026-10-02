'use client';

import { useRef, useState } from 'react';
import AnchoredPopover from '@/components/AnchoredPopover';
import DiceTray, { type Advantage, type DiceTrayProps } from '@/components/DiceTray';
import Icon from '@/components/Icon';
import { useAnchoredPopover } from '@/lib/a11y/useAnchoredPopover';
import styles from './RollControl.module.css';

/**
 * A9d-2 fix round N7 (Sora lever brief 2.3; Tora 4a-4b, 5; Iro 4, 6) — the phone's dice: a labelled **Roll** button in the composer's mode
 * row that opens the dice tray in an anchored popover.
 *
 * Why: the dice were the stage's tenant, 357px of tray in a band that could not hold them (0 of 58px visible at rest on a 390x844 phone). The
 * composer is the one region present in both moments and has the width: Roll beside Say / Act / OOC is about 125px of 366 with "· Dis".
 *
 * - The button is a 44px target: the die icon and the visible text "Roll", or "Roll · Adv" / "Roll · Dis" while a modifier is on (a hidden
 *   toggle must not silently change a public roll: Tora 5). Its accessible name is "Roll · Advantage" / "Roll · Disadvantage": it BEGINS with
 *   the visible text, so the label is in the name (WCAG 2.5.3), and says the modifier in full.
 * - It opens `DiceTray layout="popover"` (quick checks, modifier, dice: the dice nearest the thumb). On open focus goes to the first die.
 * - A die or a check rolled closes the popover on that click and returns focus to Roll, so the result is seen: it is announced by the story
 *   log, which is `role="log" aria-live="polite"` (ChatLog.tsx; pinned by ChatLog.test "a roll row renders INSIDE role=log"). A modifier change does NOT close it.
 *   While a roll is busy the dice stay `aria-disabled` (the tray's own `disabled`), and a click on one rolls and closes nothing.
 * - The tray is mounted only while the popover is open: it remounts when the row changes (desktop <-> phone); the modifier lives in the page
 *   (`advantage`), so it survives. If Roll itself is gone (the row switched under an open popover) focus falls to `fallbackFocus`, the scene head.
 *
 * `data-roll-control` marks the button for the browser harness (o:restControls, z:modeRow, the roll-popover legs).
 */
export interface RollControlProps extends Omit<DiceTrayProps, 'layout'> {
  /** Where focus goes if Roll is gone when the popover closes (the scene head): never <body>. */
  fallbackFocus?: () => HTMLElement | null | undefined;
}

const SHORT: Record<Advantage, string | null> = { none: null, adv: 'Adv', dis: 'Dis' };
const FULL: Record<Advantage, string | null> = { none: null, adv: 'Advantage', dis: 'Disadvantage' };

export default function RollControl({ onRoll, quickChecks, advantage = 'none', onAdvantage, disabled, fallbackFocus }: RollControlProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const pop = useAnchoredPopover({
    open,
    onClose: () => setOpen(false),
    anchorRef,
    role: 'dialog',
    initialFocus: '[role="toolbar"][aria-label="Dice"] button',
    fallbackFocus,
  });
  const short = SHORT[advantage];
  const full = FULL[advantage];
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={styles.roll}
        data-roll-control=""
        onClick={() => setOpen((o) => !o)}
        aria-label={full ? `Roll · ${full}` : 'Roll'}
        {...pop.anchorProps}
      >
        <Icon name="D20" size={16} aria-hidden />
        <span>{short ? `Roll · ${short}` : 'Roll'}</span>
      </button>
      <AnchoredPopover pop={pop} role="dialog" label="Roll dice" className={styles.popover}>
        <DiceTray
          layout="popover"
          quickChecks={quickChecks}
          advantage={advantage}
          onAdvantage={onAdvantage}
          disabled={disabled}
          // The roll closes it on that click; a disabled die never calls this (DiceTray's `press` ignores it), so nothing closes on a no-op.
          onRoll={(trigger) => {
            onRoll(trigger);
            setOpen(false);
          }}
        />
      </AnchoredPopover>
    </>
  );
}
