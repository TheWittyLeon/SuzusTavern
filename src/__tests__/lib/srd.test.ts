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
  BACKGROUND_DECORATION,
  DEFAULT_SCORES,
  POINT_BUY_BUDGET,
  abilityMod,
  applyRacialBonuses,
  costFor,
  derivedStats,
  formatMod,
  hasBackgroundBlurb,
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

describe('hasBackgroundBlurb (helpers — UIR2-TAV-22 render guard)', () => {
  it('true for a normal flavor string', () => {
    expect(hasBackgroundBlurb('you were good at the prayers.')).toBe(true);
  });

  it('false for an empty string', () => {
    expect(hasBackgroundBlurb('')).toBe(false);
  });

  it('false for a whitespace-only string', () => {
    expect(hasBackgroundBlurb('   ')).toBe(false);
  });

  it('false for null/undefined (defensive — WizardBackground.blurb is a plain string today)', () => {
    expect(hasBackgroundBlurb(null)).toBe(false);
    expect(hasBackgroundBlurb(undefined)).toBe(false);
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

describe('applyRacialBonuses — subrace + Half-Elf ASI (TAV-CREATE-SUBRACE-ASI-PICKER)', () => {
  it('adds the subrace bonus on top of the base race bonus', () => {
    const out = applyRacialBonuses(DEFAULT_SCORES, { dexterity: 2 }, { wisdom: 1 });
    expect(out.dexterity).toBe(10);
    expect(out.wisdom).toBe(9);
  });

  it('adds +1 for each Half-Elf ASI ability on top of the base +2 CHA', () => {
    const out = applyRacialBonuses(DEFAULT_SCORES, { charisma: 2 }, undefined, ['strength', 'dexterity']);
    expect(out.charisma).toBe(10);
    expect(out.strength).toBe(9);
    expect(out.dexterity).toBe(9);
    expect(out.constitution).toBe(8); // untouched
  });

  it('sums base + subrace + ASI before clamping — not three sequential clamps', () => {
    const scores: AbilityScores = { ...DEFAULT_SCORES, strength: 29 };
    // 29 + 1 (base) + 1 (subrace) + 1 (ASI) = 32, clamped to 30.
    const out = applyRacialBonuses(scores, { strength: 1 }, { strength: 1 }, ['strength', 'dexterity']);
    expect(out.strength).toBe(30);
  });

  it('omitting subraceBonuses/halfElfAsi behaves exactly like the 2-arg call', () => {
    const out = applyRacialBonuses(DEFAULT_SCORES, { charisma: 2 });
    expect(out.charisma).toBe(10);
    expect(out.strength).toBe(8);
  });
});

describe('derivedStats (helpers — display-only preview of cmd_create level-1 math)', () => {
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

  // TAV-WIZARD-UD-PREVIEW: the UD ability now comes from the class's DECLARED
  // unarmoredDefenseAbility (the catalog wire field), not barbarian/monk id
  // literals — the fixtures below mirror what catalogItemToClass actually
  // hands the wizard.

  it('Barbarian unarmored AC adds CON mod (declared, not id-matched)', () => {
    const scores: AbilityScores = {
      strength: 14,
      dexterity: 14,
      constitution: 16,
      intelligence: 8,
      wisdom: 10,
      charisma: 8,
    };
    const d = derivedStats(
      scores,
      { id: 'barbarian', hitDie: 12, unarmoredDefenseAbility: 'constitution' },
      25,
    );
    expect(d.ac).toBe(15); // 10 + 2 DEX + 3 CON
    expect(d.speed).toBe(25);
  });

  it('Monk unarmored AC adds WIS mod (declared, not id-matched)', () => {
    const scores: AbilityScores = {
      strength: 10,
      dexterity: 14,
      constitution: 12,
      intelligence: 10,
      wisdom: 14,
      charisma: 10,
    };
    const d = derivedStats(
      scores,
      { id: 'monk', hitDie: 8, unarmoredDefenseAbility: 'wisdom' },
      30,
    );
    expect(d.ac).toBe(14); // 10 + 2 DEX + 2 WIS
  });

  it('unarmored defense with a penalty never previews below plain 10+DEX (CALC-AC-UD RAW better-of)', () => {
    // Kage I1: the engine now takes the better calculation, so a WIS-8 monk
    // persists 10+DEX — the preview must not show one lower.
    const scores = {
      strength: 10,
      dexterity: 14,
      constitution: 12,
      intelligence: 10,
      wisdom: 8,
      charisma: 10,
    };
    const d = derivedStats(
      scores,
      { id: 'monk', hitDie: 8, unarmoredDefenseAbility: 'wisdom' },
      30,
    );
    expect(d.ac).toBe(12); // max(10+2, 10+2-1) — never 11
  });

  it('a HOMEBREW class with a declared UD ability previews UD AC — no id literals (HB-P1)', () => {
    // The whole point of the rider: pre-rider this previewed 10 + DEX while
    // the hint two steps earlier promised WIS-based AC (Kage IMPORTANT-3).
    const scores: AbilityScores = {
      strength: 10,
      dexterity: 14,
      constitution: 12,
      intelligence: 10,
      wisdom: 16,
      charisma: 10,
    };
    const d = derivedStats(
      scores,
      { id: 'chakra-adept', hitDie: 8, unarmoredDefenseAbility: 'wisdom' },
      30,
    );
    expect(d.ac).toBe(15); // 10 + 2 DEX + 3 WIS
  });

  it('barbarian/monk WITHOUT the declared field preview plain 10+DEX (wire is the truth)', () => {
    // No silent id-literal resurrection: if the wire field is absent (it is
    // never absent for SRD rows — the engine stamps the hardcoded fallback),
    // the preview does NOT guess from the class id.
    const scores: AbilityScores = {
      strength: 14,
      dexterity: 14,
      constitution: 16,
      intelligence: 8,
      wisdom: 10,
      charisma: 8,
    };
    expect(derivedStats(scores, { id: 'barbarian', hitDie: 12 }, 25).ac).toBe(12);
    expect(derivedStats(scores, { id: 'monk', hitDie: 8 }, 30).ac).toBe(12);
  });

  it('a declared DEX unarmored defense is ignored — no double-count (engine I3 mirror)', () => {
    const scores: AbilityScores = {
      strength: 10,
      dexterity: 18,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    };
    const d = derivedStats(
      scores,
      { id: 'chakra-adept', hitDie: 8, unarmoredDefenseAbility: 'dexterity' },
      30,
    );
    expect(d.ac).toBe(14); // 10 + 4 DEX, never 10 + 4 + 4
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

describe('catalogItemToRace — subraces + Half-Elf ASI (TAV-CREATE-SUBRACE-ASI-PICKER)', () => {
  it('parses named subraces into typed WizardSubrace entries', () => {
    const item = makeItem('elf', 'Elf', 'race', {
      ability_bonus: { dexterity: 2 },
      speed: 30,
      subraces: {
        'High Elf': { ability_bonus: { intelligence: 1 } },
        'Wood Elf': { ability_bonus: { wisdom: 1 }, speed: 35 },
      },
    });
    const race = catalogItemToRace(item);
    expect(race.subraces).toHaveLength(2);
    const wood = race.subraces.find((s) => s.name === 'Wood Elf');
    expect(wood?.bonuses).toEqual({ wisdom: 1 });
    expect(wood?.speed).toBe(35);
    expect(wood?.bonusLabel).toContain('+1 WIS');
    expect(race.needsAsiChoice).toBe(false);
  });

  it('defaults subraces to [] when the catalog omits data.subraces', () => {
    const item = makeItem('human', 'Human', 'race', { ability_bonus: { strength: 1 }, speed: 30 });
    const race = catalogItemToRace(item);
    expect(race.subraces).toEqual([]);
  });

  it('sets needsAsiChoice true only for the half-elf slug (Half-Elf has no subraces of its own)', () => {
    const item = makeItem('half-elf', 'Half-Elf', 'race', {
      ability_bonus: { charisma: 2 },
      speed: 30,
      subraces: {},
    });
    const race = catalogItemToRace(item);
    expect(race.needsAsiChoice).toBe(true);
    expect(race.subraces).toEqual([]);
  });

  it('a non-half-elf race never sets needsAsiChoice, even with subraces present', () => {
    const item = makeItem('elf', 'Elf', 'race', { ability_bonus: { dexterity: 2 }, subraces: { 'Wood Elf': {} } });
    const race = catalogItemToRace(item);
    expect(race.needsAsiChoice).toBe(false);
  });

  it('a cosmetic subrace with no ability_bonus (e.g. draconic ancestry) parses with an empty bonus map', () => {
    const item = makeItem('dragonborn', 'Dragonborn', 'race', {
      ability_bonus: { strength: 2, charisma: 1 },
      speed: 30,
      subraces: { 'Gold Dragonborn': {} },
    });
    const race = catalogItemToRace(item);
    expect(race.subraces[0].bonuses).toEqual({});
    expect(race.subraces[0].bonusLabel).toBe('none');
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

  // T4/DDX-11t — creation-wizard Spells step caster gate.
  it('marks a full-caster class (wizard) isCaster with its casterKind', () => {
    const item = makeItem('wizard', 'Wizard', 'class', { hit_die: 6, saving_throws: [] });
    const cls = catalogItemToClass(item);
    expect(cls.isCaster).toBe(true);
    expect(cls.casterKind).toBe('spellbook');
  });

  it('marks a prepared caster (cleric) with casterKind "prepared"', () => {
    const item = makeItem('cleric', 'Cleric', 'class', { hit_die: 8, saving_throws: [] });
    const cls = catalogItemToClass(item);
    expect(cls.isCaster).toBe(true);
    expect(cls.casterKind).toBe('prepared');
  });

  it('marks a non-caster class (fighter) isCaster false with no casterKind', () => {
    const item = makeItem('fighter', 'Fighter', 'class', { hit_die: 10, saving_throws: [] });
    const cls = catalogItemToClass(item);
    expect(cls.isCaster).toBe(false);
    expect(cls.casterKind).toBeUndefined();
  });

  it('marks a level-1 half-caster (paladin) isCaster false (no budget until level 2)', () => {
    const item = makeItem('paladin', 'Paladin', 'class', { hit_die: 10, saving_throws: [] });
    const cls = catalogItemToClass(item);
    expect(cls.isCaster).toBe(false);
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

  // UIR2-TAV-22 regression: the engine slugifies a multi-word background name
  // as "name.replace(' ', '-')" (NekoNova-DnDEngine scripts/import_srd.py::
  // build_backgrounds + engine/rules_catalog.py::_slugify) — e.g. "Folk Hero"
  // arrives as slug 'folk-hero', never 'folk hero'. BACKGROUND_DECORATION
  // previously keyed these two with a space, so the lookup silently missed
  // and the wizard rendered a literal "" flavor line.
  it('resolves Folk Hero flavor by its real dash-form catalog slug', () => {
    const item = makeItem('folk-hero', 'Folk Hero', 'background', {
      skills: ['animal_handling', 'survival'],
    });
    const bg = catalogItemToBackground(item);
    expect(bg.blurb).not.toBe('');
  });

  it('resolves Guild Artisan flavor by its real dash-form catalog slug', () => {
    const item = makeItem('guild-artisan', 'Guild Artisan', 'background', {
      skills: ['insight', 'persuasion'],
    });
    const bg = catalogItemToBackground(item);
    expect(bg.blurb).not.toBe('');
  });

  // Every background the engine actually seeds (engine/rules_catalog.py::
  // _BACKGROUND_SKILLS, dash-slugified the same way build_backgrounds does)
  // must resolve a real flavor line — guards against BACKGROUND_DECORATION
  // silently losing coverage again (UIR2-TAV-22 was 12 of these 23 blank).
  //
  // CAUTION (Miko-QA, UIR2-TAV-22 gate, 2026-07-10): this list is a
  // hand-copied snapshot of the engine's Python dict
  // (NekoNova-DnDEngine engine/rules_catalog.py::_BACKGROUND_SKILLS), not
  // fetched or generated from it — there is no cross-repo/cross-language
  // mechanism anywhere in this workspace that keeps the two in sync
  // automatically. Verified byte-for-byte accurate as of 2026-07-10 (23/23
  // keys match, dash-slugified). If the engine ever adds a 24th background or
  // renames one of these 23, THIS list will NOT notice on its own — it will
  // keep passing 23/23 green against a now-incomplete or stale set. The
  // sibling test below only closes the IN-REPO half of that risk (this list
  // vs. BACKGROUND_DECORATION's own keys silently drifting apart from each
  // other); closing the engine-side half needs either a live-engine-gated
  // integration test or a generated/vendored fixture with a sync check —
  // flagged as a follow-up, not built here.
  const ENGINE_BACKGROUND_SLUGS = [
    'acolyte', 'charlatan', 'criminal', 'entertainer', 'folk-hero',
    'guild-artisan', 'hermit', 'noble', 'outlander', 'sage', 'sailor',
    'soldier', 'urchin', 'spy', 'pirate', 'knight', 'gladiator',
    'haunted-one', 'far-traveler', 'city-watch', 'clan-crafter', 'courtier',
    'inheritor',
  ];

  it('every engine-seeded background slug resolves a non-empty flavor line', () => {
    for (const slug of ENGINE_BACKGROUND_SLUGS) {
      const item = makeItem(slug, slug, 'background', { skills: [] });
      const bg = catalogItemToBackground(item);
      expect(bg.blurb.trim().length).toBeGreaterThan(0);
    }
  });

  // In-repo desync guard: if someone edits BACKGROUND_DECORATION's key set
  // (add/remove/rename) without updating ENGINE_BACKGROUND_SLUGS to match —
  // or vice versa — this fails loudly instead of the exhaustive test above
  // silently continuing to test a stale or incomplete list forever.
  it("ENGINE_BACKGROUND_SLUGS matches BACKGROUND_DECORATION's own key set exactly", () => {
    expect(Object.keys(BACKGROUND_DECORATION).sort()).toEqual(
      [...ENGINE_BACKGROUND_SLUGS].sort(),
    );
  });
});
