'use client';
/**
 * DeleteCharacterButton — the DEL-7 delete affordance (grid card + sheet).
 *
 * Flow: click → ConfirmDialog → soft-delete → success toast with an **Undo**
 * action (restore). Soft-delete is recoverable for 7 days server-side; the toast
 * undo is the immediate convenience. `onChanged` is fired after both a successful
 * delete and a successful restore so the caller can re-fetch its list.
 *
 * Two shapes:
 *  - variant="icon"   → a small trash icon button (overlaid on a grid card)
 *  - variant="button" → a full ghost/danger button (character sheet header)
 *
 * Used inside a card that is itself a <Link>, so the icon variant must live as a
 * SIBLING of the link (never nested) — a button inside an anchor is invalid HTML
 * and breaks both click handling and assistive tech.
 */
import { useState } from 'react';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { deleteCharacter, restoreCharacter } from '@/lib/api/dnd';
import type { ApiError } from '@/lib/api/types';

/** ApiError is an interface (Error + status/code), so detect by shape, not instanceof. */
function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

export interface DeleteCharacterButtonProps {
  characterId: string;
  characterName: string;
  username: string;
  /** Re-fetch hook, fired after a successful delete AND a successful restore. */
  onChanged?: () => void;
  /** Called after a successful delete, for callers that must navigate away
   *  (e.g. the sheet page, whose character no longer exists). */
  onDeleted?: () => void;
  variant?: 'icon' | 'button';
  className?: string;
}

export default function DeleteCharacterButton({
  characterId,
  characterName,
  username,
  onChanged,
  onDeleted,
  variant = 'icon',
  className,
}: DeleteCharacterButtonProps) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const errMessage = (e: unknown): string =>
    isApiError(e) && e.status === 404
      ? 'That character is already gone.'
      : 'Could not delete the character. Try again in a moment.';

  async function restore() {
    try {
      await restoreCharacter(characterId, username);
      onChanged?.();
      toast({ message: `${characterName} restored.`, tone: 'success' });
    } catch {
      toast({
        message: `Could not restore ${characterName}. It stays in your trash for 7 days.`,
        tone: 'error',
      });
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await deleteCharacter(characterId, username);
      setConfirming(false);
      onChanged?.();
      onDeleted?.();
      toast({
        title: 'Moved to trash',
        message: `${characterName} is recoverable for 7 days.`,
        tone: 'success',
        action: { label: 'Undo', onClick: () => void restore() },
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
          aria-label={`Delete ${characterName}`}
          className={className}
          onClick={() => setConfirming(true)}
        >
          <Icon name="Trash" size={15} aria-hidden />
        </Button>
      ) : (
        <Button
          variant="danger"
          leadingIcon={<Icon name="Trash" size={14} aria-hidden />}
          className={className}
          onClick={() => setConfirming(true)}
        >
          Delete
        </Button>
      )}

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={`Delete ${characterName}?`}
        body={
          <>
            {characterName} will be moved to your trash. You can restore it for
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
