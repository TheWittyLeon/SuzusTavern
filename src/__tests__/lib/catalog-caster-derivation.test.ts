/**
 * TAV-WIZARD-HOMEBREW-CASTERS — pins `catalogItemToClass`'s data-driven
 * caster derivation, replacing the old hardcoded `CLASS_CASTER_KIND` 6-class
 * map. Wire fixtures below are taken verbatim from NekoNova-DnDEngine's own
 * `SRD_CLASSES` registry (read via `engine.classes.SRD_CLASSES[...].
 * spellcasting`, 2026-09-07) for the twelve SRD classes, and from the
 * `leon-naruto-5e`/`leon-fairytail-5e` seed packs' `10-classes.json` rows for
 * the two homebrew packs checked into this workspace. The DBZ "Ki Warrior"
 * pack is NOT checked into this repo (private, confirmed via
 * NekoNova-DnDEngine's `tests/test_feature_picks_freeform.py` docstring) —
 * its fixture below is authored to match that test file's own description
 * (`subclass_level:1`, `casting_model:"points"`, `feature_choices[0].
 * freeform:true`) rather than a live wire capture.
 */
import { catalogItemToClass, catalogItemToSubclass, subclassesForClass } from '../../lib/dnd/catalog';
import type { CatalogItem } from '../../lib/api/types';

function classItem(slug: string, name: string, data: Record<string, unknown>): CatalogItem {
  return {
    slug,
    name,
    content_type: 'class',
    source_type: 'srd',
    data,
  };
}

function subclassItem(slug: string, name: string, data: Record<string, unknown>): CatalogItem {
  return {
    slug,
    name,
    content_type: 'subclass',
    source_type: 'srd',
    data,
  };
}

