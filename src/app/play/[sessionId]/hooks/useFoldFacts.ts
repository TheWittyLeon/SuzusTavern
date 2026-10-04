'use client';

/**
 * B8c-4 P0 (Sora's phone-mount brief 2.3, 4.2, 4.3; the Coordinator addendum, binding) — the shell's fold machinery, in one hook so `PlayShell` stays a loop.
 * Generic: it is handed the folds that are LIVE (a placed, collapsible region with a spec whose `when` holds) and learns nothing about what they hold.
 *
 *   - THE FACT. Each live fold's value (`auto` | `open` | `folded`, foldState.ts) is reported as `fold:<regionId>`; the shell emits it last, so a row answers it like any other fact.
 *   - THE MEASURED DEFAULT (4.2). A fold whose default is `fits` and that nothing has decided reports `auto`: the row answers with a floor, the page renders once at that floor, and in the
 *     same commit (a layout effect, before paint) the shell asks whether the page fits its viewport: it does, `open`; it scrolls, `folded`. That decision is made AGAIN on exactly three
 *     events: a fight starting (the moment changes), a fold's `when` starting to hold, and the shell root's WIDTH changing (a ResizeObserver, never `window.resize`: a keyboard or a browser bar
 *     changes the height and must change nothing). Never while a touch is down anywhere on the page, nor for 150 ms after the last scroll event: the request is queued and applied then.
 *     A stored choice and a reveal are never overridden. A banner is the one exception: it folds at once (foldValue), with no measurement and no gate.
 *   - THE SCROLL STEP (4.3 and the addendum). A press on a handle opens the body UPWARD: the page scrolls by what the body added, in the commit that adds it (a layout effect, before paint,
 *     `behavior: 'instant'` so a global `scroll-behavior: smooth` cannot animate it), clamped so the handle stays wholly in view; folding scrolls back by what it removed. It applies on the
 *     handle's `click`, never on pointerdown, and a second activation inside 400 ms is ignored (the handle leaves from under the thumb). If the handle is not wholly in view when pressed to
 *     open, the open is refused and the handle says so (disabled, with a reason) until the page scrolls.
 *   - THE AUTOMATIC CASES (a fight starting with a stored `open` on a page that scrolls; the viewport getting shorter while a body is open): the page is left at its end, once per decision,
 *     never while an editable field has focus (a soft keyboard may be up), never if the user has scrolled since the last decision, never while a finger is down.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { foldValue, isEditable, scrollStep, type FoldChoice, type FoldFact } from '../foldState';
import type { Moment, RegionId } from '../presets';

/** A fold the shell can see right now: a placed, collapsible region with a spec whose `when` holds. */
export interface FoldCandidate {
  id: RegionId;
  /** The id of the body element that folds, when the fold has one (a body fold: the banner folds it, the handle is placed by the region, the scroll step measures it). */
  body?: string;
  /** `Placement.foldDefault === 'fits'`. */
  fits: boolean;
}

/** Quiet time after the last scroll event and after the last finger lifts, before a queued decision is applied (brief 4.2, T C-1). */
export const FOLD_QUIET_MS = 150;
/** A second activation of a handle inside this window is ignored (addendum, P0). */
export const FOLD_REACTIVATE_MS = 400;
/** A finger that never reports its end (a removed target) stops holding the gate after this long. */
export const FOLD_TOUCH_BACKSTOP_MS = 5000;
/** The handle's reason while a banner folded the body. Described, not announced: the handle stays focusable. */
export const FOLD_BANNER_REASON = 'Folded while the safety card is showing';
/** The handle's reason when it was pressed with the handle partly out of view: the open is refused, not slid under the viewport. */
export const FOLD_NO_ROOM_REASON = 'Scroll the handle into view to open';

const BANNER = ':scope > [data-region-slot="safetyBanner"] > :not(:empty)';

interface Args {
  rootRef: RefObject<HTMLDivElement | null>;
  moment: Moment;
  candidates: readonly FoldCandidate[];
  stored: (id: RegionId) => FoldChoice;
  revealed: (id: RegionId) => boolean;
}

