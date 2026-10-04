'use client';
/**
 * B8c-4 P1c (Sora's phone-mount brief 7.3; Aoi A section 13) — the party band's "Turn order" button. On a phone the initiative tracker sits BELOW the tile row in a 91px band, so at rest it
 * is off screen, and a keyboard or touch user has no cue that there is an order to see. A 44 x 44 button at the band's edge scrolls the band to the tracker and puts focus on the active row;
 * pressed again it scrolls back to the tiles. `aria-expanded` says which, read from the scroll position (so a hand scroll keeps it true). No smooth scrolling: `instant`.
 *
 * Layout: the region's root takes `TURN_ORDER_FRAME` (a grid of the content column and a 44px column that belongs to this button) only while the button is shown, so the tiles and the tracker
 * both leave it clear. The button spans both rows and is STICKY, so it stays where the thumb found it while the band scrolls. It is DOM-after the tiles and their controls, before the tracker.
 * The component names no region: the band's scroller is the nearest ancestor that scrolls, the tracker is found by `INITIATIVE_TRACKER_ID`.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import Icon from '@/components/Icon';
import { INITIATIVE_TRACKER_ID } from '@/components/InitiativeTracker';
import styles from './TurnOrderButton.module.css';

/** The class the region root takes while the button is shown. */
export const TURN_ORDER_FRAME = styles.frame;

/** The tracker counts as "scrolled to" once its top is within this many px of the band's top edge (the band's own padding and the tracker's 6px margin are inside it). */
const TRACKER_AT_PX = 24;

/** The nearest ancestor that scrolls vertically (the party band's slot): found by its computed `overflow-y`, never by a class. */
function nearestScroller(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}

/**
 * The button. On a phone the initiative tracker sits BELOW the tile row in a 91px band, so at rest it is off screen, and a keyboard or
 * touch user has no cue that there is an order to see. A 44 x 44 button at the band's edge scrolls the band to the tracker and puts focus on the active row; pressed again it scrolls back to the
 * tiles. `aria-expanded` says which, read from the scroll position (so a hand scroll keeps it true). No smooth scrolling: `instant`. The button is STICKY inside the band, so it stays where the
 * thumb found it while the band scrolls (Play.module.css `.partyTurnOrder`), and it is DOM-after the tiles and their controls, before the tracker.
 */
export default function TurnOrderButton({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [atTracker, setAtTracker] = useState(false);
  const read = useCallback(() => {
    const sc = nearestScroller(rootRef.current);
    const tracker = document.getElementById(INITIATIVE_TRACKER_ID);
    if (!sc || !tracker) return false;
    return tracker.getBoundingClientRect().top - sc.getBoundingClientRect().top <= TRACKER_AT_PX;
  }, [rootRef]);
  useEffect(() => {
    const sc = nearestScroller(rootRef.current);
    if (!sc) return;
    const sync = () => setAtTracker(read());
    sc.addEventListener('scroll', sync, { passive: true });
    return () => sc.removeEventListener('scroll', sync);
  }, [rootRef, read]);
  const press = () => {
    const sc = nearestScroller(rootRef.current);
    const tracker = document.getElementById(INITIATIVE_TRACKER_ID);
    if (!sc || !tracker) return;
    if (!read()) {
      sc.scrollTo({ top: sc.scrollTop + (tracker.getBoundingClientRect().top - sc.getBoundingClientRect().top), behavior: 'instant' });
      // The active row (the tab stop), else the first row: the page must not scroll to it, the band already has.
      const row = tracker.querySelector<HTMLElement>('li[aria-current="true"]') ?? tracker.querySelector<HTMLElement>('li');
      row?.focus({ preventScroll: true });
      setAtTracker(true);
    } else {
      sc.scrollTo({ top: 0, behavior: 'instant' });
      btnRef.current?.focus({ preventScroll: true });
      setAtTracker(false);
    }
  };
  return (
    <button ref={btnRef} type="button" className={styles.button} data-turn-order="" aria-label="Turn order" aria-expanded={atTracker} aria-controls={INITIATIVE_TRACKER_ID} title="Turn order" onClick={press}>
      <Icon name="Initiative" size={18} aria-hidden />
    </button>
  );
}

