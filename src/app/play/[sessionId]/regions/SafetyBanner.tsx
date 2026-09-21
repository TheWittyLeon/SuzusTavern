'use client';

import type { RefObject } from 'react';
import styles from '../Play.module.css';

/**
 * TAV-PLAY-SHELL step 3 — pure region extraction (decomposition plan §2.3,
 * §5 step 3). JSX moved verbatim from page.tsx's DDX-26 X-card banner
 * block; state, refs and handlers stay owned by page.tsx and are passed in
 * as props. Identical DOM, ids, roles and accessible names — this changes
 * no pixels.
 *
 * A1 (plan §5 invariants table): the wrapper is PERMANENTLY MOUNTED with
 * role="status"/aria-live="polite"/aria-atomic="true" — only the CHILDREN
 * (text + Dismiss button) toggle. `Play.module.css`'s `.xCardBanner:empty`
 * rule collapses it to zero footprint without display:none/
 * visibility:hidden (both would also pull it out of the a11y tree). A8:
 * `bannerRef` is a stable focus anchor — `onDismiss` (built by the caller)
 * refocuses it BEFORE the Dismiss button unmounts, so focus never drops to
 * <body>; that sequencing lives in the caller's `onDismiss`, not here, per
 * step 3's "JSX only" scope.
 */
export interface SafetyBannerProps {
  active: boolean;
  event: { seq: number; actor?: string } | null;
  isDm: boolean;
  onDismiss: () => void;
  bannerRef: RefObject<HTMLDivElement | null>;
}

export default function SafetyBanner({ active, event, isDm, onDismiss, bannerRef }: SafetyBannerProps) {
  return (
    <div
      ref={bannerRef}
      tabIndex={-1}
      className={styles.xCardBanner}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-region="safetyBanner"
    >
      {active && event && (
        <>
          <span className={styles.xCardBannerText}>
            A safety signal was raised — the table eases off.
            {isDm && event.actor ? ` X-card raised by ${event.actor}.` : ''}
          </span>
          <button
            type="button"
            className={styles.xCardBannerDismiss}
            onClick={onDismiss}
            aria-label="Dismiss safety signal banner"
          >
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}
