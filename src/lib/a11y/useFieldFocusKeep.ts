import { useRef, type MouseEvent, type PointerEvent, type RefObject } from 'react';

/**
 * The composer's popover openers keep the soft keyboard up (A10 step 11 tail fix, Tora MAJOR-1; the coordinator's ruling on the Mode menu, extended to Roll by the owner): one rule, shared by the
 * Mode menu and Roll. A pointer press on the opener while the composer's FIELD has focus keeps focus in the field (`pointerdown` and `mousedown` are default-prevented, so the browser does not move
 * it) and the popover it opens does not take focus (`keepFocusInPlace`, read by `useAnchoredPopover` at the moment it opens); focus then stays where it was and on close the hook leaves it alone.
 * A keyboard, screen-reader or switch activation is a click with `detail` 0 (no pointerdown): focus goes into the popover and returns to the opener, as always.
 * `enabled` false (every row but the phone's `line`) makes all of it inert: nothing is prevented and nothing is kept.
 *
 * Usage: spread `pressProps` on the opener, call `decide(e)` first in its `onClick`, and pass `keepFocusInPlace` to the popover hook.
 */
export function useFieldFocusKeep(fieldRef: RefObject<HTMLTextAreaElement | null> | undefined, enabled: boolean) {
  const hadRef = useRef(false);
  const keepRef = useRef(false);
  return {
    pressProps: {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (!enabled) return;
        hadRef.current = !!fieldRef?.current && document.activeElement === fieldRef.current;
        e.preventDefault();
      },
      onMouseDown: (e: MouseEvent<HTMLElement>) => {
        if (enabled) e.preventDefault();
      },
    },
    /** Call first in `onClick`: only a PRESS (`detail` >= 1) made while the field had focus keeps it there. */
    decide: (e: { detail: number }) => {
      keepRef.current = enabled && hadRef.current && e.detail > 0;
      hadRef.current = false;
    },
    keepFocusInPlace: () => keepRef.current,
  };
}
