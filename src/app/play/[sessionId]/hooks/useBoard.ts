'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { SpaceCoordinate } from '@/lib/api/types';
import { moveToken } from '@/lib/api/dnd';
import { COMBAT_REFUSAL_REASON_MAP } from '@/lib/dnd/engineReasons';
import { engineErrorMessage, extractReason, isApiError } from '@/lib/dnd/engineError';
import type { LogRow } from '@/components/ChatLog';
import { isSpaceUsable } from '@/components/tactical-map/reach';
import { accountMove, moveRowText, moveRows, type MoveSeen } from '@/lib/dnd/moveRows';
import type { UseCombatStateResult } from './useCombatState';
import { useStrandedFocusRescue } from './useStrandedFocusRescue';
import type { StageBoardProps } from '../StageBoard';
import type { FactValue } from '../presets';

/**
 * B8c-3 M2 / M2b / M3 (Sora's mount brief 2.1, 3, 3a): what the page hands the stage's body, the observers' move rows, and THE MOVE (its own hook half on the shared latch, never `onCombatAction`: that
 * narrates, takes a string payload and a file under review). The move is NEVER optimistic: the token moves when the server answers (the pending look is the map's own).
 *
 *   `stage`  null: the state body has no `space` key (positioning is off: the step-11 page, by construction), or this row's stage has no body (the phone). The page then passes the
 *            stage NO child (`null`, never `false`: `SceneStage` renders `children ?? standIn` and `false` is not nullish). Otherwise the props of the map or, for `space: null` and a
 *            malformed board, the band: the map itself falls back through the same `isSpaceUsable` that the room fact reads, so the room and the body cannot disagree.
 *   `label`  the body's accessible name, only when a BOARD is in it (a named `group`); the band's list names itself.
 *
 * The room is the page's `facts.room`; this hook never tests `space` for it. KEY PRESENCE is the engine's contract (a served fight carries the key).
 */
export interface UseBoardArgs {
  /** The combat state hook's whole result: the state, the viewer's seat, and the shared latch and writers the move uses (so the move and any other verb cannot be in flight together). */
  cs: UseCombatStateResult;
  /** `facts.room` (usePlayLayout). */
  room: FactValue<'room'> | undefined;
  /** `variantFor(row, 'sceneStage', moment) === 'hero'`: only a stage with a body can hold a map (F-k: a phone has none yet). */
  stageHasBody: boolean;
  /** `row.boardMove === true` (presets.ts): the layout row opts in to the Move verb. A row value, never a viewport test; the phone row does not until P3. */
  moveAllowed: boolean;
  /** The session is paused or ended: no move is offered (the verbs are locked the same way). */
  sessionLocked: boolean;
  appendLog: (row: Omit<LogRow, 'id' | 'ts'>) => void;
  /** useSceneState's `refocusSceneHeadIfStranded`. */
  rescueStrandedFocus: (hadFocusInGroup: boolean) => void;
  /** The action bar's own container (`composerRailAnchorRef`): where focus goes after a disarm when the Move button is disabled. */
  railRef: RefObject<HTMLElement | null>;
}

/** What the action bar needs to offer Move: a toggle (`aria-pressed`) with a fixed name. */
export interface MoveControl {
  pressed: boolean;
  disabled: boolean;
  /** Why Move is locked when the turn line does not say (your own turn: no feet left, or your move in flight). Read only by the bar's described form (Iro m-3: a locked verb says why). */
  reason?: string;
  onToggle: () => void;
}

export interface UseBoardResult {
  stage: StageBoardProps | null;
  label: string | undefined;
  /** undefined: no Move is offered (no board served, no body, not my creature, no budget on the wire). */
  bar: MoveControl | undefined;
  /** The Move button's ref, a SEPARATE field (a ref inside the control object reads as a render-time ref access to the compiler lint). A callback ref: its cleanup is the Move button's unmount, where the stranded-focus rescue is decided. */
  moveButtonRef: (el: HTMLButtonElement | null) => void | (() => void);
}

