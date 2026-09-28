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
//      container-scoped scroll effect keyed on `activeParticipantId` below.
//
// D1 CR#1 fix round (2026-09-28, coordinator decisions in
// [[2026-09-27 Tavern 1.0 Drive — Reviews]] "D1 — consolidated fix round"):
//   1. `refusalReason` deleted — design §4 says the refusal reuses the
//      shell's EXISTING inline slot ("not a new component"); the mount
//      wires that slot, not this one.
//   4. An inspector strip under the board shows the roving-focused (or
//      tapped — see the cell onClick handler) cell's full occupant detail,
//      replacing the old `title`-only disclosure that Tora-Gesture found
//      inert on touch (MAJOR-3).
//   8. Escape now routes through `consumeEscape` (Tora CRIT-1 = Kage
//      IMPORTANT-3) — see `src/lib/a11y/escapeConsume.ts`.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CombatParticipantState, CombatSpace, SpaceCoordinate } from '@/lib/api/types';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import { chebyshevCost, coordsEqual, isLegalMoveTarget, reachableCells } from './reach';
import { cellAccessibleName, nextFocusCoord, toDisplayRowCol, type CellOccupant } from './a11y';
import { worstCondition } from './conditions';
import { formatConditionName } from '@/lib/conditions';
import ConditionChipList from '@/components/ConditionChipList';
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

interface OccupantDescription {
  cellOccupant: CellOccupant;
  downed: boolean;
  dead: boolean;
  invisible: boolean;
  worst: string | undefined;
  otherConditionsFormatted: string | undefined;
}

/**
 * Single source of truth for "what is true about this occupant" — used both
 * per-cell in the board render loop and (D1 decision 4) by the inspector
 * strip for whichever cell is currently roving-focused. Kept as ONE
 * function (rather than two near-identical derivations) on purpose: A2's
 * IMPORTANT-2 finding on this same lane's sibling component is exactly what
 * a second copy risks.
 *
 * T2/Kage-CR D1 IMPORTANT-6(b): "invisible" is filtered out of the
 * conditions BEFORE `worstCondition` is computed — it has its own eye-badge
 * disclosure, so without this filter an invisible-only token could show
 * both the eye badge AND a redundant condition badge for the same fact.
 */
function describeOccupant(
  occupant: CombatParticipantState,
  viewerParticipantId: string | null | undefined,
): OccupantDescription {
  const downed = isDowned(occupant);
  const dead = !occupant.is_alive;
  const invisible = occupant.conditions.includes('invisible');
  const nonInvisibleConditions = occupant.conditions.filter(
    (c) => c.toLowerCase() !== 'invisible',
  );
  const worst = worstCondition(nonInvisibleConditions);
  const otherConditions = nonInvisibleConditions.map(formatConditionName);
  const otherConditionsFormatted = otherConditions.length > 0 ? otherConditions.join(', ') : undefined;
  const isSelf = occupant.participant_id === viewerParticipantId;
  return {
    downed,
    dead,
    invisible,
    worst,
    otherConditionsFormatted,
    cellOccupant: {
      name: occupant.name,
      isSelf,
      isAlly: occupant.is_pc && !isSelf,
      hostile: !occupant.is_pc,
      invisible,
      dead,
      // D1b item D: was computed above but never threaded into the
      // accessible-name input, so cellAccessibleName's downed branch (added
      // this same fold-forward) had no signal to read for a real render.
      downed,
      otherConditions,
    },
  };
}

