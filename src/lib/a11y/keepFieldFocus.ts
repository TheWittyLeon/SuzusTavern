import type { MouseEvent, PointerEvent } from 'react';

/**
 * The composer's buttons keep the field's focus (A10 step 11 tail, S6; Tora 5 / S-3): on a phone a tap on Roll, Mode or Send that moves focus off the textarea drops the soft keyboard in the
 * middle of the tap, a layout change under the finger (the popover defect's class). `preventDefault` on `pointerdown` stops the focus move and the compatibility mouse events a touch would
 * follow it with; `mousedown` is the same for a real mouse. The CLICK still fires, so every button works as before and a keyboard user is untouched (no pointer event).
 * One helper for every composer button, spread onto the element: `<button {...keepFieldFocus} />`.
 */
export const keepFieldFocus = {
  onPointerDown: (e: PointerEvent<HTMLElement>) => e.preventDefault(),
  onMouseDown: (e: MouseEvent<HTMLElement>) => e.preventDefault(),
} as const;
