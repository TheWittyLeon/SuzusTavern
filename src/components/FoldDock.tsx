'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import Icon, { type IconName } from '@/components/Icon';
import styles from './FoldDock.module.css';

/**
 * R20's foldable dock (TAV-PLAY-SHELL, A9b fix round 1) — a docked region
 * whose preset placement is `collapsible: true`. Open, it renders `children`;
 * folded, the children stay MOUNTED but `hidden` (a singleton's heading id
 * and its inner state survive the fold) and a thin strip with a re-open
 * button stands in. The strip is what lets the grid track give the space
 * back: the row's column is `fit-content(<cap>)`, and this component's open
 * panel asks for more than any cap while the strip asks for ~one icon, so
 * the TRACK follows the fold with no row-data change and no second copy of
 * the width (the cap lives in `presets.ts` only).
 *
 * Generic on purpose: nothing here knows it holds a character sheet — the
 * tenth collapsible region is a prop set, not another component.
 *
 * Focus: the control that folds lives inside `children`, so a fold would
 * strand focus on a now-hidden button; folding moves it to the strip's
 * button, and unfolding FROM the strip moves it to `focusOnOpenRef` (the
 * children's close button). Unfolding any other way (e.g. picking a party
 * member) leaves focus where the user put it.
 */
export interface FoldDockProps {
  folded: boolean;
  onUnfold: () => void;
  /** Accessible name of the strip's re-open button. */
  openLabel: string;
  icon: IconName;
  /** Receives focus when the strip's button re-opens the dock. */
  focusOnOpenRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export default function FoldDock({
  folded,
  onUnfold,
  openLabel,
  icon,
  focusOnOpenRef,
  children,
}: FoldDockProps) {
  const stripRef = useRef<HTMLButtonElement>(null);
  const wasFolded = useRef(folded);
  const unfoldedFromStrip = useRef(false);

  useEffect(() => {
    if (folded && !wasFolded.current) stripRef.current?.focus();
    else if (!folded && wasFolded.current && unfoldedFromStrip.current) {
      focusOnOpenRef?.current?.focus();
    }
    unfoldedFromStrip.current = false;
    wasFolded.current = folded;
  }, [folded, focusOnOpenRef]);

  return (
    <>
      <div className={styles.panel} hidden={folded}>
        {children}
      </div>
      {folded && (
        <button
          ref={stripRef}
          type="button"
          className={styles.strip}
          aria-label={openLabel}
          aria-expanded={false}
          onClick={() => {
            unfoldedFromStrip.current = true;
            onUnfold();
          }}
        >
          <Icon name={icon} size={18} aria-hidden />
        </button>
      )}
    </>
  );
}
