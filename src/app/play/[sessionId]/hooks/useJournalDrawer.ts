'use client';

/**
 * TAV-PLAY-SHELL step 5 — `useJournalDrawer` (decomposition plan §1.9,
 * Amendment A A7). Built on `useDrawer('play-pane-journal')` for
 * open/closeButtonRef; owns the DDX-22 journal feed (`journalEvents`,
 * `journalSeenSeqsRef`).
 *
 * A7 carry item (b): `journalSeenSeqsRef`/`setJournalEvents` had NO owning
 * hook (marked with a `debt:` in `useSessionEvents.ts`, `until:` this hook
 * existing) — this hook is that owner now. `useSessionEvents` still
 * receives both as plain handler params, same shape as every other
 * sibling-hook field on that interface; only WHERE they're declared moved.
 *
 * A9d E4: the journal is a `Drawer` at every width. The mobile-tab
 * presentation, `mobileView` and the `visible` fold of the two are gone, so
 * this hook takes no parameters and `open` is the only presence state: one
 * presentation cannot desync from itself.
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

export interface UseJournalDrawerResult {
  id: string;
  open: boolean;
  closeButtonRef: UseDrawerResult['closeButtonRef'];
  journalEvents: EngineSessionEvent[];
  setJournalEvents: Dispatch<SetStateAction<EngineSessionEvent[]>>;
  journalSeenSeqsRef: MutableRefObject<Set<number>>;
  setOpen: Dispatch<SetStateAction<boolean>>;
  onClose: () => void;
}

export function useJournalDrawer(): UseJournalDrawerResult {
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

  const onClose = useCallback(() => setOpen(false), [setOpen]);

  return {
    id,
    open,
    closeButtonRef,
    journalEvents,
    setJournalEvents,
    journalSeenSeqsRef,
    setOpen,
    onClose,
  };
}
