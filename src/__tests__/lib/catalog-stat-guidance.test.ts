/**
 * TAV-CLASS-STAT-GUIDANCE — pins the CONSUMER's wire at the Tavern's own
 * adapter seam: `catalogItemToClass` maps `primary_ability` /
 * `spellcasting_ability` / `unarmored_defense_ability` exactly as the browser
 * receives them from GET /api/dnd/catalog (through the NekoNova proxy + BFF
 * passthroughs), and degrades malformed wire data to "no guidance" instead of
 * crashing the wizard. This adapter is the third-hop layer that silently
 * dropped new wire fields twice before (check-retry; starting_level +
 * casting_model) — these tests go red if the mapping is removed.
 */
import { catalogItemToClass } from '../../lib/dnd/catalog';
import type { CatalogItem } from '../../lib/api/types';

function classItem(slug: string, data: Record<string, unknown>): CatalogItem {
  return {
    slug,
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    content_type: 'class',
    source_type: 'srd',
    public_id: `dnd5e:class:${slug}`,
    pack_id: 'srd-5e',
    data,
  };
}

describe('catalogItemToClass — stat guidance (TAV-CLASS-STAT-GUIDANCE)', () => {
  it('maps all three guidance fields from the wire data', () => {
    const monk = catalogItemToClass(
      classItem('monk', {
        hit_die: 8,
        saving_throws: ['strength', 'dexterity'],
        primary_ability: ['dexterity', 'wisdom'],
        unarmored_defense_ability: 'wisdom',
      }),
    );
    expect(monk.primary).toEqual(['dexterity', 'wisdom']);
    expect(monk.unarmoredDefenseAbility).toBe('wisdom');
    expect(monk.spellcastingAbility).toBeUndefined();

    const sorcerer = catalogItemToClass(
      classItem('sorcerer', {
        hit_die: 6,
        primary_ability: ['charisma'],
        spellcasting_ability: 'charisma',
      }),
    );
    expect(sorcerer.primary).toEqual(['charisma']);
    expect(sorcerer.spellcastingAbility).toBe('charisma');
    expect(sorcerer.unarmoredDefenseAbility).toBeUndefined();
  });

  it('absent guidance maps to []/undefined — nothing is fabricated', () => {
    const hb = catalogItemToClass(classItem('chakra-adept', { hit_die: 8 }));
    expect(hb.primary).toEqual([]);
    expect(hb.spellcastingAbility).toBeUndefined();
    expect(hb.unarmoredDefenseAbility).toBeUndefined();
  });

  it('a garbage primary_ability string does not crash and maps to []', () => {
    // The engine normalises, but this adapter never trusts the wire: a
    // string here would throw on .filter without the Array.isArray guard.
    const hb = catalogItemToClass(
      classItem('chakra-adept', { hit_die: 8, primary_ability: 'STR' }),
    );
    expect(hb.primary).toEqual([]);
  });

  it('unknown ability entries are dropped, valid ones kept', () => {
    const hb = catalogItemToClass(
      classItem('chakra-adept', {
        hit_die: 8,
        primary_ability: ['dexterity', 'luck'],
        spellcasting_ability: 'luck',
        unarmored_defense_ability: 42,
      }),
    );
    expect(hb.primary).toEqual(['dexterity']);
    expect(hb.spellcastingAbility).toBeUndefined();
    expect(hb.unarmoredDefenseAbility).toBeUndefined();
  });

  // ── ADVERSARIAL (Miko-QA) ────────────────────────────────────────────────────
  it('primary_ability entries that are not strings at all (number/null/object/bool) are dropped without crashing, valid strings kept', () => {
    // isAbilityKey short-circuits on typeof before the `in` check, but that's
    // an implementation detail — pin the OBSERVABLE behavior so a future
    // refactor that drops the typeof guard goes red here, not in prod.
    const hb = catalogItemToClass(
      classItem('chakra-adept', {
        hit_die: 8,
        primary_ability: [1, null, undefined, {}, true, ['nested'], 'dexterity', 'wisdom'],
      }),
    );
    expect(hb.primary).toEqual(['dexterity', 'wisdom']);
  });

  it('an explicit null for primary_ability (not just absent) maps to [] — Array.isArray guard, not a truthiness check', () => {
    const hb = catalogItemToClass(
      classItem('chakra-adept', { hit_die: 8, primary_ability: null }),
    );
    expect(hb.primary).toEqual([]);
  });

  it('Object.prototype key names on the wire are rejected, not rendered (Kage IMPORTANT-2)', () => {
    // `"toString" in ABILITY_ABBR` is TRUE via the prototype chain — the old
    // `in`-based guard would have cast it to AbilityKey and the label helpers'
    // `?? k.toUpperCase()` fallback would render "Suggested focus: TOSTRING".
    // The guard must consult the real six-key truth table (ABILITY_KEYS).
    const hb = catalogItemToClass(
      classItem('chakra-adept', {
        hit_die: 8,
        primary_ability: ['toString', 'constructor', 'hasOwnProperty', 'dexterity'],
        spellcasting_ability: 'valueOf',
        unarmored_defense_ability: '__proto__',
      }),
    );
    expect(hb.primary).toEqual(['dexterity']);
    expect(hb.spellcastingAbility).toBeUndefined();
    expect(hb.unarmoredDefenseAbility).toBeUndefined();
  });

  it('guidance mapping leaves the existing class fields untouched', () => {
    const monk = catalogItemToClass(
      classItem('monk', {
        hit_die: 8,
        saving_throws: ['strength', 'dexterity'],
        primary_ability: ['dexterity', 'wisdom'],
      }),
    );
    expect(monk.id).toBe('monk');
    expect(monk.hitDie).toBe(8);
    expect(monk.saves).toEqual(['strength', 'dexterity']);
    expect(monk.isCaster).toBe(false);
  });
});
