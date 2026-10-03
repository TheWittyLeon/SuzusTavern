'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import Icon from '@/components/Icon';
import Button from '@/components/Button';
import { useReducedMotion } from '@/lib/useReducedMotion';
import styles from '@/components/Toast.module.css';

// ---- Types ----

export type ToastTone = 'info' | 'success' | 'warn' | 'error';

export interface ToastOptions {
  title?: string;
  message: string;
  tone?: ToastTone;
  /** Auto-dismiss after this many ms. Default: 5000. Pass Infinity to disable. */
  duration?: number;
  /** Optional action button (e.g. "Undo"). Invoked then the toast is dismissed. */
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: string;
  /** Set to true to begin exit animation */
  exiting: boolean;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => string;
  dismiss: (id: string) => void;
}

// ---- Context ----

const ToastContext = createContext<ToastContextValue | null>(null);

// ---- Hook ----

/**
 * Returns `{ toast, dismiss }` from the nearest ToastProvider.
 * Throws a descriptive error when called outside a provider.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    throw new Error(
      'useToast() must be called inside a <ToastProvider>. ' +
        'Wrap your component tree with <ToastProvider> before using this hook.',
    );
  }
  return ctx;
}

// ---- Helpers ----

let _counter = 0;
function nextId(): string {
  return `toast-${++_counter}`;
}

const TONE_ICON = {
  info: 'Bell',
  success: 'Check',
  warn: 'Bell',
  error: 'Close',
} as const satisfies Record<ToastTone, Parameters<typeof Icon>[0]['name']>;

const TONE_TOKEN: Record<ToastTone, string> = {
  info: 'var(--accent)',
  success: 'var(--good)',
  warn: 'var(--warn)',
  error: 'var(--bad)',
};

// Exit animation duration (must match CSS)
const EXIT_DURATION_MS = 220;

// ---- Individual toast ----

interface ToastItemProps {
  item: ToastItem;
  onDismiss: (id: string) => void;
  /** Waiting its turn (the placement could not show it without touching the safety block): `hidden`, and its timer has not started. */
  held?: boolean;
}

