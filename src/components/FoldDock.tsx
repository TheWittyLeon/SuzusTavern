'use client';

import { createContext, useCallback, useContext, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
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
 * With `body`, only the part carrying `data-fold-body` folds (`.dock[data-folded='true']
 * [data-fold-body]` in the stylesheet); the panel itself is never `hidden`, so a
 * region's head, controls and live regions stay reachable (Iro A9d-1 IMPORTANT-1: a
 * folded stage must not take End combat and its announcer out of the page).
 *
 * `foldable={false}` is the same tree in an inert mode (no handle, never
 * hidden, no landmark, `display: contents` so the children lay out as if the
 * dock were not there). The shell uses it where a region is collapsible in
 * SOME row but not this one, so a row switch changes the dock's mode and
 * never its place in the tree: the region's state survives (presets place,
 * they never unmount).
 *
 * B8c-4 P0 (Amendment H.3-H.4; brief 2.3, 2.4, 4.4). In BODY mode the dock PROVIDES its handle and the region PLACES it (`FoldHandleSlot`): the stage puts it
 * on its scene line, after the encounter buttons, and the dock paints nothing of its own; a foldable body dock whose region renders no slot throws in development.
 * The dock also provides the folded state to the region (`useFoldBody`): the region puts the `hidden` attribute on its body element, so the removed-focus probe, the
 * AX tree and every engine agree the body is gone (a class alone is invisible to the probe, Iro F-n). A fold that takes focus out of the body moves it to the handle,
 * in this dock's own layout effect and only if focus was inside the body. While `lockedReason` is given (a safety banner is up) the handle is `aria-disabled`, still
 * focusable and described by that reason, and says it is not expanded.
 *
 * Generic on purpose: nothing here knows what it holds. The shell is its only
 * caller (`PlayShell` reads `collapsible` and wraps the region's own node), so
 * the tenth collapsible region is a preset row plus a `FoldSpec`, not code.
 */
export interface FoldDockProps {
  /** The fold's state as the shell resolved it. Open covers the measured default's `auto`: it is rendered open while its floor is measured. */
  folded: boolean;
  onToggle: () => void;
  /** Accessible name of the handle, stable across states. */
  label: string;
  icon: IconName;
  /** Id of the heading that names the panel. When given the panel is a
   *  `region` landmark labelled by it; when absent (the stage is already the
   *  "Scene" aside) the panel is a plain container — no duplicate landmark. */
  labelledBy?: string;
  /** Id of a `[data-fold-body]` part INSIDE `children` that is the only thing a fold
   *  hides (A9d-2 F1). The panel is then never `hidden`: everything else in it stays
   *  rendered, in the AX tree and focusable, and the handle's `aria-controls` names the
   *  body. Absent = the whole panel folds. */
  body?: string;
  /** Default true. False = inert (see above). */
  foldable?: boolean;
  /** Body mode: the handle's visible label (the word under the glyph). `label` stays the accessible name; the name contains this text (WCAG 2.5.3). */
  text?: string;
  /** Body mode: set while the fold cannot be used (a safety banner folded it). The handle is `aria-disabled`, focusable, `aria-expanded="false"` and described by this text. */
  lockedReason?: string;
  children: ReactNode;
}

interface FoldBodyContextValue {
  /** The body is folded: the region puts `hidden` on its body element. */
  folded: boolean;
  /** The handle, for `FoldHandleSlot` to place. Null outside a body dock. */
  handle: ReactNode;
  /** A slot mounted / unmounted (the dev check that a body dock's handle is placed). */
  claim: (on: boolean) => void;
}

const FoldBodyContext = createContext<FoldBodyContextValue>({ folded: false, handle: null, claim: () => {} });

/** The region's half of a body fold: is the body folded (put `hidden` on the body element). False outside a dock, so a region used alone never hides its body. */
export function useFoldBody(): boolean {
  return useContext(FoldBodyContext).folded;
}

/** Where a body dock's handle is drawn. A region renders it once, where the handle belongs in its own layout; with no body dock around it, it renders nothing. */
export function FoldHandleSlot() {
  const { handle, claim } = useContext(FoldBodyContext);
  useLayoutEffect(() => {
    claim(true);
    return () => claim(false);
  }, [claim]);
  return <>{handle}</>;
}

export default function FoldDock({
  folded,
  onToggle,
  label,
  icon,
  labelledBy,
  body,
  foldable = true,
  text,
  lockedReason,
  children,
}: FoldDockProps) {
  const panelId = useId();
  const nameId = useId();
  const reasonId = useId();
  const dockRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const claims = useRef(0);
  const claim = useCallback((on: boolean) => { claims.current += on ? 1 : -1; }, []);
  const isFolded = foldable && folded;
  const inBody = foldable && body !== undefined;
  const locked = inBody && lockedReason !== undefined;
  // ONE decision for everything that names the panel (role, aria-labelledby and the
  // prefix node): an inert dock (`foldable={false}`) can never take a role or a name,
  // by construction here rather than by each attribute remembering to check (Iro A9c-1 MINOR-3).
  const landmarkLabelledBy = foldable ? labelledBy : undefined;

  // A fold that takes focus out of the body hands it to the handle (brief 4.4), in this layout effect, in the commit that hides the body, and ONLY if focus was inside the body.
  // The effect runs after its children's: the region's own effects (and the slot's claim) have already run. The previous focus is read from the DOM before the browser blurs it.
  const prevFolded = useRef(isFolded);
  useLayoutEffect(() => {
    if (inBody && isFolded && !prevFolded.current) {
      const bodyEl = dockRef.current?.querySelector(`[id="${body}"]`);
      if (bodyEl && bodyEl.contains(document.activeElement)) handleRef.current?.focus({ preventScroll: true });
    }
    prevFolded.current = isFolded;
  });
  useLayoutEffect(() => {
    if (inBody && process.env.NODE_ENV !== 'production' && claims.current < 1) {
      throw new Error(`FoldDock: the body fold "${body}" has no <FoldHandleSlot /> in its region: a body dock provides its handle and the region places it`);
    }
  });

  const handle = foldable ? (
    <button
      ref={handleRef}
      type="button"
      className={inBody ? `${styles.handle} ${styles.handleBody}` : styles.handle}
      aria-label={label}
      aria-expanded={locked ? false : !folded}
      aria-controls={body ?? panelId}
      aria-disabled={locked ? true : undefined}
      aria-describedby={locked ? reasonId : undefined}
      // A locked handle's tooltip is its reason (a sighted hover or long-press user reads it; `aria-describedby` serves assistive technology), never "Open map" over a press that does nothing.
      title={locked ? lockedReason : `${folded ? 'Open' : 'Fold'} ${label.toLowerCase()}`}
      onClick={locked ? undefined : onToggle}
    >
      {inBody ? (
        <>
          <span className={styles.handleTop}>
            <Icon name={icon} size={18} aria-hidden />
            <Icon name="Chevron" size={12} className={folded ? styles.chevronFolded : styles.chevronOpen} aria-hidden />
          </span>
          {text !== undefined && <span className={styles.handleText}>{text}</span>}
          {locked && <span id={reasonId} hidden>{lockedReason}</span>}
        </>
      ) : (
        // The plain dock's handle is the glyph and nothing else, as it always was (the character sheet's: same markup to the byte).
        <Icon name={icon} size={18} aria-hidden />
      )}
    </button>
  ) : null;

  return (
    <div ref={dockRef} className={styles.dock} data-foldable={foldable} data-folded={isFolded} data-has-body={body !== undefined ? 'true' : undefined}>
      {!inBody && handle}
      {landmarkLabelledBy && (
        // The region's name is "<label>: <heading>" ("Character sheet: Kestrel Ashwood"),
        // not the bare heading: the type of thing is part of the name (WCAG 2.4.6).
        // `hidden` is fine for an aria-labelledby target; it is never rendered.
        <span id={nameId} hidden>
          {`${label}:`}
        </span>
      )}
      <div
        id={panelId}
        className={styles.panel}
        hidden={isFolded && body === undefined}
        role={landmarkLabelledBy ? 'region' : undefined}
        aria-labelledby={landmarkLabelledBy ? `${nameId} ${landmarkLabelledBy}` : undefined}
      >
        <FoldBodyContext.Provider value={{ folded: isFolded, handle: inBody ? handle : null, claim }}>{children}</FoldBodyContext.Provider>
      </div>
    </div>
  );
}
