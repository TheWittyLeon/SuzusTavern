import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import styles from './SectionHead.module.css';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type SectionHeadProps = {
  /** Uppercase overline label above the title. */
  kicker?: string;
  /** Primary heading — truncated with ellipsis on overflow. Required. */
  title: string;
  /** Secondary description below the title. */
  sub?: string;
  /** Right-side action slot (typically a Button). */
  action?: ReactNode;
  /** Semantic heading level for the title element. Default: 2 */
  level?: HeadingLevel;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>;

// Map of numeric level → literal element type so TS can narrow correctly
const HEADING_TAGS = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
} as const satisfies Record<HeadingLevel, string>;

/**
 * Section header with optional kicker, title (ellipsed), sub-text, and action.
 *
 * Layout mirrors shared.jsx: flex-row, align-items flex-end,
 * space-between, gap 16px, margin-bottom 18px.
 *
 * A11Y-6: title uses clamp(1.4rem, 3vw, 1.75rem) for zoom reflow (was px-locked).
 * API-1: forwardRef — ref forwarded to the root <div>.
 * API-2: spreads ...rest so callers can pass data-*, aria-*, id, style, events.
 */
const SectionHead = forwardRef<HTMLDivElement, SectionHeadProps>(
  function SectionHead({ kicker, title, sub, action, level = 2, ...rest }, ref) {
    const Tag = HEADING_TAGS[level];

    return (
      <div ref={ref} data-component="SectionHead" className={styles.root} {...rest}>
        <div className={styles.left}>
          {kicker && <div className={`label ${styles.kicker}`}>{kicker}</div>}
          <Tag className={styles.title}>{title}</Tag>
          {sub && <p className={styles.sub}>{sub}</p>}
        </div>
        {action && <div className={styles.action}>{action}</div>}
      </div>
    );
  },
);

SectionHead.displayName = 'SectionHead';
export default SectionHead;
