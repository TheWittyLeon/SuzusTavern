/**
 * reach.ts — client-side PREVIEW mirror of `SquareSpace.cost`
 * (NekoNova-DnDEngine/engine/space.py). Chebyshev distance × `cell.value`.
 */
import { chebyshevCost, isLegalMoveTarget, reachableCells } from '@/components/tactical-map/reach';
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
});
