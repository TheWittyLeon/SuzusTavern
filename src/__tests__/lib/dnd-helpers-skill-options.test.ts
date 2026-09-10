/**
 * ORACLE-CANDIDATE-1 (2026-09-08) — `normalizeSkillOption`/
 * `normalizeSkillOptions` (lib/dnd/helpers.ts), the tolerance adapter for a
 * `skills:1` pending choice's `options` array. Coordinator note on Kage-CR's
 * engine review: the engine ships `{slug, name}` objects (sibling-shaped
 * with `feature_choice`), but the adapter ALSO accepts a bare skill-slug
 * string so neither deploy ordering between this repo and
 * NekoNova-DnDEngine ever strands a character on a shape it can't render.
 */
import { normalizeSkillOption, normalizeSkillOptions, normalizeSkillSlug } from '../../lib/dnd/helpers';

// Kage-CR pin (2026-09-08): normalizeSkillSlug was unpinned directly —
// mutating it to a bare `raw.trim()` left every other test green, since
// every fixture used ALREADY-normalized input. This exercises the actual
// transform (mixed case + a hyphen AND a space) byte-identical to the
// engine's own `_resolve_skills_choice` normalization
// (`str(p).strip().lower().replace(" ","_").replace("-","_")`).
describe('normalizeSkillSlug', () => {
  it('trims, lowercases, and replaces both spaces and hyphens with underscores', () => {
    expect(normalizeSkillSlug('Sleight-Of Hand')).toBe('sleight_of_hand');
  });

  it('is a no-op on already-normalized input', () => {
    expect(normalizeSkillSlug('animal_handling')).toBe('animal_handling');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeSkillSlug('  athletics  ')).toBe('athletics');
  });
});

describe('normalizeSkillOption', () => {
  it('accepts the CURRENT wire shape — {slug, name}', () => {
    expect(normalizeSkillOption({ slug: 'athletics', name: 'Athletics' })).toEqual({
      slug: 'athletics',
      name: 'Athletics',
    });
  });

  // Kage-CR (2026-09-10): the engine's skills:1 enrichment title-cases
  // blindly (`s.replace("_", " ").title()`), which disagrees with the
  // curated SKILLS table for any multi-word skill whose middle word is a
  // preposition — "Sleight Of Hand" vs. the curated "Sleight of Hand". A
  // known slug's curated name must win over whatever the wire sent, so the
  // wizard's Skills step and the level-up SkillsChoiceCard never render the
  // SAME skill under two different names depending on which one happened
  // to read the raw wire name.
  it('a known slug prefers the curated SKILLS name over a wrongly-cased server name', () => {
    expect(normalizeSkillOption({ slug: 'sleight_of_hand', name: 'Sleight Of Hand' })).toEqual({
      slug: 'sleight_of_hand',
      name: 'Sleight of Hand',
    });
  });

  it('an UNKNOWN slug still defers to the server-sent name (no curated opinion to prefer)', () => {
    expect(normalizeSkillOption({ slug: 'shadow_weaving', name: 'Shadow-Weaving (Homebrew)' })).toEqual({
      slug: 'shadow_weaving',
      name: 'Shadow-Weaving (Homebrew)',
    });
  });

  it('accepts a bare string (tolerance for the other deploy ordering) and humanizes it via the curated SKILLS table', () => {
    expect(normalizeSkillOption('sleight_of_hand')).toEqual({
      slug: 'sleight_of_hand',
      name: 'Sleight of Hand', // NOT the naive split-capitalize 'Sleight Of Hand'
    });
  });

  it('a bare string for an unknown/homebrew slug falls back to split-capitalize', () => {
    expect(normalizeSkillOption('shadow_weaving')).toEqual({
      slug: 'shadow_weaving',
      name: 'Shadow Weaving',
    });
  });

  it('an object with a missing/blank name falls back to humanizing the slug', () => {
    expect(normalizeSkillOption({ slug: 'animal_handling' })).toEqual({
      slug: 'animal_handling',
      name: 'Animal Handling',
    });
    expect(normalizeSkillOption({ slug: 'animal_handling', name: '   ' })).toEqual({
      slug: 'animal_handling',
      name: 'Animal Handling',
    });
  });

  it('a blank string, blank slug, null, or non-object drops (fail-open, never throws)', () => {
    expect(normalizeSkillOption('')).toBeNull();
    expect(normalizeSkillOption('   ')).toBeNull();
    expect(normalizeSkillOption({ slug: '' })).toBeNull();
    expect(normalizeSkillOption(null)).toBeNull();
    expect(normalizeSkillOption(undefined)).toBeNull();
    expect(normalizeSkillOption(42)).toBeNull();
    expect(normalizeSkillOption({ name: 'Athletics' })).toBeNull(); // no slug key
  });
});

describe('normalizeSkillOptions', () => {
  it('maps a mixed array of both shapes (proves neither deploy ordering strands a character)', () => {
    expect(
      normalizeSkillOptions([
        { slug: 'athletics', name: 'Athletics' },
        'perception',
        { slug: 'insight' },
      ]),
    ).toEqual([
      { slug: 'athletics', name: 'Athletics' },
      { slug: 'perception', name: 'Perception' },
      { slug: 'insight', name: 'Insight' },
    ]);
  });

  it('drops malformed entries rather than throwing or including a null', () => {
    expect(normalizeSkillOptions(['athletics', '', { slug: '' }, null, 42])).toEqual([
      { slug: 'athletics', name: 'Athletics' },
    ]);
  });

  it('a non-array (undefined, object, string) degrades to [] rather than throwing', () => {
    expect(normalizeSkillOptions(undefined)).toEqual([]);
    expect(normalizeSkillOptions(null)).toEqual([]);
    expect(normalizeSkillOptions({})).toEqual([]);
    expect(normalizeSkillOptions('athletics')).toEqual([]);
  });
});
