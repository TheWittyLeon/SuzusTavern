'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { useReducedMotion } from '@/lib/useReducedMotion';
import styles from './Pill.module.css';

export type PillTone =
  | 'accent'
  | 'good'
  | 'warn'
  | 'bad'
  | 'cool'
  | 'warm'
  | 'crit'
  | 'muted'
  | 'lav';

export type PillProps = {
  tone?: PillTone;
  /** Show a pulsing dot before the label. Respects prefers-reduced-motion. */
  dot?: boolean;
  children: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'className'>;

// Tone → CSS custom property expressions (mirror of shared.jsx toneMap)
const TONE_MAP: Record<PillTone, { bg: string; fg: string; bd: string }> = {
  accent: {
    bg: 'color-mix(in oklab, var(--accent) 14%, transparent)',
    fg: 'var(--accent)',
    bd: 'color-mix(in oklab, var(--accent) 30%, transparent)',
  },
  good: {
    bg: 'color-mix(in oklab, var(--good) 16%, transparent)',
    fg: 'var(--good)',
    bd: 'color-mix(in oklab, var(--good) 30%, transparent)',
  },
  warn: {
    bg: 'color-mix(in oklab, var(--warn) 16%, transparent)',
    // --warn-ink: text-safe on the candlelit light parchment (A11Y S8.3, HIGH-1).
    // Candlelit --warn (#7a5500) on a 16%-tinted surface passes, but --warn-ink
    // (#6b4a00) gives consistent ≥4.88:1 clearance across all palettes.
    fg: 'var(--warn-ink)',
    bd: 'color-mix(in oklab, var(--warn) 30%, transparent)',
  },
  bad: {
    bg: 'color-mix(in oklab, var(--bad) 16%, transparent)',
    // --bad-ink: text-safe on both dark and light parchment surfaces (A11Y S8.3, BLOCKER-1).
    // --bad alone fails 4.5:1 on the candlelit 16%-tinted bg (≈2.7:1 on light surfaces).
    fg: 'var(--bad-ink)',
    bd: 'color-mix(in oklab, var(--bad) 30%, transparent)',
  },
  cool: {
    bg: 'color-mix(in oklab, var(--cool) 14%, transparent)',
    // --cool-ink: text-safe on the candlelit light parchment (A11Y S3.1).
    fg: 'var(--cool-ink)',
    bd: 'color-mix(in oklab, var(--cool) 30%, transparent)',
  },
  warm: {
    bg: 'color-mix(in oklab, var(--warm) 14%, transparent)',
    // --warm-ink: text-safe on the candlelit light parchment (A11Y S8.3, BLOCKER-2).
    // Candlelit --warm (#d4a64b) = 1.60:1 — fails AA. --warm-ink (#7a5300) = 6.2:1.
    fg: 'var(--warm-ink)',
    bd: 'color-mix(in oklab, var(--warm) 30%, transparent)',
  },
  crit: {
    bg: 'color-mix(in oklab, var(--crit) 18%, transparent)',
    // --crit-ink: text-safe on the candlelit light parchment (A11Y S3.1).
    fg: 'var(--crit-ink)',
    bd: 'color-mix(in oklab, var(--crit) 36%, transparent)',
  },
  muted: {
    bg: 'color-mix(in oklab, var(--ink) 6%, transparent)',
    // --ink-2 (not --ink-3): 11px/600 uppercase is WCAG "small text" and needs
    // ≥4.5:1; --ink-3 measured 4.14:1 on the muted surface. --ink-2 passes.
    fg: 'var(--ink-2)',
    bd: 'var(--line)',
  },
  lav: {
    bg: 'color-mix(in oklab, var(--accent-2) 14%, transparent)',
    fg: 'var(--accent-2)',
    bd: 'color-mix(in oklab, var(--accent-2) 30%, transparent)',
  },
};

/**
 * Tone-aware pill label.
 *
 * Uses inline styles for the per-tone colour values (CSS custom property
 * expressions can't be expressed in static CSS Modules). The dot pulse
 * animation is in `Pill.module.css` and is suppressed via a CSS class when
 * `prefers-reduced-motion: reduce` is active.
 *
 * API-1: forwardRef — ref forwarded to the root <span>.
 * API-2: spreads ...rest onto root so callers can pass data-*, aria-*, id, events.
 * API-6: composes the global .pill class for geometry; only per-tone colors inline.
 */
const Pill = forwardRef<HTMLSpanElement, PillProps>(function Pill(
  { tone = 'accent', dot = false, children, className = '', ...rest },
  ref,
) {
  const reduced = useReducedMotion();
  const t = TONE_MAP[tone];

  // API-6: compose the global .pill class for geometry; only override per-tone colors
  const cls = ['pill', className].filter(Boolean).join(' ');

  return (
    <span
      ref={ref}
      data-component="Pill"
      className={cls}
      style={{
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.bd}`,
      }}
      {...rest}
    >
      {dot && (
        <span
          className={reduced ? styles.dotStatic : styles.dot}
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            background: 'currentColor',
            boxShadow: '0 0 0 3px color-mix(in oklab, currentColor 25%, transparent)',
          }}
        />
      )}
      {children}
    </span>
  );
});

Pill.displayName = 'Pill';
export default Pill;