describe('catalogItemToClass — caster derivation (TAV-WIZARD-HOMEBREW-CASTERS)', () => {
  // ── SRD six — byte-identical to the old CLASS_CASTER_KIND map ────────────
  it.each([
    ['bard', 'charisma', 'known'],
    ['sorcerer', 'charisma', 'known'],
    ['warlock', 'charisma', 'known'],
    ['cleric', 'wisdom', 'prepared'],
    ['druid', 'wisdom', 'prepared'],
    ['wizard', 'intelligence', 'spellbook'],
  ])('%s -> isCaster:true, casterKind:%s', (slug, ability, expectedKind) => {
    const isPrepared = expectedKind === 'prepared' || expectedKind === 'spellbook';
    const preparesFromSpellbook = expectedKind === 'spellbook';
    const cls = catalogItemToClass(
      classItem(slug, slug.charAt(0).toUpperCase() + slug.slice(1), {
        hit_die: 8,
        spellcasting: {
          ability,
          progression: slug === 'warlock' ? 'pact' : 'full',
          casting_model: slug === 'warlock' ? 'slots' : null,
          is_prepared_caster: isPrepared,
          prepares_from_spellbook: preparesFromSpellbook,
          pact_magic: slug === 'warlock',
        },
      }),
    );
    expect(cls.isCaster).toBe(true);
    expect(cls.casterKind).toBe(expectedKind);
    expect(cls.castingModel).toBe('slots');
    expect(cls.pointsLabel).toBe('Spell points');
  });

  // ── Non-caster control (spellcasting: null on the wire) ───────────────────
  it('fighter (spellcasting: null) -> isCaster:false, casterKind:undefined', () => {
    const cls = catalogItemToClass(
      classItem('fighter', 'Fighter', { hit_die: 10, spellcasting: null }),
    );
    expect(cls.isCaster).toBe(false);
    expect(cls.casterKind).toBeUndefined();
    expect(cls.castingModel).toBe('slots');
  });

  it('a class row with NO spellcasting key at all (v1 row) -> isCaster:false', () => {
    const cls = catalogItemToClass(classItem('rogue', 'Rogue', { hit_die: 8 }));
    expect(cls.isCaster).toBe(false);
    expect(cls.casterKind).toBeUndefined();
  });

  // ── Half-caster exclusion — the reason isCaster isn't just "block present" ─
  it.each([
    ['paladin', 'charisma', true],
    ['ranger', 'wisdom', false],
  ])(
    '%s declares a real spellcasting block (progression:half) but stays isCaster:false at creation',
    (slug, ability, isPrepared) => {
      const cls = catalogItemToClass(
        classItem(slug, slug.charAt(0).toUpperCase() + slug.slice(1), {
          hit_die: 10,
          spellcasting: {
            ability,
            progression: 'half',
            casting_model: null,
            is_prepared_caster: isPrepared,
            prepares_from_spellbook: false,
            pact_magic: false,
          },
        }),
      );
      // Half-progression's level-1 slot table is EMPTY (engine/progressions.py
      // HALF_CASTER[1] === {}) — zero spell budget at creation, so this must
      // stay byte-identical to the old hardcoded map's exclusion.
      expect(cls.isCaster).toBe(false);
      expect(cls.casterKind).toBeUndefined();
    },
  );

  it('a third-progression declaration (Eldritch Knight/Arcane Trickster shape) also stays non-caster', () => {
    const cls = catalogItemToClass(
      classItem('fighter', 'Fighter', {
        hit_die: 10,
        spellcasting: {
          ability: 'intelligence',
          progression: 'third',
          casting_model: null,
          is_prepared_caster: false,
          prepares_from_spellbook: false,
        },
      }),
    );
    expect(cls.isCaster).toBe(false);
  });

  // ── Homebrew points casters — the actual regression target ───────────────
  it('Fairy Tail ft-caster/ft-holder/ft-slayer -> points/known', () => {
    for (const [slug, ability] of [
      ['ft-caster', 'charisma'],
      ['ft-holder', 'intelligence'],
      ['ft-slayer', 'constitution'],
    ] as const) {
      const cls = catalogItemToClass(
        classItem(slug, slug, {
          hit_die: 8,
          subclass_level: 1,
          spellcasting: {
            ability,
            progression: 'full',
            casting_model: 'points',
            points_label: 'Magic Power',
            is_prepared_caster: false,
            prepares_from_spellbook: false,
            pact_magic: false,
          },
          feature_choices: [
            {
              label: 'Magic Rung',
              known: { '1': 1, '3': 2, '5': 3, '11': 4, '18': 5 },
              freeform: true,
              options: [
                { slug: 'fire-magic-ember-lance', name: 'Ember Lance', level: 1, subclass: 'ft-fire-magic' },
              ],
            },
          ],
        }),
      );
      expect(cls.isCaster).toBe(true);
      expect(cls.casterKind).toBe('known');
      expect(cls.castingModel).toBe('points');
      expect(cls.pointsLabel).toBe('Magic Power');
      expect(cls.subclassLevel).toBe(1);
      expect(cls.rungMenu?.knownAtLevel1).toBe(1);
      expect(cls.rungMenu?.freeform).toBe(true);
    }
  });

  it('Naruto shinobi -> points/known, subclassLevel 1, Rung menu known["1"]=1', () => {
    const cls = catalogItemToClass(
      classItem('shinobi', 'Shinobi', {
        hit_die: 8,
        subclass_level: 1,
        spellcasting: {
          ability: 'wisdom',
          progression: 'full',
          casting_model: 'points',
          points_label: 'Chakra',
          is_prepared_caster: false,
          prepares_from_spellbook: false,
          pact_magic: false,
        },
        feature_choices: [
          {
            label: 'Path Technique',
            known: { '1': 1, '3': 2, '6': 3, '10': 4, '18': 5 },
            freeform: true,
            options: [
              {
                slug: 'fire-release-flame-bullet',
                name: 'Fire Release: Flame Bullet (Ninjutsu)',
                level: 1,
                subclass: 'ninjutsu-specialist',
              },
              {
                slug: 'earth-release-earth-style-wall',
                name: 'Earth Release: Earth-Style Wall (Ninjutsu)',
                level: 1,
                subclass: 'ninjutsu-specialist',
              },
            ],
          },
        ],
      }),
    );
    expect(cls.isCaster).toBe(true);
    expect(cls.casterKind).toBe('known');
    expect(cls.castingModel).toBe('points');
    expect(cls.pointsLabel).toBe('Chakra');
    expect(cls.subclassLevel).toBe(1);
    expect(cls.rungMenu).toEqual({
      label: 'Path Technique',
      freeform: true,
      knownAtLevel1: 1,
      options: [
        {
          slug: 'fire-release-flame-bullet',
          name: 'Fire Release: Flame Bullet (Ninjutsu)',
          level: 1,
          subclass: 'ninjutsu-specialist',
        },
        {
          slug: 'earth-release-earth-style-wall',
          name: 'Earth Release: Earth-Style Wall (Ninjutsu)',
          level: 1,
          subclass: 'ninjutsu-specialist',
        },
      ],
    });
  });

  it('DBZ Ki Warrior (authored fixture, private pack not in this repo) -> points, subclassLevel 1, freeform Rung menu', () => {
    const cls = catalogItemToClass(
      classItem('ki-warrior', 'Ki Warrior', {
        hit_die: 10,
        subclass_level: 1,
        spellcasting: {
          ability: 'constitution',
          progression: 'full',
          casting_model: 'points',
          points_label: 'Ki',
          is_prepared_caster: false,
          prepares_from_spellbook: false,
          pact_magic: false,
        },
        feature_choices: [
          {
            label: 'Techniques',
            known: { '1': 1 },
            freeform: true,
            options: [
              { slug: 'ki-blast', name: 'Ki Blast', level: 1, subclass: 'turtle-school' },
              { slug: 'ki-focus', name: 'Ki Focus', level: 1, subclass: 'crane-school' },
            ],
          },
        ],
      }),
    );
    expect(cls.isCaster).toBe(true);
    expect(cls.castingModel).toBe('points');
    expect(cls.pointsLabel).toBe('Ki');
    expect(cls.subclassLevel).toBe(1);
    expect(cls.rungMenu?.knownAtLevel1).toBe(1);
  });

  // ── points_label fallback ───────────────────────────────────────────────
  it('a points caster with no declared points_label falls back to "Spell points"', () => {
    const cls = catalogItemToClass(
      classItem('homebrew-points', 'Homebrew Points', {
        hit_die: 8,
        spellcasting: {
          ability: 'wisdom',
          progression: 'full',
          casting_model: 'points',
          is_prepared_caster: false,
          prepares_from_spellbook: false,
        },
      }),
    );
    expect(cls.castingModel).toBe('points');
    expect(cls.pointsLabel).toBe('Spell points');
  });

  // ── subclass_level / rungMenu absence ─────────────────────────────────────
  it('subclassLevel is undefined when the class row omits subclass_level', () => {
    const cls = catalogItemToClass(classItem('rogue', 'Rogue', { hit_die: 8 }));
    expect(cls.subclassLevel).toBeUndefined();
    expect(cls.rungMenu).toBeUndefined();
  });

  it('warlock declares a feature_choices menu whose level-1 known count is 0 (Eldritch Invocations start at level 2)', () => {
    const cls = catalogItemToClass(
      classItem('warlock', 'Warlock', {
        hit_die: 8,
        spellcasting: {
          ability: 'charisma',
          progression: 'pact',
          casting_model: 'slots',
          is_prepared_caster: false,
          prepares_from_spellbook: false,
          pact_magic: true,
        },
        feature_choices: [
          {
            label: 'Eldritch Invocations',
            known: { '1': 0, '2': 2 },
            options: [{ slug: 'agonizing-blast', name: 'Agonizing Blast', level: 2 }],
          },
        ],
      }),
    );
    expect(cls.rungMenu?.knownAtLevel1).toBe(0);
    expect(cls.rungMenu?.freeform).toBe(false);
  });
});

