/**
 * tactical-map-parity.test.ts — Kage-CR B8c-3a 🟢 1, ledger item 19
 * ([[2026-09-27 Tavern 1.0 Drive — Reviews]]).
 *
 * Kage-CR's B8c-3a review ran a 4,216-case differential against the REAL
 * `engine.combat.move_legality` (engine `main` @ `3a5d18b`) and found 0
 * disagreements with `reach.ts` — but that generator was an ad hoc
 * reviewer-side script, never committed anywhere (confirmed by grep; the
 * only committed cross-repo parity artifact before this file was the
 * 12-case `reach_vectors.json`, which samples `cell.value` from
 * `{2.5, 5, 10}` only). This file is the committed replacement: a
 * DETERMINISTIC, table-driven cross of Kage's own axes — 17 `cell.value`s
 * x 8 `cell` containers x 9 `kind`s x 9 paired `width`/`height` values,
 * 1,944 cases total — with each case's EXPECTED verdict recorded from the
 * real engine, not a hand-transcription of its documented behaviour.
 *
 * Generator: `scripts/generate-tactical-map-parity-fixture.py` (repo root
 * — see its header for how/when to regenerate). Fixture:
 * `src/__tests__/fixtures/tactical_map_parity.json`.
 *
 * DIGEST-PINNED, same mechanism as `reach_vectors.json`/
 * `reach-vectors.test.ts`: any edit to the fixture must update BOTH the
 * sha256 and case-count literals below in the SAME commit, or this test
 * (not silent trust) is what catches the drift.
 *
 * FOLLOW-UP, ROUTED, NOT DONE HERE (generator script header, same note):
 * a digest-pinned copy of this fixture (or its generator) in the engine
 * repo, so an engine-side `move_legality` change is forced to re-run the
 * generator in the SAME PR, matching `reach_vectors.json`'s two-repo pin.
 * Coordinator to route.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { isLegalMoveTarget, reachableCells } from '@/components/tactical-map/reach';
import type { CombatSpace, SpaceCoordinate } from '@/lib/api/types';

const FIXTURE_PATH = path.join(__dirname, '..', '..', 'fixtures', 'tactical_map_parity.json');
const RAW = fs.readFileSync(FIXTURE_PATH, 'utf8');

const CANONICAL_SHA256 = '9666dba24dae4cdcdcf7573025682d16904432218fd8221ae7bc808c9e84fd29';
const EXPECTED_CASE_COUNT = 1944;
const EXPECTED_ENGINE_COMMIT = '3a5d18b51865f53900394838bfe32b387d8ea9d1';

interface RawCase {
  desc: string;
  space: unknown;
  frm: SpaceCoordinate;
  to: SpaceCoordinate;
  budget: number;
  occupied: SpaceCoordinate[];
  legal: boolean | null;
  reason: string | null;
  err: string | null;
}

/**
 * Reverses the generator's sentinel encoding for values JSON has no token
 * for (`NaN`/`Infinity`/`-Infinity`) — the same `{"__SENT__": ...}` shape
 * Kage-CR's own scratch `parity-probe.ts` used. An empty object (`{}`, one
 * of the deliberately malformed `cell.value` shapes under test) has ZERO
 * keys and is never mistaken for a sentinel, which requires exactly one
 * key named `__SENT__`.
 */
function desent(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(desent);
  if (o !== null && typeof o === 'object') {
    const keys = Object.keys(o as Record<string, unknown>);
    if (keys.length === 1 && keys[0] === '__SENT__') {
      const s = (o as { __SENT__: string }).__SENT__;
      if (s === 'nan') return Number.NaN;
      if (s === 'inf') return Number.POSITIVE_INFINITY;
      if (s === '-inf') return Number.NEGATIVE_INFINITY;
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = desent((o as Record<string, unknown>)[k]);
    return out;
  }
  return o;
}

const FIXTURE: { _mechanism: string; engine_commit: string; cases: RawCase[] } = JSON.parse(RAW);

describe('reach.ts vs the tactical-map parity fixture (Kage-CR B8c-3a 🟢 1, ledger item 19)', () => {
  it('the fixture matches the canonical sha256 digest', () => {
    const digest = crypto.createHash('sha256').update(RAW).digest('hex');
    expect(digest).toBe(CANONICAL_SHA256);
  });

  it(`carries exactly ${EXPECTED_CASE_COUNT} cases — a floor would miss a dropped case`, () => {
    expect(FIXTURE.cases).toHaveLength(EXPECTED_CASE_COUNT);
    const descs = FIXTURE.cases.map((c) => c.desc);
    expect(new Set(descs).size).toBe(descs.length);
  });

  it('was generated against engine main @ 3a5d18b, not a branch name that dies with its worktree', () => {
    expect(FIXTURE.engine_commit).toBe(EXPECTED_ENGINE_COMMIT);
  });

  const decided = FIXTURE.cases.filter((c) => c.err === null);
  const engineRaised = FIXTURE.cases.filter((c) => c.err !== null);

  it('positive control: the fixture has both legal and refused cases — not a vacuous all-refuse table', () => {
    expect(decided.some((c) => c.legal === true)).toBe(true);
    expect(decided.some((c) => c.legal === false)).toBe(true);
  });

  it('the engine never raises across the whole matrix, even with malformed width/height (measured; matches Kage-CR\'s own 4,216-case finding)', () => {
    // If a future regeneration finds a raising case, THIS is what must
    // change first — the current fixture has none, so the loop below
    // never runs today, but is here so a future non-empty
    // `engineRaised` gets real per-case coverage instead of a silent
    // it.each([]) no-op.
    for (const c of engineRaised) {
      const space = desent(c.space) as CombatSpace;
      expect(() => isLegalMoveTarget(space, c.frm, c.to, c.budget, c.occupied)).not.toThrow();
      expect(() => reachableCells(space, c.frm, c.budget, c.occupied)).not.toThrow();
    }
    expect(engineRaised).toHaveLength(0);
  });

  it.each(decided)('$desc -> isLegalMoveTarget AND reachableCells membership agree with move_legality', (c) => {
    const space = desent(c.space) as CombatSpace;
    expect(isLegalMoveTarget(space, c.frm, c.to, c.budget, c.occupied)).toBe(c.legal);
    const reach = reachableCells(space, c.frm, c.budget, c.occupied);
    const inReach = reach.some(([x, y]) => x === c.to[0] && y === c.to[1]);
    expect(inReach).toBe(c.legal);
  });
});
