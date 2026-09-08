/**
 * HB-P7e — unit tests for src/lib/dnd/variableCost.ts's pure spend-chooser
 * math. CastSpellPanel.test.tsx covers these through the component; this
 * file targets the functions directly, including the boundary/adversarial
 * cases the component tests don't bother enumerating.
 */
import type { SpellVariableCost } from '../../lib/api/types';
import {
  affordableMaxSpend,
  previewSpend,
  repeatNarrative,
  resolveMaxSpend,
  resourceLabelFor,
  snapSpend,
  stepDicePreview,
  stepsFor,
} from '../../lib/dnd/variableCost';

const ROAR: SpellVariableCost = {
  base_cost: 2,
  step_cost: 2,
  max_spend: { pb_mult: 2 },
  per_step: { damage_dice: '2d6', narrative: '+15 ft of cone' },
};

describe('resolveMaxSpend', () => {
  it('resolves the {pb_mult} expression form against the caster\'s own PB', () => {
    expect(resolveMaxSpend({ pb_mult: 2 }, 2)).toBe(4);
    expect(resolveMaxSpend({ pb_mult: 2 }, 6)).toBe(12);
  });

  it('passes a pre-resolved integer form through unchanged', () => {
    expect(resolveMaxSpend(12, 2)).toBe(12);
    expect(resolveMaxSpend(12, 6)).toBe(12);
  });

  // PB=2/pb_mult=2 (the only combination used elsewhere in this file and in
  // CastSpellPanel.test.tsx) gives 4 whether you multiply, add, or exponentiate
  // (2*2 = 2+2 = 2**2 = 4) — a broken `+` or `**` in place of `*` would pass
  // every other test in this suite. These PB values disambiguate multiplication
  // from every other plausible-looking operator.
  it('multiplies rather than adds or exponentiates — disambiguated with PB != pb_mult', () => {
    expect(resolveMaxSpend({ pb_mult: 3 }, 4)).toBe(12); // + would give 7, ** would give 81
    expect(resolveMaxSpend({ pb_mult: 1 }, 5)).toBe(5); // + would give 6
    expect(resolveMaxSpend({ pb_mult: 3 }, 5)).toBe(15); // level-17+ PB
  });
});

describe('affordableMaxSpend', () => {
  it('is unconstrained by an unknown pool (null) — the resolved cap is the only ceiling', () => {
    expect(affordableMaxSpend(2, 2, 12, null)).toBe(12);
  });

  it('clamps to the pool on a valid step boundary, never a partial step', () => {
    // Pool of 7: base 2 + step 2 -> {2,4,6}; 6 is the highest <= 7.
    expect(affordableMaxSpend(2, 2, 12, 7)).toBe(6);
  });

  it('never returns less than base_cost even when the pool barely covers it', () => {
    expect(affordableMaxSpend(2, 2, 12, 2)).toBe(2);
    expect(affordableMaxSpend(2, 2, 12, 3)).toBe(2); // one step needs 4, pool has 3
  });

  it('never exceeds the resolved cap even with a huge pool', () => {
    expect(affordableMaxSpend(2, 2, 4, 999)).toBe(4);
  });

  // Item 1 from the QA gate: a resolved max_spend that does NOT itself sit on
  // a step boundary from base_cost. base 2, step 2 -> valid spends are
  // {2,4,6,...}; a resolved cap of 5 must floor to 4, never expose 5 as
  // reachable.
  it('floors an off-boundary resolved max_spend down to the nearest valid step, with no pool constraint', () => {
    expect(affordableMaxSpend(2, 2, 5, null)).toBe(4);
  });

  it('floors an off-boundary resolved max_spend down to the nearest valid step, pool unconstraining', () => {
    expect(affordableMaxSpend(2, 2, 5, 999)).toBe(4);
  });

  it('a step_cost of 1 makes every integer in range a valid step', () => {
    expect(affordableMaxSpend(3, 1, 10, null)).toBe(10);
    expect(affordableMaxSpend(3, 1, 10, 7)).toBe(7);
  });

  // Item 2: the pool affords NOTHING — not even base_cost. The engine's
  // castable_now gate (C11) should mean this spell is never offered at all,
  // but the client still must not crash if it somehow is: affordableMaxSpend
  // never returns below base_cost (see its own doc comment), so the ceiling
  // is base_cost even though the character genuinely cannot afford it. This
  // is why CastSpellPanel's separate `spendOverPool` belt-and-suspenders gate
  // on the cast button exists — see CastSpellPanel.test.tsx's
  // 'pool affords less than base_cost' case, which proves the button is
  // still disabled in exactly this scenario.
  it('never returns below base_cost even when the pool cannot afford base_cost at all', () => {
    expect(affordableMaxSpend(2, 2, 4, 1)).toBe(2);
    expect(affordableMaxSpend(2, 2, 4, 0)).toBe(2);
  });

  // Item 1/5: a max_spend below base_cost (malformed row — the engine should
  // never send this, but the client renders before any server round-trip).
  // hardCap <= baseCost is already true from max_spend alone, so this
  // degrades the same way as an unaffordable pool: floor of base_cost, not a
  // crash or a negative range.
  it('degrades to base_cost, not a crash, when max_spend is below base_cost', () => {
    expect(affordableMaxSpend(5, 1, 3, null)).toBe(5);
    expect(affordableMaxSpend(5, 1, 3, 10)).toBe(5); // pool would allow more, cap forbids it
  });

  // Item 5 (degenerate row): step_cost of exactly 0 is explicitly guarded
  // (`stepCost <= 0`) rather than reaching the division on the next line —
  // pinned here so a future refactor that drops the guard turns this red
  // instead of silently reintroducing a division by zero.
  it('does not divide by zero when step_cost is 0 — returns base_cost', () => {
    expect(affordableMaxSpend(2, 0, 12, null)).toBe(2);
    expect(affordableMaxSpend(2, 0, 12, 20)).toBe(2);
  });

  it('does not divide by zero when step_cost is negative — returns base_cost', () => {
    expect(affordableMaxSpend(2, -2, 12, null)).toBe(2);
  });
});

