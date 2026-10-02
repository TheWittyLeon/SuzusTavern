'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * How long an armed watch waits for the commit that removes the focused control before it gives up. The commit that unmounts a
 * resolved check's button follows the grounding refresh by a render or two, never by seconds; a watch that outlives this was armed
 * on a control that is staying, and disarms rather than lurk (Iro A9d-2 Major-3: "the result is bounded in time").
 */
export const STRANDED_FOCUS_WATCH_MS = 2000;

/**
 * A9d-2 fix round N1 (Kage A9d-2 I-3, Iro Major-3) — the stranded-focus rescue, tied to the COMMIT instead of to a frame.
 *
 * What it replaces: `refocusSceneHeadIfStranded` asked for ONE animation frame and checked `document.activeElement === document.body`
 * there. Nothing ties that frame to React's commit. When the frame fires before the commit that unmounts the control the user was on
 * (a resolved check's "Attempt" button, a taken transition), it still sees that control focused, does nothing, and nothing looks
 * again; the commit then drops focus on `<body>` and a keyboard user is stranded (WCAG 2.4.3). Measured, not guessed: forced order
 * stranded every time; natural order with a frame already pending stranded 12 and 17 of 80 runs; an idle frame clock, 0 of 80, which
 * is why the bug hid from a test inside `act()` and hit a real browser (whose frame clock always runs).
 *
 * The rule now:
 *   - the caller still says, BEFORE any await, whether the user had focus in the group about to be replaced (`hadFocusInGroup`);
 *   - the call ARMS a watch on the control that has focus, and a layout effect with no dependency list looks after EVERY commit:
 *       the watched control is gone and focus fell to `<body>`      -> focus the scene head (the rescue);
 *       the watched control is gone but focus is already elsewhere  -> leave it, disarm (the user moved on; never yank focus);
 *       the watched control is still here and still focused         -> keep waiting (the commit that removes it has not run);
 *       the watched control is still here but focus has left it     -> disarm (the user moved focus, including to `<body>` on purpose);
 *   - if the control is ALREADY gone when the call arrives (the commit ran first), the same decision is made at once;
 *   - the watch is bounded (STRANDED_FOCUS_WATCH_MS) and cleared on unmount.
 * No animation frame is involved, so there is no order of frame and commit to get wrong.
 *
 * Why a layout effect, the one in `hooks/`: it is not a ref-mirror (the shape the "zero useLayoutEffect in hooks/" notes in useDice /
 * useSessionEvents retired). It runs before paint, so the head takes focus in the same frame the control disappears and `<body>` is
 * never painted focused.
 */
export function useStrandedFocusRescue(headRef: RefObject<HTMLElement | null>): (hadFocusInGroup: boolean) => void {
  const watchRef = useRef<{ el: Element; timer: ReturnType<typeof setTimeout> } | null>(null);

  const disarm = useCallback(() => {
    const w = watchRef.current;
    if (w) clearTimeout(w.timer);
    watchRef.current = null;
  }, []);

  /** One decision; true = the watch is finished (rescued, or nothing left to do). */
  const decide = useCallback(() => {
    const w = watchRef.current;
    if (!w) return;
    const active = document.activeElement;
    if (w.el.isConnected) {
      // Still on screen: while it still has focus the commit that removes it has not run; once focus has left it the user moved on.
      if (active !== w.el) disarm();
      return;
    }
    disarm();
    if (active == null || active === document.body) headRef.current?.focus();
  }, [disarm, headRef]);

  // After EVERY commit of the owning component. No dependency list on purpose: the commit that unmounts the control is the one thing
  // this must not miss, and a cheap ref read is all it costs on the rest.
  useLayoutEffect(() => {
    decide();
  });

  useEffect(() => disarm, [disarm]);

  return useCallback(
    (hadFocusInGroup: boolean) => {
      if (!hadFocusInGroup) return;
      disarm();
      const active = document.activeElement;
      if (active == null || active === document.body) {
        // Focus is already on <body>: the commit that dropped it ran before this call (or there was nothing focused). The caller
        // says the user HAD focus in the group, so this is the stranded state: rescue now.
        headRef.current?.focus();
        return;
      }
      watchRef.current = { el: active, timer: setTimeout(disarm, STRANDED_FOCUS_WATCH_MS) };
      decide();
    },
    [decide, disarm, headRef],
  );
}
