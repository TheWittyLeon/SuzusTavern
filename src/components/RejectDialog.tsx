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
 *   overflow:auto panes. The ConfirmDialog itself now portals to document.body
 *   so it escapes any overflow:auto or isolation:isolate ancestor regardless.
 *   See Aoi-UI spec §RejectDialog.
 *
 * S8.3 gate fixes:
 *   - MINOR-2 (Tora): replaced 200ms setTimeout reason-reset with a useEffect
 *     watching `open`. Resets when the dialog opens (clean slate on each use).
 *     Cleanup fires on unmount — no post-unmount setState risk.
 *   - HIGH-3 / MEDIUM-2 (Iro): pass `confirmDisabled` (not `busy`) when reason
 *     is empty. `aria-busy` is reserved for actual in-flight state. Added
 *     `aria-invalid` + `role=alert` "Reason is required" on attempted submit
 *     with empty reason.
 *
 * S8.3 — Gated Content Pipeline: admin review screen.
 */
import { useId, useState } from 'react';
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
  const [showRequired, setShowRequired] = useState(false);
  const hintId = useId();
  const alertId = useId();

  // Reset helper — called from both cancel and confirm-success paths so the
  // dialog opens with a blank slate each time. No effect needed: clearing on
  // close is equivalent because the dialog is always mounted.
  const resetFields = () => {
    setReason('');
    setShowRequired(false);
  };

  const handleConfirm = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      // HIGH-3 + MEDIUM-2: show "Reason is required" error on attempted submit
      // with empty reason, instead of silently swallowing the action.
      setShowRequired(true);
      return;
    }
    resetFields();
    onConfirm(trimmed);
  };

  const handleCancel = () => {
    resetFields();
    onCancel();
  };

  const isEmpty = reason.trim() === '';

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
        onChange={(e) => {
          setReason(e.target.value);
          if (e.target.value.trim()) setShowRequired(false);
        }}
        placeholder="Describe what's wrong with this extraction…"
        aria-required="true"
        required
        disabled={busy}
        aria-invalid={showRequired ? 'true' : undefined}
        aria-describedby={[hintId, showRequired ? alertId : ''].filter(Boolean).join(' ') || undefined}
      />
      <p id={hintId} className={styles.fieldHint}>
        A reason is required before rejecting a draft.
      </p>
      {/* MEDIUM-2 (Iro): announce "Reason is required" when attempting to confirm
          with an empty textarea. role=alert fires immediately; clears on any input. */}
      {showRequired && (
        <p id={alertId} role="alert" className={styles.requiredAlert}>
          Reason is required.
        </p>
      )}
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
      busy={busy}
      // HIGH-3 (Iro): use confirmDisabled (not busy) when reason is empty.
      // busy=true → aria-busy (in flight). confirmDisabled=true → aria-disabled
      // (input required). SR distinction: "loading" vs "unavailable".
      confirmDisabled={isEmpty}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}
