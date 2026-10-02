'use client';

import styles from '../Play.module.css';

/**
 * TAV-PLAY-SHELL A9c-1 C1 (build brief §7, carry item 1) — the X-card, moved
 * VERBATIM out of page.tsx's tenants map (same `styles.safety*` classes; only
 * the markup the three review findings below change is new). A tenant of
 * `actionBar` (`REGION_TENANTS.safetyControls`, A9b fix round 1).
 *
 * Why it is its own file: it is the highest-consequence control on the
 * screen, and the independence pins in `play.xcard-independence.test.tsx`
 * exist because a one-line edit at its old call site could re-gate it on
 * combat state without a single test going red (Kage A9b IMPORTANT-3).
 *
 * THE BAR'S DISABLED MODEL, stated once: combat verbs use native `disabled`
 * (focus rescue via the rail anchor, A8). Cast and the Composer use
 * `aria-disabled` via `lockProps` (A9c-2: a transient lock must not drop focus).
 * The X-card uses `aria-disabled`, ONLY for its own in-flight raise, NEVER for
 * combat or session state. Props deliberately carry no turn/lock/busy-combat
 * field: a safety tool stays reachable whatever the table is doing (DDX-26), and
 * a prop that could gate it is a prop someone will wire.
 *
 * Iro A9b IMPORTANT-4: native `disabled` blurs a focused button, and the
 * `finally` that re-enabled it never restored focus, so a keyboard user who
 * raised the card landed on <body> (measured: activeElement = body at
 * +800ms). `aria-disabled` keeps it in the tab order; the click guard is the
 * `xCardBusyRef` latch in `useSafety.onRaiseXCard` (the A10 pattern).
 */
export interface SafetyControlsProps {
  /** True only while this client's own raise is in flight (useSafety). */
  xCardBusy: boolean;
  onRaiseXCard: () => void | Promise<void>;
}

export default function SafetyControls({ xCardBusy, onRaiseXCard }: SafetyControlsProps) {
  return (
    // `data-popover-passthrough` (A9d-2 N3, Tora C1): an anchored popover never covers this block, and a press inside it closes any open
    // popover AND is delivered. The X-card fires on the first tap, whatever is open; nothing in the primitive names this tenant.
    // `data-toast-avoid` (Kage C-1): the toast host is placed clear of this block on every layout; nothing in Toast.tsx names the tenant either.
    <div className={styles.safety} data-tenant="safetyControls" data-popover-passthrough="" data-toast-avoid="">
      <span className={styles.safetyLabel}>Safety</span>
      {/* Iro A9b MINOR-1 (3.3.2): the consequence copy is VISIBLE at every width and
          stays the button's accessible description. When the bar is narrow,
          Play.module.css wraps it onto its own line above the button (`order`); it is
          never visually hidden. */}
      <span id="play-safety-hint" className={styles.safetyHint}>
        Pause · rewind · Suzu listens.
      </span>
      {/* DDX-26: durable, cross-client — a bare local appendLog/toast
          (the old behavior) was the bug: no other client ever saw it,
          and the toast had no way to know it had been "resolved" so it
          lingered (UIR2-TAV-25). postXCard persists an `x_card` session
          event; the banner above + the events poll are what every
          client (including this one) actually renders from. */}
      <button
        type="button"
        onClick={() => void onRaiseXCard()}
        aria-disabled={xCardBusy || undefined}
        aria-busy={xCardBusy}
        aria-describedby="play-safety-hint"
      >
        X-card
      </button>
    </div>
  );
}
