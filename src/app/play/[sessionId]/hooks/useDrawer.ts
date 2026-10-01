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
 * and-restore effect. A `close()` with its own side effects
 * is genuinely per-drawer (member-sheet's close also resets
 * `selectedIsSelf`) — see
 * `useMemberSheetDrawer`/`useJournalDrawer`, both built on this primitive,
 * for that domain-specific layer.
 *
 * Durability check: a THIRD drawer (if one ever lands) calls `useDrawer`
 * for this shared cell instead of hand-rolling a third `useState(false)` +
 * `useRef<HTMLButtonElement>(null)` pair — the row a tenth drawer author
 * writes.
 *
 * A8 carry item (b) / Kage-CR A7 Suggestion D: `useDrawer` is the first
 * RUNTIME hook-to-hook import in `hooks/` (every sibling import elsewhere
 * in this directory is `import type`). That is NOT a breach of §2.2's "the
 * poll never imports a sibling hook" rule — `useDrawer` is a leaf
 * PRIMITIVE composed BY its two callers (`useJournalDrawer`,
 * `useMemberSheetDrawer`), not a SIBLING composed by page.tsx: it has no
 * effects, reads nothing from outside its own arguments, and so cannot
 * create a cycle or an ordering constraint the way a sibling-to-sibling
 * import would.
 */
import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

export interface UseDrawerResult {
  id: string;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
}

// Kage-CR A7 IMPORTANT-5: `id` is now returned, not just accepted -- it was
// a declared-and-unread parameter (the fourth copy of the journal's DOM id
// literal, alongside page.tsx's two <Drawer id> props and TopBar.tsx's own
// aria-controls, with nothing tying the four together). Returning it makes
// `useDrawer('play-pane-journal')` the single source both call sites and
// TopBar's aria-controls read from, collapsing 4 copies to 1 and making
// the aria-controls<->id pairing structural instead of four independently-
// typed literals that happen to match today.
export function useDrawer(id: string): UseDrawerResult {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  return { id, open, setOpen, closeButtonRef };
}
