/**
 * Adversarial + edge-case unit tests for src/lib/dnd/codex.ts (DDX-21).
 *
 * The page-level test (src/__tests__/pages/codex.test.tsx) only exercises
 * these helpers indirectly through two content types (spell, monster) with
 * well-formed fixtures. This file targets the pure functions directly with
 * the missing/null/boundary inputs a real catalog row can actually have —
 * per Miko-QA's adversarial standard, not just the happy path.
 */
import type {
  CatalogEquipmentData,
  CatalogItem,
  CatalogMonsterAction,
  CatalogMonsterData,
  CatalogPhysique,
  CatalogSpellData,
} from '../../lib/api/types';
import {
  CODEX_KINDS,
  conditionHasData,
  featureEntryLabel,
  itemCostLabel,
  itemDescription,
  itemWeightLabel,
  matchesSearch,
  monsterActionDescription,
  monsterActionLine,
  monsterCrLabel,
  monsterSensesLabel,
  monsterSpeedLabel,
  normalizeFeatureEntries,
  physiqueHairLabel,
  raceSpeedLabel,
  sourceBadge,
  spellComponentsLabel,
  spellLevelLabel,
  toneVar,
} from '../../lib/dnd/codex';

// ── physiqueHairLabel (PHYSIQUE-000, Aoi-UI §1) ─────────────────────────────

describe('physiqueHairLabel', () => {
  it('combines hair_style + hair_color with "; " when both are present', () => {
    const p: CatalogPhysique = { hair_style: 'short, spiky in every direction', hair_color: 'bright sun-blond' };
    expect(physiqueHairLabel(p)).toBe('short, spiky in every direction; bright sun-blond');
  });

  it('renders hair_style alone with no dangling separator', () => {
    expect(physiqueHairLabel({ hair_style: 'a long braid' })).toBe('a long braid');
  });

  it('renders hair_color alone with no dangling separator', () => {
    expect(physiqueHairLabel({ hair_color: 'silver' })).toBe('silver');
  });

  it('returns empty string when neither atom is present, so the caller omits the cell', () => {
    expect(physiqueHairLabel({})).toBe('');
  });
});

// ── monsterCrLabel ────────────────────────────────────────────────────────────

describe('monsterCrLabel', () => {
  it('renders the standard sub-1 CR fractions', () => {
    expect(monsterCrLabel(0.125)).toBe('1/8');
    expect(monsterCrLabel(0.25)).toBe('1/4');
    expect(monsterCrLabel(0.5)).toBe('1/2');
  });
  it('renders integer CR as-is', () => {
    expect(monsterCrLabel(5)).toBe('5');
    expect(monsterCrLabel(0)).toBe('0');
  });
  it('passes through a string CR untouched (engine may send "1/8" directly)', () => {
    expect(monsterCrLabel('1/8')).toBe('1/8');
  });
  it('renders an em dash for undefined/null rather than "undefined"/"null"', () => {
    expect(monsterCrLabel(undefined)).toBe('—');
    expect(monsterCrLabel(null as unknown as undefined)).toBe('—');
  });
});

// ── monsterSpeedLabel / monsterSensesLabel ───────────────────────────────────

describe('monsterSpeedLabel', () => {
  it('formats walk speed without a prefix, other modes with one', () => {
    expect(monsterSpeedLabel({ speed: { walk: 30, fly: 60 } } as CatalogMonsterData)).toBe(
      '30 ft., fly 60 ft.',
    );
  });
  it('drops zero/negative speeds (a monster with fly:0 should not claim it flies)', () => {
    expect(monsterSpeedLabel({ speed: { walk: 30, fly: 0, swim: -5 } } as CatalogMonsterData)).toBe(
      '30 ft.',
    );
  });
  it('renders an em dash when speed is missing entirely', () => {
    expect(monsterSpeedLabel({} as CatalogMonsterData)).toBe('—');
  });
  it('does not crash on a non-numeric speed value (malformed upstream row)', () => {
    expect(() =>
      monsterSpeedLabel({ speed: { walk: 'thirty' as unknown as number } } as CatalogMonsterData),
    ).not.toThrow();
    expect(monsterSpeedLabel({ speed: { walk: 'thirty' as unknown as number } } as CatalogMonsterData)).toBe(
      '—',
    );
  });
});

