'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import { consumeEscape } from './escapeConsume';

/**
 * A9d-2 fix round N3 (Sora lever brief 2.2; Tora C1-C3, Iro 4) — the anchored popover primitive.
 *
 * Extracted from `ActionBar.placePop`, the one correct copy of "a menu that opens from a control inside a clipping slot": a slot is
 * `overflow-y: auto`, so a menu left inside it opens clipped (the outcome chooser rendered at y 346-718 under a band that ended at 333,
 * so the tap on End combat looked like it did nothing). Five consumers use it: the Attack target menu, the End-combat outcome chooser,
 * Roll, Cast a spell and the DM's Session controls. The hook is renderer-agnostic (the Attack menu stays where its DOM position is
 * pinned); `AnchoredPopover` composes it with a portal and the shared look.
 *
 * The contract, each line a reviewer's condition:
 *
 * PLACEMENT. `position: fixed`, from the opener's rect, on the side with more room, clamped to the VISUAL viewport (pinch zoom and the
 *   iOS keyboard move it: the layout viewport is not the screen). Re-placed on window `resize` and `scroll` and on `visualViewport`
 *   `resize` and `scroll` (Tora C2: iOS fires no window `resize` when the keyboard retracts, and tapping Roll from a focused composer
 *   blurs the textarea). It NEVER covers an element marked `data-popover-passthrough` (the X-card): the popover's height is clamped so the
 *   two do not intersect, whichever side it opens on (including one BESIDE the opener, on its row). Nothing here names a tenant. When clamped it scrolls inside
 *   (`overscroll-behavior: contain`, with the shared scroll cue in AnchoredPopover.module.css).
 *
 * DISMISSAL (Tora C1, a safety rule). An outside press closes on `click`, never on `pointerdown` / `touchstart` (a pointer-down close
 *   lets the synthesized click land on whatever lies underneath: Attack, End turn, Send). That click is CONSUMED: a capture-phase listener
 *   on `document` calls `preventDefault` and `stopPropagation`, so the control under the finger does not activate. EXCEPT a press inside a
 *   `data-popover-passthrough` element: it closes the popover and is delivered, because the X-card fires on the first tap, always. No
 *   backdrop element exists (no stacking question, no touch-pan lock). A press on the opener itself is the consumer's toggle, untouched.
 *   Escape goes through `consumeEscape`.
 *   A MODAL LAYER OPENED FROM IT OWNS THE PRESS AND THE FOCUS (A9d-2 fix round 4, Kage I-B). A confirm dialog a popover's own control opens is
 *   portalled out of the popover (and End session's belongs to the page), so by DOM containment it is "outside": its first click closed the popover
 *   and was consumed, and by keyboard the popover closed under the dialog and focus fell to <body> after Escape. While any `aria-modal` element that
 *   is not the popover (or around it) is open, the popover neither closes on nor consumes a press, and focus moving into it is not "leaving": the
 *   dialog's own restore returns focus to the control that opened it, inside the popover. One rule here, so no consumer closes its popover by hand
 *   before opening a dialog.
 *
 * FOCUS (Iro 4, Tora C3). The opener is the control that was activated (`openerRef`, recorded from the activating event by
 *   `recordOpener`; the anchor when there is only one). Never `document.activeElement` at open time: WebKit does not focus a tapped
 *   button. On open focus moves to the consumer's declared target (`initialFocus`). Tab or Shift+Tab past either end closes the
 *   popover and returns focus to the opener: it neither traps (it is non-modal) nor strands. On every close focus returns to the opener
 *   if focus was in the popover or on <body>; if the opener is gone (End combat unmounts when the fight ends) it goes to
 *   `fallbackFocus` (the scene head), decided in the commit that closed it, never <body>. Focus is left alone when it already moved on to
 *   a control the user chose (the X-card). The focused control is brought INSIDE the popover's own box (it scrolls inside when clamped:
 *   at 320x256 the first die of Roll was out of view in a 94px popover, A9d-2 fix round 2, Iro MAJOR-1): focus without scrolling the page, then
 *   scroll the popover's own box, never `scrollIntoView`. And focus that LEAVES an open popover for a control outside it, the popover, its
 *   opener and a passthrough element, closes it WITHOUT moving focus (Safari's Tab skips buttons, so a popover whose last stop is a select
 *   was never "past the end": it was left open and orphaned, Iro Minor-1). A pointer press is not that: its click is handled above (consumed
 *   or delivered), so a focus caused by a press is ignored here.
 *
 * SEMANTICS. The hook never sets `aria-modal`, `inert` or `aria-hidden` on anything: the page behind stays reachable. It returns the
 *   opener's `aria-haspopup` / `aria-expanded` / `aria-controls`.
 */

