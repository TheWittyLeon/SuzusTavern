'use client';
// src/components/tactical-map/TacticalMap.tsx
//
// Tactical map (#12), design pass v1 (Aoi-UI) — STANDALONE component (Lane D,
// 2026-09-28 runbook). Not mounted anywhere yet; mounting into `SceneStage`
// waits for play-shell steps 6/11. Presentational only: every prop is data
// in or a callback out — no fetching, no engine calls, no combat-action
// wiring (that belongs to whoever mounts this inside `/play`).
//
// HARD RULE (movement design §3.4, Aoi-UI design header, carried through
// every screen): renders from `space` ONLY, never `terrain`/`tactics`/
// `position` — those are DM-only or polymorphic prose that this component
// must never import, let alone read. See
// `src/__tests__/components/tactical-map/TacticalMap.test.tsx`'s guard test.
//
// Leon's T1-T4 rulings (2026-09-28) this component implements:
//   T1 (reach overlay visible to ALL) — the overlay is computed from the
//      ACTIVE participant's `at`/`movement_remaining`, never from
//      `viewerParticipantId`, so any viewer whose caller sets `moveMode`
//      true sees the true mover's reach, not a privileged "my own reach"
//      view. See the `reach`/`reachSet` derivation below.
//   T2 (condition badge = top/worst only) — `worstCondition` (./conditions).
//   T3 (invisible-but-shown = distinct look) — `.tokenInvisible` (dashed
//      outline) + an eye badge, applied whenever `conditions` includes
//      "invisible"; the token still renders at its true `at` (M1).
//   T4 (phone board centers on the active token each turn) — the
//      scroll-into-view effect keyed on `activeParticipantId` below.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CombatParticipantState, CombatSpace, SpaceCoordinate } from '@/lib/api/types';
import { COMBAT_REFUSAL_REASON_MAP } from '@/lib/dnd/engineReasons';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import { chebyshevCost, coordsEqual, isLegalMoveTarget, reachableCells } from './reach';
import { cellAccessibleName, nextFocusCoord, toDisplayRowCol, type CellOccupant } from './a11y';
import { worstCondition } from './conditions';
import { formatConditionName } from '@/lib/conditions';
import TheatreOfMindBand from './TheatreOfMindBand';
import styles from './TacticalMap.module.css';

export interface TacticalMapProps {
  /** The instantiated board this encounter authored, or `null`/`undefined`
   *  for theatre-of-mind (movement design §5: absence of `space`, not a
   *  mode). */
  space: CombatSpace | null | undefined;
  /** Full participant roster, regardless of placement — an unplaced
   *  participant (`at: null`) is simply never drawn on the board. */
  participants: CombatParticipantState[];
  /** The logged-in viewer's own `participant_id`, if they have a character
   *  seated in this combat. Drives the "you" token modifier and the
   *  "Current position" accessible name — never drives which reach is
   *  shown (see T1 above). */
  viewerParticipantId?: string | null;
  /** `CombatState.active_participant_id` — whose reach/turn ring/board
   *  centering this render reflects. */
  activeParticipantId?: string | null;
  /** True while the viewer is in Move-targeting mode. Gates the reach
   *  overlay, the destination-cell highlight, and whether Enter/Space/click
   *  on a legal cell calls `onMove`. Caller-controlled — this component
   *  never decides on its own that it's "someone's turn to move". */
  moveMode: boolean;
  /** Called with the destination coordinate when the viewer confirms a
   *  legal cell (Enter/Space, or a click, on a cell this component's own
   *  `reach.ts` mirror considers reachable). The server's `/move` response
   *  is the only authority — this is a client PREVIEW (design §4). */
  onMove: (to: SpaceCoordinate) => void;
  /** Called when the viewer presses Escape while `moveMode` is true. This
   *  component does not move focus outside its own DOM — the caller is
   *  responsible for returning focus to its Move control (design §5). */
  onExitMove: () => void;
  /** Machine-readable refusal code from the most recent `/move` 4xx
   *  (`CombatErrorData.reason`) — mapped to player copy via
   *  `COMBAT_REFUSAL_REASON_MAP`. `null`/`undefined` renders no banner. */
  refusalReason?: string | null;
  className?: string;
}

function coordKeyStr(c: SpaceCoordinate): string {
  return `${c[0]},${c[1]}`;
}

function isDowned(p: CombatParticipantState): boolean {
  return p.hp_current === 0 && p.is_alive;
}

function tokenInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed[0].toUpperCase() : '?';
}