function ToastCard({ item, onDismiss, held = false }: ToastItemProps) {
  const reduced = useReducedMotion();
  const pausedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Placeholder only — `Date.now()` is impure and can't run during render;
  // the auto-dismiss effect below overwrites this with the real value before
  // it's ever read (handleMouseEnter/Leave only fire post-mount, by hover).
  const startedAtRef = useRef<number>(0);
  const remainingRef = useRef<number>(item.duration ?? 5000);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === 'undefined') return;
    const measure = () => setScrolls(body.scrollHeight > body.clientHeight + 1);
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    measure();
    return () => ro.disconnect();
  }, [item.message]);

  const tone = item.tone ?? 'info';
  const accentColor = TONE_TOKEN[tone];
  const iconName = TONE_ICON[tone];
  const isError = tone === 'error';

  // Auto-dismiss timer
  useEffect(() => {
    const dur = item.duration ?? 5000;
    if (!isFinite(dur) || held) return;

    startedAtRef.current = Date.now();
    remainingRef.current = dur;

    timerRef.current = setTimeout(() => onDismiss(item.id), remainingRef.current);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [item.id, item.duration, onDismiss, held]);

  // Pause/resume on hover
  const handleMouseEnter = () => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      remainingRef.current -= Date.now() - startedAtRef.current;
    }
  };

  const handleMouseLeave = () => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    startedAtRef.current = Date.now();
    if (isFinite(item.duration ?? 5000)) {
      timerRef.current = setTimeout(
        () => onDismiss(item.id),
        Math.max(remainingRef.current, 0),
      );
    }
  };

  return (
    <div
      role={isError ? 'alert' : 'status'}
      data-component="Toast"
      data-toast-id={item.id}
      data-tone={tone}
      data-exiting={item.exiting ? 'true' : undefined}
      className={[
        styles.toast,
        item.exiting
          ? reduced
            ? styles.hiddenStatic
            : styles.exiting
          : reduced
            ? styles.visibleStatic
            : styles.entering,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--toast-accent': accentColor } as React.CSSProperties}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className={styles.iconSlot} aria-hidden="true">
        <Icon name={iconName} size={16} color={accentColor} />
      </span>

      <div
        ref={bodyRef}
        className={styles.body}
        // A card taller than its max height (Toast.module.css) scrolls INSIDE: then the text is a tab stop, so a keyboard user can read all of it (WCAG 2.1.1).
        {...(scrolls ? { tabIndex: 0, role: 'group', 'aria-label': 'Notification text, scrollable' } : {})}
      >
        {item.title && <p className={styles.title}>{item.title}</p>}
        <p className={styles.message}>{item.message}</p>
      </div>

      {item.action && (
        <Button
          variant="ghost"
          className={styles.action}
          onClick={() => {
            item.action?.onClick();
            onDismiss(item.id);
          }}
        >
          {item.action.label}
        </Button>
      )}

      <Button
        size="icon"
        variant="ghost"
        aria-label="Dismiss notification"
        className={styles.dismiss}
        onClick={() => onDismiss(item.id)}
      >
        <Icon name="Close" size={14} />
      </Button>
    </div>
  );
}

// ---- Viewport ----

interface ToastViewportProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

/**
 * Where the toast host stands, and how many cards it shows (A9d-2 fix round 4, Kage C-1; rounds 5 and 6). Placed by EXCLUSION, on every layout, never by a
 * width: the host writes a candidate, measures its own box, and ranks what it covers, tier by tier (lexicographic: a higher tier outweighs any amount of a lower one):
 *   1. THE SAFETY BLOCK (`data-toast-avoid="safety"`: the X-card). Its own tier, ahead of everything: the X-card rule is never exemptable (round 6, Kage point 1: it was
 *      summed with the banner and the composer, so a candidate on the X-card could beat one on the composer by area).
 *   2. The other NEVER-cover marks (`data-toast-avoid`: the raised safety banner, the composer: Send and the textarea).
 *   3. Every other focusable CONTROL on screen (WCAG 2.4.11), found by what it is, CLIPPED by the scrollers it sits in (a control scrolled out of its own scroller's box is not
 *      on screen). A new region needs no mark and no edit here.
 *   4. The page's CLEAR marks (`data-toast-clear`), then the earlier candidate.
 * CANDIDATES: the bottom edge, the top edge, the line under each mark, then, while the best still covers something, the line under each thing it covers (four rounds).
 * THE STACK IS CAPPED BY FIT: with several cards the stack is taller than any free place, so the host tries all of them, then one fewer, down to ONE, and keeps the most that
 * stand clear of tiers 1 and 2 (never fewer than one). The rest are HELD (`hidden`, their timers not started) and show as the earlier ones leave: not dropped.
 * NO HOPPING: it keeps its place unless that place has become worse in tiers 1-3 than the best available (hysteresis), does not re-place WHILE the page scrolls
 * (it settles ~150 ms after the last scroll; but at once if its place has touched a never-cover mark), and runs at once when a card is added or removed. The search
 * runs only when a signature of the boxes it reads changed. `pointer-events` alone is not the fix: the button has to stay VISIBLE. `data-placement` and `--toast-top` are
 * what Toast.module.css reads.
 */
// debt: the candidates are the two edges and the line under each thing in the way (at most four rounds), not a search for a free rectangle. ceiling: a screen whose only free band is beside a control (a narrow gap in a wide row) is not found; Table at 320x256 has no free band at all and keeps the least bad for ONE card. until: the stage gets a notification lane (a place no toast needs to find).
const TOAST_GAP_PX = 8;
const SLIDE_ROUNDS = 4;
const MIN_CARD_PX = 72;
const SCROLL_SETTLE_MS = 150;
const SAFETY = '[data-toast-avoid="safety"]';
const NEVER = '[data-toast-avoid]:not([data-toast-avoid="safety"])';
const AVOID = '[data-toast-avoid]';
const CLEAR = '[data-toast-clear]';
const CONTROLS =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [role="button"], [role="menuitem"]';

type Placement = { placement: 'bottom' | 'top'; top: number };

const boxes = (selector: string) =>
  [...document.querySelectorAll(selector)].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);

