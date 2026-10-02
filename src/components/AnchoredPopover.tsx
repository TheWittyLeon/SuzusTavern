'use client';

import { createPortal } from 'react-dom';
import { useSyncExternalStore, type ReactNode } from 'react';
import type { AnchoredPopoverApi, PopoverRole } from '@/lib/a11y/useAnchoredPopover';
import styles from './AnchoredPopover.module.css';

/**
 * A9d-2 fix round N3 (Sora lever brief 2.2) — the shared popover surface: `useAnchoredPopover`'s placement, dismissal and focus
 * contract, PORTALLED to `document.body` (the ConfirmDialog / TweaksPanel precedent). Required: Table's stage is an overlay owner with
 * `isolation: isolate`, so a fixed child painted inside a slot sits under every later slot; and a slot is `overflow-y: auto`, which
 * clips whatever it holds. A named `role="dialog"` (or the chooser's existing named `role="group"`); never `aria-modal`; the app root
 * is never `inert` or `aria-hidden` while one is open (Iro 4).
 *
 * `keepMounted`: closed, it stays in the tree and a CSS class hides it (`display: none`), so a consumer whose content must keep its
 * state and its live regions (Cast a spell's four announcers, the DM's Session card) is unchanged in jsdom, and a browser removes it
 * from the accessibility tree. A pin must never assert that a keepMounted popover's content is reachable while closed.
 */
export interface AnchoredPopoverProps {
  pop: AnchoredPopoverApi;
  /** `dialog` (Roll, Cast, Session) or `group` (the outcome chooser). */
  role: Extract<PopoverRole, 'dialog' | 'group'>;
  /** The accessible name: a popover is always named. */
  label: string;
  keepMounted?: boolean;
  className?: string;
  children: ReactNode;
}

const subscribe = () => () => {};

export default function AnchoredPopover({ pop, role, label, keepMounted = false, className, children }: AnchoredPopoverProps) {
  // SSR-safe: there is no document on the server; the portal exists from the first client render on.
  const clientReady = useSyncExternalStore(subscribe, () => true, () => false);
  const { open, popoverProps, attachPopover } = pop;
  if (!clientReady || (!open && !keepMounted)) return null;
  // Closed and kept mounted, it is `display: none` in a browser (out of the accessibility tree) and carries no role in jsdom, which has no
  // stylesheet: a suite that asks for "the dialog" (a bare `queryByRole('dialog')` after its own confirm closed) must not find a closed
  // popover's. Its content is still queryable directly, which is what keepMounted is for. The role and name come back when it opens.
  const named = open || !keepMounted;
  return createPortal(
    <div
      {...popoverProps}
      ref={attachPopover}
      role={named ? role : undefined}
      aria-label={named ? label : undefined}
      className={[styles.popover, className, open ? null : styles.closed].filter(Boolean).join(' ')}
    >
      {children}
    </div>,
    document.body,
  );
}
