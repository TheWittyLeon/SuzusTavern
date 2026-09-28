// src/components/tactical-map/reach.ts
//
// Pure, presentation-free helpers for the tactical map's move-range PREVIEW.
//
// Authority: `NekoNova-DnDEngine/engine/space.py::SquareSpace.cost` — this is
// a client-side MIRROR of that exact formula (Chebyshev distance × the
// board's `cell.value`, denominated in `cell.unit` — ft-only in 1.0, per the
// movement design's §2.2/§4.3 and Kage-CR's B1+B2 IMPORTANT-1 fix that made
// the engine's own docstring match its code). It is a PREVIEW only — the
// tactical-map design (Aoi-UI, §4) is explicit that the server's `/move`
// response is the sole authority on disagreement (a stale budget after a
// concurrent action). This module never calls the engine and never claims to
// be authoritative.
//
// Straight-line only, matching the one shipped adapter (`SquareSpace.cost`'s
// own marker: "debt: cost() is straight-line, not a path around `blocked`
// cells") — this mirror inherits that same limitation deliberately, not by
// oversight.
import type { CombatSpace, SpaceCoordinate } from '@/lib/api/types';

function coordKey(c: SpaceCoordinate): string {
  return `${c[0]},${c[1]}`;
}

function inBounds(space: CombatSpace, at: SpaceCoordinate): boolean {
  return at[0] >= 0 && at[0] < space.width && at[1] >= 0 && at[1] < space.height;
}

/**
 * Chebyshev distance between `from` and `to`, scaled by `space.cell.value` —
 * the exact mirror of `SquareSpace.cost` (engine/space.py). Returns the cost
 * in `space.cell.unit` (ft-only in 1.0). Does not check bounds/blocked/
 * occupancy — callers that need the full legality predicate use
 * `reachableCells` or `isLegalMoveTarget` below.
 */
export function chebyshevCost(
  space: Pick<CombatSpace, 'cell'>,
  from: SpaceCoordinate,
  to: SpaceCoordinate,
): number {
  const dx = Math.abs(to[0] - from[0]);
  const dy = Math.abs(to[1] - from[1]);
  return Math.max(dx, dy) * space.cell.value;
}

/**
 * Every cell reachable from `from` within `movementRemaining`, excluding
 * `space.blocked` (authoritative content) and any cell in `occupied`
 * (typically every OTHER participant's `at` — a participant's own current
 * cell is excluded separately below, since it is never a legal move target).
 * Design §4: "excluding `space.blocked` and any occupied cell … bounded by
 * `movement_remaining`."
 */
export function reachableCells(
  space: CombatSpace,
  from: SpaceCoordinate,
  movementRemaining: number,
  occupied: SpaceCoordinate[],
): SpaceCoordinate[] {
  if (movementRemaining <= 0) return [];
  const blockedSet = new Set(space.blocked.map(coordKey));
  const occupiedSet = new Set(occupied.map(coordKey));
  const fromKey = coordKey(from);
  const out: SpaceCoordinate[] = [];
  for (let x = 0; x < space.width; x++) {
    for (let y = 0; y < space.height; y++) {
      const cell: SpaceCoordinate = [x, y];
      const key = coordKey(cell);
      if (key === fromKey) continue;
      if (blockedSet.has(key)) continue;
      if (occupiedSet.has(key)) continue;
      if (chebyshevCost(space, from, cell) <= movementRemaining) out.push(cell);
    }
  }
  return out;
}

/**
 * The refusal predicate mirrored (design §4): legal iff `to` is in bounds,
 * not blocked, not occupied, and within budget. Used by the interactive grid
 * layer to decide whether Enter/Space/click on a cell calls `onMove` — never
 * used to claim the server will agree (see module header).
 */
export function isLegalMoveTarget(
  space: CombatSpace,
  from: SpaceCoordinate,
  to: SpaceCoordinate,
  movementRemaining: number,
  occupied: SpaceCoordinate[],
): boolean {
  if (!inBounds(space, to)) return false;
  const toKey = coordKey(to);
  if (toKey === coordKey(from)) return false;
  if (space.blocked.some((b) => coordKey(b) === toKey)) return false;
  if (occupied.some((o) => coordKey(o) === toKey)) return false;
  return chebyshevCost(space, from, to) <= movementRemaining;
}

export function coordsEqual(a: SpaceCoordinate | null | undefined, b: SpaceCoordinate | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}