// ── raceSpeedLabel — DDX21-1 crash-fix guard ─────────────────────────────────
//
// A regular CatalogRaceData['speed'] is a plain number, but this helper must
// also tolerate receiving a monster's *compound* speed object: see codex.ts's
// doc comment — a stale cross-kind render (the /codex route crash) could
// otherwise hand this a monster's `{walk, swim, ...}` object for one render
// while useCodexCatalog catches up to a newly active 'race' tab.

describe('raceSpeedLabel', () => {
  it('formats a plain number as "N ft." (the normal race-data shape)', () => {
    expect(raceSpeedLabel(30)).toBe('30 ft.');
    expect(raceSpeedLabel(0)).toBe('0 ft.');
  });

  it('renders an em dash for null/undefined', () => {
    expect(raceSpeedLabel(null)).toBe('—');
    expect(raceSpeedLabel(undefined)).toBe('—');
  });

  it('never returns a raw object — a compound (monster-shaped) speed object formats via the same compound formatter monsterSpeedLabel uses, instead of crashing', () => {
    expect(raceSpeedLabel({ walk: 10, swim: 40 })).toBe('10 ft., swim 40 ft.');
    expect(typeof raceSpeedLabel({ walk: 10, swim: 40 })).toBe('string');
  });

  it('does not throw and returns a string for any input shape', () => {
    expect(() => raceSpeedLabel({ walk: 10, swim: 40 })).not.toThrow();
    expect(() => raceSpeedLabel('fast' as unknown)).not.toThrow();
    expect(raceSpeedLabel('fast' as unknown)).toBe('—');
  });
});

// ── normalizeFeatureEntries / featureEntryLabel — UIA-0919-001 crash-fix guard ─
//
// A homebrew subclass/class/race row's feature/trait list may carry bare
// display strings or structured `{level, name, description}` objects — see
// CatalogFeatureEntry's doc comment in lib/api/types.ts for exactly which
// fields are write-time enforced to one shape vs. wide open. SubclassDetail
// used to map the raw array straight onto `<Pill key={f}>{f}</Pill>`, which
// crashed React on the object shape ("Objects are not valid as a React
// child") and produced duplicate `[object Object]` keys even before the
// crash. normalizeFeatureEntries is TOTAL over `unknown` (Kage-CR, UIA-0919-
// 001 QA gate, two follow-up passes): a non-array FIELD (`features: "Wind
// Palm"`, `features: {...}`) returns `[]` instead of throwing at
// `entries.forEach`, and a malformed ELEMENT (null, a number, an
// object with no usable name, an object-valued level/description) is
// skipped rather than read. Cleaning (this function) and labelling
// (`featureEntryLabel`) are separate.

