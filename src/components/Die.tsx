'use client';

import { forwardRef, useEffect, useState, type HTMLAttributes } from 'react';
import { useReducedMotion } from '@/lib/useReducedMotion';
import styles from './Die.module.css';

export type DieProps = {
  /** Tile size in px. Default: 56 */
  size?: number;
  /** Controlled value. null/undefined → randomise on mount. */
  value?: number | null;
  /** Die sides used for random range. Default: 20 */
  sides?: number;
  /** When true, cycles the displayed number every 80 ms. */
  rolling?: boolean;
  /** Gold gradient + glow — nat-20 celebration. */
  crit?: boolean;
  /** Red gradient — nat-1 fumble. */
  fumble?: boolean;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>;

/**
 * Animated die tile.
 *
 * Rolling cycles the number every 80 ms via setInterval.
 * Under prefers-reduced-motion the ticker is suppressed and the resting value
 * is shown statically — crit/fumble styling still applies.
 *
 * Accessibility: decorative when rolling; exposes current value via aria-label
 * when at rest and value is defined.
 *
 * API-1: forwardRef — ref forwarded to the root <div>.
 * API-2: spreads ...rest so callers can pass data-*, aria-*, id, style, events.
 * A11Y-3: fumble text color uses --fumble-ink token (per-palette, always ≥4.5:1).
 * A11Y-9: Die.module.css suppresses transition under reduced-motion at first paint.
 */
const Die = forwardRef<HTMLDivElement, DieProps>(function Die(
  {
    size = 56,
    value,
    sides = 20,
    rolling = false,
    crit = false,
    fumble = false,
    style,
    ...rest
  },
  ref,
) {
  const reducedMotion = useReducedMotion();

  const initialValue = value != null ? value : Math.floor(Math.random() * sides) + 1;
  const [n, setN] = useState(initialValue);

  // Sync controlled value
  useEffect(() => {
    if (value != null) setN(value);
  }, [value]);

  // Rolling ticker — suppressed under reduced-motion
  useEffect(() => {
    if (!rolling || reducedMotion) return;
    const id = setInterval(
      () => setN(Math.floor(Math.random() * sides) + 1),
      80,
    );
    return () => clearInterval(id);
  }, [rolling, sides, reducedMotion]);

  const bg = crit
    ? 'linear-gradient(135deg, var(--crit), var(--warm))'
    : fumble
      ? 'linear-gradient(135deg, var(--fumble), var(--bad))'
      : 'linear-gradient(135deg, color-mix(in oklab, var(--accent) 20%, transparent), color-mix(in oklab, var(--accent-2) 20%, transparent))';

  // A11Y-3: --fumble-ink is per-palette (dark on light fumble bg, white on dark)
  const color = crit ? '#2a1e16' : fumble ? 'var(--fumble-ink)' : 'var(--ink)';

  const boxShadow = crit
    ? '0 0 24px color-mix(in oklab, var(--crit) 50%, transparent)'
    : 'var(--shadow-soft)';

  // Aria: decorative while rolling; meaningful label at rest
  const isRolling = rolling && !reducedMotion;
  const ariaHidden = isRolling ? true : undefined;
  const ariaLabel = !isRolling ? `d${sides} shows ${n}` : undefined;

  return (
    <div
      ref={ref}
      data-component="Die"
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      className={styles.die}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: bg,
        color,
        boxShadow,
        ...style,
      }}
      {...rest}
    >
      {n}
    </div>
  );
});

Die.displayName = 'Die';
export default Die;