export default function TacticalMap({
  space,
  participants,
  viewerParticipantId,
  activeParticipantId,
  moveMode,
  onMove,
  onExitMove,
  className,
}: TacticalMapProps) {
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const boardScrollRef = useRef<HTMLDivElement>(null);

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
  // Tora-Gesture MAJOR-1: `scrollIntoView` walks EVERY scrollable ancestor
  // including the page (the classic phone vertical-jump trap) — scoped
  // instead to `.boardScroll`'s own scrollLeft/scrollTop via
  // getBoundingClientRect deltas, so no ancestor outside the board ever
  // moves.
  const lastCenteredRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!space || !activeAt) return;
    if (lastCenteredRef.current === activeParticipantId) return;
    lastCenteredRef.current = activeParticipantId;
    const container = boardScrollRef.current;
    const cell = cellRefs.current.get(coordKeyStr(activeAt));
    if (!container || !cell) return;
    const containerRect = container.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const deltaX =
      cellRect.left + cellRect.width / 2 - (containerRect.left + containerRect.width / 2);
    const deltaY =
      cellRect.top + cellRect.height / 2 - (containerRect.top + containerRect.height / 2);
    container.scrollLeft += deltaX;
    container.scrollTop += deltaY;
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

  // Inspector strip (coordinator decision 4): driven by the roving focus,
  // which a click now also syncs to (see the cell onClick handler below) —
  // "tap = focus a cell" is the touch affordance Tora-Gesture's MAJOR-3
  // asked for, replacing the old title-only (hover-only, touch-inert) full
  // condition-list disclosure. `title` stays as a hover nicety only.
  const focusedOccupant = placed.find((p) => coordsEqual(p.at, focusedCoord));
  const focusedDesc = focusedOccupant
    ? describeOccupant(focusedOccupant, viewerParticipantId)
    : undefined;

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <div
        className={styles.boardScroll}
        ref={boardScrollRef}
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

                const desc = occupant ? describeOccupant(occupant, viewerParticipantId) : undefined;

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
                      occupant: desc?.cellOccupant,
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
                    onClick={() => {
                      // Tora-Gesture MAJOR-2: a click never synced
                      // `focusedCoord`, desyncing DOM focus (which a click
                      // on a tabindex-bearing div already moves natively)
                      // from the roving-tabindex model — the NEXT arrow key
                      // or Tab would then jump from the STALE cell, not the
                      // one just clicked. Unconditional (not gated on
                      // moveMode) so tapping any cell outside Move mode
                      // also drives the inspector strip below.
                      setFocusedCoord(coord);
                      attemptMove(coord);
                    }}
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
                    {occupant && desc && (
                      <span
                        className={[
                          styles.token,
                          desc.cellOccupant.isSelf && styles.tokenSelf,
                          !desc.cellOccupant.isSelf && desc.cellOccupant.isAlly && styles.tokenAlly,
                          desc.cellOccupant.hostile && styles.tokenFoe,
                          desc.dead && styles.tokenDead,
                          !desc.dead && desc.downed && styles.tokenDowned,
                          desc.invisible && styles.tokenInvisible,
                          occupant.is_active_turn && styles.tokenActive,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-hidden="true"
                        title={desc.otherConditionsFormatted}
                      >
                        {tokenInitial(occupant.name)}
                        {desc.invisible && (
                          <span className={styles.eyeBadge} aria-hidden="true">
                            ◌
                          </span>
                        )}
                        {desc.worst && (
                          <span className={styles.conditionBadge} aria-hidden="true">
                            {desc.worst.slice(0, 1).toUpperCase()}
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
      <div className={styles.inspector}>
        {focusedOccupant && focusedDesc ? (
          <>
            <span className={styles.inspectorName}>{focusedOccupant.name}</span>
            <span className={styles.inspectorTeam}>
              {focusedDesc.cellOccupant.isSelf
                ? 'You'
                : focusedDesc.cellOccupant.isAlly
                  ? 'Ally'
                  : 'Foe'}
            </span>
            {focusedDesc.dead && <span className={styles.inspectorState}>Dead</span>}
            {!focusedDesc.dead && focusedDesc.downed && (
              <span className={styles.inspectorState}>Downed</span>
            )}
            {focusedDesc.invisible && <span className={styles.inspectorState}>Invisible</span>}
            <ConditionChipList
              conditions={focusedOccupant.conditions}
              durations={focusedOccupant.condition_durations}
              combatantName={focusedOccupant.name}
            />
          </>
        ) : (
          <span className={styles.inspectorEmpty}>No creature selected.</span>
        )}
      </div>
    </div>
  );
}