describe('normalizeFeatureEntries', () => {
  it('returns [] for a non-array field: undefined, null, an empty array, a bare string, or a bare object', () => {
    expect(normalizeFeatureEntries(undefined)).toEqual([]);
    expect(normalizeFeatureEntries(null)).toEqual([]);
    expect(normalizeFeatureEntries([])).toEqual([]);
    // Kage-CR jsdom probe: `features: "Wind Palm"` — a whole field authored
    // as a bare string instead of an array — used to throw at
    // `entries.forEach` (strings have no `.forEach`).
    expect(() => normalizeFeatureEntries('Wind Palm')).not.toThrow();
    expect(normalizeFeatureEntries('Wind Palm')).toEqual([]);
    // Kage-CR jsdom probe: `features: {...}` — a whole field authored as a
    // bare object — used to throw the same way (plain objects have no
    // `.forEach` either).
    expect(() => normalizeFeatureEntries({ name: 'Wind Palm' })).not.toThrow();
    expect(normalizeFeatureEntries({ name: 'Wind Palm' })).toEqual([]);
  });

  it('passes bare strings through as the name, with no level or description', () => {
    const result = normalizeFeatureEntries(['Evocation Savant', 'Sculpt Spells']);
    expect(result).toEqual([
      { key: '0-Evocation Savant', name: 'Evocation Savant' },
      { key: '1-Sculpt Spells', name: 'Sculpt Spells' },
    ]);
  });

  it('trims a bare string, and skips it entirely if it is blank/whitespace-only', () => {
    const result = normalizeFeatureEntries(['  Padded Name  ', '   ', '']);
    expect(result).toEqual([{ key: '0-Padded Name', name: 'Padded Name' }]);
  });

  it('keeps a structured entry’s level and description, trimming the name', () => {
    const entry = {
      level: 1,
      name: '  Wind Palm (Airspace Signature)  ',
      description: 'Your Magic’s signature — free, at-will.',
    };
    expect(normalizeFeatureEntries([entry])).toEqual([
      {
        key: '0-Wind Palm (Airspace Signature)',
        name: 'Wind Palm (Airspace Signature)',
        level: 1,
        description: entry.description,
      },
    ]);
  });

  it('omits level and description entirely (not null/NaN) when either is absent', () => {
    const result = normalizeFeatureEntries([{ name: 'Turncoat’s Nerve' }]);
    expect(result).toEqual([{ key: '0-Turncoat’s Nerve', name: 'Turncoat’s Nerve' }]);
    expect('level' in result[0]).toBe(false);
    expect('description' in result[0]).toBe(false);
  });

  it('accepts a numeric-STRING level ("3") and parses it to a number', () => {
    const result = normalizeFeatureEntries([{ name: 'Rung II', level: '3' }]);
    expect(result[0].level).toBe(3);
    expect(typeof result[0].level).toBe('number');
  });

  // Kage-CR BLOCKING #1: an object-valued `level` used to render literally
  // as "Lv [object Object]" (a plain template literal has no type check).
  // An object-valued `description`, a non-finite level (NaN/Infinity), and
  // a non-numeric string level are the same family of "not actually a
  // usable value" wire garbage — every one must be OMITTED, not stringified.
  it('omits level entirely when it is an object, NaN, Infinity, or a non-numeric string — never stringifies it', () => {
    for (const badLevel of [{ nested: true }, NaN, Infinity, -Infinity, 'not-a-number', [], true]) {
      const result = normalizeFeatureEntries([{ name: 'Foo', level: badLevel as unknown }]);
      expect(result).toEqual([{ key: '0-Foo', name: 'Foo' }]);
    }
  });

  it('omits description entirely when it is not a string (never renders `title="[object Object]"`)', () => {
    const result = normalizeFeatureEntries([{ name: 'Foo', description: { nested: true } as unknown }]);
    expect(result).toEqual([{ key: '0-Foo', name: 'Foo' }]);
  });

  it('treats a blank/whitespace-only description the same as absent', () => {
    const result = normalizeFeatureEntries([{ name: 'Foo', description: '   ' }]);
    expect('description' in result[0]).toBe(false);
  });

  it('never throws on a mixed array of strings and objects, and produces stable, unique keys even when a name repeats across levels', () => {
    const asi = { level: 4, name: 'Ability Score Improvement' };
    const asiAgain = { level: 8, name: 'Ability Score Improvement' };
    let result: ReturnType<typeof normalizeFeatureEntries> = [];
    expect(() => {
      result = normalizeFeatureEntries(['Magic', asi, asiAgain]);
    }).not.toThrow();
    const keys = result.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(featureEntryLabel(result[1])).toBe('Level 4 · Ability Score Improvement');
    expect(featureEntryLabel(result[2])).toBe('Level 8 · Ability Score Improvement');
  });

  it('never returns an object as `name` or `description` — every field is a string, a finite number, or absent (Kage-CR BLOCKING #1 fixture: an object-valued level AND an object-valued description on the same entry)', () => {
    const entries = normalizeFeatureEntries([
      'bare',
      { name: 'structured', level: 3, description: 'text' },
      { name: 'garbage-fields', level: { nested: true }, description: { nested: true } },
    ]);
    for (const e of entries) {
      expect(typeof e.name).toBe('string');
      expect(e.level === undefined || (typeof e.level === 'number' && Number.isFinite(e.level))).toBe(true);
      expect(e.description === undefined || typeof e.description === 'string').toBe(true);
    }
    // The garbage-fields entry survives (it has a usable name) but with
    // both bad fields dropped rather than stringified.
    expect(entries).toContainEqual({ key: '2-garbage-fields', name: 'garbage-fields' });
  });

  it('Miko-QA: treats a literal `null` field value (not just `undefined`/omitted) the same as an empty list — jsonb APIs commonly send explicit null rather than omitting a key', () => {
    expect(normalizeFeatureEntries(null)).toEqual([]);
  });

  // Miko-QA DEFECT, fixed (Ren-Dev, UIA-0919-001 follow-up): a `null` (or
  // `undefined`) ELEMENT *inside* an otherwise-normal entries array — e.g.
  // `['Fighting Style', null]`, which a hand-authored homebrew JSON file can
  // produce via a stray trailing-comma fix or a placeholder left in an array
  // — used to reach the `entry.level`/`entry.name` property reads in the
  // non-string branch and throw `TypeError: Cannot read properties of null
  // (reading 'level')`, because `typeof null === 'object'` sent it down the
  // "structured entry" branch instead of the string branch. Same bug class
  // UIA-0919-001 closed at the field level, one level deeper (array
  // element).
  it('a null/undefined/number/no-name-object ELEMENT inside the array is skipped, not thrown on — the surviving entries still render', () => {
    let result: ReturnType<typeof normalizeFeatureEntries> = [];
    expect(() => {
      result = normalizeFeatureEntries([
        'Fighting Style',
        null,
        undefined,
        42,
        { level: 2, description: 'no name' },
        [1, 2, 3],
      ]);
    }).not.toThrow();
    expect(result).toEqual([{ key: '0-Fighting Style', name: 'Fighting Style' }]);
  });
});

