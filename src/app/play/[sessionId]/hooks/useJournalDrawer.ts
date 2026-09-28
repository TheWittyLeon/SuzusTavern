'use client';

/**
 * TAV-PLAY-SHELL step 5 — `useJournalDrawer` (decomposition plan §1.9,
 * Amendment A A7). Built on `useDrawer('play-pane-journal')` for
 * open/closeButtonRef; owns the DDX-22 journal feed (`journalEvents`,
 * `journalSeenSeqsRef`), the desktop-drawer/mobile-tab `visible` fold, and
 * the close handler (which ALSO falls the mobile tab back to Story).
 *
 * A7 carry item (b): `journalSeenSeqsRef`/`setJournalEvents` had NO owning
 * hook (marked with a `debt:` in `useSessionEvents.ts`, `until:` this hook
 * existing) — this hook is that owner now. `useSessionEvents` still
 * receives both as plain handler params, same shape as every other
 * sibling-hook field on that interface; only WHERE they're declared moved.
 *
 * Takes `mobileView`/`setMobileView` as plain downward params — neither is
 * owned by this hook. `mobileView` has no owning hook yet either (plan
 * §1.13/step 6, `usePlayLayout` territory — not built this pass); this
 * hook doesn't claim it, it just reads/writes it, the same "no hook owns
 * it yet is not a reason to invent one here" rule `useSessionEvents.ts`'s
 * own header already states for this exact pair.
 */
import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { EngineSessionEvent } from '@/lib/api/types';
import { useDrawer } from './useDrawer';
import type { UseDrawerResult } from './useDrawer';

/** DDX-22: which pane is active on the phone breakpoint (plan §1.13 —
 * `mobileView` is plain React state at every width; panes are hidden by
 * `display:none` in `Play.module.css`'s media query, not by this value).
 * Owned here (not page.tsx) so both sides of the journal/mobile-tab
 * coupling read the same union without a second copy of the literal. */
export type MobileView = 'log' | 'party' | 'scene' | 'journal';

export interface UseJournalDrawerResult {
  id: string;
  open: boolean;
  visible: boolean;
  closeButtonRef: UseDrawerResult['closeButtonRef'];
  journalEvents: EngineSessionEvent[];
  setJournalEvents: Dispatch<SetStateAction<EngineSessionEvent[]>>;
  journalSeenSeqsRef: MutableRefObject<Set<number>>;
  setOpen: Dispatch<SetStateAction<boolean>>;
  onClose: () => void;
}

export function useJournalDrawer(
  mobileView: MobileView,
  setMobileView: Dispatch<SetStateAction<MobileView>>,
): UseJournalDrawerResult {
  const { id, open, setOpen, closeButtonRef } = useDrawer('play-pane-journal');
  const [journalEvents, setJournalEvents] = useState<EngineSessionEvent[]>([]);
  // A7 carry item (b) — see this file's header. Same DDX-20 F9+Recap
  // fix/invariant `useSessionEvents.ts`'s `pollDurable` documents on its
  // own read side: must stay in lockstep with `journalEvents` on every path
  // reachable while DURABLE_GENERATION_ENABLED is true (today: the mount
  // effect's rehydration seed and pollDurable's own merge, both in
  // page.tsx/useSessionEvents.ts, both still writing through this ref by
  // the same name).
  const journalSeenSeqsRef = useRef<Set<number>>(new Set());

  // DDX-22 — true whenever the journal is actually presented to the user
  // in ANY form (open desktop drawer OR the active mobile tab). Drives
  // `inert` on the always-mounted <aside> (via <Drawer>'s own `visible`
  // prop) so a CLOSED-but-still-mounted desktop drawer is removed from the
  // tab order / a11y tree, while the mobile tab (governed entirely by CSS,
  // not `open`) is never accidentally made inert by the drawer's own
  // closed state.
  const visible = open || mobileView === 'journal';

  // "Close" is one unified action regardless of which presentation is
  // active: on desktop it closes the drawer; on the mobile tab (where
  // there's no drawer to close) it's the natural "back to the table"
  // affordance, switching back to Story. Neither branch is a no-op-turned-
  // bug at the OTHER breakpoint's default state.
  const onClose = useCallback(() => {
    setOpen(false);
    setMobileView((v) => (v === 'journal' ? 'log' : v));
  }, [setOpen, setMobileView]);

  return {
    id,
    open,
    visible,
    closeButtonRef,
    journalEvents,
    setJournalEvents,
    journalSeenSeqsRef,
    setOpen,
    onClose,
  };
}
