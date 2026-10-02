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
}

function ToastCard({ item, onDismiss }: ToastItemProps) {
  const reduced = useReducedMotion();
  const pausedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Placeholder only — `Date.now()` is impure and can't run during render;
  // the auto-dismiss effect below overwrites this with the real value before
  // it's ever read (handleMouseEnter/Leave only fire post-mount, by hover).
  const startedAtRef = useRef<number>(0);
  const remainingRef = useRef<number>(item.duration ?? 5000);

  const tone = item.tone ?? 'info';
  const accentColor = TONE_TOKEN[tone];
  const iconName = TONE_ICON[tone];
  const isError = tone === 'error';

  // Auto-dismiss timer
  useEffect(() => {
    const dur = item.duration ?? 5000;
    if (!isFinite(dur)) return;

    startedAtRef.current = Date.now();
    remainingRef.current = dur;

    timerRef.current = setTimeout(() => onDismiss(item.id), remainingRef.current);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [item.id, item.duration, onDismiss]);

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

      <div className={styles.body}>
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
 * Where the toast host stands (A9d-2 fix round 4, Kage C-1: it sat bottom-right on the X-card at EVERY desktop width, and the card, `pointer-events:
 * auto`, took the X-card's tap; round 2 had moved it off the safety block with a width query that never reached the desktop). Placed by EXCLUSION, on
 * every layout, from marks the page puts on its own elements: `data-toast-avoid` = what a toast must NEVER cover (the safety block, the raised safety
 * banner, the composer: Send and the textarea), `data-toast-clear` = what it should keep clear when it can (the header, party band and scene strip).
 * Candidates: the bottom edge, the top edge, and the top directly UNDER each mark (the lowest first), while the whole stack fits on the screen. Each is
 * written, measured (its own box), and ranked by what it covers, in this order: the never-cover marks first, the clear marks second, then the earlier
 * candidate. RANKED, not summed or first-fit: a candidate that touches a never-cover mark always loses to one that does not, however much more it
 * covers elsewhere (round 5, Kage N-1: marking the banner alone would have made the smallest-area fallback prefer the composer and the X-card block, 13,362
 * px2, to the banner, 26,400 px2). A layout that moves a control (or a new row) needs no code here, only the marks. `pointer-events` alone is not the
 * fix: the button has to stay VISIBLE and a focused control must not be obscured (WCAG 2.4.11). `data-placement` and `--toast-top` are what
 * Toast.module.css reads.
 */
// debt: the candidates are the two edges and the line under each mark, not a search for a free rectangle. ceiling: Table at 1440x900 and 1024x768 has no free band wide enough, so the host takes the top edge over the Character sheet's heading and toggle (it covers no never-cover mark). until: the stage gets a notification lane, or a toast must stand clear of every focusable control (then rank by overlap with them too: Backlog, toast placement revisited).
const TOAST_GAP_PX = 8;
const AVOID = '[data-toast-avoid]';
const CLEAR = '[data-toast-clear]';

type Placement = { placement: 'bottom' | 'top'; top: number };

const boxes = (selector: string) =>
  [...document.querySelectorAll(selector)].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);

const overlapArea = (a: DOMRect, b: DOMRect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Lexicographic: the first tier that differs (by more than half a pixel squared) decides; all tiers equal = equal. */
function cheaper(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 0.5) return a[i] < b[i];
  }
  return false;
}

function useToastPlacement(ref: RefObject<HTMLDivElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let raf = 0;
    const apply = (c: Placement) => {
      el.setAttribute('data-placement', c.placement);
      el.style.setProperty('--toast-top', `${Math.round(c.top)}px`);
    };
    const place = () => {
      raf = 0;
      const avoid = boxes(AVOID);
      const clear = boxes(CLEAR);
      const candidates: Placement[] = [{ placement: 'bottom', top: 0 }];
      // Under each mark (the lowest first), only while the whole stack then fits on the screen; the top edge last.
      const unders = [...new Set([...avoid, ...clear].map((r) => Math.round(r.bottom)))]
        .filter((y) => y > 0 && y + TOAST_GAP_PX + el.offsetHeight <= window.innerHeight)
        .sort((x, y) => y - x);
      for (const y of unders) candidates.push({ placement: 'top', top: y });
      candidates.push({ placement: 'top', top: 0 });
      let best = candidates[0];
      let bestCost: number[] | null = null;
      for (const c of candidates) {
        apply(c);
        const host = el.getBoundingClientRect();
        const cost = [avoid, clear].map((marks) => marks.reduce((sum, r) => sum + overlapArea(host, r), 0));
        if (bestCost === null || cheaper(cost, bestCost)) { best = c; bestCost = cost; }
        if (cost.every((x) => x <= 0.5)) break;
      }
      apply(best);
      // The marks can appear after the first placement (a region mounting late): watch whatever is there now. Observing a node twice is a no-op.
      document.querySelectorAll(`${AVOID}, ${CLEAR}`).forEach((n) => ro?.observe(n));
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(queue) : null;
    ro?.observe(el);
    // A mark that mounts, unmounts or is pushed by a sibling's growth changes no size of its own and fires no resize: the page's markup is the
    // signal. The host's own writes (its placement, its cards) are not.
    const mo = typeof MutationObserver !== 'undefined'
      ? new MutationObserver((records) => { if (records.some((r) => !el.contains(r.target))) queue(); })
      : null;
    mo?.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    place();
    window.addEventListener('scroll', queue, true);
    window.addEventListener('resize', queue);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', queue, true);
      window.removeEventListener('resize', queue);
      ro?.disconnect();
      mo?.disconnect();
      el.removeAttribute('data-placement');
      el.style.removeProperty('--toast-top');
    };
  }, [ref, active]);
}

function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  const hasError = toasts.some((t) => (t.tone ?? 'info') === 'error');
  const hostRef = useRef<HTMLDivElement>(null);
  useToastPlacement(hostRef, toasts.length > 0);

  return (
    <div
      ref={hostRef}
      data-component="ToastViewport"
      aria-live={hasError ? 'assertive' : 'polite'}
      aria-atomic="false"
      className={styles.viewport}
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={onDismiss} />
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

  const value: ToastContextValue = { toast, dismiss };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
