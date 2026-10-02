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
 * On a phone the toast host sits at the TOP, under every element that carries `data-toast-clear` (A9d-2 fix round 2, Tora MAJOR-1 / Iro MAJOR-2,
 * a safety finding). At the bottom it stacked over the page's last block: the X-card, Send and the textarea, and the card (`pointer-events:
 * auto`) took the X-card's tap for as long as it was up (7s on Chromium: a touch tap pauses the timer). `pointer-events` alone is not the fix:
 * the button has to stay VISIBLE and a focused control must not be obscured (WCAG 2.4.11). The page marks what the host must clear (the /play
 * header, party band and scene strip: the controls above the story log); this reads where they end, so the toast lands over the log's older
 * lines and not over a control. Short screens (a 400% zoom) have no room under them: the host takes the top edge there (and covers the header for the
 * few seconds it is up: there is nowhere on a 256px screen that covers nothing). `--toast-top` is the
 * px the host sits below the top edge; Toast.module.css reads it inside the phone media query only.
 */
const PHONE_QUERY = '(max-width: 880px)';
const TOAST_GAP_PX = 8;

function useToastClearance(ref: RefObject<HTMLDivElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(PHONE_QUERY);
    let raf = 0;
    const place = () => {
      raf = 0;
      let top = 0;
      if (mq.matches) {
        let bottom = 0;
        document.querySelectorAll('[data-toast-clear]').forEach((n) => {
          const r = n.getBoundingClientRect();
          if (r.height > 0 && r.bottom > bottom) bottom = r.bottom;
        });
        // Under them only while the whole stack then fits on the screen; on a short one (a 400% zoom, 256px: the header, the party band and the
        // strip are most of the first screen) it takes the top edge rather than leave the viewport.
        if (bottom + TOAST_GAP_PX + el.offsetHeight <= window.innerHeight) top = bottom;
      }
      el.style.setProperty('--toast-top', `${Math.round(top)}px`);
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    window.addEventListener('scroll', queue, true);
    window.addEventListener('resize', queue);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(queue) : null;
    document.querySelectorAll('[data-toast-clear]').forEach((n) => ro?.observe(n));
    ro?.observe(el);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', queue, true);
      window.removeEventListener('resize', queue);
      ro?.disconnect();
      el.style.removeProperty('--toast-top');
    };
  }, [ref, active]);
}

function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  const hasError = toasts.some((t) => (t.tone ?? 'info') === 'error');
  const hostRef = useRef<HTMLDivElement>(null);
  useToastClearance(hostRef, toasts.length > 0);

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