const CLIPS = new Set(['auto', 'scroll', 'hidden', 'clip']);

/** `r` clipped by every scroller / `overflow: hidden` box above `el` (null when nothing is left): a control scrolled out of its own scroller is not on screen. */
function clippedBox(el: Element, r: DOMRect, styleOf: (n: Element) => CSSStyleDeclaration): { left: number; top: number; right: number; bottom: number } | null {
  let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  // A `position: fixed` box is not clipped by the scrollers it sits in (it escapes them unless one is its containing block): the Attack menu's items and a dialog's buttons are
  // painted and hittable (round 7, Kage N6-2). So the walk stops at the first fixed box on the path, the element itself included; that box's OWN overflow still clips what is in it.
  if (styleOf(el).position === 'fixed') return box;
  for (let p = el.parentElement; p && p !== document.documentElement && p !== document.body; p = p.parentElement) {
    const cs = styleOf(p);
    const clipX = CLIPS.has(cs.overflowX);
    const clipY = CLIPS.has(cs.overflowY);
    if (!clipX && !clipY) { if (cs.position === 'fixed') break; continue; }
    const pr = p.getBoundingClientRect();
    if (clipX) { box = { ...box, left: Math.max(box.left, pr.left), right: Math.min(box.right, pr.right) }; }
    if (clipY) { box = { ...box, top: Math.max(box.top, pr.top), bottom: Math.min(box.bottom, pr.bottom) }; }
    if (box.right <= box.left || box.bottom <= box.top) return null;
    if (cs.position === 'fixed') break;
  }
  return box;
}

/** Controls on screen the host is not part of (not inert, hidden, a 1px sr-only name, or clipped away by their own scroller). */
function controlBoxes(host: HTMLElement): Array<{ left: number; top: number; right: number; bottom: number }> {
  const styles = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (n: Element) => styles.get(n) ?? (styles.set(n, getComputedStyle(n)), styles.get(n) as CSSStyleDeclaration);
  const out: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  for (const n of document.querySelectorAll(CONTROLS)) {
    if (host.contains(n) || n.closest('[inert], [hidden], [aria-hidden="true"]')) continue;
    const r = n.getBoundingClientRect();
    const c = clippedBox(n, r, styleOf);
    if (!c) continue;
    if (c.right - c.left >= 4 && c.bottom - c.top >= 4 && c.bottom > 0 && c.top < window.innerHeight && c.right > 0 && c.left < window.innerWidth) out.push(c);
  }
  return out;
}

const overlapArea = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Lexicographic over the first `tiers` entries: the first that differs (by more than half a pixel squared) decides; all equal = not cheaper. */
function cheaper(a: number[], b: number[], tiers = a.length): boolean {
  for (let i = 0; i < tiers; i++) {
    if (Math.abs(a[i] - b[i]) > 0.5) return a[i] < b[i];
  }
  return false;
}