// ── featureEntryLabel — Kage-CR a11y finding ──────────────────────────────────
//
// "Level 3", never the abbreviation "Lv 3" — a screen reader spells an
// unfamiliar abbreviation letter-by-letter ("L V three").

describe('featureEntryLabel', () => {
  it('renders "Level N · Name" (the word "Level", not "Lv") when a level is present', () => {
    expect(featureEntryLabel({ key: 'k', name: 'Wind Palm', level: 3 })).toBe('Level 3 · Wind Palm');
  });

  it('renders the bare name when level is absent', () => {
    expect(featureEntryLabel({ key: 'k', name: 'Turncoat’s Nerve' })).toBe('Turncoat’s Nerve');
  });
});

describe('monsterSensesLabel', () => {
  it('renders an em dash when senses is missing', () => {
    expect(monsterSensesLabel({} as CatalogMonsterData)).toBe('—');
  });
  it('humanizes snake_case sense keys', () => {
    expect(
      monsterSensesLabel({ senses: { passive_perception: 12, darkvision: 60 } } as CatalogMonsterData),
    ).toBe('passive perception 12, darkvision 60');
  });
});

// ── spell helpers ─────────────────────────────────────────────────────────────

describe('spellLevelLabel / spellComponentsLabel', () => {
  it('renders "Cantrip" for level 0, "Level N" otherwise', () => {
    expect(spellLevelLabel(0)).toBe('Cantrip');
    expect(spellLevelLabel(9)).toBe('Level 9');
  });
  it('renders an em dash when a spell has no components at all', () => {
    expect(spellComponentsLabel({} as CatalogSpellData)).toBe('—');
  });
  it('renders only the true component flags, in V/S/M order regardless of input order', () => {
    expect(
      spellComponentsLabel({ components: { M: true, V: true } } as CatalogSpellData),
    ).toBe('V, M');
  });
});

// ── item (equipment) helpers ──────────────────────────────────────────────────

