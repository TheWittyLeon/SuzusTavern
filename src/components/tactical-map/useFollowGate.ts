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
import { FOLLOW_SETTLE_MS, TOUCH_BACKSTOP_MS } from './follow';

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
  const touchStartAt = useRef(0);
  const lastScrollAt = useRef(Number.NEGATIVE_INFINITY);
  const own = useRef<{ left: number; top: number } | null>(null);
  const pending = useRef(new Map<FollowKind, () => void>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // the timer calls the current flush through a ref: a callback that names itself is what the hooks lint refuses
  const flushRef = useRef<() => void>(() => {});

  const flush = useCallback(() => {
    if (pending.current.size === 0) return;
    const wakeIn = (ms: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        flushRef.current();
      }, ms);
    };
    if (touching.current) {
      // a touch's end flushes again; the BACKSTOP is for the end that never comes (the node under the finger was removed and the browser sends the lift to it, not to the window)
      // counted from the finger's LAST MOVEMENT (its start, or the window's last scroll event): a finger at rest releases 5 s after it last moved, and a slow pan never does
      const left = Math.max(touchStartAt.current, lastScrollAt.current) + TOUCH_BACKSTOP_MS - Date.now();
      if (left > 0) return wakeIn(left);
      touching.current = false;
    }
    const wait = lastScrollAt.current + FOLLOW_SETTLE_MS - Date.now();
    if (wait > 0) return wakeIn(wait);
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
      // `touches` lists every finger on the SCREEN, but this window hears a touchend only for a finger that started on it: count only the fingers that are on the window, or a second
      // finger resting elsewhere would hold the gate for good (Kage-CR).
      touching.current = Array.from((e as TouchEvent).touches ?? []).some((t) => t.target instanceof Node && win.contains(t.target));
      if (!touching.current) flush();
    };
    // The browser sends a touch's end to the node the touch STARTED on. When a poll removes or moves that node (a token) under a resting finger, the end goes to the detached node and
    // never reaches the window: so listen on the touch's own target too, until it ends (Tora-Gesture 1a). The 5 s backstop in `flush` covers an end that goes nowhere at all.
    const onStart = (e: Event) => {
      own.current = null; // a stale own-scroll mark must not swallow the next user scroll (Tora-Gesture 1b)
      touchStartAt.current = Date.now();
      const target = e.target;
      if (target instanceof Element && target !== win) {
        const end = (ev: Event) => {
          target.removeEventListener('touchend', end);
          target.removeEventListener('touchcancel', end);
          onTouch(ev);
        };
        target.addEventListener('touchend', end, { passive: true });
        target.addEventListener('touchcancel', end, { passive: true });
      }
      onTouch(e);
    };
    const onScroll = () => {
      const o = own.current;
      if (o && Math.abs(win.scrollLeft - o.left) < 1 && Math.abs(win.scrollTop - o.top) < 1) {
        own.current = null;
        return;
      }
      lastScrollAt.current = Date.now();
    };
    win.addEventListener('touchstart', onStart, { passive: true });
    win.addEventListener('touchend', onTouch, { passive: true });
    win.addEventListener('touchcancel', onTouch, { passive: true });
    win.addEventListener('scroll', onScroll, { passive: true });
    const pendingNow = pending.current;
    return () => {
      win.removeEventListener('touchstart', onStart);
      win.removeEventListener('touchend', onTouch);
      win.removeEventListener('touchcancel', onTouch);
      win.removeEventListener('scroll', onScroll);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      pendingNow.clear();
      // The window is gone, and with it the touchend it would have heard: a finger that lifted while the board was removed must not leave the gate held for the next window (QA F3).
      touching.current = false;
    };
  }, [windowRef, mounted, flush]);

  // One identity for the life of the component: the callers list it in effect dependencies, and a new object each render would re-run those effects every render.
  return useMemo(() => ({ request, markOwn }), [request, markOwn]);
}
