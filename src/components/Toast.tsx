'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
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
  const startedAtRef = useRef<number>(Date.now());
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

function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  const hasError = toasts.some((t) => (t.tone ?? 'info') === 'error');

  return (
    <div
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