/** Minimum clearance between the popover and the screen edge, the opener and a passthrough element (6px: the Attack menu's own, which this was extracted from). */
const EDGE = 6;
const GAP = 6;
const PASSTHROUGH = '[data-popover-passthrough]';
const TABBABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const MODAL = '[aria-modal="true"]';

/** True while a modal layer is open that is neither the popover, nor inside it, nor around it (a closed Drawer drops the attribute; an inert or hidden one is not open). */
function modalLayerOpen(pop: HTMLElement | null): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>(MODAL)).some(
    (m) => !(pop && (pop.contains(m) || m.contains(pop))) && !m.closest('[inert], [hidden], [aria-hidden="true"]'),
  );
}

export type PopoverRole = 'dialog' | 'menu' | 'group';
export type PopoverSide = 'auto' | 'top' | 'bottom';

export interface UseAnchoredPopoverOptions {
  open: boolean;
  onClose: () => void;
  /** The control the popover belongs to (placement, `aria-*`, and the default opener). */
  anchorRef: RefObject<HTMLElement | null>;
  /** The control that was actually activated, when more than one can open it ("End combat" and "Wrap up"). Set by `recordOpener`. */
  openerRef?: RefObject<HTMLElement | null>;
  /** Drives `aria-haspopup`. */
  role?: PopoverRole;
  /** A selector inside the popover for the control that takes focus on open; default the first tabbable. */
  initialFocus?: string;
  /** Where focus goes when the opener is gone. Never <body>. */
  fallbackFocus?: () => HTMLElement | null | undefined;
  /** The popover stays in the DOM while closed (a CSS class hides it): `aria-controls` is then valid while closed. */
  keepMounted?: boolean;
  side?: PopoverSide;
  /** No taller than this many px: the popover scrolls inside beyond it (the Session card, 540px of content, must not cover the composer and the verbs). */
  maxHeight?: number;
}

export interface AnchoredPopoverApi {
  id: string;
  open: boolean;
  /** `aria-haspopup`, `aria-expanded`, `aria-controls` for the opener. */
  anchorProps: { 'aria-haspopup': 'dialog' | 'menu' | 'true'; 'aria-expanded': boolean; 'aria-controls': string | undefined };
  /** Spread onto the popover's root element; its ref is `attachPopover`. */
  popoverProps: {
    id: string;
    style: CSSProperties;
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
    'data-anchored-popover': '';
    'data-placement': 'top' | 'bottom';
  };
  /** The popover root's CALLBACK ref (not a ref object: the React compiler's lint forbids reading one during render). */
  attachPopover: (el: HTMLElement | null) => void;
  /** Call from the opener's onClick (or any control that opens it) so focus returns to THAT control. */
  recordOpener: (e: ReactMouseEvent<HTMLElement>) => void;
}

interface Placed {
  left: number;
  /** Set when the popover opens BELOW the opener (its top edge); otherwise `bottom` is. */
  top?: number;
  /** Set when it opens ABOVE the opener: the distance from the layout viewport's bottom edge to the popover's bottom edge. */
  bottom?: number;
  /** The room on the chosen side, after the screen edge and any passthrough element: the popover is never taller than this. */
  maxHeight: number;
  maxWidth: number;
  side: 'top' | 'bottom';
}

/**
 * Pure (exported for the unit cases): how far to scroll a popover's own box so `target` lies inside it. Positive = scroll down. Zero when it
 * already does; a target taller than the box is aligned at its top. Both rects are viewport coordinates, the box's being its CLIENT area.
 */
export function revealDelta(box: { top: number; bottom: number }, target: { top: number; bottom: number }): number {
  if (target.top < box.top) return target.top - box.top;
  if (target.bottom > box.bottom) return Math.min(target.bottom - box.bottom, target.top - box.top);
  return 0;
}

const samePlaced = (a: Placed | null, b: Placed) =>
  !!a && a.left === b.left && a.top === b.top && a.bottom === b.bottom && a.maxHeight === b.maxHeight && a.maxWidth === b.maxWidth && a.side === b.side;

/** The visible part of the screen, in layout-viewport coordinates (what `position: fixed` is measured in). */
function visualBox() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const root = document.documentElement;
  return {
    left: vv?.offsetLeft ?? 0,
    top: vv?.offsetTop ?? 0,
    width: vv?.width ?? root.clientWidth,
    height: vv?.height ?? root.clientHeight,
  };
}

