import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import Card from '@/components/Card';
import styles from './Stat.module.css';

export type DeltaTone = 'good' | 'bad' | 'neutral';

export type StatProps = {
  label: string;
  value: ReactNode;
  /**
   * A11Y-4: Plain-text version of `value` for screen-reader aria-label composition.
   * Required when `value` is a ReactNode that isn't a plain string or number.
   * When omitted, falls back to String(value).
   */
  valueText?: string;
  delta?: string;
  deltaTone?: DeltaTone;
  /** Optional 16–18px icon element rendered in the accent tile. */
  icon?: ReactNode;
  /** CSS color for the icon tile; defaults to var(--accent). */
  accentColor?: string;
} & Omit<HTMLAttributes<HTMLElement>, 'children'>;

const DELTA_TONE_COLOR: Record<DeltaTone, string> = {
  good: 'var(--good)',
  bad: 'var(--bad)',
  neutral: 'var(--ink-3)',
};

/**
 * Stat tile — composes Card (glass surface).
 *
 * Label in .label utility; value in var(--font-display) at 28px;
 * delta in var(--font-mono) toned by deltaTone; optional icon tile.
 *
 * API-1: forwardRef — ref forwarded to the root Card element (HTMLElement).
 * API-2: spreads ...rest onto Card root.
 * A11Y-4: role="group" + aria-label groups label/value/delta for screen readers.
 */
const Stat = forwardRef<HTMLElement, StatProps>(function Stat(
  {
    label,
    value,
    valueText,
    delta,
    deltaTone = 'good',
    icon,
    accentColor,
    ...rest
  },
  ref,
) {
  const accent = accentColor ?? 'var(--accent)';

  // A11Y-4: compose accessible label for the group; include delta when present
  const resolvedValueText =
    valueText !== undefined ? valueText : String(value);
  const groupLabel = delta
    ? `${label}: ${resolvedValueText}, ${delta}`
    : `${label}: ${resolvedValueText}`;

  return (
    // A11Y-4: role="group" + aria-label groups label/value/delta for screen readers
    <Card ref={ref} data-component="Stat" role="group" aria-label={groupLabel} {...rest}>
      <div className={styles.header}>
        <div className="label">{label}</div>
        {icon && (
          <div
            className={styles.iconTile}
            style={{
              background: `color-mix(in oklab, ${accent} 14%, transparent)`,
              color: accent,
            }}
          >
            {icon}
          </div>
        )}
      </div>
      <div className={styles.value}>{value}</div>
      {delta && (
        <div
          className={`${styles.delta} mono`}
          style={{ color: DELTA_TONE_COLOR[deltaTone] }}
        >
          {delta}
        </div>
      )}
    </Card>
  );
});

Stat.displayName = 'Stat';
export default Stat;
