/**
 * reach.ts — client-side PREVIEW mirror of `SquareSpace.cost`
 * (NekoNova-DnDEngine/engine/space.py). Chebyshev distance × `cell.value`.
 */
import { chebyshevCost, isLegalMoveTarget, isSpaceUsable, reachableCells } from '@/components/tactical-map/reach';
import type { CombatSpace } from '@/lib/api/types';

function space(overrides: Partial<CombatSpace> = {}): CombatSpace {
  return {
    kind: 'square',
    width: 10,
    height: 10,
    cell: { value: 5, unit: 'ft' },
    blocked: [],
    features: [],
    ...overrides,
  };
}

describe('chebyshevCost', () => {
  it('is 0 for the same cell', () => {
    expect(chebyshevCost(space(), [4, 4], [4, 4])).toBe(0);
  });

  it('is straight-axis distance × cell.value for an orthogonal move', () => {
    // Chebyshev distance = max(|dx|, |dy|) = 3, × 5 ft = 15 ft.
    expect(chebyshevCost(space(), [0, 0], [3, 0])).toBe(15);
    expect(chebyshevCost(space(), [0, 0], [0, 3])).toBe(15);
  });

  it('is max(|dx|,|dy|) × cell.value for a diagonal move — the defining Chebyshev case', () => {
    // dx=3, dy=3 -> Chebyshev distance 3 (not 6, not sqrt(18)), × 5 ft = 15 ft.
    expect(chebyshevCost(space(), [0, 0], [3, 3])).toBe(15);
  });

  it('uses the larger axis when dx and dy differ (known asymmetric case)', () => {
    // dx=2, dy=5 -> Chebyshev distance 5, × 5 ft = 25 ft.
    expect(chebyshevCost(space(), [0, 0], [2, 5])).toBe(25);
  });

  it('scales with cell.value', () => {
    expect(chebyshevCost(space({ cell: { value: 10, unit: 'ft' } }), [0, 0], [2, 0])).toBe(20);
  });
});

describe('reachableCells', () => {
  it('returns every in-budget cell within Chebyshev distance, excluding the origin', () => {
    // 1-cell budget (5 ft / 5-ft cell) on an open board -> the 8 neighbors.
    const s = space({ width: 5, height: 5 });
    const cells = reachableCells(s, [2, 2], 5, []);
    expect(cells).toHaveLength(8);
    expect(cells).not.toContainEqual([2, 2]);
    expect(cells).toContainEqual([1, 1]);
    expect(cells).toContainEqual([3, 3]);
  });

  it('excludes blocked cells even when within budget', () => {
    const s = space({ width: 5, height: 5, blocked: [[3, 2]] });
    const cells = reachableCells(s, [2, 2], 5, []);
    expect(cells).not.toContainEqual([3, 2]);
    // its unblocked neighbor at the same distance is still included.
    expect(cells).toContainEqual([1, 2]);
  });

  it('excludes occupied cells even when within budget', () => {
    const s = space({ width: 5, height: 5 });
    const cells = reachableCells(s, [2, 2], 5, [[3, 2]]);
    expect(cells).not.toContainEqual([3, 2]);
  });

  it('respects the board bounds', () => {
    const s = space({ width: 3, height: 3 });
    const cells = reachableCells(s, [0, 0], 100, []);
    expect(cells.every(([x, y]) => x >= 0 && x < 3 && y >= 0 && y < 3)).toBe(true);
    expect(cells).toHaveLength(8); // the whole 3x3 board minus the origin
  });

  it('returns nothing when movementRemaining is 0 or negative', () => {
    const s = space();
    expect(reachableCells(s, [4, 4], 0, [])).toEqual([]);
    expect(reachableCells(s, [4, 4], -5, [])).toEqual([]);
  });

  it('includes a diagonal-corner cell at cell.value 10, and never crosses off the board from a board corner', () => {
    // Mover sits in the top-left CORNER ([0,0]) of a 5x5 board with a 10ft
    // cell — the diagonal neighbor [1,1] costs Chebyshev(1,1)=1 x 10 = 10ft,
    // exactly the budget. This exercises two things at once the plain
    // chebyshevCost unit tests above don't: (a) cell.value 10 flowing
    // through the FULL reachableCells legality path (blocked/occupied/
    // bounds), not just the bare formula; (b) a mover positioned AT a
    // corner, where three of the eight Chebyshev neighbors ([-1,-1],
    // [-1,0], [0,-1]) are off-board — the loop only ever iterates
    // 0..width-1/0..height-1, so an out-of-bounds "neighbor" can never
    // silently appear in the result.
    const s = space({ width: 5, height: 5, cell: { value: 10, unit: 'ft' } });
    const cells = reachableCells(s, [0, 0], 10, []);
    expect(cells).toContainEqual([1, 1]); // in-bounds diagonal corner, exactly at budget
    expect(cells).toContainEqual([1, 0]);
    expect(cells).toContainEqual([0, 1]);
    expect(cells.every(([x, y]) => x >= 0 && y >= 0)).toBe(true); // no negative coords ever
    expect(cells).toHaveLength(3); // only the 3 on-board neighbors of a corner cell
  });
});

