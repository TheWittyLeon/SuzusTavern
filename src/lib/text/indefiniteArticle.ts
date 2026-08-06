// src/lib/text/indefiniteArticle.ts
//
// TAV-SUZU-NOTE-ARTICLE-AGREEMENT (2026-08-06). Extracted from
// src/app/character/new/page.tsx, where this lived as a file-local helper used
// only for the subrace legend. Suzu's Note on the character sheet had the same
// need and hardcoded "a" instead, rendering "A human vessel with a acolyte
// past" on every vowel-initial background.
//
// LIMITATION, deliberate: English chooses the article by SOUND, not spelling,
// so this letter test is wrong for "a unicorn" / "a European" (vowel letter,
// consonant sound) and "an hour" / "an heir" (consonant letter, vowel sound).
// It is correct for every race, class and background currently in the catalog
// — checked 2026-08-06 across db/seed/, which contains no such name — so the
// exception sets those cases would need are NOT written here rather than
// guessed at. If a homebrew race like "Unicorn" is ever added, this is the one
// place to fix, and the fix is a short prefix allow-list, not a rewrite.

/**
 * "a" or "an" for the word that follows, by its leading vowel letter.
 * Trims first; returns "a" for an empty/blank word.
 */
export function indefiniteArticle(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word.trim()) ? 'an' : 'a';
}
