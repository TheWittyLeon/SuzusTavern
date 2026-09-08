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