/**
 * Pure placement (exported for the unit cases): where a popover of `natural` size goes relative to `opener`, inside `view`, clear of
 * `zones` (the passthrough rects). Left-aligned to the opener and clamped; opens on the side with more room unless told; its height
 * is capped to the room on that side, after the zones on that side are subtracted. Opening above is expressed as `bottom` (the Attack
 * menu's coordinates, so what it grows into stays where the opener is), opening below as `top`. `viewportHeight` is the layout
 * viewport's height, which `bottom` is measured against.
 */
export function computePlacement(
  opener: { left: number; right: number; top: number; bottom: number },
  natural: { width: number; height: number },
  view: { left: number; top: number; width: number; height: number },
  zones: ReadonlyArray<{ left: number; right: number; top: number; bottom: number }>,
  side: PopoverSide = 'auto',
  viewportHeight: number = view.top + view.height,
  cap: number = Infinity,
): Placed {
  const maxWidth = Math.max(0, view.width - 2 * EDGE);
  const w = Math.min(natural.width, maxWidth);
  const left = Math.max(view.left + EDGE, Math.min(opener.left, view.left + view.width - w - EDGE));
  const right = left + w;
  const overlapsX = (z: { left: number; right: number }) => z.right > left && z.left < right;
  // The vertical room on each side: to the screen edge, or to the nearest passthrough element on that side that the popover would run into.
  // A zone BESIDE the opener (it shares the opener's row: the Cast button and the X-card block, A9d-2 N8) is on neither side, yet a popover
  // as wide as the gap between them would run over it: the opener's edge is extended to the zone's on whichever side the popover opens,
  // so the popover stands clear of the zone and the opener alike.
  let ot = opener.top;
  let ob = opener.bottom;
  let topLimit = view.top + EDGE;
  let bottomLimit = view.top + view.height - EDGE;
  for (const z of zones) {
    if (!overlapsX(z)) continue;
    if (z.bottom <= opener.top + 1) topLimit = Math.max(topLimit, z.bottom + GAP);
    else if (z.top >= opener.bottom - 1) bottomLimit = Math.min(bottomLimit, z.top - GAP);
    else {
      ot = Math.min(ot, z.top);
      ob = Math.max(ob, z.bottom);
    }
  }
  const roomAbove = Math.max(0, ot - GAP - topLimit);
  const roomBelow = Math.max(0, bottomLimit - (ob + GAP));
  // `cap`: a consumer that wants its popover no taller than this (it scrolls inside beyond it), so a tall one does not run over the page's
  // lower controls. The side is chosen for the height it will actually be.
  const want = Math.min(natural.height, cap);
  const chosen: 'top' | 'bottom' =
    side === 'top' ? 'top' : side === 'bottom' ? 'bottom' : want <= roomAbove ? 'top' : want <= roomBelow ? 'bottom' : roomAbove >= roomBelow ? 'top' : 'bottom';
  const maxHeight = Math.min(chosen === 'top' ? roomAbove : roomBelow, cap);
  return chosen === 'top'
    ? { left, bottom: viewportHeight - ot + GAP, maxHeight, maxWidth, side: chosen }
    : { left, top: ob + GAP, maxHeight, maxWidth, side: chosen };
}

