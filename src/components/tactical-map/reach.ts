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
import { SPACE_KINDS, SPACE_MAX_DIM, type CombatSpace, type SpaceCoordinate } from '@/lib/api/types';

function coordKey(c: SpaceCoordinate): string {
  return `${c[0]},${c[1]}`;
}

// Found by the ledger item 19 parity fixture (Kage-CR B8c-3a 🟢 1, 2026-09-29):
// `SquareSpace.is_valid` (engine/space.py) refuses BEFORE the bounds
// comparison when `width`/`height` aren't `int` (`isinstance(width, int)`)
// -- a `5.5` or a numeric-string `"5"` width is `no_space`, not "the board
// is just very small". `at[0] < "5"` and `at[0] < 5.5` both coerce/compare
// FINE in JS with no error, so without this check the client silently
// allowed a move onto a board Python refuses outright (10/1,944 parity
// cases, both non-int dims values, all 5 otherwise-valid cell.values).
//
// The `Number.isInteger(width)/(height)` guard that used to live here is
// now `isDimsValid`'s job, one call above every path that reaches this
// function (Kage-CR B8c-3b IMPORTANT-4 / Miko-QA, ledger item 22,
// 2026-09-29 -- see `isDimsValid`'s own docstring for the full history).
// `inBounds` is private and reachable ONLY through `isValidCell`, itself
// reachable ONLY from `reachableCells`/`isLegalMoveTarget`, both of which
// check `isSpaceUsable` -- which now calls `isDimsValid` -- FIRST and
// return before ever calling `isValidCell` on a space with bad dims. A
// second `Number.isInteger` check here would be permanently unreachable
// dead code, not defense-in-depth: removed, not duplicated, per the
// "single seam" pattern the last four ledger items (11, 16, 17, 19) all
// converged on.
function inBounds(space: CombatSpace, at: SpaceCoordinate): boolean {
  const { width, height } = space;
  return at[0] >= 0 && at[0] < width && at[1] >= 0 && at[1] < height;
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
 * that exclusion automatic here — no separate check needed. THREE
 * different clauses guard `cell` itself, not one shared `typeof` test as
 * an earlier version of this comment claimed (Kage-CR B8c-3a 🟢 3,
 * 2026-09-29, measured): `typeof cell !== 'object'` catches only an
 * ABSENT `cell` (`typeof undefined === 'undefined'`) — `typeof null` and
 * `typeof [5]` both evaluate to `'object'` and pass that test fine, so
 * `null` is caught by the separate `cell === null` clause and an array by
 * `Array.isArray(cell)`. The latter is behaviourally DEAD today (🟢 4:
 * deleting it is 1205/1205 green — an array has no `.value` property, so
 * it is refused one line later regardless) — kept for mirror-legibility,
 * as the faithful counterpart to `isinstance(cell, dict)`, not because it
 * changes any outcome. Kage-CR B8b-2 🟡-3 / B8c-2 🟢 B (2026-09-29): with
 * no guard at all, 6 of 9 corrupt `cell.value` shapes (`"5"`, `null`,
 * `true`, `0`, `-5`, `[5]`) rendered as legal moves the engine refuses as
 * `no_space`.
 */
function isCellValueValid(space: CombatSpace): boolean {
  const cell = (space as { cell?: unknown }).cell;
  if (typeof cell !== 'object' || cell === null || Array.isArray(cell)) return false;
  const value = (cell as { value?: unknown }).value;
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** A coordinate the engine would write: a pair of integers. */
function isCoordPair(c: unknown): boolean {
  return Array.isArray(c) && c.length === 2 && Number.isInteger(c[0]) && Number.isInteger(c[1]);
}

/**
 * `blocked` and `features` are legal to OMIT (the engine reads `space.get("blocked") or []`, Kage-CR D1 CRITICAL-1: `undefined` and `null` are an empty list), but PRESENT they must be what
 * the render reads them as: `blocked` an array of integer pairs, `features` an array of objects with a string `label` and an `at` that is an array of integer pairs. A board whose lists are not
 * (`{}`, `"x"`, `5`, `[null]`, `[{}]`, `[{ at: null }]`, `[{ at: "x" }]`) used to reach the render's `.some`/`.find` and take the whole `/play` page down ("Something went wrong") in both
 * engines (B8c-3 run 2, Miko MF1); it is now "no usable board" at the same seam as a bad `cell` or bad dimensions, and the stage shows the band.
 */
function isListsValid(space: CombatSpace): boolean {
  const { blocked, features } = space as { blocked?: unknown; features?: unknown };
  if (blocked != null && !(Array.isArray(blocked) && blocked.every(isCoordPair))) return false;
  if (features == null) return true;
  return (
    Array.isArray(features) &&
    features.every((f) => {
      if (typeof f !== 'object' || f === null || Array.isArray(f)) return false;
      const { at, label } = f as { at?: unknown; label?: unknown };
      return typeof label === 'string' && Array.isArray(at) && at.every(isCoordPair);
    })
  );
}

/**
 * `width`/`height` must be a real, positive integer — mirrors the
 * STRICTER of the engine's two width/height checks, not
 * `SquareSpace._in_bounds`'s (engine/space.py @ `3a5d18b`): `_in_bounds`
 * only asserts `isinstance(width, int)` per coordinate check and never
 * asserts positivity at all (a non-positive width simply makes every `x`
 * fail `0 <= x < width`, so the board silently has no valid cells rather
 * than being flagged invalid). The content-authoring gate every board
 * must already clear before it can reach a client,
 * `adventure_validator._validate_space` (engine/adventure_validator.py:
 * 246-251 @ `3a5d18b`), is the stricter, explicit one this mirror follows:
 *
 *   if isinstance(width, bool) or not isinstance(width, int) or width < 1:
 *       raise _err(...)
 *
 * (same clause repeated for `height`). Found by Miko-QA (B8c-3b) and
 * Kage-CR IMPORTANT-4 independently, from opposite directions (ledger item
 * 22, 2026-09-29): with no dims check in `isSpaceUsable`, a malformed
 * board fell through the render seam to a THIRD, untested degrade shape —
 * `-3`/`0`/`NaN` rendered an empty `role="grid"` shell
 * (`Array.from({length: <clamped-to-0>})`), a numeric-string `"5"` or a
 * float `5.5` rendered a full, wrong grid — `inBounds` used to carry its
 * own `Number.isInteger(width)/(height)` check back then, which refused
 * every cell inside it, but the grid FRAME itself (`TacticalMap.tsx`'s
 * `Array.from({ length: space.width/height }, …)`) never consulted
 * `inBounds` and drew regardless. That per-cell copy is now redundant and
 * removed — see `inBounds`'s own comment for why — since this function
 * refuses the whole board before the render layer ever loops.
 *
 * `Number.isInteger` already excludes `boolean` the same way
 * `isCellValueValid`'s `typeof` check does above (`typeof true ===
 * 'boolean'`, never `'number'`, so `Number.isInteger(true)` is `false`
 * with no separate check needed) — the validator's explicit
 * `isinstance(width, bool)` clause exists only because Python's `bool` IS
 * an `int` subclass (`isinstance(True, int)` is `True`); JS has no such
 * subtyping, so this is a case where the mirror needs FEWER lines than the
 * source to stay exact, not more.
 *
 * `5.0` (Kage-CR IMPORTANT-4, re-verified here): unrepresentable as a
 * distinct value in JS. Python's validator/`_in_bounds` both refuse it
 * (`isinstance(5.0, int)` is `False` — a JSON float literal), but
 * `JSON.parse("5.0") === 5` and `Number.isInteger(5)` is `true`, so a wire
 * payload containing the literal text `5.0` is indistinguishable from `5`
 * by the time this function ever sees it. This one shape stays
 * (documented, not silently) fail-open — no JS-side check can close it,
 * because there is no JS value left to check against.
 *
 * UPPER bound (B8c-3c ledger row 26, Kage-CR IMPORTANT-2 / Miko-QA,
 * 2026-09-29 — closed engine-side by B8e, `engine/space.py::SPACE_MAX_DIM`,
 * NekoNova-DnDEngine `main` @ `8eaf152`): before this clause,
 * `Number.isInteger(1e21)` is `true` for ANY whole-valued double regardless
 * of magnitude, so a huge `width`/`height` made this function — and
 * therefore `isSpaceUsable` — return `true`. `reachableCells`'s nested
 * `for (x < width) for (y < height)` loop has no `Array.from`-style length
 * ceiling to throw fast on; it is a plain scalar-bound loop that must run
 * `width × height` times, and it runs synchronously inside `TacticalMap`'s
 * render-body `useMemo` — so a board with no legal cells at all (a board
 * this large is never authored content) hung the render instead of
 * degrading like every other malformed-dims shape. `width <=
 * SPACE_MAX_DIM && height <= SPACE_MAX_DIM` mirrors the engine's own
 * `_dim_in_range` bound exactly (`1 <= dim <= SPACE_MAX_DIM`, both axes) —
 * see `SPACE_MAX_DIM`'s own doc comment (types.ts) for the constant and
 * its `debt:` marker. `100` itself stays legal (the engine's own boundary
 * test asserts the ceiling value is accepted, not refused).
 */
function isDimsValid(space: CombatSpace): boolean {
  const { width, height } = space;
  return (
    Number.isInteger(width) &&
    width > 0 &&
    width <= SPACE_MAX_DIM &&
    Number.isInteger(height) &&
    height > 0 &&
    height <= SPACE_MAX_DIM
  );
}

/**
 * Mirrors `move_legality` steps 1–2 (engine/combat.py, engine `main` @
 * `3a5d18b`): step 1 refuses a falsy/non-dict `space`; step 2 refuses an
 * unregistered `space.kind` (`engine.space.SPACE_KINDS`, currently exactly
 * one entry — `engine/space.py::SPACE_KINDS`) or a malformed `cell.value`.
 * `SpaceKind` (types.ts, now DERIVED from this client's own `SPACE_KINDS`
 * registry rather than a second hand copy — Kage-CR B8c-3a IMPORTANT-1,
 * ledger item 17) closes this at the TYPE level on the wire, but this
 * function is what keeps that honest at RUNTIME too.
 *
 * PLUS `isDimsValid` (ledger item 22, 2026-09-29) — a check with no
 * matching step number above, added deliberately: `move_legality` itself
 * only discovers bad dims later, at steps 4/5 (`mover_unplaced` /
 * `invalid_destination`, via `SquareSpace.is_valid`), never here. But a
 * board with invalid dims has ZERO legally occupiable cells for ANY
 * coordinate — there is nothing a grid could legally render regardless of
 * which reason code a real move attempt would eventually get back from the
 * server, so this predicate refuses it at the same seam as every other
 * "there is no usable board" case rather than letting the render layer
 * draw geometry over it first. See `isDimsValid`'s own docstring for the
 * full finding.
 *
 * A pre-validator/corrupt board, or the first non-`'square'` kind landing
 * before the type union widens to match, degrades to "no legal move"
 * wherever a caller checks this predicate FIRST, rather than rendering
 * square geometry onto a board this mirror does not understand —
 * `reachableCells`/`isLegalMoveTarget` below always did. `TacticalMap.tsx`'s
 * own render guard did NOT, until it started calling this SAME function
 * (Kage-CR B8c-3a CRITICAL-1, ledger item 16, 2026-09-29): before that fix
 * this claim was true of this module in isolation but FALSE of the mounted
 * component, which used a separate, `cell`-blind `kind !== 'square'` check
 * and rendered a full, wrong grid (or threw, for `cell: null`) instead.
 */
// Exported as a TYPE PREDICATE (Kage-CR B8c-3a CRITICAL-1, ledger item 16)
// so `TacticalMap.tsx` can use it as its OWN render seam, guaranteeing a
// `CombatSpace` with a real, finite, positive `cell.value` AND real,
// positive integer `width`/`height` for every subsequent read — see the
// docstring above for what "usable" means and why that guarantee used to
// not hold for the mounted component.
export function isSpaceUsable(space: CombatSpace | null | undefined): space is CombatSpace {
  if (!space || typeof space !== 'object') return false;
  // Kage-CR B8c-3a IMPORTANT-1 (ledger item 17): membership against the
  // one runtime `SPACE_KINDS` registry (types.ts), not a hand-copied
  // `!== 'square'` literal — a kind check that widens the moment the
  // engine registers a second entry, with nothing else to edit here.
  if (!(SPACE_KINDS as readonly string[]).includes((space as { kind?: unknown }).kind as string)) return false;
  // Ledger item 22 (2026-09-29): malformed width/height used to fall
  // through this seam entirely and reach the render layer, which drew
  // either an empty grid shell or a full, wrong grid instead of degrading
  // to `TheatreOfMindBand` — see `isDimsValid`'s docstring.
  if (!isDimsValid(space)) return false;
  if (!isCellValueValid(space)) return false;
  return isListsValid(space);
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
