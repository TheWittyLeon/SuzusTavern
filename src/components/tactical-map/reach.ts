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
import { SPACE_KINDS, type CombatSpace, type SpaceCoordinate } from '@/lib/api/types';

function coordKey(c: SpaceCoordinate): string {
  return `${c[0]},${c[1]}`;
}

function inBounds(space: CombatSpace, at: SpaceCoordinate): boolean {
  return at[0] >= 0 && at[0] < space.width && at[1] >= 0 && at[1] < space.height;
}

/**
 * The mirror of `SquareSpace.is_valid` (engine/space.py): on the board and
 * not `blocked`. The engine's `move_legality` applies it to BOTH ends — the
 * mover's own cell (`mover_unplaced`) and the destination
 * (`invalid_destination`) — so this preview does too. Kage-CR D1
 * CRITICAL-1: an omitted `blocked` key is legal content, defended as
 * `SquareSpace._is_blocked` does (`space.get("blocked") or []`).
 */
function isValidCell(space: CombatSpace, at: SpaceCoordinate): boolean {
  if (!inBounds(space, at)) return false;
  const key = coordKey(at);
  return !(space.blocked ?? []).some((b) => coordKey(b) === key);
}

/**
 * Mirrors `engine.combat._cell_value_is_valid` (engine/combat.py) exactly:
 * `space.cell.value` must be a real, finite, positive number. Read directly
 * off engine `main` @ `3a5d18b` rather than guessed:
 *
 *   cell = space.get("cell")
 *   if not isinstance(cell, dict): return False
 *   value = cell.get("value")
 *   if isinstance(value, bool) or not isinstance(value, (int, float)): return False
 *   return math.isfinite(value) and value > 0
 *
 * Python's `bool` is an `int` subclass, so the engine excludes it
 * explicitly; JS's `typeof true === 'boolean'` (never `'number'`) makes
 * that exclusion automatic here — no separate check needed. `cell` itself
 * absent/`null`/an array all fail the `typeof … === 'object'` dict-shape
 * test the same way `isinstance(cell, dict)` does. Kage-CR B8b-2 🟡-3 /
 * B8c-2 🟢 B (2026-09-29): with no guard, 6 of 9 corrupt `cell.value`
 * shapes (`"5"`, `null`, `true`, `0`, `-5`, `[5]`) rendered as legal moves
 * the engine refuses as `no_space`.
 */
function isCellValueValid(space: CombatSpace): boolean {
  const cell = (space as { cell?: unknown }).cell;
  if (typeof cell !== 'object' || cell === null || Array.isArray(cell)) return false;
  const value = (cell as { value?: unknown }).value;
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Mirrors `move_legality` steps 1–2 (engine/combat.py, engine `main` @
 * `3a5d18b`): step 1 refuses a falsy/non-dict `space`; step 2 refuses an
 * unregistered `space.kind` (`engine.space.SPACE_KINDS` has exactly one
 * entry, `"square"`, today — `engine/space.py:217`) or a malformed
 * `cell.value`. `SpaceKind = 'square'` closes this at the TYPE level on the
 * wire, but this module's own T1 pin (B8c-2 Kage 🟢 B) is what keeps that
 * honest at RUNTIME too — a pre-validator/corrupt board, or the first
 * non-`'square'` kind landing before the type union widens to match,
 * degrades to "no legal move" here rather than rendering square geometry
 * onto a board this mirror does not understand. Both call sites below
 * check this FIRST, matching the engine's own step-1-before-step-2-before-
 * everything-else order.
 */
// Kage-CR B8c-3a CRITICAL-1 (2026-09-29, ledger item 16): exported as a TYPE
// PREDICATE and made the component's own render seam (TacticalMap.tsx), not
// just an internal helper here — a plain `space.kind !== 'square'` check at
// the component's early return let a wire-reachable `cell: null` reach the
// per-cell `chebyshevCost` call and throw `TypeError` at render, because
// that check never validated `cell` at all. This is the ONE seam now: any
// caller that gates on `isSpaceUsable` first is guaranteed a `CombatSpace`
// with a real, finite, positive `cell.value` for every subsequent read.
export function isSpaceUsable(space: CombatSpace | null | undefined): space is CombatSpace {
  if (!space || typeof space !== 'object') return false;
  // Kage-CR B8c-3a IMPORTANT-1 (ledger item 17): membership against the
  // one runtime `SPACE_KINDS` registry (types.ts), not a hand-copied
  // `!== 'square'` literal — a kind check that widens the moment the
  // engine registers a second entry, with nothing else to edit here.
  if (!(SPACE_KINDS as readonly string[]).includes((space as { kind?: unknown }).kind as string)) return false;
  return isCellValueValid(space);
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
  // move_legality steps 1-2: no board, an unregistered kind, or a malformed
  // `cell.value` -> no move is legal at all (Kage-CR B8b-2 🟡-3, B8c-2 🟢 B).
  if (!isSpaceUsable(space)) return [];
  if (movementRemaining <= 0) return [];
  // A mover on an invalid cell has no legal move at all (`mover_unplaced`).
  if (!isValidCell(space, from)) return [];
  const occupiedSet = new Set(occupied.map(coordKey));
  const fromKey = coordKey(from);
  const out: SpaceCoordinate[] = [];
  for (let x = 0; x < space.width; x++) {
    for (let y = 0; y < space.height; y++) {
      const cell: SpaceCoordinate = [x, y];
      const key = coordKey(cell);
      if (key === fromKey) continue;
      // Kage-CR B8c-2 🟢 A: destination validity through the SAME
      // `isValidCell` seam `isLegalMoveTarget` uses for both ends, instead
      // of a second hand-rolled `blockedSet` copy of the blocked-term —
      // one predicate, not two, so a future term added to `isValidCell`
      // (Kage-CR D1 CRITICAL-1's `blocked ?? []` omitted-key defense
      // included) reaches this destination check too, not just the origin
      // one three lines up.
      if (!isValidCell(space, cell)) continue;
      if (occupiedSet.has(key)) continue;
      if (chebyshevCost(space, from, cell) <= movementRemaining) out.push(cell);
    }
  }
  return out;
}

/**
 * The refusal predicate mirrored (design §4, engine `move_legality`): legal
 * iff `to` differs from `from`, both are valid cells (in bounds, not
 * blocked), `to` is not occupied, and the cost is within budget. Used by the interactive grid
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
  // move_legality steps 1-2 (see `isSpaceUsable`'s own docstring).
  if (!isSpaceUsable(space)) return false;
  const toKey = coordKey(to);
  if (toKey === coordKey(from)) return false;
  // `move_legality` steps 4-5: both ends must be valid cells, so the preview
  // never offers a move the server refuses as `mover_unplaced` or
  // `invalid_destination`.
  if (!isValidCell(space, from)) return false;
  if (!isValidCell(space, to)) return false;
  if (occupied.some((o) => coordKey(o) === toKey)) return false;
  return chebyshevCost(space, from, to) <= movementRemaining;
}

export function coordsEqual(a: SpaceCoordinate | null | undefined, b: SpaceCoordinate | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}
