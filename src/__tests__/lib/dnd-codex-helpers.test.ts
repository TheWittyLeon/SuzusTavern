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
  CatalogSpellData,
} from '../../lib/api/types';
import {
  CODEX_KINDS,
  conditionHasData,
  itemCostLabel,
  itemDescription,
  itemWeightLabel,
  matchesSearch,
  monsterActionDescription,
  monsterActionLine,
  monsterCrLabel,
  monsterSensesLabel,
  monsterSpeedLabel,
  raceSpeedLabel,
  sourceBadge,
  spellComponentsLabel,
  spellLevelLabel,
  toneVar,
} from '../../lib/dnd/codex';

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
  };

  it('has exactly 7 kinds', () => {
    expect(CODEX_KINDS).toHaveLength(7);
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