export function useFoldFacts({ rootRef, moment, candidates, stored, revealed }: Args) {
  const [decided, setDecided] = useState<Partial<Record<RegionId, 'open' | 'folded'>>>({});
  const [banner, setBanner] = useState(false);
  const [noRoom, setNoRoom] = useState<RegionId | null>(null);
  const [, setTick] = useState(0);

  // The gate: a finger anywhere on the page, or a scroll in the last FOLD_QUIET_MS, holds every decision and automatic scroll.
  const touches = useRef(0);
  const touchSince = useRef(0);
  const lastScroll = useRef(0);
  const ownScrollUntil = useRef(0);
  const userScrolled = useRef(false);
  const want = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gen = useRef(0);
  const parkedGen = useRef(-1);
  const lastPress = useRef(-Infinity);
  const step = useRef<{ id: RegionId; dir: 'open' | 'fold'; before: number; body: string } | null>(null);

  const gateOpen = useCallback(() => {
    const now = Date.now();
    const held = touches.current > 0 && now - touchSince.current < FOLD_TOUCH_BACKSTOP_MS;
    return !held && now - lastScroll.current >= FOLD_QUIET_MS;
  }, []);

  const values = new Map<RegionId, FoldFact>();
  for (const c of candidates) {
    values.set(c.id, foldValue({ banner: banner && c.body !== undefined, revealed: revealed(c.id), stored: stored(c.id), fits: c.fits, decided: decided[c.id] }));
  }
  // What the effects below read: the latest render's candidates and values, never a closure from an older one.
  const latest = useRef({ candidates, values });
  useLayoutEffect(() => {
    latest.current = { candidates, values };
  });

  const anyOpenBody = useCallback(() => latest.current.candidates.some((c) => c.body !== undefined && latest.current.values.get(c.id) === 'open'), []);

  const park = useCallback(() => {
    if (!gateOpen() || isEditable(document.activeElement) || userScrolled.current) return;
    if (parkedGen.current === gen.current) return;
    const doc = document.scrollingElement;
    if (!doc || doc.scrollHeight <= doc.clientHeight + 1) return;
    parkedGen.current = gen.current;
    ownScrollUntil.current = Date.now() + 100;
    userScrolled.current = false; // the page has settled where the shell left it
    window.scrollTo({ top: doc.scrollHeight, behavior: 'instant' });
  }, [gateOpen]);

  // A decision is asked for again: now, or queued until the gate opens.
  const redecide = useCallback(() => {
    gen.current += 1;
    if (gateOpen()) setDecided((prev) => (Object.keys(prev).length ? {} : prev));
    else want.current = true;
  }, [gateOpen]);

  useEffect(() => {
    const flush = () => {
      timer.current = undefined;
      if (!gateOpen()) { schedule(); return; }
      if (want.current) {
        want.current = false;
        setDecided((prev) => (Object.keys(prev).length ? {} : prev));
      }
      setTick((t) => t + 1);
      if (anyOpenBody()) park();
    };
    function schedule(ms = FOLD_QUIET_MS) {
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, ms);
    }
    const onTouch = (e: TouchEvent) => {
      if (touches.current === 0 && e.touches.length > 0) touchSince.current = Date.now();
      touches.current = e.touches.length;
      // A finger down holds the gate; if its end never arrives, the backstop lets go (and flushes whatever was queued).
      schedule(touches.current === 0 ? FOLD_QUIET_MS : FOLD_TOUCH_BACKSTOP_MS);
    };
    const onScroll = () => {
      lastScroll.current = Date.now();
      if (Date.now() > ownScrollUntil.current) userScrolled.current = true;
      setNoRoom((prev) => (prev === null ? prev : null));
      if (want.current) schedule();
    };
    const onResize = () => { if (anyOpenBody()) park(); };
    window.addEventListener('touchstart', onTouch, { capture: true, passive: true });
    window.addEventListener('touchend', onTouch, { capture: true, passive: true });
    window.addEventListener('touchcancel', onTouch, { capture: true, passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('touchstart', onTouch, { capture: true });
      window.removeEventListener('touchend', onTouch, { capture: true });
      window.removeEventListener('touchcancel', onTouch, { capture: true });
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      clearTimeout(timer.current);
    };
  }, [gateOpen, anyOpenBody, park]);

  // Event 3: the shell root's WIDTH changes (never its height).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    let last: number | null = null;
    const ro = new ResizeObserver(() => {
      const w = root.clientWidth;
      if (last !== null && w !== last) redecide();
      last = w;
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [rootRef, redecide]);

  // Events 1 and 2: a fight starting (the moment changes) and a fold's `when` starting to hold (the live set changes).
  const liveKey = candidates.map((c) => c.id).join(',');
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a fight starting / a fold appearing IS the event that asks for the decision again; it must land before paint (the shell's fit measurement does the same)
    redecide();
    // A scroll the user made before this fight is refused, not forgotten: it holds the automatic scroll until the page settles or the fight is over.
    if (moment !== 'combat') userScrolled.current = false;
    if (moment === 'combat' && anyOpenBody()) park();
  }, [moment, liveKey, redecide, anyOpenBody, park]);

  // A banner is stamped from the DOM, the way the shell's fit measurement reads it: a safety banner up with a body fold folds it at once.
  const stampBanner = useCallback(() => {
    const up = !!rootRef.current?.querySelector(BANNER);
    setBanner((prev) => (prev === up ? prev : up));
  }, [rootRef]);
  useLayoutEffect(() => {
    stampBanner();
  });

  // The measured default: in the commit that rendered an `auto` fold at its floor, does the page fit? One pass, before paint.
  const decide = useCallback(() => {
    const root = rootRef.current;
    const autos = latest.current.candidates.filter((c) => latest.current.values.get(c.id) === 'auto');
    if (!root || autos.length === 0 || !gateOpen()) return;
    const fits = root.scrollHeight <= root.clientHeight + 1;
    setDecided((prev) => {
      const next = { ...prev };
      for (const c of autos) next[c.id] = fits ? 'open' : 'folded';
      return next;
    });
  }, [rootRef, gateOpen]);
  useLayoutEffect(() => {
    decide();
  });

  // The scroll step, in the commit that opened or folded the body a handle press asked for.
  useLayoutEffect(() => {
    const s = step.current;
    if (!s) return;
    step.current = null;
    const after = document.getElementById(s.body)?.getBoundingClientRect().height ?? 0;
    const added = s.dir === 'open' ? after - s.before : s.before - after;
    const doc = document.scrollingElement;
    if (!doc) return;
    let by = 0;
    if (s.dir === 'open') {
      if (doc.scrollHeight <= doc.clientHeight + 1) return;
      const r = rootRef.current?.querySelector(`[aria-controls="${s.body}"]`)?.getBoundingClientRect();
      if (!r) return;
      by = scrollStep({ dir: 'open', added, handleTop: r.top, handleBottom: r.bottom, viewport: window.innerHeight });
    } else if (window.scrollY > 0) {
      by = scrollStep({ dir: 'fold', added, handleTop: 0, handleBottom: 0, viewport: 0 });
    }
    if (by === 0) return;
    ownScrollUntil.current = Date.now() + 100;
    window.scrollBy({ top: by, behavior: 'instant' });
  });

  /** A press on a handle. `write` stores the user's choice (the only thing that ever does). */
  const press = useCallback((c: FoldCandidate, write: (next: 'folded' | 'open') => void) => {
    const now = Date.now();
    if (now - lastPress.current < FOLD_REACTIVATE_MS) return;
    lastPress.current = now;
    const open = latest.current.values.get(c.id) !== 'folded';
    const next = open ? 'folded' : 'open';
    if (c.body !== undefined) {
      const bodyEl = document.getElementById(c.body);
      if (next === 'open') {
        const r = rootRef.current?.querySelector(`[aria-controls="${c.body}"]`)?.getBoundingClientRect();
        if (r && (r.top < 0 || r.bottom > window.innerHeight)) { setNoRoom(c.id); return; }
      }
      step.current = { id: c.id, dir: next === 'open' ? 'open' : 'fold', before: bodyEl?.getBoundingClientRect().height ?? 0, body: c.body };
    }
    write(next);
  }, [rootRef]);

  const lockedReason = (c: FoldCandidate): string | undefined => {
    if (c.body === undefined) return undefined;
    if (banner) return FOLD_BANNER_REASON;
    return noRoom === c.id ? FOLD_NO_ROOM_REASON : undefined;
  };

  return { values, press, lockedReason };
}
