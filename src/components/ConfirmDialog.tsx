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
 *
 * Renders nothing when `open` is false.
 */
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import Button from '@/components/Button';
import styles from '@/components/ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' tints the confirm button as destructive. */
  tone?: 'default' | 'danger';
  /** Disable both buttons while the confirm action runs. */
  busy?: boolean;
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
  busy = false,
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

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onCancel();
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

  return (
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
        role="dialog"
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
            disabled={busy}
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
}