describe('itemCostLabel / itemWeightLabel / itemDescription', () => {
  it('renders an em dash for null/undefined cost and weight (not "0 gp")', () => {
    expect(itemCostLabel({} as CatalogEquipmentData)).toBe('—');
    expect(itemWeightLabel({} as CatalogEquipmentData)).toBe('—');
  });
  it('renders an explicit 0 cost/weight correctly (falsy but not absent)', () => {
    expect(itemCostLabel({ cost_gp: 0 } as CatalogEquipmentData)).toBe('0 gp');
    expect(itemWeightLabel({ weight: 0 } as CatalogEquipmentData)).toBe('0 lb.');
  });
  it('falls back to placeholder copy for missing/blank/whitespace-only description', () => {
    expect(itemDescription({} as CatalogEquipmentData)).toMatch(/no description recorded/i);
    expect(itemDescription({ description: '' } as CatalogEquipmentData)).toMatch(
      /no description recorded/i,
    );
    expect(itemDescription({ description: '   ' } as CatalogEquipmentData)).toMatch(
      /no description recorded/i,
    );
  });
});

// ── condition helpers ─────────────────────────────────────────────────────────

describe('conditionHasData', () => {
  it('is false for the real dev shape ({}) and for null/undefined', () => {
    expect(conditionHasData({})).toBe(false);
    expect(conditionHasData(null as unknown as Record<string, unknown>)).toBe(false);
    expect(conditionHasData(undefined as unknown as Record<string, unknown>)).toBe(false);
  });
  it('is true once the engine starts populating rules text', () => {
    expect(conditionHasData({ rules_text: 'Blinded creatures...' })).toBe(true);
  });
});

// ── monster action helpers ────────────────────────────────────────────────────

describe('monsterActionLine / monsterActionDescription', () => {
  it('omits the parenthetical entirely when an action has no attack/damage data', () => {
    expect(monsterActionLine({ name: 'Multiattack' } as CatalogMonsterAction)).toBe('Multiattack');
  });
  it('falls back from `description` to `desc` (engine has used both field names historically)', () => {
    expect(monsterActionDescription({ name: 'Bite', desc: 'legacy field' } as CatalogMonsterAction)).toBe(
      'legacy field',
    );
    expect(
      monsterActionDescription({ name: 'Bite', description: 'current field', desc: 'legacy field' } as CatalogMonsterAction),
    ).toBe('current field');
  });
  it('returns empty string (not "undefined") when neither field is present', () => {
    expect(monsterActionDescription({ name: 'Bite' } as CatalogMonsterAction)).toBe('');
  });
});

// ── sourceBadge ────────────────────────────────────────────────────────────────

describe('sourceBadge', () => {
  it('falls back to echoing an unknown source_type verbatim rather than crashing', () => {
    expect(sourceBadge('some-future-source')).toEqual({ label: 'some-future-source', tone: 'muted' });
  });
});

// ── matchesSearch — the adversarial core: this is Codex's ONLY search logic ──

function itemNamed(name: string): CatalogItem {
  return { slug: name.toLowerCase(), name, content_type: 'spell', source_type: 'srd', data: {} };
}

