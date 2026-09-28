'use client';

/**
 * TAV-PLAY-SHELL step 5 — `useMemberSheetDrawer` (decomposition plan §1.8,
 * Amendment A A7). Built on `useDrawer('play-pane-member-sheet')` for
 * open/closeButtonRef; owns everything else the party-panel inline sheet
 * needs: the selected member's fetched sheet/name/self-flag/loading/error,
 * PartyStrip's `onSelectMember` click handler (TAV-PARTY-INLINE-SHEET), and
 * the close handler (which ALSO resets the self-flag — Kage n3 — mirroring
 * the pre-extraction page.tsx `closeMemberSheet`).
 *
 * "Close" only flips the open flag — the fetched sheet/name/error state
 * stays mounted (unchanged behaviour) so the drawer's slide-out transition
 * has a "from" state, and re-opening the SAME member instantly shows their
 * last-loaded sheet instead of flashing back to loading.
 *
 * Takes `username`/`mySheet` as plain downward params — neither is owned
 * by this hook (`useAuth` / `useMyCharacter`, both composed earlier in
 * page.tsx's fixed hook order).
 */
import { useCallback, useState } from 'react';
import { getCharacterSheet } from '@/lib/api/dnd';
import type { CharacterSheet, Participant } from '@/lib/api/types';
import { useDrawer } from './useDrawer';
import type { UseDrawerResult } from './useDrawer';

export interface UseMemberSheetDrawerResult {
  open: boolean;
  closeButtonRef: UseDrawerResult['closeButtonRef'];
  selectedMemberSheet: CharacterSheet | null;
  selectedMemberName: string | null;
  selectedMemberIsSelf: boolean;
  memberSheetLoading: boolean;
  memberSheetError: boolean;
  onClose: () => void;
  onSelectMember: (p: Participant) => void;
}

export function useMemberSheetDrawer(
  username: string | null,
  mySheet: CharacterSheet | null,
): UseMemberSheetDrawerResult {
  const { open, setOpen, closeButtonRef } = useDrawer('play-pane-member-sheet');
  const [selectedMemberSheet, setSelectedMemberSheet] = useState<CharacterSheet | null>(null);
  const [selectedMemberName, setSelectedMemberName] = useState<string | null>(null);
  // LVL (Aoi gap B): whether the drawer is showing the viewer's OWN sheet —
  // drives MemberSheetPanel's pending-choices callout.
  const [selectedMemberIsSelf, setSelectedMemberIsSelf] = useState(false);
  const [memberSheetLoading, setMemberSheetLoading] = useState(false);
  const [memberSheetError, setMemberSheetError] = useState(false);

  const onClose = useCallback(() => {
    setOpen(false);
    // Kage n3: don't leave the previous selection's self-flag lingering
    // between opens (always re-set on open, but stale state is stale state).
    setSelectedMemberIsSelf(false);
  }, [setOpen]);

  // TAV-PARTY-INLINE-SHEET: PartyPanel's card onClick. The viewer's own row
  // reuses the already-loaded `mySheet` (no extra hop); any other member's
  // row fetches their sheet fresh via the same getCharacterSheet call the
  // rebind-onChanged path (page.tsx) already uses. Errors surface inline in
  // the drawer (MemberSheetPanel's own error branch) rather than a toast —
  // the drawer is already the "here's what went wrong" surface.
  const onSelectMember = useCallback(
    (p: Participant) => {
      if (!p.character) return;
      setOpen(true);
      setSelectedMemberName(p.character.name ?? p.username);
      const isSelf = p.username.toLowerCase() === (username ?? '').toLowerCase();
      setSelectedMemberIsSelf(isSelf);
      if (isSelf && mySheet) {
        setSelectedMemberSheet(mySheet);
        setMemberSheetError(false);
        setMemberSheetLoading(false);
        return;
      }
      setSelectedMemberSheet(null);
      setMemberSheetError(false);
      setMemberSheetLoading(true);
      getCharacterSheet(String(p.character.character_id), username ?? '')
        .then((sheet) => {
          setSelectedMemberSheet(sheet);
          setMemberSheetLoading(false);
        })
        .catch(() => {
          setMemberSheetError(true);
          setMemberSheetLoading(false);
        });
    },
    [username, mySheet, setOpen],
  );

  return {
    open,
    closeButtonRef,
    selectedMemberSheet,
    selectedMemberName,
    selectedMemberIsSelf,
    memberSheetLoading,
    memberSheetError,
    onClose,
    onSelectMember,
  };
}
