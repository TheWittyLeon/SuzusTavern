'use client';
/**
 * DeleteCampaignButton — the DM-only delete affordance for a campaign/session.
 *
 * Mirrors DeleteCharacterButton: click → ConfirmDialog → soft-delete → success
 * toast with an **Undo** action (restore). Soft-delete is recoverable for 7 days
 * server-side; the toast undo is the immediate convenience. `onChanged` fires
 * after both a successful delete and a successful restore so the caller re-fetches.
 *
 * Deleting a campaign is a DM action and more consequential than deleting a
 * character — it closes the table for everyone. The engine enforces owner-only
 * delete (a non-owner gets a 404), and the caller only renders this for the DM,
 * but the confirm copy still spells out the blast radius. Player character sheets
 * are NOT deleted (the engine SET-NULLs members, never their characters).
 *
 * Two shapes mirror DeleteCharacterButton:
 *  - variant="icon"   → a small trash icon button (a campaign row action)
 *  - variant="button" → a full danger button (a campaign settings/detail header)
 *
 * Focus management (Iro MAJOR-1): when the campaign row is removed from the DOM,
 * ConfirmDialog's focus-restore target no longer exists and focus would fall to
 * <body>. Callers pass `focusFallbackRef` pointing at a stable element (e.g. the
 * section heading) so focus lands somewhere meaningful after delete.
 */
import { useRef, useState } from 'react';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { deleteSession, restoreSession } from '@/lib/api/dnd';
import type { ApiError } from '@/lib/api/types';

/** ApiError is an interface (Error + status/code), so detect by shape, not instanceof. */
function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

export interface DeleteCampaignButtonProps {
  sessionId: string;
  campaignName: string;
  username: string;
  /** Re-fetch hook, fired after a successful delete AND a successful restore. */
  onChanged?: () => void;
  /** Called after a successful delete, for callers that must navigate away. */
  onDeleted?: () => void;
  /**
   * Iro MAJOR-1: element to receive focus after a confirmed delete.
   * When the campaign row unmounts, ConfirmDialog's focus-restore target
   * disappears and focus would land on <body>. Pass a ref to a stable
   * element (e.g. the section heading) to keep focus on something meaningful.
   */
  focusFallbackRef?: React.RefObject<HTMLElement | null>;
  variant?: 'icon' | 'button';
  className?: string;
}

export default function DeleteCampaignButton({
  sessionId,
  campaignName,
  username,
  onChanged,
  onDeleted,
  focusFallbackRef,
  variant = 'icon',
  className,
}: DeleteCampaignButtonProps) {
  const { toast, dismiss } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Tora MINOR-1: guard against double-fire on Undo.
  const restoringRef = useRef(false);

  const errMessage = (e: unknown): string =>
    isApiError(e) && e.status === 404
      ? 'That campaign is already gone.'
      : 'Could not delete the campaign. Try again in a moment.';

  async function restore(undoToastId: string) {
    // Tora MINOR-1: early-return if a restore is already in flight.
    if (restoringRef.current) return;
    restoringRef.current = true;
    try {
      await restoreSession(sessionId, username);
      // Tora MAJOR-1: dismiss the undo toast on successful restore so it
      // doesn't linger after the action is no longer relevant.
      dismiss(undoToastId);
      onChanged?.();
      toast({ message: `${campaignName} restored.`, tone: 'success' });
    } catch {
      toast({
        message: `Could not restore ${campaignName}. It stays in your trash for 7 days.`,
        tone: 'error',
      });
    } finally {
      restoringRef.current = false;
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await deleteSession(sessionId, username);
      setConfirming(false);
      onChanged?.();
      onDeleted?.();
      // Iro MAJOR-1: move focus to the stable fallback before the row unmounts.
      focusFallbackRef?.current?.focus();
      // Tora MAJOR-1: duration: Infinity keeps the undo toast alive until the
      // user explicitly acts on it (dismiss or Undo). ToastCard already guards
      // !isFinite(dur) to skip the auto-dismiss timer.
      const undoToastId = toast({
        title: 'Campaign moved to trash',
        message: `${campaignName} is recoverable for 7 days.`,
        tone: 'success',
        duration: Infinity,
        action: { label: 'Undo', onClick: () => void restore(undoToastId) },
      });
    } catch (e) {
      toast({ message: errMessage(e), tone: 'error' });
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {variant === 'icon' ? (
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Delete campaign ${campaignName}`}
          className={className}
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          <Icon name="Trash" size={15} aria-hidden />
        </Button>
      ) : (
        <Button
          variant="danger"
          leadingIcon={<Icon name="Trash" size={14} aria-hidden />}
          className={className}
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          Delete campaign
        </Button>
      )}

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={`Delete ${campaignName}?`}
        body={
          <>
            This closes the table for everyone at it and moves the campaign to your
            trash. Your players&rsquo; characters are kept. You can restore it for
            the next 7 days, after which it&rsquo;s permanently removed.
          </>
        }
        confirmLabel="Move to trash"
        cancelLabel="Keep"
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
