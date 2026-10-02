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
  /** Whether this occupant currently blocks movement onto their own cell —
   *  computed ONCE in `TacticalMap.tsx`'s `describeOccupant`
   *  (`occupiesWhenAlive(occupant) || (isSelf && isActiveMover)`), never
   *  re-derived here from `dead` (Kage-CR B8c-1 IMPORTANT-3, 2026-09-28):
   *  before this field existed, the self-narration branch below assumed
   *  "your own cell is always Current position" unconditionally, which
   *  stopped being true the moment a dead, non-active viewer's square
   *  became a legal move target for someone else (B8a IMP-5) — the
   *  self-branch now reads THIS fact instead of hardcoding the assumption,
   *  and the other-occupant branch reads it instead of re-deciding
   *  membership from `dead` independently. */
  occupiesCell: boolean;
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
  /** The label of a feature on this square (`space.features[].label`), if any. Free text from the encounter's content: read and shown, never interpreted. It joins the
   *  name here and the scene line (`buildLine`) from the SAME input, B8c-3 (before: a hover `title` only, inert to keyboard and touch). */
  featureLabel?: string;
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
  const location = `Row ${input.row1}, column ${input.col1}.${input.featureLabel ? ` Feature: ${input.featureLabel}.` : ''}`;

  const others = input.occupant?.otherConditions ?? [];
  const conditionsSuffix = others.length > 0 ? ` Conditions: ${others.join(', ')}.` : '';

  if (input.occupant?.isSelf) {
    // Kage-CR B8c-1 IMPORTANT-3 (2026-09-28, fix-round-2): "your own cell
    // is always Current position" was true only because, before B8a's
    // dead-don't-occupy fix, EVERY placed participant (dead or alive)
    // occupied their own square. Now that a dead, non-active viewer's
    // square can be a legal destination for someone else's move, this
    // reads `occupiesCell` — the SAME fact the other-occupant branch below
    // uses — instead of assuming "Current position." unconditionally. A
    // self cell where the viewer IS the active mover always stays
    // "Current position." regardless (occupiesCell's isSelf-&&-
    // isActiveMover carve-out, see TacticalMap.tsx's describeOccupant) —
    // the mover's own square is never a target for their own move.
    // downed/dead use the same ", <state>" phrasing as the other-occupant
    // branch below (D1b Kage-CR IMPORTANT-2): the red ring
    // .tokenDowned/.tokenDead disclose visually applies to your own PC
    // too, and isDowned/isDead are independent of `otherConditions`
    // (isDowned = hp_current === 0 && is_alive carries no `conditions`
    // entry), so nothing else in this string would otherwise carry the
    // fact.
    const downed = input.occupant.downed ? ', downed' : '';
    const dead = input.occupant.dead ? ', dead' : '';
    if (!input.occupant.occupiesCell) {
      return `${location} ${input.occupant.name} — you${downed}${dead}.${reachPhrase(input)}${conditionsSuffix}`;
    }
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
    const occupantPart = `${location} ${input.occupant.name}, ${relation}${invisible}${downed}${dead}.`;
    // Branches on `occupiesCell` (Kage-CR B8c-1 IMPORTANT-3) — the SAME
    // fact TacticalMap.tsx's `occupiedByOthers`/`reachableCells` use to
    // decide legality — rather than re-deciding membership from `dead`
    // independently. The dead do not occupy a cell (engine
    // `SquareSpace.occupied_by`, living participants only; B8a IMP-5), so
    // a corpse's cell is a legal destination and reads with the same
    // reach phrasing as an empty one. A downed-but-alive occupant still
    // blocks.
    if (!input.occupant.occupiesCell) {
      return `${occupantPart}${reachPhrase(input)}${conditionsSuffix}`;
    }
    return `${occupantPart} Occupied — can't stop here.${conditionsSuffix}`;
  }

  return `${location} Empty.${reachPhrase(input)}`;
}

/** The move-targeting suffix for a cell a mover may stand on: empty
 *  (design §5's "Empty." has no range language outside Move targeting)
 *  when Move is not engaged. */
function reachPhrase(input: CellNameInput): string {
  if (!input.moveModeActive) return '';
  return input.inRange ? ` In range — costs ${input.costFt} feet.` : ' Out of range.';
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

// ── the scene line (B8c-3, Sora's mount brief 2.2; Iro-A11y's ruling 1: the line is plain readable text) ────────────────────────────────────────────────────────────────────────
//
// The map tells its mount what to say about the square the user chose; the mount writes it in the scene line, next to the status node. Two renderings of ONE set of facts: the
// cell's accessible name (`cellAccessibleName`, for a user who is on the square) and the line (`buildLine`, for one who is not: a browse or swipe user, a touch user whose tap
// moved no focus). Both read the same `CellNameInput`, so a fact cannot be in one and not the other (unit test: inspectLine.test.ts).

/** What the map reports to `onInspect`. `null` means there is nothing to say beyond the stage's own rest line. */
export type InspectLine =
  /** At rest, the creature whose turn it is has a budget. */
  | { kind: 'turn'; name: string; feetLeft: number }
  /** The chosen square holds a creature or a feature. */
  | { kind: 'cell'; input: CellNameInput }
  /** A move is being chosen: the square under the pointer, else the focused one. `costFt` / `budgetFt` are for a legal square. */
  | { kind: 'target'; input: CellNameInput; legal: boolean; costFt?: number; budgetFt?: number };

/** A creature's side, as the line says it (the cell name says `you` / `ally` / `hostile`). */
function sideWord(o: CellOccupant): string {
  return o.isSelf ? 'You' : o.isAlly ? 'Ally' : 'Foe';
}

/**
 * The text of the scene line, from the map's payload. Pure. `line === null` is the rest line the stage shows when the map has nothing to add. `round` is the combat round (null when
 * unknown).
 *
 *   rest      "In combat · round 2"
 *   turn      "In combat · round 2 · Kestrel Ashwood: 30 ft left"
 *   creature  "Goblin Skulker · Foe · Invisible · Poisoned, Prone" (a downed or dead one says so before "Invisible")
 *   feature   "Stalagmites"
 *   empty     the cell's own accessible name, "Row 1, column 3. Empty." (the map reports an empty square only while the grid holds KEYBOARD focus on it)
 *   target    legal: "Move to row 6, column 10 · 15 ft of 30"; not legal: the cell's own name (the square and why, in its own words)
 */
export function buildLine(line: InspectLine | null, { round }: { round: number | null }): string {
  const rest = round == null ? 'In combat' : `In combat · round ${round}`;
  if (!line) return rest;
  if (line.kind === 'turn') return `${rest} · ${line.name}: ${line.feetLeft} ft left`;
  if (line.kind === 'target') {
    if (!line.legal) return cellAccessibleName(line.input);
    return `Move to row ${line.input.row1}, column ${line.input.col1} · ${line.costFt} ft of ${line.budgetFt}`;
  }
  const o = line.input.occupant;
  if (!o) return line.input.featureLabel ?? cellAccessibleName(line.input); // an empty square the keyboard is on: the cell's OWN name
  const parts = [o.name, sideWord(o)];
  if (o.dead) parts.push('Dead');
  else if (o.downed) parts.push('Downed');
  if (o.invisible) parts.push('Invisible');
  if (o.otherConditions && o.otherConditions.length > 0) parts.push(o.otherConditions.join(', '));
  if (line.input.featureLabel) parts.push(line.input.featureLabel);
  return parts.join(' · ');
}
