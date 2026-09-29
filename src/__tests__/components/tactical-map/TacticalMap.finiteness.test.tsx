/**
 * TacticalMap — the finiteness half of the `cell.value` mirror, pinned at
 * the COMPONENT layer (Kage-CR B8c-3a IMPORTANT-2, ledger item 18).
 *
 * `reach.ts`'s own `isCellValueValid` mirrors the engine's
 * `math.isfinite(value) and value > 0` clause with
 * `Number.isFinite(value) && value > 0`. `reach.test.ts`'s own
 * `invalidCellValues` table already exercises `cell.value` = `{}` / `NaN` /
 * `Infinity` through `reachableCells`/`isLegalMoveTarget`, but Kage-CR
 * measured (M4: delete `Number.isFinite(value)` from `isCellValueValid`,
 * suite 1205/1205 still green) that those three rows stay green with or
 * without the finiteness check:
 *   - `{}`  fails `typeof value === 'number'` regardless (never reaches
 *     the finiteness clause).
 *   - `NaN` fails the `value > 0` clause that follows it (`NaN > 0` is
 *     `false`) regardless of `Number.isFinite`.
 *   - `Infinity` passes `typeof`/`value > 0` either way, but every existing
 *     caller (`reachableCells`, `isLegalMoveTarget`) ALSO checks
 *     `cost <= movementRemaining`, and `Infinity <= <any finite budget>` is
 *     always `false` — so it is refused downstream regardless of the
 *     guard.
 *
 * So through reach.ts's public API, `Number.isFinite` is genuinely
 * unobservable — it can be deleted with nothing going red there. It
 * becomes observable ONLY at the component layer, once ledger item 16 made
 * `isSpaceUsable` (which calls `isCellValueValid`) the component's one
 * render seam: an `Infinity` `cell.value` that slipped past a missing
 * `Number.isFinite` check would make `isSpaceUsable` return `true`, so the
 * component would render the REAL grid (`role="grid"` present) instead of
 * degrading to the theatre-of-mind band — even though every cell would
 * still read "Out of range" (the eager `cost <= budget` check inside
 * `reachableCells` still refuses an `Infinity` cost against any finite
 * budget). `grid` PRESENCE, not cell membership, is the only place this
 * clause's absence is visible — "one test closes both" (Kage-CR).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TacticalMap, { type TacticalMapProps } from '@/components/tactical-map/TacticalMap';
import type { CombatParticipantState, CombatSpace } from '@/lib/api/types';

// Local, self-contained fixtures — matching this repo's own convention
// (reach.test.ts, TacticalMap.test.tsx, TacticalMap.spaceUsability.test.tsx
// each define their own copy rather than import across test files).
function makeParticipant(overrides: Partial<CombatParticipantState> = {}): CombatParticipantState {
  return {
    participant_id: 'p1',
    entity_id: 'char-1',
    name: 'Bren',
    is_pc: true,
    initiative: 15,
    hp_current: 20,
    hp_max: 20,
    ac: 15,
    conditions: [],
    is_alive: true,
    can_be_targeted: true,
    is_active_turn: true,
    took_turn: false,
    at: [0, 0],
    movement_remaining: 30,
    ...overrides,
  };
}

function baseProps(overrides: Partial<TacticalMapProps> = {}): TacticalMapProps {
  return {
    space: null,
    participants: [makeParticipant()],
    viewerParticipantId: 'p1',
    activeParticipantId: 'p1',
    moveMode: true,
    onMove: jest.fn(),
    onExitMove: jest.fn(),
    ...overrides,
  };
}

// Matches reach.test.ts's own `invalidCellValues` naming for these three
// rows exactly ('an empty object', NaN, Infinity) — same values, now
// exercised through a full TacticalMap render instead of a direct
// reachableCells/isLegalMoveTarget call.
const FINITENESS_CASES: Array<[string, unknown]> = [
  ['cell.value: {} (an empty object)', {}],
  ['cell.value: NaN', Number.NaN],
  ['cell.value: Infinity', Number.POSITIVE_INFINITY],
];

describe('TacticalMap — cell.value finiteness, pinned here because reach.ts cannot see it (Kage-CR B8c-3a IMPORTANT-2, ledger item 18)', () => {
  it.each(FINITENESS_CASES)('%s -> degrades to no board, never the real grid', (_label, value) => {
    const space = {
      kind: 'square',
      width: 3,
      height: 3,
      blocked: [],
      features: [],
      cell: { value, unit: 'ft' },
    };
    const onMove = jest.fn();
    render(<TacticalMap {...baseProps({ space: space as unknown as CombatSpace, onMove })} />);

    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(onMove).not.toHaveBeenCalled();
  });
});
