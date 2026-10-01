'use client';
/**
 * useFocusTrap — keep Tab / Shift+Tab inside an `aria-modal` dialog, and give focus
 * back when it closes (Iro A9c-2 IMPORTANT-2).
 *
 * The hand-rolled trap this replaces compared the active element with the first and
 * last of EVERY `input, button` and wrapped only at those two. That is wrong for a
 * dialog of native radio groups: a browser gives a radio group ONE tab stop (the
 * checked member), so the real last tab stop is the checked radio of the last
 * group, which is not the last radio in the DOM. Tab from it never hit the `last`
 * test and walked out of the dialog into the page behind the backdrop.
 *
 * What this does:
 *  - `tabStops(container)` is the model of what Tab actually visits: radio groups
 *    collapse to the checked member (or the first when none is checked), and
 *    disabled controls, `fieldset[disabled]` descendants and `tabindex="-1"` drop out.
 *  - A keydown on the container wraps first <-> last (Shift+Tab on the first goes to
 *    the last, Tab on the last to the first); focus that is on the dialog itself or
 *    on a non-stop goes to the nearest end.
 *  - A document `focusin` backstop pulls focus that lands OUTSIDE the container back
 *    in (covers whatever the keydown model misses: a browser's own tab order, an
 *    assistive technology moving focus, a script).
 *  - On close the hook gives focus back (to `restoreFocusTo`, else the element that
 *    was focused when it opened). It does so in the effect CLEANUP, after the
 *    backstop is removed: a close handler that focuses the trigger itself, before
 *    React unmounts the dialog, would have that focus stolen straight back by the
 *    backstop. Callers therefore just flip their `open` state.
 *
 * `active` is the dialog's open flag: the container ref is only populated while open.
 */
import { useEffect, type RefObject } from 'react';

const TABBABLE =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

function isRadio(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'radio';
}

/** A radio's group within `container` (same name). Unnamed radios are alone. */
function radioGroup(container: HTMLElement, radio: HTMLInputElement): HTMLInputElement[] {
  if (!radio.name) return [radio];
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ).filter((r) => r.name === radio.name && r.form === radio.form);
}

function isOperable(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  // A control in a disabled fieldset has no `disabled` attribute of its own.
  if (el.closest('fieldset[disabled]')) return false;
  if (el.getAttribute('tabindex') === '-1') return false;
  return true;
}

/** The elements Tab visits inside `container`, in DOM order. */
export function tabStops(container: HTMLElement): HTMLElement[] {
  const stops: HTMLElement[] = [];
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(TABBABLE))) {
    if (!isOperable(el)) continue;
    if (isRadio(el)) {
      const group = radioGroup(container, el).filter(isOperable);
      const rep = group.find((r) => r.checked) ?? group[0];
      if (el !== rep) continue;
    }
    stops.push(el);
  }
  return stops;
}

/** The tab stop that stands for `el`: a radio stands for its group's stop. */
function representative(container: HTMLElement, el: HTMLElement, stops: HTMLElement[]): HTMLElement | null {
  if (stops.includes(el)) return el;
  if (isRadio(el)) {
    const mate = radioGroup(container, el).find((r) => stops.includes(r));
    if (mate) return mate;
  }
  return null;
}

export interface FocusTrapOptions {
  /** Where focus goes on close. Default: the element focused when the trap opened. */
  restoreFocusTo?: RefObject<HTMLElement | null>;
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  { restoreFocusTo }: FocusTrapOptions = {},
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let lastInside: HTMLElement | null = null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return;
      const stops = tabStops(container);
      if (stops.length === 0) {
        e.preventDefault();
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      const here = document.activeElement instanceof HTMLElement
        ? representative(container, document.activeElement, stops)
        : null;
      if (here === null) {
        // Focus is on the dialog itself or a non-stop: enter at the nearest end.
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && here === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && here === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (container.contains(t)) {
        if (t instanceof HTMLElement) lastInside = t;
        return;
      }
      const back = lastInside?.isConnected && container.contains(lastInside) ? lastInside : tabStops(container)[0];
      back?.focus();
    };

    container.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      // Read at CLOSE time on purpose: the caller's restore target can mount after the
      // trap opened, so a value copied at open would be stale.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const target = restoreFocusTo?.current ?? opener;
      if (target?.isConnected) target.focus();
    };
    // `restoreFocusTo` is a ref object (stable); `containerRef` likewise.
  }, [active, containerRef, restoreFocusTo]);
}
