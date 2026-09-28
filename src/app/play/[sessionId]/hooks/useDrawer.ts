'use client';

/**
 * TAV-PLAY-SHELL step 5 — `useDrawer(id)` (decomposition plan §2.2 §1.8/
 * §1.9, Amendment A A7). The one piece of drawer chrome genuinely shared by
 * both callers (member-sheet, journal): open/closed state and the close
 * button's own ref, so `<Drawer>`'s `closeButtonRef` prop always has a
 * stable target to focus on open.
 *
 * Everything ELSE `<Drawer>` needs is already owned internally by
 * `src/components/Drawer.tsx` as of step 2 (see that file's own header):
 * `dialogRef`, the Tab-trap `onKeyDown`, and the open/close focus-remember-
 * and-restore effect. `visible` and a `close()` with its own side effects
 * are genuinely per-drawer (member-sheet's close also resets
 * `selectedIsSelf`; journal's close also falls the mobile tab back to
 * Story, and its `visible` folds in `mobileView`) — see
 * `useMemberSheetDrawer`/`useJournalDrawer`, both built on this primitive,
 * for that domain-specific layer.
 *
 * Durability check: a THIRD drawer (if one ever lands) calls `useDrawer`
 * for this shared cell instead of hand-rolling a third `useState(false)` +
 * `useRef<HTMLButtonElement>(null)` pair — the row a tenth drawer author
 * writes.
 */
import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

export interface UseDrawerResult {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
}

// `id` isn't read inside this hook -- it exists so every call site names
// which drawer it is (mirrors <Drawer id=...>), for the same "the caller's
// label, not the hook's input" reason useDrawer('play-pane-journal') reads
// better than a bare useDrawer() at the call site. Leading underscore is
// this repo's "intentionally unused" convention (eslint config comment,
// no-unused-vars argsIgnorePattern).
export function useDrawer(_id: string): UseDrawerResult {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  return { open, setOpen, closeButtonRef };
}