export function useAnchoredPopover({
  open,
  onClose,
  anchorRef,
  openerRef,
  role = 'dialog',
  initialFocus,
  fallbackFocus,
  keepMounted = false,
  side = 'auto',
  maxHeight,
}: UseAnchoredPopoverOptions): AnchoredPopoverApi {
  const id = useId();
  const popoverRef = useRef<HTMLElement | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const wasOpenRef = useRef(false);
  // The latest `onClose`, and the press / Tab flags, live in refs and NOT as locals of an effect keyed on `onClose` (A9d-2 fix round 4, Kage I-A):
  // every consumer passes an inline arrow, so any re-render (a combat poll's answer) re-ran the effect and reset the flags BETWEEN a tap's pointerdown
  // and its focus, the focus-out rule then closed the popover, and the tap's click landed on what lay underneath (Send posted a draft 3 of 3; with the
  // Attack menu open the same tap can End turn). A flag now outlives a render; only the popover opening or closing clears it.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  // Focus owed to the opener while a modal layer is still open over a popover that has just closed (the session ENDED under the End-session confirm).
  const owedFocusRef = useRef<(() => void) | null>(null);
  useEffect(() => () => owedFocusRef.current?.(), []);
  const pointerRef = useRef(false);
  // The last key was Tab: only then is a focus that goes to nothing the user leaving. A control that becomes disabled or hidden while focused is
  // blurred by the browser with the same null relatedTarget (a Cast button disabled while the cast is in flight, the harness's cue probe), and
  // that is not.
  const tabbedRef = useRef(false);

  const openerEl = useCallback(() => {
    const o = openerRef?.current;
    return o && o.isConnected ? o : (anchorRef.current ?? o ?? null);
  }, [anchorRef, openerRef]);

  const place = useCallback(() => {
    const pop = popoverRef.current;
    const opener = openerEl();
    if (!pop || !opener) return;
    const r = opener.getBoundingClientRect();
    const zones = Array.from(document.querySelectorAll<HTMLElement>(PASSTHROUGH))
      .map((el) => el.getBoundingClientRect())
      .filter((z) => z.width > 0 && z.height > 0);
    // Natural size: the content's, whatever max-height a previous placement left (the popover scrolls inside, so scrollHeight is the content).
    const chrome = pop.offsetHeight - pop.clientHeight;
    const next = computePlacement(r, { width: pop.offsetWidth, height: pop.scrollHeight + chrome }, visualBox(), zones, side, document.documentElement.clientHeight, maxHeight);
    setPlaced((prev) => (samePlaced(prev, next) ? prev : next));
  }, [openerEl, side, maxHeight]);

  // Placed before the first paint, and again after every render while open (content can change size); re-placed on resize, on any
  // scroll (capture: an ancestor's) and on the visual viewport's own resize / scroll.
  useLayoutEffect(() => {
    if (!open) return;
    place();
  });
  useLayoutEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    const ro = typeof ResizeObserver !== 'undefined' && popoverRef.current ? new ResizeObserver(place) : null;
    if (ro && popoverRef.current) ro.observe(popoverRef.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
      ro?.disconnect();
    };
  }, [open, place]);

  // The focused control lies inside the popover's own box: scroll the BOX (never the page) by what it is out of view.
  const revealFocused = useCallback(() => {
    const pop = popoverRef.current;
    const active = document.activeElement;
    if (!pop || !active || !pop.contains(active)) return;
    const box = pop.getBoundingClientRect();
    const top = box.top + pop.clientTop;
    const delta = revealDelta({ top, bottom: top + pop.clientHeight }, active.getBoundingClientRect());
    if (delta !== 0) pop.scrollTop += delta;
  }, []);

  // Focus leaving for a control outside the popover, its opener and a passthrough element closes it, without moving focus. Only focus that a
  // POINTER did not cause: a press on something outside is closed (consumed or delivered) by its click, below.
  useEffect(() => {
    if (!open) return;
    pointerRef.current = false;
    tabbedRef.current = false;
    const onPointerDown = () => { pointerRef.current = true; tabbedRef.current = false; };
    const onKeyDown = (e: KeyboardEvent) => { pointerRef.current = false; tabbedRef.current = e.key === 'Tab'; };
    // A press is over a task after its CLICK (a pointercancel ends it at once): not on pointerup, because iOS focuses a text input at or after it. Without this the flag
    // stayed set until a key or the next open, and focus that left by a non-key route (a screen reader's swipe) was ignored: the popover was left open and orphaned
    // (Iro round-4 MINOR-1). The press's own focus is already in by the click, which comes after it.
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    const onClick = () => { clearTimer = setTimeout(() => { pointerRef.current = false; }, 0); };
    const onPointerCancel = () => { pointerRef.current = false; };
    const onFocusIn = (e: FocusEvent) => {
      if (pointerRef.current || modalLayerOpen(popoverRef.current)) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target) || openerRef?.current?.contains(target)) return;
      if (target instanceof Element && target.closest(PASSTHROUGH)) return;
      onCloseRef.current();
    };
    // Focus leaving the popover for NOTHING (WebKit's Tab goes to <body>/the browser's own chrome after the last stop; no `focusin` fires there):
    // `focusout` with no `relatedTarget` right after a Tab, while the document still has focus (a window switch is not the user leaving it).
    const onFocusOut = (e: FocusEvent) => {
      if (pointerRef.current || !tabbedRef.current || e.relatedTarget !== null || modalLayerOpen(popoverRef.current)) return;
      const target = e.target;
      if (!(target instanceof Node) || !popoverRef.current?.contains(target)) return;
      if (typeof document.hasFocus === 'function' && !document.hasFocus()) return;
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      if (clearTimer) clearTimeout(clearTimer);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [open, anchorRef, openerRef]);

  // Outside press: closes on CLICK, consumes it, except on a passthrough element (the X-card): closes and delivers it.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const pop = popoverRef.current;
      if (pop?.contains(target)) return;
      if (modalLayerOpen(pop)) return; // a dialog opened from the popover: its press is the dialog's, neither a dismissal nor consumed
      const anchor = anchorRef.current;
      const opener = openerRef?.current;
      if ((anchor && anchor.contains(target)) || (opener && opener.contains(target))) return; // the consumer's own toggle
      const passthrough = target instanceof Element && target.closest(PASSTHROUGH) !== null;
      if (!passthrough) {
        e.preventDefault();
        e.stopPropagation();
      }
      onCloseRef.current();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [open, anchorRef, openerRef]);

  // Focus: on open to the declared target; on every close back to the opener (or the fallback), decided in the commit that closed it.
  useLayoutEffect(() => {
    if (open) {
      owedFocusRef.current?.();
      wasOpenRef.current = true;
      const pop = popoverRef.current;
      const target = (initialFocus ? pop?.querySelector<HTMLElement>(initialFocus) : null) ?? pop?.querySelector<HTMLElement>(TABBABLE) ?? pop;
      target?.focus({ preventScroll: true });
      // The placement lands in this commit and the next (the clamp is state): reveal now, and once more when two frames have settled it.
      revealFocused();
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(revealFocused);
      });
      return () => {
        cancelAnimationFrame(raf1);
        if (raf2) cancelAnimationFrame(raf2);
      };
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    if (modalLayerOpen(popoverRef.current)) {
      // Closed under a modal (a dialog the popover's control opened is still up: the session ended while its confirm was open). Focus is the dialog's and its
      // own restore will aim at a control inside this now-hidden popover and land on <body>: when the last modal layer goes, give focus to the opener (the
      // fallback if it is gone), unless the page has put it somewhere real by then. Bounded.
      owedFocusRef.current?.();
      const mo = new MutationObserver(() => {
        if (modalLayerOpen(popoverRef.current)) return;
        owedFocusRef.current?.();
        const now = document.activeElement;
        if (now && now !== document.body) return;
        const o = openerEl();
        if (o && o.isConnected) o.focus({ preventScroll: true });
        else fallbackFocus?.()?.focus({ preventScroll: true });
      });
      const timer = setTimeout(() => owedFocusRef.current?.(), 15_000);
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'inert', 'hidden'] });
      owedFocusRef.current = () => { mo.disconnect(); clearTimeout(timer); owedFocusRef.current = null; };
      return;
    }
    const active = document.activeElement;
    // Focus is left alone when the user moved it on to a control of their choosing (the X-card took the press); it is brought back when it
    // was in the popover (now gone or hidden) or fell to <body>.
    if (active && active !== document.body && !popoverRef.current?.contains(active)) return;
    const opener = openerEl();
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    else fallbackFocus?.()?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the focus rule reads the options at the moment of the change, not on their identity
  }, [open]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.key === 'Escape') {
        consumeEscape(e, { onClose });
        return;
      }
      if (e.key !== 'Tab') return;
      const pop = popoverRef.current;
      if (!pop) return;
      const stops = Array.from(pop.querySelectorAll<HTMLElement>(TABBABLE)).filter(
        (el) => el.tabIndex >= 0 && !el.closest('[hidden], [inert], [aria-hidden="true"]'),
      );
      const active = document.activeElement as HTMLElement | null;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const past = stops.length === 0 || (e.shiftKey ? active === first || active === pop : active === last);
      if (!past) return;
      // Past either end: close, and put focus back on the opener (the close's own focus rule), not wherever Tab would have gone.
      e.preventDefault();
      onClose();
    },
    [onClose],
  );

  const attachPopover = useCallback((el: HTMLElement | null) => {
    popoverRef.current = el;
  }, []);

  const recordOpener = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      if (openerRef && 'current' in openerRef) (openerRef as { current: HTMLElement | null }).current = e.currentTarget;
    },
    [openerRef],
  );

  const style: CSSProperties = placed
    ? { position: 'fixed', left: placed.left, maxHeight: placed.maxHeight, maxWidth: placed.maxWidth, ...(placed.top !== undefined ? { top: placed.top } : { bottom: placed.bottom }) }
    : { position: 'fixed', left: 0, top: 0 };

  return {
    id,
    open,
    anchorProps: {
      'aria-haspopup': role === 'menu' ? 'menu' : 'dialog',
      'aria-expanded': open,
      'aria-controls': open || keepMounted ? id : undefined,
    },
    popoverProps: {
      id,
      style,
      onKeyDown,
      'data-anchored-popover': '',
      'data-placement': placed?.side ?? 'top',
    },
    attachPopover,
    recordOpener,
  };
}
