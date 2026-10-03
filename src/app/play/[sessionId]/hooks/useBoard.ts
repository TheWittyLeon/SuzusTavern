'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { CombatState } from '@/lib/api/types';
import type { LogRow } from '@/components/ChatLog';
import { isSpaceUsable } from '@/components/tactical-map/reach';
import { moveRows, type MoveSeen } from '@/lib/dnd/moveRows';
import type { StageBoardProps } from '../StageBoard';
import type { FactValue } from '../presets';

/**
 * B8c-3 M2 / M2b (Sora's mount brief 2.1, 3a): what the page hands the stage's body, and the observers' move rows. READ-ONLY: the move itself (`useBoard`'s other half, the Move control)
 * is M3.
 *
 *   `stage`  null: the state body has no `space` key (positioning is off: the step-11 page, by construction), or this row's stage has no body (the phone). The page then passes the
 *            stage NO child (`null`, never `false`: `SceneStage` renders `children ?? standIn` and `false` is not nullish). Otherwise the props of the map or, for `space: null` and a
 *            malformed board, the band: the map itself falls back through the same `isSpaceUsable` that the room fact reads, so the room and the body cannot disagree.
 *   `label`  the body's accessible name, only when a BOARD is in it (a named `group`); the band's list names itself.
 *
 * The room is the page's `facts.room`; this hook never tests `space` for it. KEY PRESENCE is the engine's contract (a served fight carries the key).
 */
export interface UseBoardArgs {
  state: CombatState | null;
  combatIsActive: boolean;
  /** `facts.room` (usePlayLayout). */
  room: FactValue<'room'> | undefined;
  /** `variantFor(row, 'sceneStage', moment) === 'hero'`: only a stage with a body can hold a map (F-k: a phone has none yet). */
  stageHasBody: boolean;
  /** The viewer's own participant id (`selfPcId`). */
  selfPcId: string | null;
  round: number | null;
  appendLog: (row: Omit<LogRow, 'id' | 'ts'>) => void;
  /** useSceneState's `refocusSceneHeadIfStranded`. */
  rescueStrandedFocus: (hadFocusInGroup: boolean) => void;
}

export interface UseBoardResult {
  stage: StageBoardProps | null;
  label: string | undefined;
}

export function useBoard({ state, combatIsActive, room, stageHasBody, selfPcId, round, appendLog, rescueStrandedFocus }: UseBoardArgs): UseBoardResult {
  const served = combatIsActive && state != null && 'space' in state;

  // M2b: one story-log row per creature per turn, written when the turn passes (lib/dnd/moveRows.ts). `seenRef` is what has been accounted for; the effect runs on each applied state.
  const seenRef = useRef<MoveSeen | null>(null);
  const appendRef = useRef(appendLog);
  useEffect(() => {
    appendRef.current = appendLog;
  });
  useEffect(() => {
    if (!state) {
      seenRef.current = null;
      return;
    }
    const next = moveRows(seenRef.current, state);
    seenRef.current = next.seen;
    for (const text of next.rows) appendRef.current({ who: 'Suzu', kind: 'system', text });
  }, [state]);

  const activeParticipant = state?.participants.find((p) => p.is_active_turn) ?? null;
  // T1: every seat sees the reach of the creature whose turn it is, all turn: the board room, an active state, and a creature that has a square and a budget.
  const showReach = room === 'board' && state?.state === 'active' && activeParticipant?.at != null && (activeParticipant.movement_remaining ?? 0) > 0;

  return useMemo<UseBoardResult>(() => {
    if (!served || !stageHasBody || state == null) return { stage: null, label: undefined };
    return {
      stage: {
        space: state.space,
        participants: state.participants,
        viewerParticipantId: selfPcId,
        activeParticipantId: state.active_participant_id,
        round,
        showReach,
        rescueStrandedFocus,
      },
      label: isSpaceUsable(state.space) ? 'Tactical map' : undefined,
    };
  }, [served, stageHasBody, state, selfPcId, round, showReach, rescueStrandedFocus]);
}
