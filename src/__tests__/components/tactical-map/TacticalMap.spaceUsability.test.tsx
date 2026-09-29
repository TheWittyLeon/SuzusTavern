/**
 * TacticalMap — render-time space usability (Kage-CR B8c-3a CRITICAL-1,
 * ledger item 16: [[2026-09-27 Tavern 1.0 Drive — Reviews]]).
 *
 * `chebyshevCost` (reach.ts) reads `space.cell.value` with no guard, and the
 * component called it for every cell (the accessible-name `costFt` and the
 * destination-tag label) gated only on `activeAt` — not on the early-return
 * guard, which used to check only `space.kind !== 'square'` and never
 * validated `cell` at all. A wire-reachable `cell: null` (the engine's
 * projection gate at `build_combat_state`, engine/combat.py:7361-7364 @
 * 3a5d18b, is key-PRESENCE only) reached `chebyshevCost` and threw
 * `TypeError: Cannot read properties of null (reading 'value')` at render.
 *
 * Fix: `isSpaceUsable` (reach.ts) is now exported as a TYPE PREDICATE and IS
 * the component's one render seam — nothing downstream can run on a space
 * this guard would refuse.
 *
 * Mutation proof (manual, recorded here — not re-run by this file itself):
 * reverting TacticalMap.tsx's guard to the pre-fix
 * `!space || space.kind !== 'square'` reds the `cell: null` and `cell
 * absent` cases below with the exact TypeError quoted above; every other
 * row here stays green under either guard (they never crashed — they just
 * silently rendered a full, wrong grid pre-fix), which is why this table
 * also asserts `grid=false` for all of them, not merely "does not throw".
 *
 * `cell.value: {}` / `NaN` / `Infinity` are deliberately NOT in this table
 * — Kage-CR IMPORTANT-2 (ledger item 18) pins those separately in
 * TacticalMap.finiteness.test.tsx, because they exercise a different
 * clause (`Number.isFinite`) than the one this file is pinning.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TacticalMap, { type TacticalMapProps } from '@/components/tactical-map/TacticalMap';
import type { CombatParticipantState, CombatSpace } from '@/lib/api/types';

export function makeParticipant(overrides: Partial<CombatParticipantState> = {}): CombatParticipantState {
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

export function baseProps(overrides: Partial<TacticalMapProps> = {}): TacticalMapProps {
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

// Kage-CR B8c-3a render probe (2026-09-29), measured against the shipped,
// pre-fix component: `cell: null` and `cell` absent threw; every other
// shape here rendered a full grid with no throw but a wrong "in range"
// picture (the old guard never checked `cell` at all).
const MALFORMED_CELLS: Array<[string, unknown]> = [
  ['cell: null', null],
  ['cell absent', '__ABSENT__'],
  ['cell: "5" (not an object)', '5'],
  ['cell: [5] (an array)', [5]],
  ['cell: {} (value key absent)', {}],
  ['cell.value: null', { value: null, unit: 'ft' }],
  ['cell.value: 0', { value: 0, unit: 'ft' }],
  ['cell.value: -5', { value: -5, unit: 'ft' }],
  ['cell.value: "5" (a string)', { value: '5', unit: 'ft' }],
];

describe('TacticalMap — degrades instead of throwing on every malformed `cell` shape (Kage-CR B8c-3a CRITICAL-1, ledger item 16)', () => {
  it.each(MALFORMED_CELLS)(
    '%s -> renders without throwing, no board (no grid, no gridcell), onMove never called',
    (_label, cellValue) => {
      const space: Record<string, unknown> = { kind: 'square', width: 3, height: 3, blocked: [], features: [] };
      if (cellValue !== '__ABSENT__') space.cell = cellValue;
      const onMove = jest.fn();

      expect(() =>
        render(<TacticalMap {...baseProps({ space: space as unknown as CombatSpace, onMove })} />),
      ).not.toThrow();

      // Degrades to the theatre-of-mind band (design §5): no board renders
      // at all, so there is structurally no cell to offer as "in range"
      // and nothing to click — "a board with no legal move" per the ledger
      // item's own framing.
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
      expect(screen.queryByRole('gridcell')).not.toBeInTheDocument();
      expect(onMove).not.toHaveBeenCalled();
    },
  );

  it('positive control: a valid space (cell.value: 5) still renders the real grid, not the degrade path', () => {
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
