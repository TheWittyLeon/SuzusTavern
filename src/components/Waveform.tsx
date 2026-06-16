'use client';

import { forwardRef, useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { useReducedMotion } from '@/lib/useReducedMotion';
import styles from './Waveform.module.css';

export type WaveformProps = {
  /** Number of vertical bars. Default: 32 */
  bars?: number;
  /** Container height in px. Default: 24 */
  height?: number;
  /** Animated when true; renders static idle bars when false. Default: true */
  active?: boolean;
  /** Bar colour. Default: 'var(--accent)' */
  color?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>;

/**
 * Animated audio waveform using requestAnimationFrame.
 *
 * When active=false OR prefers-reduced-motion is true, renders static idle bars
 * (v=0.18, opacity=0.3) without starting an rAF loop. The rAF loop is cancelled
 * on unmount to avoid memory/GPU leaks.
 *
 * Decorative → aria-hidden.
 *
 * API-1: forwardRef — ref forwarded to the root <div>.
 * API-2: spreads ...rest so callers can pass data-*, aria-*, id, style, events.
 */
const Waveform = forwardRef<HTMLDivElement, WaveformProps>(function Waveform(
  { bars = 32, height = 24, active = true, color = 'var(--accent)', style, ...rest },
  ref,
) {
  const reducedMotion = useReducedMotion();
  const shouldAnimate = active && !reducedMotion;

  const [t, setT] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!shouldAnimate) {
      setT(0);
      return;
    }
    const tick = () => {
      setT(performance.now() / 200);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [shouldAnimate]);

  return (
    <div
      ref={ref}
      data-component="Waveform"
      aria-hidden="true"
      className={styles.waveform}
      style={{ display: 'flex', alignItems: 'center', gap: 3, height, ...style }}
      {...rest}
    >
      {Array.from({ length: bars }).map((_, i) => {
        const phase = i * 0.4 + t;
        const v = shouldAnimate
          ? 0.25 + 0.75 * Math.abs(Math.sin(phase) * Math.cos(phase * 0.3 + i * 0.2))
          : 0.18;
        return (
          <div
            key={i}
            style={{
              width: 3,
              height: `${v * 100}%`,
              background: color,
              borderRadius: 99,
              opacity: shouldAnimate ? 0.5 + 0.5 * v : 0.3,
            }}
          />
        );
      })}
    </div>
  );
});

Waveform.displayName = 'Waveform';
export default Waveform;
