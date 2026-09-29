/**
 * TacticalMap — width/height render-seam validity (Miko-QA B8c-3b + Kage-CR
 * B8c-3b IMPORTANT-4, ledger item 22:
 * [[2026-09-27 Tavern 1.0 Drive — Reviews]]).
 *
 * `isSpaceUsable` (reach.ts) used to check only `kind` and `cell.value` --
 * never `width`/`height` -- so a malformed board fell through the render
 * seam (`TacticalMap.tsx:401`, established by ledger item 16) and reached
 * `TacticalMap.tsx`'s grid-frame render (`Array.from({ length: space.width
 * /height }, …)`) directly. Measured (Kage-CR IMPORTANT-4) at the FULL
 * render layer, with a valid `cell.value`, only dims varied:
 *
 *   -3 / 0 / NaN  -> role="grid" present, 0 gridcells (an empty shell --
 *                    `Array.from({length: <clamped-to-0>})`)
 *   "5" / 5.5     -> role="grid" present, 25 gridcells (a full, WRONG grid
 *                    -- `inBounds`'s per-cell `Number.isInteger` check used
 *                    to refuse every cell inside it, but nothing stopped
 *                    the grid FRAME itself from drawing)
 *
 * Neither degraded to `TheatreOfMindBand`, the fallback every OTHER
 * malformed-space shape (a bad `kind`, a bad `cell.value` -- see
 * TacticalMap.spaceUsability.test.tsx / TacticalMap.finiteness.test.tsx)
 * already got. Fix: fold the engine's int/positive width/height rule into
 * `isSpaceUsable` itself (see reach.ts's `isDimsValid`), so every malformed
 * dims shape takes the SAME degrade path as every other unusable board.
 *
 * Mutation proof (manual, recorded here -- not re-run by this file itself):
 * deleting `isDimsValid`'s call from `isSpaceUsable` (or gutting
 * `isDimsValid` to `return true`) reds every row below except the `5.0` and
 * positive-control rows.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TacticalMap, { type TacticalMapProps } from '@/components/tactical-map/TacticalMap';
import type { CombatParticipantState, CombatSpace } from '@/lib/api/types';

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

// Kage-CR B8c-3b IMPORTANT-4's own render matrix, minus `true` (cleared --
// a 1x1-equivalent board with no legal move target either way, not a
// divergence -- see reach.test.ts's `isSpaceUsable` dims describe block)
// and minus `5.0` (handled separately below -- it renders the REAL grid,
// not the degrade path, and that is the correct, documented behaviour).
const MALFORMED_DIMS: Array<[string, unknown]> = [
  ['negative (-3)', -3],
  ['zero', 0],
  ['a non-integer float (0.5)', 0.5],
  ['NaN', Number.NaN],
  ['a numeric string ("5")', '5'],
  ['a non-integer float (5.5)', 5.5],
];

describe('TacticalMap — degrades instead of drawing a grid on malformed width/height (Miko-QA + Kage-CR IMPORTANT-4, ledger item 22)', () => {
  it.each(MALFORMED_DIMS)(
    'width/height = %s -> renders without throwing, no board (no grid, no gridcell), onMove never called',
    (_label, dims) => {
      const space: Record<string, unknown> = {
        kind: 'square',
        width: dims,
        height: dims,
        cell: { value: 5, unit: 'ft' },
        blocked: [],
        features: [],
      };
      const onMove = jest.fn();

      expect(() =>
        render(<TacticalMap {...baseProps({ space: space as unknown as CombatSpace, onMove })} />),
      ).not.toThrow();

      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
      expect(screen.queryByRole('gridcell')).not.toBeInTheDocument();
      expect(onMove).not.toHaveBeenCalled();
    },
  );

  it('width/height = 5.0 (JS cannot distinguish it from 5) -> renders the REAL grid, not the degrade path', () => {
    // Documented, unclosable divergence from the engine (which refuses
    // `isinstance(5.0, int)`) -- see reach.ts's `isDimsValid` docstring.
    // Pinned here so a future change that silently starts refusing this
    // shape (breaking every ordinary integer-looking board that happens to
    // arrive as a JSON float) is caught, same as the malformed rows above.
    const dims = JSON.parse('5.0');
    const space = {
      kind: 'square',
      width: dims,
      height: dims,
      cell: { value: 5, unit: 'ft' },
      blocked: [],
      features: [],
    };
    render(<TacticalMap {...baseProps({ space: space as CombatSpace })} />);
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(25);
  });

  it('positive control: an ordinary integer width/height still renders the real grid, not the degrade path', () => {
    const space = {
      kind: 'square',
      width: 3,
      height: 3,
      cell: { value: 5, unit: 'ft' },
      blocked: [],
      features: [],
    };
    render(<TacticalMap {...baseProps({ space: space as CombatSpace })} />);
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(9);
  });
});
