/**
 * S2.4 — tests for the catalog-driven character creation layer.
 *
 * Replaces the old srd.ts tests (hardcoded catalog, now deleted). Covers:
 *   1. helpers.ts — point-buy math, ability modifiers, applyRacialBonuses,
 *      derivedStats (invariants the wizard preview depends on).
 *   2. Catalog adapter — catalogItemToRace / catalogItemToClass /
 *      catalogItemToBackground transform raw items into wizard shapes.
 *
 * Catalog API client tests (getCatalog / getSystems / getSystemDefinition)
 * live in src/__tests__/lib/catalog-client.test.ts (node environment).
 */

// ── 1. helpers.ts ─────────────────────────────────────────────────────────────

import {
  ABILITY_KEYS,
  DEFAULT_SCORES,
  POINT_BUY_BUDGET,
  abilityMod,
  applyRacialBonuses,
  costFor,
  derivedStats,
  formatMod,
  humanizeSkill,
  pointsRemaining,
  pointsSpent,
  type AbilityScores,
} from '@/lib/dnd/helpers';

describe('point buy (helpers)', () => {
  it('costs mirror rules.point_buy_cost', () => {
    expect(costFor(8)).toBe(0);
    expect(costFor(9)).toBe(1);
    expect(costFor(13)).toBe(5);
    expect(costFor(14)).toBe(7);
    expect(costFor(15)).toBe(9);
  });

  it('out-of-range score → Infinity (budget gate stays correct)', () => {
    expect(costFor(16)).toBe(Infinity);
    expect(costFor(7)).toBe(Infinity);
  });

  it('defaults to all 8s = 0 spent, 27 remaining', () => {
    expect(pointsSpent(DEFAULT_SCORES)).toBe(0);
    expect(pointsRemaining(DEFAULT_SCORES)).toBe(POINT_BUY_BUDGET);
  });

  it('a maxed legal spread spends exactly 27', () => {
    const spread: AbilityScores = {
      strength: 15,
      dexterity: 14,
      constitution: 13,
      intelligence: 12,
      wisdom: 10,
      charisma: 8,
    };
    expect(pointsSpent(spread)).toBe(27);
    expect(pointsRemaining(spread)).toBe(0);
  });
});

describe('ability modifiers (helpers)', () => {
  it('floor((score - 10) / 2)', () => {
    expect(abilityMod(8)).toBe(-1);
    expect(abilityMod(10)).toBe(0);
    expect(abilityMod(15)).toBe(2);
    expect(abilityMod(16)).toBe(3);
    expect(abilityMod(20)).toBe(5);
  });

  it('formats with a sign', () => {
    expect(formatMod(8)).toBe('-1');
    expect(formatMod(10)).toBe('+0');
    expect(formatMod(16)).toBe('+3');
  });
});

describe('humanizeSkill (helpers)', () => {
  it('capitalizes each word from snake_case', () => {
    expect(humanizeSkill('sleight_of_hand')).toBe('Sleight Of Hand');
    expect(humanizeSkill('animal_handling')).toBe('Animal Handling');
    expect(humanizeSkill('stealth')).toBe('Stealth');
  });
});

describe('applyRacialBonuses (helpers — mirrors engine apply_racial_bonuses)', () => {
  it('applies bonuses to each affected ability', () => {
    const out = applyRacialBonuses(DEFAULT_SCORES, { charisma: 2, intelligence: 1 });
    expect(out.charisma).toBe(10);
    expect(out.intelligence).toBe(9);
    expect(out.strength).toBe(8); // unaffected
  });

  it('applies +1 to all when all abilities are in the bonus map', () => {
    const allOne = Object.fromEntries(ABILITY_KEYS.map((k) => [k, 1])) as Record<string, number>;
    const out = applyRacialBonuses(DEFAULT_SCORES, allOne);
    for (const k of ABILITY_KEYS) expect(out[k]).toBe(9);
  });

  it('clamps to 1 at the low end', () => {
    const out = applyRacialBonuses(DEFAULT_SCORES, { strength: -10 });
    expect(out.strength).toBe(1);
  });

  it('clamps to 30 at the high end', () => {
    const scores: AbilityScores = { ...DEFAULT_SCORES, strength: 29 };
    const out = applyRacialBonuses(scores, { strength: 5 });
    expect(out.strength).toBe(30);
  });

  it('does not mutate the input', () => {
    const base = { ...DEFAULT_SCORES };
    applyRacialBonuses(base, { strength: 2 });
    expect(base.strength).toBe(8);
  });

  it('undefined bonuses pass scores through unchanged', () => {
    const out = applyRacialBonuses(DEFAULT_SCORES, undefined);
    expect(out).toEqual(DEFAULT_SCORES);
  });
});