describe('matchesSearch (adversarial)', () => {
  it('matches everything on an empty or whitespace-only query', () => {
    expect(matchesSearch(itemNamed('Fireball'), '')).toBe(true);
    expect(matchesSearch(itemNamed('Fireball'), '   ')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesSearch(itemNamed('Fireball'), 'FIRE')).toBe(true);
    expect(matchesSearch(itemNamed('Fireball'), 'ball')).toBe(true);
  });

  it('is a plain substring match — regex metacharacters are treated literally, not as regex (no ReDoS surface)', () => {
    const item = itemNamed('Fireball (3rd level)');
    // A classic catastrophic-backtracking pattern. If this were ever passed to
    // `new RegExp(query)` against a non-matching string, it would hang. Since
    // matchesSearch only ever calls String.prototype.includes, this must
    // return fast and false without throwing.
    const evil = '(a+)+$';
    const start = Date.now();
    expect(() => matchesSearch(item, evil)).not.toThrow();
    expect(matchesSearch(item, evil)).toBe(false);
    expect(Date.now() - start).toBeLessThan(50);
    // A literal paren in the query should match a literal paren in the name.
    expect(matchesSearch(item, '(3rd')).toBe(true);
  });

  it('handles a 10k-character query against a short name without crashing or hanging', () => {
    const item = itemNamed('Fireball');
    const huge = 'a'.repeat(10_000);
    const start = Date.now();
    expect(() => matchesSearch(item, huge)).not.toThrow();
    expect(matchesSearch(item, huge)).toBe(false);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('handles emoji / ZWJ grapheme clusters without throwing (astral + combining code units)', () => {
    const item = itemNamed('Fireball 🔥');
    expect(() => matchesSearch(item, '🔥')).not.toThrow();
    expect(matchesSearch(item, '🔥')).toBe(true);
    // A ZWJ family emoji as a query against a name that doesn't contain it —
    // must not throw and must correctly report no match.
    const zwj = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
    expect(() => matchesSearch(item, zwj)).not.toThrow();
    expect(matchesSearch(item, zwj)).toBe(false);
  });

  it('does not throw and correctly reports no match for a query with an embedded null byte', () => {
    const item = itemNamed('Fireball');
    const withNullByte = 'Fire' + String.fromCharCode(0) + 'ball';
    expect(() => matchesSearch(item, withNullByte)).not.toThrow();
    expect(matchesSearch(item, withNullByte)).toBe(false);
  });
});

// ── toneVar — A11Y MAJOR-3 regression guard ──────────────────────────────────
//
// toneVar('muted') used to diverge from Pill.tsx's own audited TONE_MAP,
// where fg for 'muted' is --ink-2 (ink-3 measured 4.14:1 on the muted chip
// surface — fails AA small text). Locks the two maps in sync.

// ── CODEX_KINDS.nounPlural — DDX21-3 regression guard ────────────────────────
//
// The Classes tab used to render "12 classs" via naive `${noun}s` string
// concatenation. Verifies every one of the 7 kinds has an explicit, correctly
// spelled plural in the metadata itself (the source page.tsx reads from) —
// not just the one irregular case that was actually caught live.

describe('CODEX_KINDS nounPlural (DDX21-3)', () => {
  const expected: Record<string, string> = {
    spell: 'spells',
    monster: 'monsters',
    item: 'items',
    race: 'races',
    class: 'classes',
    background: 'backgrounds',
    condition: 'conditions',
    // TAV-CODEX-SOURCE-PICKER-NPC (D6/FR-15): four new rail kinds.
    npc: 'NPCs',
    feat: 'feats',
    subclass: 'subclasses',
    adventure: 'adventures',
  };

  it('has exactly 11 kinds (7 original + npc/feat/subclass/adventure)', () => {
    expect(CODEX_KINDS).toHaveLength(11);
  });

  it('Kage-CR #23: rail order is pinned exactly (Classes, Subclasses, Races, Backgrounds, Feats, Spells, Items, Conditions, Monsters, NPCs, Adventures)', () => {
    expect(CODEX_KINDS.map((m) => m.kind)).toEqual([
      'class',
      'subclass',
      'race',
      'background',
      'feat',
      'spell',
      'item',
      'condition',
      'monster',
      'npc',
      'adventure',
    ]);
  });

  it.each(CODEX_KINDS.map((m) => [m.kind, m] as const))(
    '%s pluralizes to the correct irregular-aware form',
    (kind, meta) => {
      expect(meta.nounPlural).toBe(expected[kind]);
    },
  );

  it('the irregular case: "class" pluralizes to "classes", not "classs"', () => {
    const classMeta = CODEX_KINDS.find((m) => m.kind === 'class');
    expect(classMeta?.nounPlural).toBe('classes');
    expect(classMeta?.nounPlural).not.toBe('classs');
  });
});

describe('toneVar', () => {
  it('resolves "muted" to --ink-2, matching Pill.tsx TONE_MAP.muted.fg', () => {
    expect(toneVar('muted')).toBe('var(--ink-2)');
  });

  it('resolves the CODEX_KINDS tones to their expected CSS custom properties', () => {
    expect(toneVar('lav')).toBe('var(--accent-2)');
    expect(toneVar('bad')).toBe('var(--bad-ink)');
    expect(toneVar('warm')).toBe('var(--warm-ink)');
    expect(toneVar('cool')).toBe('var(--cool-ink)');
    expect(toneVar('accent')).toBe('var(--accent)');
    expect(toneVar('crit')).toBe('var(--crit-ink)');
    expect(toneVar('warn')).toBe('var(--warn-ink)');
  });
});
