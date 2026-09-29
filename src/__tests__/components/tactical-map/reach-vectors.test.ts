/**
 * reach-vectors.test.ts — B8c-2 (design brief §4 / §5.3 item 4, B8a
 * IMPORTANT-6's Tavern half): the shared reach-vector drift guard between
 * `engine/space.py::SquareSpace.cost` + `engine.combat.move_legality`
 * (engine branch `feature/movement-b8b-verb-0928`, tip `996a699`, still
 * under QA, not yet merged — this branch merges only after B8b does) and
 * this repo's client-side PREVIEW mirror (`reach.ts`).
 *
 * LOCAL COPY, NOT A SIBLING-PATH READ. `src/__tests__/fixtures/reach_vectors.json`
 * is a byte-identical copy of the engine's `tests/fixtures/reach_vectors.json`,
 * committed here — never a relative cross-repo read. The fixture's own
 * "_mechanism" key explains why: a worktree checkout under
 * `SuzusTavern/.worktrees/<item>/` has no sibling `NekoNova-DnDEngine`
 * directory to resolve, and even where a sibling checkout exists, editing
 * the canonical file would not change a separately committed local copy's
 * digest. The sha256 pin below is what actually catches drift — any edit to
 * either copy without updating BOTH literals (this one and the engine's
 * `tests/test_space_adapter.py::_CANONICAL_REACH_VECTORS_SHA256`) reds this
 * test in the same commit as the edit.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { chebyshevCost, isLegalMoveTarget } from '@/components/tactical-map/reach';
import { occupiesWhenAlive } from '@/components/tactical-map/TacticalMap';
import type { CombatSpace, SpaceCoordinate } from '@/lib/api/types';

const FIXTURE_PATH = path.join(__dirname, '..', '..', 'fixtures', 'reach_vectors.json');
const RAW = fs.readFileSync(FIXTURE_PATH, 'utf8');

// Kage-CR B8a IMPORTANT-6 / design brief §4 item 6: the SAME literal as the
// engine's `_CANONICAL_REACH_VECTORS_SHA256` on `feature/movement-b8b-verb-0928`
// (tip `996a699`). B8b step 7 recomputed this after adding `others` /
// `expected_reason` to every case and 2 new occupancy cases — the OLD
// literal (`c51e3ea4...`) that earlier carry notes quoted is STALE; this is
// the new one.
const CANONICAL_REACH_VECTORS_SHA256 =
  'd6e0c106d165a25b4ede0a673dc81ee578fe07cd5205b02e2d8ef021f5c53bcc';

// Exact count, not a floor — same rationale as the engine's own
// `_EXPECTED_REACH_VECTOR_COUNT` (Miko-QA B8a mutation probe 3: a floor only
// catches the fixture going empty, never one case quietly disappearing).
const EXPECTED_CASE_COUNT = 11;

interface ReachVectorCase {
  name: string;
  space: CombatSpace;
  from: SpaceCoordinate;
  to: SpaceCoordinate;
  expected: number | null;
  budget: number;
  others: Record<string, SpaceCoordinate>;
  expected_legal: boolean;
  expected_reason: string;
}

const FIXTURE: { _mechanism: string; cases: ReachVectorCase[] } = JSON.parse(RAW);

/**
 * Builds the `occupied` coordinate list `isLegalMoveTarget` expects from a
 * case's `others` map, routed through `TacticalMap`'s OWN `occupiesWhenAlive`
 * predicate — never re-implemented here. Every fixture entry in `others`
 * already represents a LIVING participant (the engine's
 * `living_participant_positions` pre-filters before building `others`; see
 * the fixture's own "_mechanism" key), so every stand-in built here is
 * `is_alive: true` — this proves the Tavern's occupancy pipeline, when fed
 * the same pre-filtered shape production code would receive, agrees with
 * it, rather than silently bypassing the shared rule.
 */
function occupiedFromOthers(others: Record<string, SpaceCoordinate>): SpaceCoordinate[] {
  return Object.entries(others)
    .filter(() => occupiesWhenAlive({ is_alive: true }))
    .map(([, at]) => at);
}

describe('reach.ts vs the shared reach-vector fixture (B8c-2, design brief §4)', () => {
  it('the local fixture copy matches the canonical sha256 digest', () => {
    const digest = crypto.createHash('sha256').update(RAW).digest('hex');
    expect(digest).toBe(CANONICAL_REACH_VECTORS_SHA256);
  });

  it('carries exactly 11 cases — a floor would miss a single dropped vector', () => {
    expect(FIXTURE.cases).toHaveLength(EXPECTED_CASE_COUNT);
    const names = FIXTURE.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // ── KNOWN CLIENT/ENGINE DIVERGENCE — reported, not silently absorbed ─────
  // `origin_out_of_bounds_is_unreachable`: reach.ts's `isLegalMoveTarget`
  // bounds-checks only `to`, never `from` — the engine's `move_legality`
  // refuses this case at step 4 (`mover_unplaced`) before cost is even
  // computed. Measured directly: the client returns `true` (legal) for a
  // mover whose OWN cell is off the board; the engine's real answer is
  // `false`. Not fixed here — reach.ts is a client-side PREVIEW mirror
  // whose own module header already states the server's `/move` response
  // is sole authority on disagreement (design §4), and this is a genuinely
  // separate finding from this item's scope (the fixture pin, not a
  // reach.ts behaviour change). Reported to the coordinator per the build
  // brief's own instruction for this item; NOT "fixed" by editing the
  // fixture's `expected_legal` to match the client's wrong answer.
  const KNOWN_DIVERGENCES: Record<string, string> = {
    origin_out_of_bounds_is_unreachable:
      'isLegalMoveTarget never bounds-checks `from`, only `to` — client says legal, engine refuses mover_unplaced',
  };

  it.each(FIXTURE.cases)('$name: isLegalMoveTarget agrees with the engine\'s move_legality (or is a documented divergence)', (c) => {
    const occupied = occupiedFromOthers(c.others);
    const actual = isLegalMoveTarget(c.space, c.from, c.to, c.budget, occupied);
    if (c.name in KNOWN_DIVERGENCES) {
      // Pin the CURRENT (wrong) client behaviour so a future silent fix to
      // reach.ts is visible here as an intentional change, not a surprise —
      // and pin that it really does diverge from the engine's real answer,
      // so this entry can't go stale into "this case doesn't diverge
      // anymore" without anyone noticing.
      expect(actual).not.toBe(c.expected_legal);
      return;
    }
    expect(actual).toBe(c.expected_legal);
  });

  it.each(FIXTURE.cases.filter((c) => c.expected !== null))(
    '$name: chebyshevCost matches the engine\'s SquareSpace.cost',
    (c) => {
      expect(chebyshevCost(c.space, c.from, c.to)).toBe(c.expected);
    },
  );
});
