'use client';

import { useId, type ReactNode } from 'react';
import Icon, { type IconName } from '@/components/Icon';
import styles from './FoldDock.module.css';

/**
 * R20's foldable dock (TAV-PLAY-SHELL; A9b fix round 1, rebuilt A9c C7 as a
 * DISCLOSURE) — a region whose preset placement is `collapsible: true`.
 *
 * ONE handle button, present in both states, is the whole control. It comes
 * BEFORE the panel in the DOM (a disclosure's trigger precedes what it
 * discloses: a keyboard user reaches it without tabbing through the whole
 * sheet or stage first); when open it floats over the panel's corner by
 * absolute positioning, so the visual is unchanged.
 * `aria-label` is the stable `label` ("Character sheet"), `aria-expanded`
 * says which state it is in, `aria-controls` names the panel, and `title`
 * says what a press does ("Fold …" / "Open …"). It is the same DOM node in
 * both states, so focus stays on it across a toggle by construction — the
 * old two-button focus juggling (`focusOnOpenRef`) is gone.
 *
 * Open, the panel renders `children`; folded, the children stay MOUNTED but
 * `hidden` (a singleton's heading id and its inner state survive the fold).
 * The panel asks for more width than any track cap and the handle asks for
 * 44px, so a `fit-content(<cap>)` column follows the fold with no row-data
 * change and no second copy of the width (the cap lives in `presets.ts`).
 *
 * `foldable={false}` is the same tree in an inert mode (no handle, never
 * hidden, no landmark, `display: contents` so the children lay out as if the
 * dock were not there). The shell uses it where a region is collapsible in
 * SOME row but not this one, so a row switch changes the dock's mode and
 * never its place in the tree: the region's state survives (presets place,
 * they never unmount).
 *
 * Generic on purpose: nothing here knows what it holds. The shell is its only
 * caller (`PlayShell` reads `collapsible` and wraps the region's own node), so
 * the tenth collapsible region is a preset row plus a `FoldSpec`, not code.
 */
export interface FoldDockProps {
  folded: boolean;
  onToggle: () => void;
  /** Accessible name of the handle, stable across states. */
  label: string;
  icon: IconName;
  /** Id of the heading that names the panel. When given the panel is a
   *  `region` landmark labelled by it; when absent (the stage is already the
   *  "Scene" aside) the panel is a plain container — no duplicate landmark. */
  labelledBy?: string;
  /** Default true. False = inert (see above). */
  foldable?: boolean;
  children: ReactNode;
}

export default function FoldDock({
  folded,
  onToggle,
  label,
  icon,
  labelledBy,
  foldable = true,
  children,
}: FoldDockProps) {
  const panelId = useId();
  const isFolded = foldable && folded;
  return (
    <div className={styles.dock} data-foldable={foldable} data-folded={isFolded}>
      {foldable && (
        <button
          type="button"
          className={styles.handle}
          aria-label={label}
          aria-expanded={!folded}
          aria-controls={panelId}
          title={`${folded ? 'Open' : 'Fold'} ${label.toLowerCase()}`}
          onClick={onToggle}
        >
          <Icon name={icon} size={18} aria-hidden />
        </button>
      )}
      <div
        id={panelId}
        className={styles.panel}
        hidden={isFolded}
        role={foldable && labelledBy ? 'region' : undefined}
        aria-labelledby={foldable ? labelledBy : undefined}
      >
        {children}
      </div>
    </div>
  );
}