const sig = (rs: Array<{ left: number; top: number; right: number; bottom: number }>) => rs.map((r) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`).join(';');

/** What the placement decided: how many cards to show (the rest are held), tells the viewport so it renders them held. */
function useToastPlacement(ref: RefObject<HTMLDivElement | null>, active: boolean, count: number, onFit: (shown: number) => void) {
  const placeRef = useRef<((force: boolean) => void) | null>(null);
  const onFitRef = useRef(onFit);
  useLayoutEffect(() => {
    onFitRef.current = onFit;
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let raf = 0;
    let lastSig = '';
    let scrollUntil = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const cards = () => [...el.querySelectorAll<HTMLElement>(':scope > [data-component="Toast"]')];
    const hold = (n: number) => cards().forEach((c, i) => { if (i >= n) c.setAttribute('hidden', ''); else c.removeAttribute('hidden'); });
    const apply = (c: Placement) => {
      el.setAttribute('data-placement', c.placement);
      el.style.setProperty('--toast-top', `${Math.round(c.top)}px`);
    };
    const current = (): Placement | null => {
      const placement = el.getAttribute('data-placement');
      const top = Number.parseFloat(el.style.getPropertyValue('--toast-top'));
      return placement === 'bottom' || placement === 'top' ? { placement, top: Number.isFinite(top) ? top : 0 } : null;
    };

    const place = (force = false) => {
      raf = 0;
      const safety = boxes(SAFETY);
      const never = boxes(NEVER);
      // While the page scrolls the host stays where it is, unless that place has just touched a never-cover mark (then it moves at once, as safety outranks calm).
      if (!force && Date.now() < scrollUntil) {
        const host = el.getBoundingClientRect();
        if (![...safety, ...never].some((r) => overlapArea(host, r) > 0.5)) return;
      }
      const clear = boxes(CLEAR);
      const controls = controlBoxes(el);
      const total = cards().length;
      // A card TOO TALL to clear the safety block (round 7, Kage point 2: 60 words were 309px at 320x256 and covered the X-card's centre; the X-card rule has no exemption): each card
      // gets a max height, the larger free band above or below the safety block that overlaps the host's width (never under 72px), and scrolls inside.
      const hostBox = el.getBoundingClientRect();
      const around = safety.filter((r) => Math.min(r.right, hostBox.right) - Math.max(r.left, hostBox.left) > 0.5);
      const room = around.length ? Math.max(MIN_CARD_PX, Math.min(...around.map((r) => r.top)) - 2 * TOAST_GAP_PX, window.innerHeight - Math.max(...around.map((r) => r.bottom)) - 2 * TOAST_GAP_PX) : window.innerHeight - 2 * TOAST_GAP_PX;
      el.style.setProperty('--toast-card-max', `${Math.floor(room)}px`);
      const signature = `${total}|${el.offsetHeight}|${window.innerWidth}x${window.innerHeight}|${sig(safety)}|${sig(never)}|${sig(controls)}|${sig(clear)}`;
      if (!force && signature === lastSig) return;
      lastSig = signature;
      const start = current();
      const tiers = [safety, never, controls, clear];

      // One search for the cards as they are now (some may be held): the best place, and whether the CURRENT one is still as good.
      const search = () => {
        const seen = new Set<string>();
        const results: { c: Placement; cost: number[]; host: { left: number; top: number; right: number; bottom: number } }[] = [];
        const fits = (y: number) => y + TOAST_GAP_PX + el.offsetHeight <= window.innerHeight;
        const evaluate = (c: Placement) => {
          const key = `${c.placement}/${Math.round(c.top)}`;
          if (seen.has(key)) return;
          seen.add(key);
          apply(c);
          const host = el.getBoundingClientRect();
          results.push({ c, host, cost: tiers.map((marks) => marks.reduce((sum, r) => sum + overlapArea(host, r), 0)) });
        };
        const bestOf = () => results.reduce((a, b) => (cheaper(b.cost, a.cost) ? b : a));
        if (start) evaluate(start);
        evaluate({ placement: 'bottom', top: 0 });
        [...new Set([...safety, ...never, ...clear].map((r) => Math.round(r.bottom)))].filter((y) => y > 0 && fits(y)).sort((x, y) => y - x).forEach((y) => evaluate({ placement: 'top', top: y }));
        evaluate({ placement: 'top', top: 0 });
        for (let round = 0; round < SLIDE_ROUNDS; round++) {
          const best = bestOf();
          if (best.cost.every((x) => x <= 0.5)) break;
          const before = results.length;
          [...new Set([...safety, ...never, ...controls, ...clear].filter((r) => overlapArea(best.host, r) > 0.5).map((r) => Math.round(r.bottom)))]
            .filter(fits).sort((x, y) => y - x).slice(0, 8).forEach((y) => evaluate({ placement: 'top', top: y }));
          if (results.length === before) break;
        }
        const best = bestOf();
        // Hysteresis: the place it had stands unless the best is strictly better in the safety, never-cover or control tiers (not the clear marks).
        const cur = start ? results.find((r) => r.c.placement === start.placement && Math.round(r.c.top) === Math.round(start.top)) : undefined;
        return cur && !cheaper(best.cost, cur.cost, 3) ? cur : best;
      };

      // THE CAP: all cards, then one fewer... down to one; the most that stand clear of the safety block and the other never-cover marks.
      let chosen = { n: total, r: (hold(total), search()) };
      for (let n = total - 1; n >= 1 && (chosen.r.cost[0] > 0.5 || chosen.r.cost[1] > 0.5); n--) {
        hold(n);
        const r = search();
        chosen = { n, r }; // the loop's own condition stops it at the first n that clears both tiers, else it ends on ONE
      }
      hold(chosen.n);
      apply(chosen.r.c);
      onFitRef.current(chosen.n);
      // The marks can appear after the first placement (a region mounting late): watch whatever is there now. Observing a node twice is a no-op.
      document.querySelectorAll(`${AVOID}, ${CLEAR}`).forEach((n) => ro?.observe(n));
    };
    placeRef.current = place;
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(() => place());
    };
    const onScroll = () => {
      scrollUntil = Date.now() + SCROLL_SETTLE_MS;
      queue();
      // the settle: one placement a beat after the LAST scroll (the signature decides whether anything moved)
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => { settleTimer = null; scrollUntil = 0; queue(); }, SCROLL_SETTLE_MS + 10);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(queue) : null;
    ro?.observe(el);
    // A mark or a control that mounts, unmounts or is pushed by a sibling's growth changes no size of its own and fires no resize: the page's markup is the
    // signal (nodes and attributes; not text, which moves a box only by resizing it, and a resize is seen above). The host's own writes are not. A mutation
    // costs one rAF and a few rect reads; the SEARCH runs only when the signature of the boxes changed.
    const mo = typeof MutationObserver !== 'undefined'
      ? new MutationObserver((records) => { if (records.some((r) => !el.contains(r.target))) queue(); })
      : null;
    mo?.observe(document.body, { childList: true, subtree: true, attributes: true });
    place(true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', queue);
    return () => {
      placeRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      if (settleTimer) clearTimeout(settleTimer);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', queue);
      ro?.disconnect();
      mo?.disconnect();
      el.removeAttribute('data-placement');
      el.style.removeProperty('--toast-top');
      el.style.removeProperty('--toast-card-max');
    };
  }, [ref, active]);

  // A card added or removed: place AT ONCE (no settle, no hysteresis shortcut by signature), so a new card never waits behind a scroll.
  const prevCount = useRef(count);
  useLayoutEffect(() => {
    if (prevCount.current === count) return;
    prevCount.current = count;
    placeRef.current?.(true);
  }, [count]);
}

function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  const hasError = toasts.some((t) => (t.tone ?? 'info') === 'error');
  const hostRef = useRef<HTMLDivElement>(null);
  // How many cards the placement could show without touching the safety block: the rest are HELD, in order, and show as the earlier ones leave.
  const [shown, setShown] = useState(Number.POSITIVE_INFINITY);
  useToastPlacement(hostRef, toasts.length > 0, toasts.length, setShown);
  if (toasts.length === 0 && shown !== Number.POSITIVE_INFINITY) setShown(Number.POSITIVE_INFINITY);

  // A keyboard user on a card's Dismiss: the card goes, and focus must not fall to <body> (Iro round-4 minor, older than this branch). It goes back to where it came from, else to
  // the page's fallback (the scene head, `data-focus-fallback`): the removed-focus rule the page already has. Only when focus WAS in the host and is now nowhere.
  const hadFocus = useRef(false);
  const cameFrom = useRef<HTMLElement | null>(null);
  // A POINTER dismiss leaves a REAL focus where it was (round 9, Miko F3: a mouse click on the x with focus in the composer left it on <body>; 2e73945 kept it in the composer):
  // the element focused when the press began, if it was outside the host. Nothing focused: nothing is recorded and no focus moves.
  const pointerReturn = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // A POINTER press on a card (a mouse click on its x) moves no focus of its own and is not a keyboard user's: the rescue forgets it, as the page's other rescue rule does
    // (useRemovedFocus). The press's own focus (Chromium focuses the button) comes between pointerdown and its click: ignored until a task after the click.
    let pressing = false;
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    const endPress = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = setTimeout(() => { pressing = false; }, 0); };
    const onPointerDown = (e: Event) => {
      if (pressTimer) clearTimeout(pressTimer);
      pressing = true;
      hadFocus.current = false;
      const a = document.activeElement;
      pointerReturn.current = e.target instanceof Node && hostRef.current?.contains(e.target) && a instanceof HTMLElement && a !== document.body && !hostRef.current.contains(a) ? a : null;
    };
    const onFocusIn = (e: FocusEvent) => {
      const inHost = e.target instanceof Node && !!hostRef.current?.contains(e.target);
      hadFocus.current = inHost && !pressing;
      if (!inHost) return;
      // where focus came FROM: cleared when it entered from nowhere, so a stale target is never returned to
      const from = e.relatedTarget;
      cameFrom.current = from instanceof HTMLElement && from !== document.body && !hostRef.current?.contains(from) ? from : null;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', endPress, true);
    document.addEventListener('pointercancel', endPress, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      if (pressTimer) clearTimeout(pressTimer);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('click', endPress, true);
      document.removeEventListener('pointercancel', endPress, true);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);
  useLayoutEffect(() => {
    const keyboard = hadFocus.current;
    const pointer = pointerReturn.current;
    if (!keyboard && !pointer) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    hadFocus.current = false;
    pointerReturn.current = null;
    // NEVER a safety control (round 9, Miko F2): the host follows the X-card in Tab order, so a keyboard Dismiss returned focus to the X-card and a held Enter (key auto-repeat)
    // then fired it (one /x-card POST). Where focus came from is used only if it is not inside the safety block; else the scene head.
    const usable = (el: HTMLElement | null) => !!el && el.isConnected && !el.closest('[inert], [hidden], [data-toast-avoid="safety"]');
    const back = keyboard ? cameFrom.current : pointer;
    const fallback = document.querySelector<HTMLElement>('[data-focus-fallback]');
    const target = usable(back) ? back : keyboard || back ? fallback : null;
    target?.focus({ preventScroll: true });
  }, [toasts]);

  return (
    <div
      ref={hostRef}
      data-component="ToastViewport"
      aria-live={hasError ? 'assertive' : 'polite'}
      aria-atomic="false"
      className={styles.viewport}
    >
      {toasts.map((item, i) => (
        <ToastCard key={item.id} item={item} onDismiss={onDismiss} held={i >= shown} />
      ))}
    </div>
  );
}

// ---- Provider ----

export interface ToastProviderProps {
  children: ReactNode;
}

/**
 * Provides `useToast()` to the subtree and renders the toast viewport.
 *
 * Keep this out of the root layout until Sprint 4 call-site wiring — pages
 * can wrap themselves as needed.
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    // Mark as exiting first (triggers exit animation)
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    );
    // Remove from DOM after animation completes
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_DURATION_MS);
  }, []);

  const toast = useCallback(
    (opts: ToastOptions): string => {
      const id = nextId();
      setToasts((prev) => [...prev, { ...opts, id, exiting: false }]);
      return id;
    },
    [],
  );

  // Escape dismisses the toasts (Iro round-5 MAJOR-2, WCAG 2.4.11: content that can cover a focused control must be dismissible without moving the pointer or
  // focus). The INNERMOST layer first: Escape that a popover or dialog consumed never reaches here (they stop it), and while a popover or a modal is open the
  // key is theirs, so the toast waits for the next one.
  const showing = toasts.some((t) => !t.exiting);
  useEffect(() => {
    if (!showing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const layerOpen = [...document.querySelectorAll('[aria-modal="true"], [data-anchored-popover][role]')].some((n) => !n.closest('[inert], [hidden], [aria-hidden="true"]'));
      if (layerOpen) return;
      // Only the cards that are SHOWN go: a held card was never seen or announced, and must now take its turn (round 7, Kage N6-1: at 320x256 one Escape left 0 of 4).
      const shownIds = new Set([...document.querySelectorAll<HTMLElement>('[data-component="Toast"]:not([hidden])')].map((c) => c.dataset.toastId));
      setToasts((prev) => prev.map((t) => (!t.exiting && shownIds.has(t.id) ? { ...t, exiting: true } : t)));
      setTimeout(() => setToasts((prev) => prev.filter((t) => !t.exiting)), EXIT_DURATION_MS);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showing]);

  const value: ToastContextValue = { toast, dismiss };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
