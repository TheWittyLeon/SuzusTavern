'use client';
/**
 * ConfirmDialog — a small accessible confirm modal (DEL-7).
 *
 * - role="dialog" + aria-modal, labelled by the title and described by the body.
 * - On open: focuses the Cancel (least-destructive) button and remembers the
 *   previously-focused element; on close: restores focus to it.
 * - Esc cancels; clicking the backdrop cancels; Tab is trapped between the two
 *   buttons so focus can't escape behind the dialog.
 * - `busy` disables both buttons while the confirm action is in flight.
 * - `confirmDisabled` disables only the confirm button (distinct from `busy` —
 *   used when the confirm action is not yet valid, e.g. required reason is empty).
 *   SR sees this as disabled/aria-disabled, NOT as aria-busy (misleads SR as "loading").
 *
 * S8.3 additions:
 *   - Portal to document.body so position:fixed is never clipped by an
 *     overflow:auto or isolation:isolate ancestor (MAJOR-1 / Tora).
 *   - confirmDisabled prop (HIGH-3 / Iro): separate disabled-input-required
 *     state from in-flight busy state.
 *   - e.stopPropagation() in the busy-Tab branch (MINOR-3 / Tora).
 *
 * Renders nothing when `open` is false.
 */
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Button from '@/components/Button';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import styles from '@/components/ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' tints the confirm button as destructive. */
  tone?: 'default' | 'danger';
  /**
   * ONE-CHAR-ONE-CAMPAIGN-UX: 'alertdialog' for confirms that interrupt an
   * in-progress choice (e.g. releasing a character from another table) —
   * distinct from a plain informational 'dialog'. Default preserves every
   * existing caller's semantics.
   */
  role?: 'dialog' | 'alertdialog';
  /** Disable both buttons while the confirm action runs (in-flight). */
  busy?: boolean;
  /**
   * Disable only the confirm button because the action is not yet valid
   * (e.g. a required reason field is empty). Separate from `busy` — this
   * renders as disabled/aria-disabled rather than aria-busy so screen readers
   * announce "unavailable" not "loading" (A11Y S8.3 HIGH-3 / Iro).
   */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  role = 'dialog',
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const uid = useId();
  const titleId = `${uid}-title`;
  const bodyId = `${uid}-body`;

  // Focus management: remember trigger, focus Cancel on open, restore on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Focus after paint so the node exists.
    const t = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // LEVELUP-UX-A11Y-TAIL (Kage m5): when `busy` flips true, a REAL browser
  // blurs the now-disabled focused button to <body> — after which the
  // onKeyDown busy-Tab park below never fires (keydown lands on body, not
  // the dialog). Park focus on the dialog via an effect instead, at the
  // moment busy starts. jsdom lets disabled buttons keep focus, so tests
  // must assert the OUTCOME (dialog focused) rather than the blur.
  useEffect(() => {
    if (open && busy) dialogRef.current?.focus();
  }, [open, busy]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        // UIR2-TAV-11 r2 (Miko-QA re-gate) / TAV-A11Y-USE-ESCAPE-CONSUME-HOOK
        // (Kage IMPORTANT — this dialog was a 5th /play overlay left out of
        // the original migration): stopPropagation is UNCONDITIONAL — this
        // dialog always consumes its own Escape so a busy Escape can't
        // bubble to the page-level Award-XP fallback listener (or any other
        // ancestor). Only the actual cancel stays gated on `!busy`. No
        // onRefocus here — the dialog already restores focus via its own
        // `previouslyFocused` useEffect cleanup above.
        consumeEscape(e, { onClose: onCancel, canClose: !busy });
        return;
      }
      // Minimal focus trap between the two buttons.
      if (e.key === 'Tab') {
        const first = cancelRef.current;
        const last = confirmRef.current;
        if (!first || !last) return;
        // While busy both buttons are disabled (can't receive focus) — park focus
        // on the dialog itself so it can't escape behind the modal.
        if (busy) {
          e.preventDefault();
          e.stopPropagation(); // MINOR-3: stop propagation alongside preventDefault
          dialogRef.current?.focus();
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [busy, onCancel],
  );

  if (!open) return null;

  // Determine confirm button state:
  // - busy: in-flight action → aria-busy, disabled
  // - confirmDisabled (not busy): input not valid → aria-disabled, not aria-busy
  const confirmIsDisabled = busy || confirmDisabled;

  const dialogContent = (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        // onClick (not mousedown) so a click only cancels when it both starts AND
        // ends on the backdrop — a drag that overshoots onto/off the dialog won't
        // dismiss it.
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        tabIndex={-1}
        className={styles.dialog}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {body && (
          <div id={bodyId} className={styles.body}>
            {body}
          </div>
        )}
        <div className={styles.actions}>
          <Button
            ref={cancelRef}
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={confirmIsDisabled}
            aria-disabled={confirmDisabled && !busy ? 'true' : undefined}
            aria-busy={busy || undefined}
            // Keep the real label as the accessible name while busy shows a spinner
            // glyph — otherwise SR reads the bare "…".
            aria-label={busy ? `${confirmLabel}…` : undefined}
          >
            {busy ? '…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );

  // Portal to document.body so position:fixed is never clipped by an
  // overflow:auto or isolation:isolate ancestor (MAJOR-1 / Tora).
  // SSR-safe: createPortal is called only when open=true (which can only be
  // true client-side since this is a 'use client' component).
  if (typeof document === 'undefined') return null;
  return createPortal(dialogContent, document.body);
}