describe('stepsFor', () => {
  it('computes whole steps above base_cost', () => {
    expect(stepsFor(ROAR, 2)).toBe(0);
    expect(stepsFor(ROAR, 4)).toBe(1);
    expect(stepsFor(ROAR, 12)).toBe(5);
  });

  it('floors rather than rounds a spend that somehow lands off-step', () => {
    expect(stepsFor(ROAR, 5)).toBe(1); // (5-2)/2 = 1.5 -> floor 1
  });

  it('clamps to zero for a spend below base_cost (defensive)', () => {
    expect(stepsFor(ROAR, 0)).toBe(0);
  });
});

describe('snapSpend', () => {
  it('passes through an already-valid spend', () => {
    expect(snapSpend(4, 2, 2, 12)).toBe(4);
  });

  it('snaps an off-step raw value to the nearest valid step', () => {
    expect(snapSpend(3, 2, 2, 12)).toBe(4); // rounds .5 up
    expect(snapSpend(5, 2, 2, 12)).toBe(6); // rounds .5 up
  });

  it('clamps below base_cost up to base_cost', () => {
    expect(snapSpend(0, 2, 2, 12)).toBe(2);
    expect(snapSpend(-5, 2, 2, 12)).toBe(2);
  });

  it('clamps above the ceiling down to the ceiling', () => {
    expect(snapSpend(999, 2, 2, 12)).toBe(12);
  });

  it('clamps exactly one step past the ceiling down to the ceiling, not one step further', () => {
    // base 2, step 2, ceiling 12: 14 is one step past 12.
    expect(snapSpend(14, 2, 2, 12)).toBe(12);
  });

  it('passes through a spend that lands exactly on the ceiling', () => {
    expect(snapSpend(12, 2, 2, 12)).toBe(12);
  });

  it('does not divide by zero when step_cost is 0 — returns base_cost regardless of raw', () => {
    expect(snapSpend(50, 2, 0, 12)).toBe(2);
    expect(snapSpend(0, 2, 0, 12)).toBe(2);
  });
});

describe('repeatNarrative', () => {
  it('returns null at zero steps — nothing extra to narrate at base cost', () => {
    expect(repeatNarrative(ROAR, 0)).toBeNull();
  });

  it('joins one copy of the narrative per step', () => {
    expect(repeatNarrative(ROAR, 1)).toBe('+15 ft of cone');
    expect(repeatNarrative(ROAR, 3)).toBe('+15 ft of cone, +15 ft of cone, +15 ft of cone');
  });

  it('returns null when the row has no per_step.narrative', () => {
    const noNarrative: SpellVariableCost = { ...ROAR, per_step: { damage_dice: '2d6' } };
    expect(repeatNarrative(noNarrative, 2)).toBeNull();
  });

  it('returns null when per_step is entirely absent (a spell that costs more without any narrated effect)', () => {
    const noPerStep: SpellVariableCost = { base_cost: 2, step_cost: 2, max_spend: 10 };
    expect(repeatNarrative(noPerStep, 2)).toBeNull();
  });
});

