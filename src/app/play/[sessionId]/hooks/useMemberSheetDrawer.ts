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
 *
 * A9b fix round 1 (Miko Imp-1 / Aoi B1): the hook also takes `docked` — the
 * resolved placement of `characterBlock` (`!layer`, from the preset row), so
 * ONE hook owns both presentations of the singleton sheet and derives
 * everything from it instead of page.tsx sharing one `open` flag between a
 * Drawer and a grid slot that never read it:
 *   - `open` (the Drawer's dialog flag) is never true while docked: a docked
 *     sheet is never a modal, and a stale `open` set while the sheet was a
 *     Drawer is cleared in the render the sheet docks, so docked -> Story
 *     cannot resurrect it as an unrequested modal (A9b-1).
 *   - docked, the Close button FOLDS the rail (`folded`; R20, the row is
 *     `collapsible:true`) instead of flipping a flag nothing reads (A9b-1b);
 *     picking a party member unfolds it.
 *   - docked with no member picked, the panel shows the viewer's OWN sheet
 *     (a docked panel with no selection was an empty "Character sheet"
 *     header over nothing); a viewer with no character gets the panel's own
 *     empty state.
 * `panelProps` is the one object `<MemberSheetPanel>` is rendered from, in
 * either presentation.
 */
import { useCallback, useState } from 'react';
import { getCharacterSheet } from '@/lib/api/dnd';
import type { MemberSheetPanelProps } from '@/components/MemberSheetPanel';
import type { CharacterSheet, Participant } from '@/lib/api/types';
import { useDrawer } from './useDrawer';
import type { UseDrawerResult } from './useDrawer';

export interface UseMemberSheetDrawerResult {
  id: string;
  /** The Drawer's dialog flag — never true while the sheet is docked. */
  open: boolean;
  /** Docked rail folded to its strip (meaningful only while docked). */
  folded: boolean;
  onUnfold: () => void;
  closeButtonRef: UseDrawerResult['closeButtonRef'];
  /** Everything `<MemberSheetPanel>` takes, resolved for this presentation. */
  panelProps: Pick<
    MemberSheetPanelProps,
    'sheet' | 'loading' | 'error' | 'memberName' | 'isSelf' | 'onClose' | 'closeButtonRef'
  >;
  onSelectMember: (p: Participant) => void;
}

export function useMemberSheetDrawer(
  username: string | null,
  mySheet: CharacterSheet | null,
  docked: boolean,
): UseMemberSheetDrawerResult {
  const { id, open, setOpen, closeButtonRef } = useDrawer('play-pane-member-sheet');
  const [folded, setFolded] = useState(false);
  // Docked => never a modal. Adjusting state during render (React's own
  // pattern for state derived from a prop) rather than an effect: an effect
  // would paint one frame of `open` on the new placement first.
  if (docked && open) setOpen(false);
  const [selectedMemberSheet, setSelectedMemberSheet] = useState<CharacterSheet | null>(null);
  const [selectedMemberName, setSelectedMemberName] = useState<string | null>(null);
  // LVL (Aoi gap B): whether the drawer is showing the viewer's OWN sheet —
  // drives MemberSheetPanel's pending-choices callout.
  const [selectedMemberIsSelf, setSelectedMemberIsSelf] = useState(false);
  const [memberSheetLoading, setMemberSheetLoading] = useState(false);
  const [memberSheetError, setMemberSheetError] = useState(false);

  const onClose = useCallback(() => {
    // A9b-1b: docked, Close folds the rail; there is nothing to "close".
    if (docked) {
      setFolded(true);
      return;
    }
    setOpen(false);
    // Kage n3: don't leave the previous selection's self-flag lingering
    // between opens (always re-set on open, but stale state is stale state).
    setSelectedMemberIsSelf(false);
  }, [docked, setOpen]);
  const onUnfold = useCallback(() => setFolded(false), []);

  // TAV-PARTY-INLINE-SHEET: PartyPanel's card onClick. The viewer's own row
  // reuses the already-loaded `mySheet` (no extra hop); any other member's
  // row fetches their sheet fresh via the same getCharacterSheet call the
  // rebind-onChanged path (page.tsx) already uses. Errors surface inline in
  // the drawer (MemberSheetPanel's own error branch) rather than a toast —
  // the drawer is already the "here's what went wrong" surface.
  const onSelectMember = useCallback(
    (p: Participant) => {
      if (!p.character) return;
      if (docked) setFolded(false);
      else setOpen(true);
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
    [username, mySheet, docked, setOpen],
  );

  // Docked with nobody picked: the viewer's own sheet is the default view.
  const showOwn = docked && selectedMemberName === null && mySheet !== null;
  return {
    id,
    open,
    folded,
    onUnfold,
    closeButtonRef,
    panelProps: {
      sheet: showOwn ? mySheet : selectedMemberSheet,
      loading: memberSheetLoading,
      error: memberSheetError,
      memberName: showOwn ? mySheet.name : selectedMemberName,
      isSelf: showOwn || selectedMemberIsSelf,
      onClose,
      closeButtonRef,
    },
    onSelectMember,
  };
}