describe('isLegalMoveTarget', () => {
  const s = space({ width: 5, height: 5, blocked: [[3, 3]] });

  it('true for an in-bounds, unblocked, unoccupied, in-budget cell', () => {
    expect(isLegalMoveTarget(s, [2, 2], [2, 3], 5, [])).toBe(true);
  });

  it('false out of bounds', () => {
    expect(isLegalMoveTarget(s, [2, 2], [10, 10], 100, [])).toBe(false);
  });

  it('false on a blocked cell', () => {
    expect(isLegalMoveTarget(s, [2, 2], [3, 3], 100, [])).toBe(false);
  });

  it('false on an occupied cell', () => {
    expect(isLegalMoveTarget(s, [2, 2], [1, 1], 100, [[1, 1]])).toBe(false);
  });

  it('false when the cost exceeds the budget', () => {
    expect(isLegalMoveTarget(s, [0, 0], [4, 4], 5, [])).toBe(false); // costs 20 ft
  });

  it('false for the mover\'s own cell', () => {
    expect(isLegalMoveTarget(s, [2, 2], [2, 2], 100, [])).toBe(false);
  });

  it('true for a diagonal-corner cell at cell.value 10 exactly at budget, false one foot over', () => {
    const s10 = space({ width: 5, height: 5, cell: { value: 10, unit: 'ft' } });
    // Chebyshev(1,1) x 10ft = 10ft: exactly at a 10ft budget.
    expect(isLegalMoveTarget(s10, [0, 0], [1, 1], 10, [])).toBe(true);
    // One foot short of the same move: refused.
    expect(isLegalMoveTarget(s10, [0, 0], [1, 1], 9, [])).toBe(false);
  });

  it('false for a diagonal target off the board from a board corner (negative coordinates)', () => {
    // A naive Chebyshev formula run on [-1,-1] would compute a real
    // (falsely legal) cost; the bounds check must reject it before cost is
    // ever consulted.
    expect(isLegalMoveTarget(s, [0, 0], [-1, -1], 1000, [])).toBe(false);
  });

  it('Kage-CR D1 CRITICAL-1: never throws when `blocked` is omitted entirely (legal, unstamped content)', () => {
    const noBlocked = { ...space({ width: 5, height: 5 }) } as { blocked?: unknown };
    delete noBlocked.blocked;
    expect(() => isLegalMoveTarget(noBlocked as CombatSpace, [0, 0], [1, 1], 100, [])).not.toThrow();
    expect(isLegalMoveTarget(noBlocked as CombatSpace, [0, 0], [1, 1], 100, [])).toBe(true);
  });
});

describe('reachableCells — Kage-CR D1 CRITICAL-1', () => {
  it('never throws when `blocked` is omitted entirely, and treats every unoccupied in-bounds cell as reachable', () => {
    const noBlocked = { ...space({ width: 3, height: 3 }) } as { blocked?: unknown };
    delete noBlocked.blocked;
    expect(() => reachableCells(noBlocked as CombatSpace, [0, 0], 100, [])).not.toThrow();
    expect(reachableCells(noBlocked as CombatSpace, [0, 0], 100, [])).toHaveLength(8);
  });
});

