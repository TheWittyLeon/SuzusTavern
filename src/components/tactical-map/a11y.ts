// src/components/tactical-map/a11y.ts
//
// Pure helpers for the grid's accessible names and roving-tabindex keyboard
// math. Coordinate convention (movement design §2.1/§5, Aoi-UI design §5):
// engine `at` is 0-indexed, origin top-left, x -> column (right), y -> row
// (down). Announced row/column are 1-indexed for the screen-reader-
// conventional read — a DISPLAY-ONLY translation, never round-tripped to the
// wire (this module never writes to `SpaceCoordinate`, only reads).
import type { SpaceCoordinate } from '@/lib/api/types';

export interface CellOccupant {
  name: string;
  /** The viewer's own participant. */
  isSelf: boolean;
  /** PC and not the viewer (a teammate). Mutually exclusive with isSelf and
   *  hostile — a cell's occupant is exactly one of the three. */
  isAlly: boolean;
  /** Not a PC (a monster). */
  hostile: boolean;
  invisible: boolean;
  /** `!is_alive` — a corpse, not a threat (Kage-CR D1 IMPORTANT-8's "the
   *  board shows corpses as threats" applies to screen-reader users too, not
   *  just the visual grayscale treatment — see TacticalMap.module.css's
   *  `.tokenDead`). Mutually exclusive with `downed` by construction
   *  (`downed` requires `is_alive`). */
  dead: boolean;
  /** `hp_current === 0 && is_alive` — the same fact `.tokenDowned`'s
   *  faded/dashed/red-ring treatment (design §5) discloses visually (D1b
   *  item D, Kage-CR re-verify): before this a downed ally read identically
   *  to a healthy one to a screen-reader user, the same visual/AT gap the
   *  `dead` field already closed for corpses. Mutually exclusive with
   *  `dead`. */
  downed: boolean;
  /** T2 (Leon's ruling): active conditions OTHER than "invisible" (which
   *  already has its own bespoke disclosure above) — the "full list" half
   *  of "worst condition badge only, full list on focus/tap". Exposed here
   *  so a screen-reader user gets the full list for free on cell focus
   *  (the visual token's own worst-only badge is the "tap" half — see
   *  TacticalMap.tsx's `title` attribute on the token span). Empty when the
   *  occupant has no other conditions, in which case the base sentence is
   *  unchanged (keeps the design table's simple examples verbatim). */
  otherConditions?: string[];
}

export interface CellNameInput {
  /** 1-indexed row (from `at[1]`, y -> down). */
  row1: number;
  /** 1-indexed column (from `at[0]`, x -> right). */
  col1: number;
  occupant?: CellOccupant;
  blocked: boolean;
  /** True while the viewer is in Move targeting and this cell is within
   *  `movement_remaining` (design §4's mirrored predicate) — meaningless
   *  (ignored) when `moveModeActive` is false. */
  inRange?: boolean;
  /** Chebyshev-mirrored cost to this cell, in `space.cell.unit` — only read
   *  when `inRange` is true. */
  costFt?: number;
  /** Whether the interactive Move-targeting layer is engaged at all (design
   *  §5: "Empty." with no range language when nobody is targeting a move). */
  moveModeActive: boolean;
}

/**
 * Builds a cell's accessible name per the Aoi-UI design's §5 table / mockup
 * demo table. Two deliberate departures from those tables' exact example
 * strings, both noted so a reviewer isn't left guessing whether they were
 * missed:
 *
 * 1. The design's own worked example names a per-cell obstacle flavor
 *    ("Blocked by rubble") that the `space` SCHEMA does not carry (movement
 *    design §2.1: `blocked` is a bare coordinate list, no per-cell label or
 *    reason). That string is illustrative to ONE example encounter, not
 *    general renderer behaviour — hardcoding "rubble" would be exactly the
 *    content-literal-in-a-generic-renderer failure the movement design's own
 *    `terrain` sections warn about (design-durability.md's red-flag table).
 *    This renderer says "Blocked." instead — honest for every board, not
 *    just the mockup's.
 * 2. The design's table gives an ally-occupied cell "Occupied — can't stop
 *    here." but its invisible-foe example ends at "Occupied." with no
 *    suffix. That fact is identical for both (any occupied cell is not a
 *    legal destination), so this renderer uses the fuller phrasing
 *    uniformly rather than reproducing what reads as an incidental
 *    truncation in one illustrative row.
 */
export function cellAccessibleName(input: CellNameInput): string {
  const location = `Row ${input.row1}, column ${input.col1}.`;

  const others = input.occupant?.otherConditions ?? [];
  const conditionsSuffix = others.length > 0 ? ` Conditions: ${others.join(', ')}.` : '';

  if (input.occupant?.isSelf) {
    // The viewer's own token's cell is always "current position" for them —
    // true whether or not Move is currently engaged. downed/dead use the
    // same ", <state>" phrasing as the other-occupant branch below (D1b
    // Kage-CR IMPORTANT-2): the red ring .tokenDowned/.tokenDead disclose
    // visually applies to your own PC too, and isDowned/isDead are
    // independent of `otherConditions` (isDowned = hp_current === 0 &&
    // is_alive carries no `conditions` entry), so nothing else in this
    // string would otherwise carry the fact.
    const downed = input.occupant.downed ? ', downed' : '';
    const dead = input.occupant.dead ? ', dead' : '';
    return `${location} ${input.occupant.name} — you${downed}${dead}. Current position.${conditionsSuffix}`;
  }

  if (input.blocked) {
    return `${location} Blocked. Not reachable.`;
  }

  if (input.occupant) {
    const relation = input.occupant.isAlly ? 'ally' : 'hostile';
    const invisible = input.occupant.invisible ? ', invisible' : '';
    const downed = input.occupant.downed ? ', downed' : '';
    const dead = input.occupant.dead ? ', dead' : '';
    return `${location} ${input.occupant.name}, ${relation}${invisible}${downed}${dead}. Occupied — can't stop here.${conditionsSuffix}`;
  }

  if (input.moveModeActive) {
    return input.inRange
      ? `${location} Empty. In range — costs ${input.costFt} feet.`
      : `${location} Empty. Out of range.`;
  }

  return `${location} Empty.`;
}

/** `at` -> 1-indexed {row, col} for the accessible-name/announcement layer. */
export function toDisplayRowCol(at: SpaceCoordinate): { row1: number; col1: number } {
  return { row1: at[1] + 1, col1: at[0] + 1 };
}

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

function isArrowKey(key: string): key is ArrowKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
}

/**
 * Roving-tabindex 2D grid navigation (the standard accessible board-game
 * pattern, Aoi-UI design §5). Clamps at the board edges rather than
 * wrapping — arriving at row/column 1 or the max and pressing further in
 * that direction is a no-op, same convention as `LevelChoicePicker`'s 1D
 * `radioStepIndex` roving helper (this grid needs 2 axes, so it is not a
 * reuse of that helper, only the same clamping idiom).
 */
export function nextFocusCoord(
  key: string,
  current: SpaceCoordinate,
  width: number,
  height: number,
): SpaceCoordinate | null {
  if (!isArrowKey(key)) return null;
  const [x, y] = current;
  switch (key) {
    case 'ArrowLeft':
      return x > 0 ? [x - 1, y] : null;
    case 'ArrowRight':
      return x < width - 1 ? [x + 1, y] : null;
    case 'ArrowUp':
      return y > 0 ? [x, y - 1] : null;
    case 'ArrowDown':
      return y < height - 1 ? [x, y + 1] : null;
    default:
      return null;
  }
}
