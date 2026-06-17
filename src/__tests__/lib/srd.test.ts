/**
 * Unit tests for the SRD catalog (src/lib/dnd/srd.ts).
 *
 * These guard the engine-mirror invariants: the wizard's point-buy math,
 * racial-bonus application, and derived stats must match the dnd-engine, since
 * the engine re-validates and re-derives server-side. Drift here = a review
 * preview that lies about the saved character.
 */
import {
  ABILITY_KEYS,
  BACKGROUNDS,
  CLASSES,
  DEFAULT_SCORES,
  POINT_BUY_BUDGET,
  RACES,
  abilityMod,
  applyRacialBonuses,
  costFor,
  derivedStats,
  formatMod,
  getRace,
  pointsRemaining,
  pointsSpent,
  type AbilityScores,
} from '@/lib/dnd/srd';

describe('point buy', () => {
  it('costs mirror rules.point_buy_cost', () => {
    expect(costFor(8)).toBe(0);
    expect(costFor(9)).toBe(1);
    expect(costFor(13)).toBe(5);
    expect(costFor(14)).toBe(7);
    expect(costFor(15)).toBe(9);
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

describe('ability modifiers', () => {
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

describe('applyRacialBonuses (mirror of engine apply_racial_bonuses)', () => {
  it('Human adds +1 to every score', () => {
    const out = applyRacialBonuses(DEFAULT_SCORES, getRace('human'));
    for (const k of ABILITY_KEYS) expect(out[k]).toBe(9);
  });

  it('Tiefling adds +2 CHA and +1 INT only', () => {
    const out = applyRacialBonuses(DEFAULT_SCORES, getRace('tiefling'));
    expect(out.charisma).toBe(10);
    expect(out.intelligence).toBe(9);
    expect(out.strength).toBe(8);
  });

  it('Half-Elf adds only the fixed +2 CHA (choice bonuses are not applied at create)', () => {
    const out = applyRacialBonuses(DEFAULT_SCORES, getRace('half-elf'));
    expect(out.charisma).toBe(10);
    expect(out.dexterity).toBe(8);
  });

  it('does not mutate the input', () => {
    const base = { ...DEFAULT_SCORES };
    applyRacialBonuses(base, getRace('human'));
    expect(base.strength).toBe(8);
  });
});

describe('derivedStats (mirror of cmd_create level-1 math)', () => {
  it('Fighter d10 + CON 14 → 12 HP, AC 10 + DEX mod', () => {
    const scores: AbilityScores = {
      strength: 14,
      dexterity: 14,
      constitution: 14,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    };
    const d = derivedStats(scores, CLASSES.find((c) => c.id === 'fighter'), getRace('human'));
    expect(d.maxHp).toBe(12); // 10 + 2
    expect(d.ac).toBe(12); // 10 + 2 DEX
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
    const d = derivedStats(scores, CLASSES.find((c) => c.id === 'barbarian'), getRace('dwarf'));
    expect(d.ac).toBe(15); // 10 + 2 DEX + 3 CON
    expect(d.speed).toBe(25);
  });
});

describe('catalog integrity vs the engine', () => {
  it('has 9 SRD races, 12 classes, 13 backgrounds', () => {
    expect(RACES).toHaveLength(9);
    expect(CLASSES).toHaveLength(12);
    expect(BACKGROUNDS).toHaveLength(13);
  });

  it('every id is the lowercase of its canonical name (engine lookup key)', () => {
    for (const r of RACES) expect(r.id).toBe(r.name.toLowerCase());
    for (const c of CLASSES) expect(c.id).toBe(c.name.toLowerCase());
    for (const b of BACKGROUNDS) expect(b.id).toBe(b.name.toLowerCase());
  });

  it('race ids match the engine SRD_RACES keys', () => {
    const ids = RACES.map((r) => r.id).sort();
    expect(ids).toEqual(
      [
        'human',
        'elf',
        'dwarf',
        'halfling',
        'dragonborn',
        'gnome',
        'half-elf',
        'half-orc',
        'tiefling',
      ].sort(),
    );
  });

  it('every class declares exactly two saving throws', () => {
    for (const c of CLASSES) expect(c.saves).toHaveLength(2);
  });

  it('every background grants exactly two skills', () => {
    for (const b of BACKGROUNDS) expect(b.skills).toHaveLength(2);
  });
});