describe('subclassesForClass / catalogItemToSubclass (TAV-WIZARD-HOMEBREW-CASTERS)', () => {
  it('filters subclass rows by class, slugifying BOTH sides (TAV-SUBCLASS-CLASSKEY-MISMATCH)', () => {
    const items = [
      subclassItem('turtle-school', 'Turtle School', { class: 'ki-warrior', description: 'Patience.' }),
      subclassItem('crane-school', 'Crane School', { class: 'ki-warrior', description: 'Precision.' }),
      subclassItem('champion', 'Champion', { class: 'fighter' }),
    ];
    // "Ki Warrior" (display name, spaced) vs "ki-warrior" (wire slug) — the
    // exact multi-word mismatch that regressed once already.
    const filtered = subclassesForClass(items, 'Ki Warrior');
    expect(filtered.map((i) => i.slug)).toEqual(['turtle-school', 'crane-school']);
  });

  it('an unmatched class yields an empty list, not a crash', () => {
    const items = [subclassItem('champion', 'Champion', { class: 'fighter' })];
    expect(subclassesForClass(items, 'Wizard')).toEqual([]);
  });

  // TAV-FT-SUBCLASS-SLUG-PREFIX (2026-09-07): a class whose SLUG carries a
  // prefix its NAME doesn't ("Caster (Fairy Tail)" -> `ft-caster`, verified
  // live against 59 seeded FT subclass rows keyed `class:"ft-caster"`).
  // slugifyName can only normalise shape (case/spaces), never bridge that
  // prefix gap — passing the class's real SLUG is the only comparison that
  // can work; passing the display name can't, by construction.
  it('SLUG key ("ft-caster") matches Fairy Tail subclass rows the display name cannot bridge', () => {
    const items = [
      subclassItem('ft-fire-magic', 'Fire Magic', { class: 'ft-caster', description: 'Fire chassis.' }),
      subclassItem('water-magic', 'Water Magic', { class: 'ft-caster', description: 'Water chassis.' }),
      subclassItem('gun-magic', 'Gun Magic', { class: 'ft-holder', description: 'Holder chassis.' }),
    ];
    expect(subclassesForClass(items, 'ft-caster').map((i) => i.slug)).toEqual([
      'ft-fire-magic',
      'water-magic',
    ]);
    // Documents WHY every caller must pass the slug, not the name: the name
    // alone cannot reconstruct the "ft-" prefix, so it matches nothing.
    expect(subclassesForClass(items, 'Caster (Fairy Tail)')).toEqual([]);
  });

  it('catalogItemToSubclass maps id/name/class/blurb', () => {
    const w = catalogItemToSubclass(
      subclassItem('turtle-school', 'Turtle School', {
        class: 'ki-warrior',
        description: 'Patience over power.',
      }),
    );
    expect(w).toEqual({
      id: 'turtle-school',
      name: 'Turtle School',
      class: 'ki-warrior',
      blurb: 'Patience over power.',
    });
  });

  it('catalogItemToSubclass degrades a missing description to an empty blurb, not undefined text', () => {
    const w = catalogItemToSubclass(subclassItem('champion', 'Champion', { class: 'fighter' }));
    expect(w.blurb).toBe('');
  });
});
