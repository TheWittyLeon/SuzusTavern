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

/**
 * Miko-QA B8c-2 divergence sweep (design brief §3.3 vs this mirror,
 * rule-by-rule): `move_legality` refuses at step 4 when
 * `adapter.is_valid(space, frm)` is false — and `SquareSpace.is_valid`
 * (engine/space.py) is `_in_bounds(at) AND NOT _is_blocked(at)`, the SAME
 * two-part check for both `frm` and `to`. This mirror's `isLegalMoveTarget`
 * / `reachableCells` apply that two-part check to `to` (bounds via
 * `inBounds`, blocked via the `space.blocked` scan) but only the BOUNDS
 * half to `from` — `from` is never checked against `space.blocked`. A
 * mover whose own current cell is a blocked cell (design's own scenario:
 * "an edited space, a downgraded engine" — `move_legality`'s step-3-before-
 * step-4 ordering comment names this exact case) gets `mover_unplaced`
 * (refused) from the engine but LEGAL from this mirror, on every other
 * cell.
 *
 * REACHABILITY, stated honestly: `adventure_validator.py:774` refuses to
 * author a `start` cell that is also a `blocked` cell, and space is static
 * mid-combat (`SquareSpace`'s own "board is static in 1.0 per R6" note) —
 * so this exact shape is NOT reachable through today's spawn path alone. It
 * is reachable through a content edit to an already-authored `blocked` list
 * between encounters that reuse a stored `at` from an earlier one, or a
 * hand-edited fixture/save row — precisely the "edited space, downgraded
 * engine" class of case `move_legality`'s docstring says step 3's ordering
 * exists to handle. Filed as a defect, not fixed here (Miko-QA does not
 * touch production code) — Ren-Dev decides whether the fix is
 * `isLegalMoveTarget`/`reachableCells` gaining a `from`-blocked check, or a
 * documented "the mirror trusts the caller's `from`" scope note. Locked via
 * `it.failing` (established repo convention — JournalPane.test.tsx,
 * play.rehydration.session-switch-staleness.adversarial.test.tsx): asserts
 * the CORRECT (engine-matching) behavior, which currently fails; if a fix
 * lands, Jest fails THIS suite (test.failing passing unexpectedly) and that
 * is the signal to drop `.failing()` and promote it to a real assertion.
 */
describe('reach.ts vs move_legality — from-cell blocked divergence (Miko-QA B8c-2, NOT fixed here)', () => {
  const s = space({ width: 5, height: 5, blocked: [[0, 0]] });

  it.failing(
    'isLegalMoveTarget should refuse a move FROM a blocked cell, matching move_legality step 4 (mover_unplaced) — currently returns true',
    () => {
      // Confirmed via a throwaway probe against this exact build (2026-09-29):
      // isLegalMoveTarget(s, [0,0], [1,0], 30, []) === true today.
      expect(isLegalMoveTarget(s, [0, 0], [1, 0], 30, [])).toBe(false);
    },
  );

  it.failing(
    'reachableCells should return nothing when `from` is itself a blocked cell, matching move_legality step 4 — currently returns the whole open board',
    () => {
      // Confirmed via the same probe: length 24 (every other cell on a 5x5
      // board) today, not 0.
      expect(reachableCells(s, [0, 0], 30, [])).toHaveLength(0);
    },
  );
});