describe('derivedStats (helpers — mirrors cmd_create level-1 math)', () => {
  it('Fighter d10 + CON 14 → 12 HP, AC 10 + DEX mod', () => {
    const scores: AbilityScores = {
      strength: 14,
      dexterity: 14,
      constitution: 14,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    };
    const d = derivedStats(scores, { id: 'fighter', hitDie: 10 }, 30);
    expect(d.maxHp).toBe(12); // 10 + 2
    expect(d.ac).toBe(12);    // 10 + 2 DEX
    expect(d.initiative).toBe(2);
    expect(d.proficiencyBonus).toBe(2);
    expect(d.speed).toBe(30);
  });

  it('Barbarian unarmored AC adds CON mod', () => {
    const scores: AbilityScores = {
      strength: 14,
      dexterity: 14,
      constitution: 16,
      intelligence: 8,
      wisdom: 10,
      charisma: 8,
    };
    const d = derivedStats(scores, { id: 'barbarian', hitDie: 12 }, 25);
    expect(d.ac).toBe(15); // 10 + 2 DEX + 3 CON
    expect(d.speed).toBe(25);
  });

  it('Monk unarmored AC adds WIS mod', () => {
    const scores: AbilityScores = {
      strength: 10,
      dexterity: 14,
      constitution: 12,
      intelligence: 10,
      wisdom: 14,
      charisma: 10,
    };
    const d = derivedStats(scores, { id: 'monk', hitDie: 8 }, 30);
    expect(d.ac).toBe(14); // 10 + 2 DEX + 2 WIS
  });

  it('undefined class falls back to d8 hit die', () => {
    const d = derivedStats(DEFAULT_SCORES, undefined, 30);
    expect(d.maxHp).toBe(7); // 8 + (-1 CON at score 8)
  });
});

// ── 2. Catalog adapter (catalogItemToRace / Class / Background) ───────────────

import {
  catalogItemToRace,
  catalogItemToClass,
  catalogItemToBackground,
} from '@/lib/dnd/catalog';
import type { CatalogItem } from '@/lib/api/types';

function makeItem(slug: string, name: string, contentType: string, data: Record<string, unknown>): CatalogItem {
  return { slug, name, content_type: contentType, source_type: 'srd', data };
}