describe('reach.ts vs move_legality steps 1-2 — space validity (Kage-CR B8b-2 🟡-3 / verify-2 🟢 2, B8c-2 🟢 B; B8c-3 ledger items 10/11)', () => {
  const openBoard = space({ width: 5, height: 5 });

  it('`space` falsy -> reachableCells returns [] and isLegalMoveTarget refuses', () => {
    expect(reachableCells(null as unknown as CombatSpace, [0, 0], 30, [])).toEqual([]);
    expect(reachableCells(undefined as unknown as CombatSpace, [0, 0], 30, [])).toEqual([]);
    expect(isLegalMoveTarget(null as unknown as CombatSpace, [0, 0], [1, 0], 30, [])).toBe(false);
  });

  it('an unregistered `space.kind` (e.g. a future "hex" board) is never legal -- closes B8c-2 🟢 B\'s "a hex space renders legal" gap', () => {
    // `SpaceKind` is a `'square'`-only union at the type level; the wire has
    // no such guarantee (design §1.2/§4.3), so this is cast through
    // `unknown` the same way the fixture-shape tests above do.
    const hex = { ...openBoard, kind: 'hex' } as unknown as CombatSpace;
    expect(reachableCells(hex, [0, 0], 30, [])).toEqual([]);
    expect(isLegalMoveTarget(hex, [0, 0], [1, 0], 30, [])).toBe(false);
  });

  // Kage-CR B8b-2 verify · IMPORTANT-3 measured 6 of these 9 shapes
  // rendering as legal client-side while the engine refused all 9 as
  // `no_space` -- there was no `cell.value` guard here at all. No parity
  // GENERATOR is committed in this repo to extend with this axis: Kage's
  // 4,000-case differential (`ts-node -T` against the real `move_legality`,
  // B8c-2 review) was run ad hoc from a reviewer's own script, not checked
  // in anywhere under `src/__tests__/` or `NekoNova-DnDEngine/tests/`
  // (confirmed by grep -- the only committed cross-repo parity artifact is
  // the digest-pinned `reach_vectors.json` fixture, which samples
  // `cell.value` from `{2.5, 5, 10}` only and is out of this item's scope).
  // So this table asserts the axis directly against the engine's documented
  // behaviour -- `_cell_value_is_valid`'s own docstring and code,
  // engine `main` @ `3a5d18b` -- rather than against a generator this repo
  // does not have.
  const invalidCellValues: Array<[string, unknown]> = [
    ['a numeric string', '5'],
    ['null', null],
    ['a boolean', true],
    ['an array', [5]],
    ['an empty object', {}],
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ];

  it.each(invalidCellValues)('cell.value = %s (%p) -> nothing reachable, no move legal', (_label, value) => {
    const corrupt = { ...openBoard, cell: { ...openBoard.cell, value } } as unknown as CombatSpace;
    expect(reachableCells(corrupt, [2, 2], 30, [])).toEqual([]);
    expect(isLegalMoveTarget(corrupt, [2, 2], [2, 3], 30, [])).toBe(false);
  });

  it('`cell` itself absent or `null` -> nothing reachable, no move legal', () => {
    const noCell = { ...openBoard } as { cell?: unknown };
    delete noCell.cell;
    expect(reachableCells(noCell as CombatSpace, [2, 2], 30, [])).toEqual([]);
    expect(isLegalMoveTarget(noCell as CombatSpace, [2, 2], [2, 3], 30, [])).toBe(false);

    const nullCell = { ...openBoard, cell: null } as unknown as CombatSpace;
    expect(reachableCells(nullCell, [2, 2], 30, [])).toEqual([]);
    expect(isLegalMoveTarget(nullCell, [2, 2], [2, 3], 30, [])).toBe(false);
  });

  it('a valid finite positive float (2.5) still works -- the guard does not over-refuse', () => {
    const valid = { ...openBoard, cell: { value: 2.5, unit: 'ft' as const } };
    expect(reachableCells(valid, [2, 2], 30, [])).not.toEqual([]);
    expect(isLegalMoveTarget(valid, [2, 2], [2, 3], 30, [])).toBe(true);
  });
});

describe('reach.ts vs move_legality — the mover\'s own cell must be valid (Miko-QA B8c-2)', () => {
  // engine `move_legality` step 4 refuses a mover on a blocked or off-board
  // cell (`mover_unplaced`); the preview must offer nothing there.
  const s = space({ width: 5, height: 5, blocked: [[0, 0]] });

  it('isLegalMoveTarget refuses a move FROM a blocked cell', () => {
    expect(isLegalMoveTarget(s, [0, 0], [1, 0], 30, [])).toBe(false);
  });

  it('reachableCells returns nothing when `from` is a blocked cell', () => {
    expect(reachableCells(s, [0, 0], 30, [])).toHaveLength(0);
  });

  it('reachableCells returns nothing when `from` is off the board', () => {
    expect(reachableCells(s, [7, 0], 30, [])).toHaveLength(0);
  });

  it('control: a valid origin next to the blocked cell still reaches the open board', () => {
    expect(isLegalMoveTarget(s, [1, 0], [2, 0], 30, [])).toBe(true);
    expect(reachableCells(s, [1, 0], 30, []).length).toBeGreaterThan(0);
  });
});

describe('isSpaceUsable — exported as a type predicate (Kage-CR B8c-3a CRITICAL-1, ledger item 16)', () => {
  // Direct unit coverage now that this is public API and TacticalMap.tsx's
  // own render seam, not just an internal helper `reachableCells`/
  // `isLegalMoveTarget` happen to call first.
  it('true for a usable space', () => {
    expect(isSpaceUsable(space())).toBe(true);
  });

  it('false for null/undefined, a non-square kind, and every malformed cell.value already covered above', () => {
    expect(isSpaceUsable(null)).toBe(false);
    expect(isSpaceUsable(undefined)).toBe(false);
    expect(isSpaceUsable({ ...space(), kind: 'hex' } as unknown as CombatSpace)).toBe(false);
    expect(isSpaceUsable({ ...space(), cell: null } as unknown as CombatSpace)).toBe(false);
  });
});
