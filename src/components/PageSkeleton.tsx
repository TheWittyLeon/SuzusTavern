'use client';

import type { CSSProperties } from 'react';
import { useReducedMotion } from '@/lib/useReducedMotion';
import styles from '@/components/PageSkeleton.module.css';

// ---- Skeleton primitive ----

export interface SkeletonProps {
  /** Width in px or any CSS width string. Default: '100%' */
  width?: number | string;
  /** Height in px or any CSS height string. Default: 16 */
  height?: number | string;
  /** Border-radius override. Default: uses --radius-sm token */
  radius?: number | string;
  /** Renders as a circle (overrides radius to 50%). */
  circle?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * A single shimmering skeleton block.
 *
 * When the user prefers reduced motion the shimmer animation is suppressed and
 * a static muted block is rendered instead.
 */
export function Skeleton({
  width = '100%',
  height = 16,
  radius,
  circle = false,
  className = '',
  style,
}: SkeletonProps) {
  const reduced = useReducedMotion();

  const resolvedRadius = circle
    ? '50%'
    : (radius !== undefined
        ? (typeof radius === 'number' ? `${radius}px` : radius)
        : 'var(--radius-sm)');

  const inlineStyle: CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius: resolvedRadius,
    ...style,
  };

  return (
    <span
      data-component="Skeleton"
      aria-hidden="true"
      className={[
        styles.skeleton,
        !reduced ? styles.shimmer : styles.static,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={inlineStyle}
    />
  );
}

// ---- PageSkeleton layout variants ----

export interface PageSkeletonProps {
  /**
   * Layout variant.
   * - 'lines' (default): stacked text-line skeletons.
   * - 'card': a card-shaped block with a header line + body lines.
   * - 'list': a repeated row pattern with a circle + two lines each.
   */
  variant?: 'lines' | 'card' | 'list';
  /** Number of lines/rows to render. Default: 4 */
  lines?: number;
  className?: string;
}

/**
 * Composable page-level loading skeleton.
 *
 * Wraps content with an `aria-busy` / `role="status"` region containing a
 * screen-reader-only "Loading…" label. The skeleton blocks themselves are
 * `aria-hidden` so screen readers only hear the status announcement.
 *
 * Passes `useReducedMotion` down through `Skeleton` — no extra wiring needed.
 */
export default function PageSkeleton({
  variant = 'lines',
  lines = 4,
  className = '',
}: PageSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading…"
      data-component="PageSkeleton"
      className={[styles.root, className].filter(Boolean).join(' ')}
    >
      {/* Screen-reader-only announcement */}
      <span className={styles.srOnly}>Loading…</span>

      {variant === 'lines' && (
        <div className={styles.linesLayout} aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <Skeleton
              key={i}
              height={14}
              width={i === lines - 1 ? '60%' : '100%'}
            />
          ))}
        </div>
      )}

      {variant === 'card' && (
        <div className={`glass ${styles.cardLayout}`} aria-hidden="true">
          <Skeleton height={20} width="45%" />
          <div className={styles.linesLayout}>
            {Array.from({ length: lines }, (_, i) => (
              <Skeleton
                key={i}
                height={13}
                width={i === lines - 1 ? '55%' : '100%'}
              />
            ))}
          </div>
        </div>
      )}

      {variant === 'list' && (
        <div className={styles.listLayout} aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className={styles.listRow}>
              <Skeleton circle width={36} height={36} />
              <div className={styles.listLines}>
                <Skeleton height={13} width="70%" />
                <Skeleton height={11} width="45%" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
