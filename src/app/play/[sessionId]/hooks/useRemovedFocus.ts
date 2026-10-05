'use client';

import { useCallback, useEffect, useRef } from 'react';

/** Focus can rest on `el` only while it is in the page and not under `inert` or `hidden`. */
// A `:disabled` control is taken away too: a native `disabled` button drops focus in a real browser, and no control the user can act on is left under it.
const focusable = (el: Element) => el.isConnected && el.closest('[inert], [hidden]') === null && !el.matches(':disabled');

/**
 * A9d-2 fix round 4 (Kage whole-branch I-C) — "was the control focus was on REMOVED?", the one question every stranded-focus rescue is about.
 *
 * The rescues in `useFocusAnchors` each asked "is focus on <body>?" in an animation frame. That answers a different question: a cold load has
 * focus on <body> too, and the layout-change rescue, which only saw "<body> after the layout id changed", put a focus ring on the scene heading
 * in 6 of 8 cold loads with the Table preference and motion allowed (main: 0 of 16). Nothing had been removed, so nothing needed rescuing.
 *
 * The probe remembers the control focus was last on (a document `focusin`; a pointer press forgets it, so a click on empty space is "the user
 * moved on", never a removal). Called from a commit, it answers true only when that control is now somewhere focus cannot be (unmounted, or
 * under `inert` / `hidden`) and the page has not given focus to anything else. Called from a layout effect there is no frame in it, so there is no
 * order of frame and commit to get wrong (the same reason as `useStrandedFocusRescue`, which keeps the async case: a watch armed before the await).
 * It forces no layout (no `getClientRects`): jsdom has none, and an `inert` / `hidden` / unmounted control is what every rescue here is about.
 */
// debt: "removed" is unmounted, or under an inert / hidden ATTRIBUTE; a control hidden by CSS alone (display: none) is not seen. ceiling: every fold and drawer in the play shell hides with hidden / inert (read at c52da04: the phone drawer, the stage folds, the closed sheet). until: a region hides a focusable control by class only.
export function useRemovedFocus(): () => boolean {
  const lastRef = useRef<Element | null>(null);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      lastRef.current = e.target instanceof Element ? e.target : null;
    };
    const onPointerDown = () => {
      lastRef.current = null;
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);

  return useCallback(() => {
    const last = lastRef.current;
    if (!last) return false;
    const active = document.activeElement;
    // Focus is on something else the user (or the page) chose: not stranded. `last` itself still counts: an `inert` node keeps `activeElement`
    // until the browser's next focus fixup, and that is exactly the layout-change case.
    if (active && active !== document.body && active !== last) return false;
    return !focusable(last);
  }, []);
}
