'use client';
/**
 * useBulkDelete — shared client-side bulk soft-delete logic (BULK-DEL).
 *
 * Reused by the characters grid and the campaigns list on /dashboard. Both
 * grids already have a working SINGLE soft-delete → trash → restore path
 * (DeleteCharacterButton / DeleteCampaignButton); this hook does not add a new
 * batch endpoint — it loops the existing single delete/restore calls via
 * `Promise.allSettled`, exactly per the client-side-loop scope decision.
 *
 * Owns: select-mode toggle, the selected-id Set, the shared bulk ConfirmDialog's
 * open/busy state, and the delete/undo loop + summary toast. Does NOT own any
 * markup — callers render their own checkboxes/bar/dialog driven by the
 * returned state, so the same hook works for both the character-grid's card
 * layout and the campaign-list's row layout.
 *
 * Focus management mirrors DeleteCampaignButton's `focusFallbackRef` pattern
 * (Iro MAJOR-1): when select mode exits (via Cancel or after a delete), the
 * caller's checkboxes/bar can unmount out from under an in-progress focus
 * target, so we explicitly move focus to a stable, always-mounted element the
 * caller provides (e.g. the section heading) rather than relying on
 * ConfirmDialog's own restore-on-close (which would try to refocus the
 * "Delete selected" trigger button that just unmounted with the bar).
 */
import { useCallback, useState, type RefObject } from 'react';
import { useToast } from '@/components/Toast';

export interface UseBulkDeleteOptions {
  /** Singular, lowercase noun for toast/copy pluralization, e.g. "character". */
  noun: string;
  /** The existing single soft-delete call, e.g. deleteCharacter / deleteSession. */
  deleteOne: (id: string, username: string) => Promise<unknown>;
  /** The existing single restore call, e.g. restoreCharacter / restoreSession. */
  restoreOne: (id: string, username: string) => Promise<unknown>;
  username: string;
  /** Re-fetch hook, fired after the bulk delete settles and after Undo. */
  onChanged?: () => void;
  /** Stable, always-mounted focus target for post-exit focus management. */
  focusFallbackRef?: RefObject<HTMLElement | null>;
}

export interface UseBulkDeleteResult {
  selectMode: boolean;
  selected: Set<string>;
  /** Enter select mode (does not affect selection). */
  enterSelectMode: () => void;
  /** Exit select mode, clear selection, move focus to the fallback target. */
  exitSelectMode: () => void;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clear: () => void;
  confirmOpen: boolean;
  /** Opens the shared bulk ConfirmDialog. No-op when nothing is selected. */
  openConfirm: () => void;
  closeConfirm: () => void;
  /** True while the delete loop is in flight — wire to ConfirmDialog's `busy`. */
  busy: boolean;
  /** Runs the Promise.allSettled delete loop, then the summary toast + exit. */
  runDelete: () => Promise<void>;
}

function pluralize(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export function useBulkDelete({
  noun,
  deleteOne,
  restoreOne,
  username,
  onChanged,
  focusFallbackRef,
}: UseBulkDeleteOptions): UseBulkDeleteResult {
  const { toast } = useToast();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const enterSelectMode = useCallback(() => setSelectMode(true), []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
    // Iro MAJOR-1 pattern: the trigger that was focused (a checkbox, or the
    // bar's own Cancel button) is about to unmount along with the rest of
    // the select-mode UI. Move focus to the caller's stable fallback so it
    // never falls back to <body>.
    focusFallbackRef?.current?.focus();
  }, [focusFallbackRef]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids));
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const openConfirm = useCallback(() => {
    setSelected((cur) => {
      if (cur.size > 0) setConfirmOpen(true);
      return cur;
    });
  }, []);

  const closeConfirm = useCallback(() => setConfirmOpen(false), []);

  const runDelete = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      setConfirmOpen(false);
      return;
    }
    setBusy(true);
    const results = await Promise.allSettled(
      ids.map((id) => deleteOne(id, username)),
    );
    const succeeded: string[] = [];
    let failed = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') succeeded.push(ids[i]);
      else failed += 1;
    });

    setBusy(false);
    setConfirmOpen(false);
    setSelectMode(false);
    setSelected(new Set());
    focusFallbackRef?.current?.focus();
    onChanged?.();

    if (succeeded.length === 0) {
      toast({
        tone: 'error',
        message: `Could not delete the selected ${noun}s. Try again in a moment.`,
      });
      return;
    }

    const undo = async () => {
      const restoreResults = await Promise.allSettled(
        succeeded.map((id) => restoreOne(id, username)),
      );
      const restoreFailed = restoreResults.filter(
        (r) => r.status === 'rejected',
      ).length;
      const restored = succeeded.length - restoreFailed;
      onChanged?.();
      if (restoreFailed > 0) {
        toast({
          tone: 'error',
          message: `Restored ${restored} of ${pluralize(succeeded.length, noun)}. The rest stay in your trash for 7 days.`,
        });
      } else {
        toast({
          tone: 'success',
          message: `${pluralize(succeeded.length, noun)} restored.`,
        });
      }
    };

    if (failed > 0) {
      toast({
        title: `Deleted ${succeeded.length}, ${failed} failed`,
        message: `${pluralize(succeeded.length, noun)} moved to trash, recoverable for 7 days. ${failed} could not be deleted — try again.`,
        tone: 'error',
        action: { label: 'Undo', onClick: () => void undo() },
      });
    } else {
      toast({
        title: `Moved ${succeeded.length} to trash`,
        message: `${pluralize(succeeded.length, noun)} recoverable for 7 days.`,
        tone: 'success',
        action: { label: 'Undo', onClick: () => void undo() },
      });
    }
  }, [selected, deleteOne, restoreOne, username, onChanged, focusFallbackRef, toast, noun]);

  return {
    selectMode,
    selected,
    enterSelectMode,
    exitSelectMode,
    toggle,
    selectAll,
    clear,
    confirmOpen,
    openConfirm,
    closeConfirm,
    busy,
    runDelete,
  };
}
