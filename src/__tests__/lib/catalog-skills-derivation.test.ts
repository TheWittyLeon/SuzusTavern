/**
 * ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP (2026-09-08) — pins
 * `catalogItemToClass`'s data-driven `skillChoices`/`skillCount` mapping off
 * the catalog row's `skill_choices`/`skill_count` (the same fields
 * `engine.rules_catalog.class_proficiencies` packages, verified against
 * NekoNova-DnDEngine 2026-09-08). Mirrors catalog-caster-derivation.test.ts's
 * fixture conventions (a bare `classItem` builder, no DOM).
 */
import { catalogItemToClass } from '../../lib/dnd/catalog';
import type { CatalogItem } from '../../lib/api/types';

function classItem(slug: string, name: string, data: Record<string, unknown>): CatalogItem {
  return { slug, name, content_type: 'class', source_type: 'srd', data };
}

describe('catalogItemToClass — skill choice derivation (ORACLE-CANDIDATE-1)', () => {
  it('maps skill_choices/skill_count verbatim off the wire', () => {
    const cls = catalogItemToClass(
      classItem('fighter', 'Fighter', {
        hit_die: 10,
        skill_choices: ['acrobatics', 'athletics', 'insight', 'intimidation', 'perception', 'survival'],
        skill_count: 2,
      }),
    );
    expect(cls.skillChoices).toEqual([
      'acrobatics',
      'athletics',
      'insight',
      'intimidation',
      'perception',
      'survival',
    ]);
    expect(cls.skillCount).toBe(2);
  });

  it('a v1 row with no skill_choices/skill_count key at all leaves both undefined (no fabricated step)', () => {
    const cls = catalogItemToClass(classItem('legacy', 'Legacy', { hit_die: 8 }));
    expect(cls.skillChoices).toBeUndefined();
    expect(cls.skillCount).toBeUndefined();
  });

  it('a garbage (non-array) skill_choices value degrades to undefined rather than throwing', () => {
    const cls = catalogItemToClass(
      classItem('bad', 'Bad', { hit_die: 8, skill_choices: 'not-an-array', skill_count: 2 }),
    );
    expect(cls.skillChoices).toBeUndefined();
    // skill_count is independently typed/validated — a bad skill_choices
    // value doesn't corrupt it.
    expect(cls.skillCount).toBe(2);
  });

  it('a non-number skill_count degrades to undefined rather than throwing', () => {
    const cls = catalogItemToClass(
      classItem('bad2', 'Bad2', { hit_die: 8, skill_choices: ['athletics'], skill_count: '2' }),
    );
    expect(cls.skillCount).toBeUndefined();
    expect(cls.skillChoices).toEqual(['athletics']);
  });

  it('skill_count: 0 with a non-empty pool still maps skillCount to 0 (hasSkillsStep computes the gate, not this adapter)', () => {
    const cls = catalogItemToClass(
      classItem('zero', 'Zero', { hit_die: 8, skill_choices: ['athletics'], skill_count: 0 }),
    );
    expect(cls.skillCount).toBe(0);
    expect(cls.skillChoices).toEqual(['athletics']);
  });
});
