'use client';
/**
 * CodexDetailModal — A11Y CRITICAL-1 (Iro-A11y).
 *
 * Below 1280px, Codex.module.css's .drawer is `display:none` with no
 * fallback, so a selected spell/monster/etc.'s full detail was completely
 * unreachable on tablets, laptops narrower than 1280px, and at 200% browser
 * zoom. This renders the same read-only CodexDetail content in a real
 * dismissible modal instead, opened on selection whenever the viewport is
 * narrow (see page.tsx's `useMediaQuery('(max-width: 1280px)')`).
 *
 * Focus trap + Escape + backdrop-click follow the same pattern as
 * ConfirmDialog.tsx / DmOverrideModal.tsx: remember the trigger, focus the
 * close button on open, trap Tab inside the dialog, restore focus on close
 * (page.tsx's onClose additionally forces focus back to the listbox
 * explicitly, since that's always the trigger in practice).
 *
 * Labelled via aria-labelledby pointing at CodexDetail's hero <h2> (passed as
 * `headingId`) — the always-visible desktop drawer instead gets a dynamic
 * aria-label directly on its <aside> (MAJOR-6, page.tsx): two different
 * labelling mechanisms for two different containers, not a duplicate fix.
 *
 * Renders nothing when `open` is false or there's no item to show.
 */
import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import type { CatalogItem } from '@/lib/api/types';
import type { CodexKind } from '@/lib/dnd/codex';
import CodexDetail from './CodexDetail';
import styles from './Codex.module.css';

export interface CodexDetailModalProps {
  open: boolean;
  item: CatalogItem | null;
  kind: CodexKind;
  onClose: () => void;
}

export default function CodexDetailModal({ open, item, kind, onClose }: CodexDetailModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const headingId = useId();

  // Focus management: remember the trigger, focus the close button on open,
  // restore focus on close (mirrors ConfirmDialog.tsx).
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      // Minimal focus trap — CodexDetail is read-only content, so the close
      // button is typically the only focusable descendant, but this walks
      // the DOM rather than assuming that stays true.
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  if (!open || !item) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.mobileDetailBackdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className={styles.mobileDetailDialog}
        onKeyDown={onKeyDown}
      >
        <Button
          ref={closeRef}
          size="icon"
          variant="ghost"
          aria-label="Close details"
          className={styles.mobileDetailClose}
          onClick={onClose}
        >
          <Icon name="Close" size={14} aria-hidden />
        </Button>
        <CodexDetail item={item} kind={kind} headingId={headingId} />
      </div>
    </div>,
    document.body,
  );
}
