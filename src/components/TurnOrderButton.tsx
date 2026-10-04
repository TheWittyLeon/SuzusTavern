'use client';
/**
 * B8c-4 P1c (Sora's phone-mount brief 7.3; Aoi A section 13) — the party band's "Turn order" button. On a phone the initiative tracker sits BELOW the tile row in a 91px band, so at rest it
 * is off screen, and a keyboard or touch user has no cue that there is an order to see. A 44 x 44 button at the band's edge scrolls the band to the tracker and puts focus on the active row;
 * pressed again it scrolls back to the tiles. `aria-expanded` says which, read from the scroll position (so a hand scroll keeps it true). No smooth scrolling: `instant`.
 *
 * Layout: the region's root takes `TURN_ORDER_FRAME` (a grid of the content column and a 44px column that belongs to this button) only while the button is shown, so the tiles and the tracker
 * both leave it clear. The button spans both rows and is STICKY, so it stays where the thumb found it while the band scrolls. It is DOM-after the tiles and their controls, before the tracker.
 * The component names no region: the band's scroller is the nearest ancestor that scrolls, the tracker is found by `INITIATIVE_TRACKER_ID`.
 *
 * It exists only while it is needed (`useTurnOrderCue`): when the band can show the whole of the tiles and the tracker, the button is redundant, and its column would only narrow the tracker (at
 * 412x915 from 388 to 336px, growing it 34px taller and making a band that fitted scroll). "Needed" is judged on the UNFRAMED band, with the button out of it, so the answer never depends on the answer.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import Icon from '@/components/Icon';
import { INITIATIVE_TRACKER_ID } from '@/components/InitiativeTracker';
import styles from './TurnOrderButton.module.css';

/** The class the region root takes while the button is shown. */
export const TURN_ORDER_FRAME = styles.frame;

/** The tracker counts as "scrolled to" once its top is within this many px of the band's top edge (the band's own padding and the tracker's 6px margin are inside it), or once the band has
 *  scrolled as far toward it as it can (a short tracker, or a band with little spare height, never gets its top that close). */
const TRACKER_AT_PX = 24;

/** The nearest ancestor that scrolls vertically (the party band's slot): found by its computed `overflow-y`, never by a class. */
function nearestScroller(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}

/** Quiet time after the band's last scroll event and after the last finger lifts, before the cue may change (the fold's gate, useFoldFacts.ts, with the same number). */
const CUE_QUIET_MS = 150;
/** A finger that never reports its end stops holding the gate after this long. */
const CUE_TOUCH_BACKSTOP_MS = 5000;

/** The tracker's row that takes focus: the active one, else the first. */
function trackerRow(): HTMLElement | null {
  const tracker = document.getElementById(INITIATIVE_TRACKER_ID);
  return tracker?.querySelector<HTMLElement>('li[aria-current="true"]') ?? tracker?.querySelector<HTMLElement>('li') ?? null;
}

/**
 * Whether the band needs the cue: the party band scrolls (the tracker cannot be seen whole beside the tiles).
 *
 * MEASURED WITHOUT THE BUTTON'S COLUMN, and the answer does not depend on the answer: with the frame class off the button is `display: none` (TurnOrderButton.module.css), so the unframed band is the
 * band as it would be with no button at all, whatever state it came from. The frame class is lifted and put back in one synchronous step, before paint, ONLY when it is on (an unframed band is
 * measured as it stands). Lifting it can make the engine clamp the band's `scrollTop` to the smaller maximum at the forced layout, so the offset is read first and handed back.
 *
 * It never touches a band in motion: while a finger is down, or the band has scrolled in the last 150ms, the measure (and so the flip) waits; it is retried when the gate opens. A flip can move
 * the tiles by 44px plus the gap, and the lift-and-restore would cancel a momentum scroll. If the button is focused when the cue turns off, focus goes to the tracker's active row first (the button
 * unmounts; focus would fall to <body>). Re-measured after every commit and whenever the band or the strip changes size (rotation, a font, a combatant joining). Nothing to measure (no scroller)
 * keeps the button: it never hides on a guess.
 */