/**
 * Refusals that end Move: the reason says there is nothing to arm for (the budget, the turn, the creature, the board, the combat). Everything else (a 409 `position_changed`, `invalid_destination`,
 * `same_cell`, a network error with no reason) keeps Move ARMED with focus on the square the user was on, and is never re-sent.
 */
const DISARMING_REASONS = new Set(['no_movement_remaining', 'not_your_turn', 'no_active_turn', 'mover_unplaced', 'no_space', 'positioning_disabled', 'not_found']);
/** A refusal that carries no `state` and says the board is gone: re-read the state so the page learns it. */
const BOARD_GONE_REASONS = new Set(['positioning_disabled', 'not_found']);

export function useBoard({ cs, room, stageHasBody, moveAllowed, sessionLocked, appendLog, rescueStrandedFocus, railRef }: UseBoardArgs): UseBoardResult {
  const { combatState: state, combatIsActive, selfPcId, round, combatId, combatBusy, combatBusyRef, stateSeqRef, setCombatBusy, setRefusedReason, applyState, refreshState, activeIsMine } = cs;
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

  const hasStage = served && stageHasBody && state != null;
  const mine = hasStage ? state.participants.find((p) => p.participant_id === selfPcId) ?? null : null;
  // Move is offered where there is a board to pick on AND the row offers it (`moveAllowed`; the phone row does not yet) and my creature has a square and a budget on the wire.
  const offered = hasStage && moveAllowed && room === 'board' && mine != null && mine.at != null && mine.movement_remaining != null;
  const myBudget = mine?.movement_remaining ?? 0;

  const [armed, setArmed] = useState(false);
  const [moveSubmitting, setMoveSubmitting] = useState(false);
  const [movedSeq, setMovedSeq] = useState(0);
  const [focusMoveTick, setFocusMoveTick] = useState(0);
  // canMove: offered, my turn, an active fight, feet left, the session not locked, and nothing ELSE in flight (a verb in flight disarms; my own move in flight does not).
  const canMove = offered && activeIsMine && state?.state === 'active' && myBudget > 0 && !sessionLocked && (!combatBusy || moveSubmitting);
  // `armed` is the player's intent; it resets in render (the adjust-state-during-render pattern) when `canMove` goes false, so a turn that passes or a verb that starts disarms Move with no effect.
  if (armed && !canMove) setArmed(false);
  const moveMode = armed && canMove;

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // After a disarm the USER caused (Escape, the last feet spent, a refusal that ends Move): focus goes to the Move button, or, when it is disabled, to the action bar's container; never <body>. A disarm
  // by a poll (the turn passed) moves nothing: the grid stays, read-only. And only while focus is still in the grid (or stranded on <body>): a user who has gone on to the composer stays there.
  useEffect(() => {
    if (focusMoveTick === 0) return;
    const active = document.activeElement;
    if (active != null && active !== document.body && !active.closest('[role="grid"]')) return;
    const btn = buttonRef.current;
    if (btn && !btn.disabled) btn.focus();
    else railRef.current?.focus();
  }, [focusMoveTick, railRef]);

  // The Move button leaves the bar when the board is gone (a `positioning_disabled` answer, then the state without the key): focus that was ON it falls to <body>. The decision is the button's own unmount
  // cleanup (never a poll-time guess about where focus is), routed through the commit-tied rescue with the action bar's container as the target (the anchor a disabled Move also uses).
  const rescueToBar = useStrandedFocusRescue(railRef);
  const bindMoveButton = useCallback(
    (el: HTMLButtonElement | null) => {
      if (!el) return;
      buttonRef.current = el;
      return () => {
        rescueToBar(document.activeElement === el);
        buttonRef.current = null;
      };
    },
    [rescueToBar],
  );

  // The move handler reads everything as it is WHEN IT RUNS (a ref refreshed after each commit), never as it was when it was armed: `from` is the mover's `at` in the state the last render drew.
  const latest = useRef({ state, mine, combatId });
  useEffect(() => {
    latest.current = { state, mine, combatId };
  });
  const onMove = useCallback(async (to: SpaceCoordinate) => {
    const { mine: me, combatId: id } = latest.current;
    const from = me?.at;
    // `from` must be a numeric pair (a garbage `at` on the wire sends nothing: the engine would refuse it, and the token cannot be said to move from nowhere).
    if (!id || !from || !Array.isArray(from) || from.length !== 2 || !from.every(Number.isFinite) || combatBusyRef.current) return; // the shared latch: a second activation in the same tick returns before any request
    combatBusyRef.current = true;
    stateSeqRef.current += 1; // a poll asked before this is discarded
    setCombatBusy(true);
    setMoveSubmitting(true);
    setRefusedReason(null);
    try {
      const res = await moveToken(id, { participant_id: me.participant_id, from, to });
      if (!res.state) {
        // A 200 with no `state` cannot move the token, and a row at the 200 would say "moves" before the map shows it. Re-read instead: the poll's own diff writes the mover's row when the square changes
        // (nothing was accounted here, so it is not written twice), and `movedSeq` stays put (the map has nothing new to sync to).
        refreshState();
        return;
      }
      applyState(res.state);
      const landed = res.state.participants.find((p) => p.participant_id === me.participant_id);
      seenRef.current = accountMove(seenRef.current, me.participant_id, landed?.at ?? to);
      appendRef.current({ who: 'Suzu', kind: 'system', text: moveRowText(me.name) }); // the mover's one row, at the 200 that carries the state; no narration beat
      setMovedSeq((n) => n + 1);
      if ((landed?.movement_remaining ?? 1) <= 0) setFocusMoveTick((t) => t + 1);
    } catch (err) {
      setRefusedReason(engineErrorMessage(err, { fallback: "That move didn't go through.", reasonMap: COMBAT_REFUSAL_REASON_MAP }));
      const data = ((err as { body?: unknown } | null)?.body as { data?: { state?: Parameters<typeof applyState>[0] } } | null)?.data;
      if (data?.state) applyState(data.state);
      const reason = isApiError(err) ? extractReason(err) : undefined;
      if (reason && DISARMING_REASONS.has(reason)) {
        setArmed(false);
        setFocusMoveTick((t) => t + 1);
        if (BOARD_GONE_REASONS.has(reason)) refreshState();
      }
      // otherwise Move stays armed, focus stays on the square the user was on (no `movedSeq`), and nothing is re-sent
    } finally {
      combatBusyRef.current = false;
      setCombatBusy(false);
      setMoveSubmitting(false);
    }
  }, [combatBusyRef, stateSeqRef, setCombatBusy, setRefusedReason, applyState, refreshState]);
  const onExitMove = useCallback(() => {
    setArmed(false);
    setFocusMoveTick((t) => t + 1);
  }, []);
  const onToggle = useCallback(() => setArmed((a) => !a), []);

  return useMemo<UseBoardResult>(() => {
    if (!hasStage) return { stage: null, label: undefined, bar: undefined, moveButtonRef: bindMoveButton };
    return {
      stage: {
        space: state.space,
        participants: state.participants,
        viewerParticipantId: selfPcId,
        activeParticipantId: state.active_participant_id,
        round,
        showReach,
        rescueStrandedFocus,
        moveMode,
        moveSubmitting,
        onMove,
        onExitMove,
        movedSeq,
      },
      label: isSpaceUsable(state.space) ? 'Tactical map' : undefined,
      bar: offered ? { pressed: moveMode, disabled: !canMove || moveSubmitting, reason: moveSubmitting ? 'Moving…' : activeIsMine && state?.state === 'active' && myBudget <= 0 ? 'No movement left' : undefined, onToggle } : undefined,
      moveButtonRef: bindMoveButton,
    };
  }, [hasStage, state, selfPcId, round, showReach, rescueStrandedFocus, moveMode, moveSubmitting, onMove, onExitMove, movedSeq, offered, canMove, activeIsMine, myBudget, onToggle, bindMoveButton]);
}
