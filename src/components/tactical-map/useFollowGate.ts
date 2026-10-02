// src/components/tactical-map/useFollowGate.ts
//
// A follow assigns the window's own scrollLeft / scrollTop. Done under a finger it yanks the board out from under the thumb, kills the browser's momentum and breaks the tap
// (Tora-Gesture C-1; the poll that hands over a turn change is exactly that case). So EVERY follow waits while a touch is on the window and until FOLLOW_SETTLE_MS after the
// window's last scroll event, then runs ONCE.
//
//   - `request(kind, run)` runs now when the window is quiet. Otherwise it is kept, one slot per kind (a second request of the same kind replaces the first: it is the newer
//     answer), and runs once when the window has been quiet. `run` must read the CURRENT state when it runs, not capture it at the request: it may run a moment later.
//   - Kinds run in a fixed order, `focus` before `mover` (Iro-A11y: the square the user is on first, the mover second).
//   - A scroll event the map CAUSED (it assigned the offsets: `markOwn`) is not the user scrolling and does not make the window busy; without this, two follows 100 ms
//     apart would hold each other off.
//   - Touch is the browser's touch events, passive: nothing here can cancel a gesture. A pen and a mouse are not "a touch on the window".
// Time is `Date.now()` and `setTimeout`, so a test controls both with fake timers.
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { FOLLOW_SETTLE_MS } from './follow';

export type FollowKind = 'focus' | 'mover';
const ORDER: FollowKind[] = ['focus', 'mover'];

export interface FollowGate {
  request: (kind: FollowKind, run: () => void) => void;
  /** Call right after assigning the window's offsets, so the scroll event that follows is recognised as ours. */
  markOwn: () => void;
}

/** `mounted`: whether the window element is in the tree (it is not for a board the map cannot draw); the listeners attach when it becomes so. */
export function useFollowGate(windowRef: RefObject<HTMLElement | null>, mounted: boolean): FollowGate {
  const touching = useRef(false);
  const lastScrollAt = useRef(Number.NEGATIVE_INFINITY);
  const own = useRef<{ left: number; top: number } | null>(null);
  const pending = useRef(new Map<FollowKind, () => void>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // the timer calls the current flush through a ref: a callback that names itself is what the hooks lint refuses
  const flushRef = useRef<() => void>(() => {});

  const flush = useCallback(() => {
    if (pending.current.size === 0 || touching.current) return; // a touch's end flushes again
    const wait = lastScrollAt.current + FOLLOW_SETTLE_MS - Date.now();
    if (wait > 0) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        flushRef.current();
      }, wait);
      return;
    }
    const due = ORDER.map((k) => pending.current.get(k)).filter((r): r is () => void => !!r);
    pending.current.clear();
    due.forEach((run) => run());
  }, []);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const request = useCallback(
    (kind: FollowKind, run: () => void) => {
      pending.current.set(kind, run);
      flush();
    },
    [flush],
  );

  const markOwn = useCallback(() => {
    const win = windowRef.current;
    if (win) own.current = { left: win.scrollLeft, top: win.scrollTop };
  }, [windowRef]);

  useEffect(() => {
    const win = windowRef.current;
    if (!mounted || !win) return;
    const onTouch = (e: Event) => {
      touching.current = (e as TouchEvent).touches?.length > 0;
      if (!touching.current) flush();
    };
    const onScroll = () => {
      const o = own.current;
      if (o && Math.abs(win.scrollLeft - o.left) < 1 && Math.abs(win.scrollTop - o.top) < 1) {
        own.current = null;
        return;
      }
      lastScrollAt.current = Date.now();
    };
    win.addEventListener('touchstart', onTouch, { passive: true });
    win.addEventListener('touchend', onTouch, { passive: true });
    win.addEventListener('touchcancel', onTouch, { passive: true });
    win.addEventListener('scroll', onScroll, { passive: true });
    const pendingNow = pending.current;
    return () => {
      win.removeEventListener('touchstart', onTouch);
      win.removeEventListener('touchend', onTouch);
      win.removeEventListener('touchcancel', onTouch);
      win.removeEventListener('scroll', onScroll);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      pendingNow.clear();
    };
  }, [windowRef, mounted, flush]);

  // One identity for the life of the component: the callers list it in effect dependencies, and a new object each render would re-run those effects every render.
  return useMemo(() => ({ request, markOwn }), [request, markOwn]);
}
