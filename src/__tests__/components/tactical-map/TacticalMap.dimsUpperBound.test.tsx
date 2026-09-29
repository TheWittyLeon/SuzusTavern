/**
 * TacticalMap — dims UPPER bound (B8c-3c ledger row 26, Kage-CR IMPORTANT-2 /
 * Miko-QA blocking finding, 2026-09-29:
 * [[2026-09-27 Tavern 1.0 Drive — Reviews]]). Closed engine-side by B8e
 * (`engine/space.py::SPACE_MAX_DIM = 100`, NekoNova-DnDEngine `main` @
 * `8eaf152`) and, in this branch, by `reach.ts::isDimsValid` mirroring that
 * exact bound (see its docstring).
 *
 * `isDimsValid` used to have NO upper bound at all: `Number.isInteger(1e21)`
 * is `true` for any whole-valued double regardless of magnitude, so a huge
 * integer-valued `width`/`height` made `isSpaceUsable` return `true` and
 * reached `reachableCells`'s nested `for (x < width) for (y < height)` loop
 * -- a plain scalar-bound loop with no `Array.from`-style length ceiling to
 * throw fast on -- which runs SYNCHRONOUSLY inside `TacticalMap`'s
 * render-body `useMemo` (`reach`, gated only on `moveMode`/`activeAt`, not on
 * `isSpaceUsable`). Both reviewers independently reproduced a real hang:
 * Miko's standalone probe was still at outer index 0 of `1e21` after
 * 5,000,000 inner iterations; Kage's first render matrix had to be killed
 * after 600s, and a concurrent scratch probe pegged 100% CPU for 9+ minutes
 * before the jest worker crashed on OOM. Not previously safe to exercise at
 * the render layer at all -- these are the first tests to render the actual
 * oversized shapes end to end, made safe ONLY because the fix now bails at
 * `isSpaceUsable` (`TacticalMap.tsx`'s one render seam, ledger item 16)
 * before `reachableCells`'s loop is ever reached.
 *
 * Timeout-guard caveat, stated plainly rather than overclaimed: the
 * wall-clock assertions below prove this FIX is fast. They cannot themselves
 * preempt a FUTURE regression that reintroduces a fully unbounded loop --
 * `reachableCells` runs inside `render()`, which is synchronous, so Node
 * never yields back to Jest's own `setTimeout`-based per-test timeout while
 * a busy synchronous loop is running (the same reason neither reviewer's
 * manual probe above could be stopped by anything short of a process kill).
 * The one assertion that CANNOT hang regardless of this file's own risk is
 * the pure, O(1) unit-level check in reach.test.ts (`isSpaceUsable` returns
 * `false` for 101/10**6/1e21 -- no loop, ever). This file's wall-clock check
 * exists to catch a narrower regression -- a future ceiling raised to a
 * value that still terminates, just slowly -- with a fast, loud failure
 * instead of a silent pass; it is a second line of defence, not the proof.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TacticalMap, { type TacticalMapProps } from '@/components/tactical-map/TacticalMap';
import { SPACE_MAX_DIM, type CombatParticipantState, type CombatSpace } from '@/lib/api/types';

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

// Kage-CR's own reproduction shape (a JSON `1e21` dims row) plus the
// ceiling's immediate successor and a plain large integer -- three
// magnitudes, not just the literal number the finding happened to use.
const OVERSIZED_DIMS: Array<[string, number]> = [
  [`one past the ceiling (SPACE_MAX_DIM + 1 = ${SPACE_MAX_DIM + 1})`, SPACE_MAX_DIM + 1],
  ['a huge integer (10**6)', 10 ** 6],
  ['an enormous integer-valued float (1e21)', 1e21],
];

describe('TacticalMap — dims upper bound degrades to TheatreOfMindBand, never hangs (ledger row 26)', () => {
  it.each(OVERSIZED_DIMS)(
    'width/height = %s -> no grid, no gridcell, renders fast (< 1000ms), onMove never called',
    (_label, dim) => {
      const space: Record<string, unknown> = {
        kind: 'square',
        width: dim,
        height: dim,
        cell: { value: 5, unit: 'ft' },
        blocked: [],
        features: [],
      };
      const onMove = jest.fn();
      const start = Date.now();

      expect(() =>
        render(<TacticalMap {...baseProps({ space: space as unknown as CombatSpace, onMove })} />),
      ).not.toThrow();

      // See the header note: this is a fast-fail regression catch, not the
      // unconditional proof (that lives in reach.test.ts, which cannot hang).
      expect(Date.now() - start).toBeLessThan(1000);
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
      expect(screen.queryByRole('gridcell')).not.toBeInTheDocument();
      expect(onMove).not.toHaveBeenCalled();
    },
    5000,
  );

  it('only ONE axis oversized is still refused, and refused fast', () => {
    const space = {
      kind: 'square',
      width: SPACE_MAX_DIM + 1,
      height: 5,
      cell: { value: 5, unit: 'ft' },
      blocked: [],
      features: [],
    };
    const start = Date.now();
    render(<TacticalMap {...baseProps({ space: space as CombatSpace })} />);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  }, 5000);

  it(
    `positive control: width/height AT the ceiling (SPACE_MAX_DIM = ${SPACE_MAX_DIM}) still renders the real grid`,
    () => {
      const space = {
        kind: 'square',
        width: SPACE_MAX_DIM,
        height: SPACE_MAX_DIM,
        cell: { value: 5, unit: 'ft' },
        blocked: [],
        features: [],
      };
      // No fast-render assertion here -- SPACE_MAX_DIM x SPACE_MAX_DIM is a
      // real, legitimately large grid (10,000 gridcells), not a hang case;
      // it is the boundary the ceiling must still ADMIT, not refuse.
      render(<TacticalMap {...baseProps({ space: space as CombatSpace, moveMode: false })} />);
      expect(screen.getByRole('grid')).toBeInTheDocument();
      expect(screen.getAllByRole('gridcell')).toHaveLength(SPACE_MAX_DIM * SPACE_MAX_DIM);
    },
    20000,
  );
});
