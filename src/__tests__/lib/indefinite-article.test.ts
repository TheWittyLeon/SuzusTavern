/**
 * indefiniteArticle — TAV-SUZU-NOTE-ARTICLE-AGREEMENT (2026-08-06).
 *
 * src/lib/text/indefiniteArticle.ts, extracted from character/new/page.tsx.
 * Behaviour is unchanged by the extraction (same regex, same signature) — this
 * file exists because there was previously ZERO direct unit coverage of the
 * helper itself; it was only exercised indirectly through the subrace legend
 * in character-new.test.tsx, which never happened to cover a vowel-led word.
 */
import { indefiniteArticle } from '@/lib/text/indefiniteArticle';

describe('indefiniteArticle', () => {
  it('returns "an" for a vowel-initial word', () => {
    expect(indefiniteArticle('Elf')).toBe('an');
    expect(indefiniteArticle('Aasimar')).toBe('an');
    expect(indefiniteArticle('Acolyte')).toBe('an');
    expect(indefiniteArticle('elf')).toBe('an');
    expect(indefiniteArticle('Orc')).toBe('an');
    expect(indefiniteArticle('Undead')).toBe('an');
  });

  it('returns "a" for a consonant-initial word', () => {
    expect(indefiniteArticle('Dwarf')).toBe('a');
    expect(indefiniteArticle('Human')).toBe('a');
    expect(indefiniteArticle('Rogue')).toBe('a');
    expect(indefiniteArticle('Charlatan')).toBe('a');
  });

  it('is case-insensitive on the leading letter', () => {
    expect(indefiniteArticle('ELF')).toBe('an');
    expect(indefiniteArticle('AASIMAR')).toBe('an');
    expect(indefiniteArticle('DWARF')).toBe('a');
  });

  it('trims leading whitespace before testing the leading letter', () => {
    expect(indefiniteArticle('  Elf')).toBe('an');
    expect(indefiniteArticle('  Dwarf')).toBe('a');
    expect(indefiniteArticle('\tOrc')).toBe('an');
  });

  it('returns "a" (never crashes) for an empty or blank word', () => {
    expect(indefiniteArticle('')).toBe('a');
    expect(indefiniteArticle('   ')).toBe('a');
  });

  it('always returns exactly the literal "a" or "an" (no locale/whitespace pollution)', () => {
    // Adversarial: a caller does `${leading} ${word}` — any stray character
    // or extra space baked into the return value would double-space or
    // misrender every consumer at once (RaceStep legend + Suzu's Note).
    expect(['a', 'an']).toContain(indefiniteArticle('Elf'));
    expect(indefiniteArticle('Elf').length).toBeLessThanOrEqual(2);
  });

  it('documented limitation: sound-based exceptions are NOT handled (letter test only)', () => {
    // Pinned as a KNOWN gap, not a silent behavior change — see the module's
    // own header comment. If this ever starts passing, the module gained an
    // exception list and this test should be updated to lock the new cases
    // in, not deleted.
    expect(indefiniteArticle('unicorn')).toBe('an'); // wrong: should be "a unicorn"
    expect(indefiniteArticle('hour')).toBe('a'); // wrong: should be "an hour"
  });
});
