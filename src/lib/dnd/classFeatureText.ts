// src/lib/dnd/classFeatureText.ts
//
// Pure helpers for rendering a character's flat `class_features` name list
// on the sheet (Leon ruling, 2026-08-22 — "make a Ki Warrior's class
// features readable"). Two problems on that list, both fixed here without
// touching the wire shape:
//
//   1. `class_features` mixes real granted features with the class's own
//      internal choose-one-of-N *menu labels* (Ki Stat / School / Signature
//      / Rung I–V / Capstone). Those aren't features a player picked —
//      they're the announcement that a menu unlocked; the thing the player
//      actually picked already surfaces elsewhere on the sheet as a
//      `feature_choices` entry with its own name + description. Shown
//      inline in the Features list they're just noise.
//
//   2. Level-up features stamp cumulatively and are NOT deduped upstream —
//      `Ability Score Improvement` appears once per ASI taken (five times
//      on a level-20 sheet).
//
// Verified against character 24043 on suzu_dnd_dev (read-only, 2026-08-22):
// 34 raw `class_features` entries, 9 of them scaffolding labels, 5 of the
// remaining 25 the same "Ability Score Improvement" string repeated.

/**
 * Internal menu-label features to hide from the Features list.
 *
 * EXACT-STRING match only — deliberately not a substring/prefix filter.
 * `"Demon Style — Rung I"` (a real granted feature: the cross-trained
 * school's own curriculum announcement) contains the substring "Rung I" and
 * would be wrongly hidden by a fuzzy filter. This module doesn't try to be
 * clever about what "looks like" scaffolding — it hides exactly the literal
 * strings Leon named, nothing else. If a future class introduces its own
 * differently-spelled scaffolding label, it needs its own entry here, not a
 * pattern that might also eat a real feature.
 */
export const SCAFFOLDING_FEATURE_NAMES: ReadonlySet<string> = new Set([
  'Ki Stat',
  'School',
  'Signature',
  'Rung I',
  'Rung II',
  'Rung III',
  'Rung IV',
  'Rung V',
  'Capstone',
]);

export interface GroupedClassFeature {
  name: string;
  /** How many times this name appears in the raw list (e.g. 5 ASIs). */
  count: number;
}

/**
 * Filters scaffolding labels out of a raw `class_features` list and
 * collapses repeated names into one entry with a count, preserving
 * first-seen order.
 */
export function groupClassFeatures(names: readonly string[]): GroupedClassFeature[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const raw of names) {
    if (SCAFFOLDING_FEATURE_NAMES.has(raw)) continue;
    const seen = counts.get(raw);
    if (seen === undefined) {
      counts.set(raw, 1);
      order.push(raw);
    } else {
      counts.set(raw, seen + 1);
    }
  }
  return order.map((name) => ({ name, count: counts.get(name) ?? 1 }));
}
