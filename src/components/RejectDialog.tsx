'use client';
/**
 * RejectDialog — thin wrapper around ConfirmDialog that adds a required
 * reject-reason textarea.
 *
 * The "Reject draft" confirm button is disabled until `reason.trim()` is
 * non-empty — the engine requires a reason on POST .../reject.
 *
 * Z-index / stacking contract (S8.3 design spec):
 *   Render this component at the PAGE level, above the ReviewLayout's
 *   overflow:auto panes. Never nest inside a scroll-container ancestor —
 *   position:fixed inside overflow:auto creates a stacking trap where
 *   backdrop-filter clips the dialog backdrop. See Aoi-UI spec §RejectDialog.
 *
 * S8.3 — Gated Content Pipeline: admin review screen.
 */
import { useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import styles from '@/components/RejectDialog.module.css';

export interface RejectDialogProps {
  open: boolean;
  /** True while the reject API call is in flight. */
  busy?: boolean;
  /**
   * Called with the trimmed reason when the reviewer confirms.
   * Only called when `reason.trim()` is non-empty.
   */
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export default function RejectDialog({
  open,
  busy = false,
  onConfirm,
  onCancel,
}: RejectDialogProps) {
  const [reason, setReason] = useState('');

  // Reset reason when the dialog closes so it's blank on next open.
  // We do this on next open detection rather than close, to avoid resetting
  // while the exit animation is still running.
  const handleCancel = () => {
    onCancel();
    // Delay reset until after dialog unmounts so the text doesn't flash empty.
    setTimeout(() => setReason(''), 200);
  };

  const handleConfirm = () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  const body = (
    <div className={styles.body}>
      <p className={styles.desc}>
        This draft will be marked rejected and removed from the queue.
      </p>
      <label htmlFor="reject-reason" className="label">
        Reason <span aria-hidden="true">(required)</span>
      </label>
      <textarea
        id="reject-reason"
        className="input"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Describe what's wrong with this extraction…"
        aria-required="true"
        required
        disabled={busy}
      />
    </div>
  );

  return (
    <ConfirmDialog
      open={open}
      title="Reject this draft?"
      body={body}
      confirmLabel="Reject draft"
      cancelLabel="Cancel"
      tone="danger"
      busy={busy || reason.trim() === ''}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}
