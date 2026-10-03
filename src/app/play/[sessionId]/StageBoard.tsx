'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
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
 * The move (M3) is `useBoard`'s: `moveMode` is true only for the seat that controls the active turn, so an observer's click, Enter or Space still sends nothing; the reach is drawn for every seat
 * through `showReach` (T1).
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
  /** Move is armed (only ever the seat that controls the active turn), a move is in flight, the callbacks behind a legal square and Escape, and the counter the move's landing bumps. */
  moveMode: boolean;
  moveSubmitting: boolean;
  onMove: (to: SpaceCoordinate) => void;
  onExitMove: () => void;
  movedSeq: number;
}

function StageBoard({ space, participants, viewerParticipantId, activeParticipantId, round, showReach, rescueStrandedFocus, moveMode, moveSubmitting, onMove, onExitMove, movedSeq }: StageBoardProps) {
  const setLine = useStageLine();
  /** The last payload the map reported, kept so a new round re-writes the rest line without the map having to say anything. */
  const lastRef = useRef<InspectLine | null>(null);
  const roundRef = useRef(round);
  const rescueRef = useRef(rescueStrandedFocus);
  useEffect(() => {
    roundRef.current = round;
    rescueRef.current = rescueStrandedFocus;
  });

  const usable = isSpaceUsable(space);
  const usableRef = useRef(usable);
  useEffect(() => {
    usableRef.current = usable;
  });

  /** The one writer of the line: the last payload the map reported, in the round the page is in. A band room (`space: null`, a malformed board, a board that BECOMES one mid-fight) has no line:
   *  it writes `null`, so a stale rest line never sits beside the band with the status clipped under it. */
  const show = useCallback(() => {
    setLine(usableRef.current ? buildLine(lastRef.current, { round: roundRef.current }) : null);
  }, [setLine]);

  const onInspect = useCallback((line: InspectLine | null) => {
    lastRef.current = line;
    show();
  }, [show]);

  // The rest line before the map says anything, again when the round changes, and cleared when the board stops being usable.
  useEffect(() => {
    show();
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
      moveMode={moveMode}
      moveSubmitting={moveSubmitting}
      showReach={showReach}
      onMove={onMove}
      onExitMove={onExitMove}
      movedSeq={movedSeq}
      onInspect={onInspect}
    />
  );
}

/** Memoised (run 2, Kage): the page re-renders for every streamed narration chunk and the props are stable between state polls (`useBoard` hands the same object until the state, the viewer, the round, the reach or the rescue changes; the rescue is a `useCallback`), so the map is not re-rendered by them. A poll brings a new `participants` array and renders it, as it must. */
export default memo(StageBoard);
