'use client';
import { useCallback, useMemo, useRef, type MouseEvent, type PointerEvent } from 'react';

/** The scrim ignores clicks for this long after its dialog opens: the second click of a double press on the opener lands on it and would cancel the dialog it just opened. */
export const BACKDROP_ARM_MS = 300;

/**
 * Scrim-dismiss for a modal dialog, the ONE copy (it was written twice, and the second copy lacked the third guard: Kage N-1). A scrim click dismisses only when
 *   1. the press BEGAN on the scrim (a drag out of a field, released over it, is not a dismissal), and
 *   2. the dialog is not within `BACKDROP_ARM_MS` of opening (call `arm()` when it opens), and
 *   3. the dialog is not `blocked` (a request in flight).
 * And a press on the scrim never moves focus: the dialog is not always the topmost focus scope (the override dialog is not portalled), and an ignored press that took focus out would
 * leave Escape and Tab acting on the page behind it, so `mousedown` on the scrim is default-prevented, whether or not the click that follows dismisses.
 */
export function useScrimDismiss(onDismiss: () => void, blocked: boolean) {
  const down = useRef(false);
  const armedAt = useRef(0);
  const arm = useCallback(() => { armedAt.current = Date.now() + BACKDROP_ARM_MS; }, []);
  const scrimProps = useMemo(() => ({
    onMouseDown: (e: MouseEvent<HTMLElement>) => { if (e.target === e.currentTarget) e.preventDefault(); },
    onPointerDown: (e: PointerEvent<HTMLElement>) => { down.current = e.target === e.currentTarget; },
    onClick: (e: MouseEvent<HTMLElement>) => {
      const downHere = down.current;
      down.current = false;
      if (e.target === e.currentTarget && downHere && !blocked && Date.now() >= armedAt.current) onDismiss();
    },
  }), [blocked, onDismiss]);
  return { scrimProps, arm };
}