export default function TacticalMap({
  space,
  participants,
  viewerParticipantId,
  activeParticipantId,
  moveMode,
  onMove,
  onExitMove,
  refusalReason,
  className,
}: TacticalMapProps) {
  const cellRefs = useRef(new Map<string, HTMLDivElement>());

  const activeParticipant = useMemo(
    () => participants.find((p) => p.participant_id === activeParticipantId),
    [participants, activeParticipantId],
  );

  // Only PLACED participants (`at` set) are drawn — an unplaced participant
  // (design §5/§7: no `space` authored at spawn, a legacy row, or more
  // seated PCs than `space.start.party` cells) is shown nowhere on the
  // board, not as a ghost/edge marker.
  const placed = useMemo(
    () =>
      participants.filter(
        (p): p is CombatParticipantState & { at: SpaceCoordinate } => p.at != null,
      ),
    [participants],
  );

  const occupiedByOthers = useMemo(
    () => placed.filter((p) => p.participant_id !== activeParticipantId).map((p) => p.at),
    [placed, activeParticipantId],
  );

  const activeAt = activeParticipant?.at ?? null;
  const activeMovementRemaining = activeParticipant?.movement_remaining ?? 0;

  const reach = useMemo(() => {
    if (!space || !moveMode || !activeAt) return [] as SpaceCoordinate[];
    return reachableCells(space, activeAt, activeMovementRemaining, occupiedByOthers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, moveMode, activeAt?.[0], activeAt?.[1], activeMovementRemaining, occupiedByOthers]);
  const reachSet = useMemo(() => new Set(reach.map(coordKeyStr)), [reach]);

  const [focusedCoord, setFocusedCoord] = useState<SpaceCoordinate>(() => activeAt ?? [0, 0]);
  const [hoverCoord, setHoverCoord] = useState<SpaceCoordinate | null>(null);

  // Move mode engaged, or the actor's own cell changed while engaged: focus
  // enters (design §5: "focus enters grid at your token") or follows
  // (a11y checklist: "focus follows the token after a successful move,
  // prop-driven") the actor's current cell. React's documented "adjust
  // state during render" pattern (a synchronous reset in the render body,
  // not an effect) — same convention as JournalPane.tsx's resetKey, and it
  // satisfies the repo-wide set-state-in-effect lint. `focusSyncKey` is
  // `null` whenever `moveMode` is false, so re-engaging Move (even at an
  // unchanged `at`) always reproduces a real key transition and re-syncs —
  // deliberately gated on `moveMode` so an observer's own roving-tabindex
  // position is never yanked by someone else's move.
  const activeAtKey = activeAt ? coordKeyStr(activeAt) : null;
  const focusSyncKey = moveMode ? activeAtKey : null;
  const [prevFocusSyncKey, setPrevFocusSyncKey] = useState<string | null>(focusSyncKey);
  if (focusSyncKey !== prevFocusSyncKey) {
    setPrevFocusSyncKey(focusSyncKey);
    if (moveMode && activeAt) setFocusedCoord(activeAt);
  }

  useEffect(() => {
    if (!moveMode) return;
    cellRefs.current.get(coordKeyStr(focusedCoord))?.focus();
  }, [focusedCoord, moveMode]);

  // T4: center the board on the active participant's cell each time the
  // turn changes (guarded so it fires once per turn, not on every render).
  const lastCenteredRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!space || !activeAt) return;
    if (lastCenteredRef.current === activeParticipantId) return;
    lastCenteredRef.current = activeParticipantId;
    cellRefs.current.get(coordKeyStr(activeAt))?.scrollIntoView({ block: 'center', inline: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, activeAt?.[0], activeAt?.[1], activeParticipantId]);

  // Kage-CR D1 IMPORTANT-1: `space.kind` was never read, so a non-square
  // board (a future hex/zone kind) silently rendered as a square grid with
  // a nonsensical Chebyshev overlay. M6 (movement design) is square-only in
  // 1.0 — fall through to the same theatre-of-mind band `!space` uses
  // rather than draw a board this mirror doesn't understand.
  if (!space || space.kind !== 'square') {
    if (participants.length === 0) return null;
    return <TheatreOfMindBand participants={participants} className={className} />;
  }

  const destinationCoord = moveMode ? (hoverCoord ?? focusedCoord) : null;
  const destinationLegal =
    destinationCoord && activeAt
      ? isLegalMoveTarget(space, activeAt, destinationCoord, activeMovementRemaining, occupiedByOthers)
      : false;

  const refusalCopy = refusalReason
    ? (COMBAT_REFUSAL_REASON_MAP[refusalReason] ?? 'The server refused that move.')
    : null;

  function attemptMove(to: SpaceCoordinate) {
    if (!space || !moveMode || !activeAt) return;
    if (isLegalMoveTarget(space, activeAt, to, activeMovementRemaining, occupiedByOthers)) {
      onMove(to);
    }
  }

  function handleGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!space) return;
    if (e.key === 'Escape') {
      // Tora-Gesture CRIT-1 / Kage-CR IMPORTANT-3: route through
      // consumeEscape so Escape can never fall through to /play's
      // document-level Award-XP fallback while exiting Move mode. Outside
      // Move mode this branch never calls consumeEscape at all, so
      // propagation is untouched — matches the pre-fix "no-op outside Move
      // mode" behaviour Tora already verified clean.
      if (moveMode) {
        e.preventDefault();
        consumeEscape(e, { onClose: onExitMove });
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (moveMode) {
        e.preventDefault();
        attemptMove(focusedCoord);
      }
      return;
    }
    const next = nextFocusCoord(e.key, focusedCoord, space.width, space.height);
    if (next) {
      e.preventDefault();
      setFocusedCoord(next);
    }
  }

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <div
        className={styles.boardScroll}
        style={{ ['--tm-cols' as string]: space.width, ['--tm-rows' as string]: space.height }}
      >
        <div
          className={styles.board}
          role="grid"
          aria-label={
            activeParticipant
              ? `Battle map — ${activeParticipant.name}'s turn, ${activeMovementRemaining} feet remaining`
              : 'Battle map'
          }
          onKeyDown={handleGridKeyDown}
        >
          {Array.from({ length: space.height }, (_, y) => (
            <div role="row" className={styles.row} key={y}>
              {Array.from({ length: space.width }, (_, x) => {
                const coord: SpaceCoordinate = [x, y];
                const key = coordKeyStr(coord);
                const occupant = placed.find((p) => coordKeyStr(p.at) === key);
                // Kage-CR D1 CRITICAL-1: `space.blocked`/`.features` are
                // legally omittable content (the validator accepts absence
                // and never backfills `[]` — B3/Miko re-confirmed by object
                // identity) even though the B6 wire type claims them
                // always-present. `SquareSpace._is_blocked`, this mirror's
                // own cited authority, defends with `or []`; match it.
                const blocked = (space.blocked ?? []).some((b) => coordKeyStr(b) === key);
                const feature = (space.features ?? []).find((f) =>
                  f.at.some((a) => coordKeyStr(a) === key),
                );
                const inRange = reachSet.has(key);
                const isDestination = Boolean(
                  destinationCoord && coordKeyStr(destinationCoord) === key,
                );
                const { row1, col1 } = toDisplayRowCol(coord);

                let cellOccupant: CellOccupant | undefined;
                let worst: string | undefined;
                let otherConditionsFormatted: string | undefined;
                let downed = false;
                let invisible = false;
                if (occupant) {
                  downed = isDowned(occupant);
                  invisible = occupant.conditions.includes('invisible');
                  worst = worstCondition(occupant.conditions);
                  // T2: the badge shows only the worst condition; the full
                  // list (minus "invisible", which has its own disclosure)
                  // is exposed via the cell's accessible name (focus) and
                  // the token's `title` attribute (tap/hover) below.
                  const otherConditions = occupant.conditions
                    .filter((c) => c.toLowerCase() !== 'invisible')
                    .map(formatConditionName);
                  otherConditionsFormatted =
                    otherConditions.length > 0 ? otherConditions.join(', ') : undefined;
                  cellOccupant = {
                    name: occupant.name,
                    isSelf: occupant.participant_id === viewerParticipantId,
                    isAlly: occupant.is_pc && occupant.participant_id !== viewerParticipantId,
                    hostile: !occupant.is_pc,
                    invisible,
                    otherConditions,
                  };
                }

                return (
                  <div
                    key={key}
                    ref={(el) => {
                      if (el) cellRefs.current.set(key, el);
                      else cellRefs.current.delete(key);
                    }}
                    role="gridcell"
                    tabIndex={coordsEqual(focusedCoord, coord) ? 0 : -1}
                    aria-label={cellAccessibleName({
                      row1,
                      col1,
                      occupant: cellOccupant,
                      blocked,
                      inRange,
                      costFt: activeAt ? chebyshevCost(space, activeAt, coord) : undefined,
                      moveModeActive: moveMode,
                    })}
                    className={[
                      styles.cell,
                      blocked && styles.cellBlocked,
                      moveMode && inRange && styles.cellInRange,
                      isDestination && destinationLegal && styles.cellDestination,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => attemptMove(coord)}
                    onMouseEnter={() => {
                      if (moveMode) setHoverCoord(coord);
                    }}
                    onMouseLeave={() => {
                      setHoverCoord((prev) => (coordsEqual(prev, coord) ? null : prev));
                    }}
                  >
                    {feature && !occupant && (
                      <span className={styles.feature} aria-hidden="true" title={feature.label}>
                        {feature.label.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    {occupant && (
                      <span
                        className={[
                          styles.token,
                          cellOccupant?.isSelf && styles.tokenSelf,
                          !cellOccupant?.isSelf && cellOccupant?.isAlly && styles.tokenAlly,
                          cellOccupant?.hostile && styles.tokenFoe,
                          downed && styles.tokenDowned,
                          invisible && styles.tokenInvisible,
                          occupant.is_active_turn && styles.tokenActive,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-hidden="true"
                        title={otherConditionsFormatted}
                      >
                        {tokenInitial(occupant.name)}
                        {invisible && (
                          <span className={styles.eyeBadge} aria-hidden="true">
                            ◌
                          </span>
                        )}
                        {worst && (
                          <span className={styles.conditionBadge} aria-hidden="true">
                            {worst.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </span>
                    )}
                    {moveMode && isDestination && destinationLegal && activeAt && (
                      <span className={styles.destinationTag} aria-hidden="true">
                        {chebyshevCost(space, activeAt, coord)} ft
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {refusalCopy && <p className={styles.refusal}>{refusalCopy}</p>}
    </div>
  );
}