export function useTurnOrderCue(rootRef: RefObject<HTMLDivElement | null>, enabled: boolean): boolean {
  const [cue, setCue] = useState(false);
  const cueRef = useRef(false);
  const enabledRef = useRef(enabled);
  const touches = useRef(0);
  const touchSince = useRef(0);
  const lastScroll = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settleRef = useRef<() => void>(() => {});

  const measure = useCallback(() => {
    const root = rootRef.current;
    const sc = nearestScroller(root);
    if (!root || !sc) return true;
    const framed = root.classList.contains(TURN_ORDER_FRAME);
    if (!framed) return sc.scrollHeight > sc.clientHeight + 1;
    const top = sc.scrollTop;
    root.classList.remove(TURN_ORDER_FRAME);
    const scrolls = sc.scrollHeight > sc.clientHeight + 1;
    root.classList.add(TURN_ORDER_FRAME);
    if (sc.scrollTop !== top) sc.scrollTop = top;
    return scrolls;
  }, [rootRef]);

  const gateOpen = useCallback(() => {
    const now = Date.now();
    if (touches.current > 0 && now - touchSince.current >= CUE_TOUCH_BACKSTOP_MS) touches.current = 0;
    return touches.current === 0 && now - lastScroll.current >= CUE_QUIET_MS;
  }, []);

  const apply = useCallback((next: boolean) => {
    if (next === cueRef.current) return;
    if (cueRef.current && !next) {
      const btn = rootRef.current?.querySelector('button[data-turn-order]');
      if (btn && document.activeElement === btn) trackerRow()?.focus({ preventScroll: true });
    }
    cueRef.current = next;
    setCue(next);
  }, [rootRef]);

  const settle = useCallback(() => {
    clearTimeout(timer.current);
    if (!enabledRef.current) { apply(false); return; }
    if (!gateOpen()) { timer.current = setTimeout(() => settleRef.current(), CUE_QUIET_MS); return; }
    apply(measure());
  }, [apply, gateOpen, measure]);

  // Runs after every commit on purpose (a combatant joining or a font arriving changes the answer with no prop of ours changing); a flip to the same value is a no-op, so it settles.
  useLayoutEffect(() => {
    enabledRef.current = enabled;
    settleRef.current = settle;
    settle();
  });
  useEffect(() => {
    const root = rootRef.current;
    const sc = nearestScroller(root);
    const onTouch = (e: TouchEvent) => {
      if (e.type === 'touchstart') touchSince.current = Date.now();
      touches.current = e.touches.length;
      if (touches.current === 0) { clearTimeout(timer.current); timer.current = setTimeout(() => settleRef.current(), CUE_QUIET_MS); }
    };
    const onScroll = (e: Event) => { if (e.target === sc) { lastScroll.current = Date.now(); } };
    window.addEventListener('touchstart', onTouch, { capture: true, passive: true });
    window.addEventListener('touchend', onTouch, { capture: true, passive: true });
    window.addEventListener('touchcancel', onTouch, { capture: true, passive: true });
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    let ro: ResizeObserver | undefined;
    if (enabled && root && sc && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => settleRef.current());
      ro.observe(sc);
      ro.observe(root);
    }
    return () => {
      window.removeEventListener('touchstart', onTouch, { capture: true });
      window.removeEventListener('touchend', onTouch, { capture: true });
      window.removeEventListener('touchcancel', onTouch, { capture: true });
      window.removeEventListener('scroll', onScroll, { capture: true });
      ro?.disconnect();
      clearTimeout(timer.current);
    };
  }, [rootRef, enabled]);
  return cue;
}

/**
 * The button. On a phone the initiative tracker sits BELOW the tile row in a 91px band, so at rest it is off screen, and a keyboard or
 * touch user has no cue that there is an order to see. A 44 x 44 button at the band's edge scrolls the band to the tracker and puts focus on the active row; pressed again it scrolls back to the
 * tiles. `aria-expanded` says which, read from the scroll position (so a hand scroll keeps it true). No smooth scrolling: `instant`. The button is STICKY inside the band, so it stays where the
 * thumb found it while the band scrolls (TurnOrderButton.module.css `.frame > .button`), and it is DOM-after the tiles and their controls, before the tracker.
 */
export default function TurnOrderButton({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [atTracker, setAtTracker] = useState(false);
  const read = useCallback(() => {
    const sc = nearestScroller(rootRef.current);
    const tracker = document.getElementById(INITIATIVE_TRACKER_ID);
    if (!sc || !tracker) return false;
    const rel = tracker.getBoundingClientRect().top - sc.getBoundingClientRect().top;
    if (rel <= TRACKER_AT_PX) return true;
    // Where the band would have to go to put the tracker at its top, and how far it can: at the nearer of the two it is "at the tracker" (1px for a fractional scrollTop).
    const max = sc.scrollHeight - sc.clientHeight;
    if (max <= 1) return false; // a band that cannot scroll is never "at" anything: a press still puts focus on the row
    return sc.scrollTop >= Math.min(sc.scrollTop + rel, max) - 1;
  }, [rootRef]);
  // The state is the scroll position's, read when the button mounts too (it can mount on a band that is already at the tracker).
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the band's scroll position on mount IS the initial state
    setAtTracker(read());
  }, [read]);
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
      trackerRow()?.focus({ preventScroll: true });
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