describe('catalogItemToRace', () => {
  it('extracts mechanical fields from catalog data', () => {
    const item = makeItem('elf', 'Elf', 'race', {
      ability_bonus: { dexterity: 2 },
      speed: 30,
    });
    const race = catalogItemToRace(item);
    expect(race.id).toBe('elf');
    expect(race.name).toBe('Elf');
    expect(race.bonuses).toEqual({ dexterity: 2 });
    expect(race.speed).toBe(30);
    expect(race.bonusLabel).toContain('+2');
    expect(race.bonusLabel).toContain('DEX');
  });

  it('applies decoration (icon, sub) from the local table', () => {
    const item = makeItem('dwarf', 'Dwarf', 'race', { ability_bonus: { constitution: 2 }, speed: 25 });
    const race = catalogItemToRace(item);
    expect(race.icon).toBe('Shield');
    expect(race.sub).toContain('stoic');
  });

  it('falls back gracefully for an unknown slug', () => {
    const item = makeItem('new-race', 'New Race', 'race', { ability_bonus: {}, speed: 30 });
    const race = catalogItemToRace(item);
    expect(race.icon).toBe('Users');
    expect(race.sub).toBe('');
    expect(race.speed).toBe(30);
  });

  it('defaults speed to 30 when absent from data', () => {
    const item = makeItem('human', 'Human', 'race', { ability_bonus: { strength: 1 } });
    const race = catalogItemToRace(item);
    expect(race.speed).toBe(30);
  });

  it('buildBonusLabel: multiple bonuses are joined with " · " separator', () => {
    // Human has +1 to all six abilities — exercises the multi-entry join path.
    const item = makeItem('human', 'Human', 'race', {
      ability_bonus: { strength: 1, dexterity: 1, constitution: 1, intelligence: 1, wisdom: 1, charisma: 1 },
      speed: 30,
    });
    const race = catalogItemToRace(item);
    // All six abilities should appear; entries are joined with " · ".
    expect(race.bonusLabel).toContain(' · ');
    expect(race.bonusLabel.split(' · ')).toHaveLength(6);
    expect(race.bonusLabel).toContain('+1 STR');
    expect(race.bonusLabel).toContain('+1 CHA');
  });

  it('buildBonusLabel: empty bonus map returns "none"', () => {
    // Races with no mechanical bonuses (e.g. a homebrew slug) should not
    // display a broken label — the function must return the literal "none".
    const item = makeItem('new-race', 'New Race', 'race', { ability_bonus: {}, speed: 30 });
    const race = catalogItemToRace(item);
    expect(race.bonusLabel).toBe('none');
  });
});

describe('catalogItemToClass', () => {
  it('extracts hitDie and saves from catalog data', () => {
    const item = makeItem('fighter', 'Fighter', 'class', {
      hit_die: 10,
      saving_throws: ['strength', 'constitution'],
    });
    const cls = catalogItemToClass(item);
    expect(cls.id).toBe('fighter');
    expect(cls.hitDie).toBe(10);
    expect(cls.saves).toEqual(['strength', 'constitution']);
  });

  it('applies decoration (icon, accent, flavor) from the local table', () => {
    const item = makeItem('rogue', 'Rogue', 'class', { hit_die: 8, saving_throws: ['dexterity', 'intelligence'] });
    const cls = catalogItemToClass(item);
    expect(cls.icon).toBe('Rogue');
    expect(cls.accent).toBe('var(--accent)');
    expect(cls.flavor).toContain('Sneak');
  });

  it('falls back to d8 hit die when absent', () => {
    const item = makeItem('unknown-class', 'Unknown', 'class', { saving_throws: [] });
    const cls = catalogItemToClass(item);
    expect(cls.hitDie).toBe(8);
  });

  it('filters saves to valid ability keys only', () => {
    const item = makeItem('wizard', 'Wizard', 'class', {
      hit_die: 6,
      saving_throws: ['intelligence', 'wisdom', 'not_an_ability'],
    });
    const cls = catalogItemToClass(item);
    expect(cls.saves).toEqual(['intelligence', 'wisdom']);
  });
});

describe('catalogItemToBackground', () => {
  it('extracts skills from catalog data', () => {
    const item = makeItem('charlatan', 'Charlatan', 'background', {
      skills: ['deception', 'sleight_of_hand'],
    });
    const bg = catalogItemToBackground(item);
    expect(bg.id).toBe('charlatan');
    expect(bg.name).toBe('Charlatan');
    expect(bg.skills).toEqual(['deception', 'sleight_of_hand']);
  });

  it('applies blurb from the local decoration table', () => {
    const item = makeItem('acolyte', 'Acolyte', 'background', { skills: ['insight', 'religion'] });
    const bg = catalogItemToBackground(item);
    expect(bg.blurb).toContain('prayers');
  });

  it('falls back gracefully for an unknown slug', () => {
    const item = makeItem('new-bg', 'New BG', 'background', { skills: ['arcana'] });
    const bg = catalogItemToBackground(item);
    expect(bg.blurb).toBe('');
    expect(bg.skills).toEqual(['arcana']);
  });

  it('defaults to empty skills when absent', () => {
    const item = makeItem('acolyte', 'Acolyte', 'background', {});
    const bg = catalogItemToBackground(item);
    expect(bg.skills).toEqual([]);
  });
});
