'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { CombatParticipantState, CombatSpace, SpaceCoordinate } from '@/lib/api/types';
import TacticalMap from '@/components/tactical-map/TacticalMap';
import { buildLine, type InspectLine } from '@/components/tactical-map/a11y';
import { isSpaceUsable } from '@/components/tactical-map/reach';
import { useStageLine } from './regions/SceneStage';

/**
 * B8c-3 M2 (Sora's mount brief 2.2; it lives beside the page, not under regions/, because it is not a region: no `data-region`, no slot): the adapter between the stage and the tactical map, so `TacticalMap` stays ignorant of the shell and `SceneStage` stays ignorant of the map.
 * It renders the map as the stage's body, turns the map's `onInspect` payload into the scene line's text (`buildLine`, from the same `CellNameInput` the cell's accessible name is
 * built from), and clears the line itself when it unmounts.
 *
 * READ-ONLY (M2): `moveMode` is false and `onMove` / `onExitMove` are no-ops, so a click, Enter or Space never sends anything and the board never arms. The reach is drawn through
 * `showReach` (T1: every seat sees how far the creature whose turn it is can go). M3 puts the move behind these two callbacks.
 */
export interface StageBoardProps {
  space: CombatSpace | null | undefined;
  participants: CombatParticipantState[];
  viewerParticipantId: string | null;
  activeParticipantId: string | null;
  /** The combat round, for the rest line ("In combat · round 2"). */
  round: number | null;
  /** Draw the active creature's reach without the interaction (see useBoard). */
  showReach: boolean;
  /** The page's stranded-focus rescue (useStrandedFocusRescue): called with true while the grid holds focus as it unmounts (the fight ended), so focus goes to the scene head, never `<body>`. */
  rescueStrandedFocus: (hadFocusInGroup: boolean) => void;
}

const noMove = (_to: SpaceCoordinate): void => {};
const noExit = (): void => {};

export default function StageBoard({ space, participants, viewerParticipantId, activeParticipantId, round, showReach, rescueStrandedFocus }: StageBoardProps) {
  const setLine = useStageLine();
  /** The last payload the map reported, kept so a new round re-writes the rest line without the map having to say anything. */
  const lastRef = useRef<InspectLine | null>(null);
  const roundRef = useRef(round);
  const rescueRef = useRef(rescueStrandedFocus);
  useEffect(() => {
    roundRef.current = round;
    rescueRef.current = rescueStrandedFocus;
  });

  /** The one writer of the line: the last payload the map reported, in the round the page is in. */
  const show = useCallback(() => {
    setLine(buildLine(lastRef.current, { round: roundRef.current }));
  }, [setLine]);

  const onInspect = useCallback((line: InspectLine | null) => {
    lastRef.current = line;
    show();
  }, [show]);

  // The rest line before the map says anything, and again when the round changes. Only with a BOARD: a band room (`space: null`, a malformed board) has no line, the status shows.
  const usable = isSpaceUsable(space);
  useEffect(() => {
    if (usable) show();
  }, [round, usable, show]);

  // Unmount (the fight ended, the board was lost): clear the line, and if the grid held focus say so BEFORE the DOM goes (a layout-effect cleanup runs before the removal), so the page's
  // rescue puts focus on the scene head instead of letting it fall to <body>. Focus that was elsewhere is not touched.
  useLayoutEffect(() => {
    return () => {
      setLine(null);
      // The map's window declares itself (`data-board-window`): focus inside it is focus in the grid.
      rescueRef.current(document.activeElement?.closest('[data-board-window]') != null);
    };
  }, [setLine]);

  return (
    <TacticalMap
      space={space}
      participants={participants}
      viewerParticipantId={viewerParticipantId}
      activeParticipantId={activeParticipantId}
      moveMode={false}
      showReach={showReach}
      onMove={noMove}
      onExitMove={noExit}
      onInspect={onInspect}
    />
  );
}