describe('stepDicePreview', () => {
  it('returns null at zero steps', () => {
    expect(stepDicePreview(ROAR, 0)).toBeNull();
  });

  it('formats the per-step dice as an increment, not a resolved total (contract gap: no base damage_dice on the wire)', () => {
    expect(stepDicePreview(ROAR, 1)).toBe('+1×2d6');
    expect(stepDicePreview(ROAR, 5)).toBe('+5×2d6');
  });

  it('returns null when the row has no per_step.damage_dice', () => {
    const noDice: SpellVariableCost = { ...ROAR, per_step: { narrative: 'x' } };
    expect(stepDicePreview(noDice, 2)).toBeNull();
  });

  it('returns null when per_step is entirely absent', () => {
    const noPerStep: SpellVariableCost = { base_cost: 2, step_cost: 2, max_spend: 10 };
    expect(stepDicePreview(noPerStep, 2)).toBeNull();
  });
});

// -----------------------------------------------------------------------
// Adversarial / malformed `variable_cost` (QA gate item 5, 2026-09-08).
//
// The engine rejects a malformed variable_cost row server-side, but the
// KNOWN-SPELLS payload that feeds this whole module is rendered client-side
// with no schema validation in between — so a bad row from that wire reaches
// these functions directly. Two of the four requested degenerate shapes
// (`step_cost: 0`, negative step_cost) are ALREADY handled gracefully and are
// pinned above. The other two are NOT — see the QA report
// (2026-09-08, HB-P7e spend stepper gate) for full repro and severity. These
// `it.todo`s are deliberately non-asserting placeholders, not skipped
// passing tests: asserting today's NaN output as "expected" would read as
// this bug being sanctioned. Ren-Dev: turn each into a real assertion once
// the corresponding fix lands, then delete this comment block.
// -----------------------------------------------------------------------
describe.skip('KNOWN DEFECTS — do not un-skip without a production fix (see QA report 2026-09-08)', () => {
  it.todo(
    'resolveMaxSpend on an unrecognized max_spend expression shape (e.g. {}) currently returns NaN ' +
      '(proficiencyBonus * undefined), which survives the `?? base_cost` fallback in CastSpellPanel ' +
      "because NaN is not null/undefined — repro: resolveMaxSpend({} as VariableCostMaxSpend, 2) is " +
      'NaN, not a thrown error or a safe fallback. Renders an <input type=\"range\" max=\"NaN\">. ' +
      'Fix should make resolveMaxSpend throw/fall back on any shape that is neither a number nor {pb_mult}.',
  );
  it.todo(
    'affordableMaxSpend/stepsFor/snapSpend with a missing/undefined base_cost currently produce NaN ' +
      'throughout (repro: affordableMaxSpend(undefined, 2, 10, null) is NaN) rather than a safe fallback.',
  );
});

describe('previewSpend', () => {
  it('at base cost (0 steps): no extra segment, pool remaining still announced', () => {
    const p = previewSpend(ROAR, 2, 'Magic Power', 20);
    expect(p.line).toBe('Spend 2 Magic Power');
    expect(p.live).toBe('Spend 2 Magic Power. 18 Magic Power remaining.');
  });

  it('with steps: dice + narrative segments joined, pool debited', () => {
    const p = previewSpend(ROAR, 6, 'Magic Power', 20);
    expect(p.line).toBe(
      'Spend 6 Magic Power → +2×2d6 · +15 ft of cone, +15 ft of cone',
    );
    expect(p.live).toBe(
      'Spend 6 Magic Power → +2×2d6 · +15 ft of cone, +15 ft of cone. 14 Magic Power remaining.',
    );
  });

  it('omits the remaining-pool clause when the pool is unknown', () => {
    const p = previewSpend(ROAR, 4, 'Magic Power', null);
    expect(p.live).toBe('Spend 4 Magic Power → +1×2d6 · +15 ft of cone.');
  });
});

describe('resourceLabelFor', () => {
  it('renders the class row\'s own label verbatim', () => {
    expect(resourceLabelFor('Magic Power')).toBe('Magic Power');
    expect(resourceLabelFor('Ki')).toBe('Ki');
  });

  it('falls back to "points" for an absent, null, or blank label — never a hardcoded "MP"', () => {
    expect(resourceLabelFor(undefined)).toBe('points');
    expect(resourceLabelFor(null)).toBe('points');
    expect(resourceLabelFor('')).toBe('points');
    expect(resourceLabelFor('   ')).toBe('points');
  });
});
