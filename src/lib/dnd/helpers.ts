// src/lib/dnd/helpers.ts
//
// Pure, static D&D 5e helpers that are UI math — not catalog data.
// These values are defined by the 5e rules themselves (point-buy math,
// ability definitions, the 18 SRD skills) and do not drift with catalog
// updates. Catalog-driven lists (races, classes, backgrounds) live in
// src/lib/api/dnd.ts (getCatalog) and src/lib/dnd/catalog.ts.

import type { IconName } from '@/components/Icon';

// ── Abilities ──────────────────────────────────────────────────────────────────

export type AbilityKey =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

export type AbilityScores = Record<AbilityKey, number>;

export interface AbilityMeta {
  key: AbilityKey;
  /** Three-letter uppercase label (STR, DEX, …). */
  abbr: string;
  /** Display name (Strength, …). */
  name: string;
  /** One-line flavor. */
  blurb: string;
}

export const ABILITIES: AbilityMeta[] = [
  { key: 'strength', abbr: 'STR', name: 'Strength', blurb: 'How hard you swing, how heavy you lift.' },
  { key: 'dexterity', abbr: 'DEX', name: 'Dexterity', blurb: 'How quick you are. Locks. Chimneys.' },
  { key: 'constitution', abbr: 'CON', name: 'Constitution', blurb: 'How much you can take before falling over.' },
  { key: 'intelligence', abbr: 'INT', name: 'Intelligence', blurb: "What you've read, what you remember." },
  { key: 'wisdom', abbr: 'WIS', name: 'Wisdom', blurb: 'What you notice. What you sense.' },
  { key: 'charisma', abbr: 'CHA', name: 'Charisma', blurb: 'How well you sell it.' },
];

export const ABILITY_KEYS: AbilityKey[] = ABILITIES.map((a) => a.key);

// ── Skills ─────────────────────────────────────────────────────────────────────

export interface SkillDef {
  /** Engine key (e.g. 'sleight_of_hand'). */
  key: string;
  /** Display name. */
  name: string;
  ability: AbilityKey;
  /** Three-letter ability abbreviation for the row. */
  abbr: string;
}

export const SKILLS: SkillDef[] = [
  { key: 'acrobatics', name: 'Acrobatics', ability: 'dexterity', abbr: 'DEX' },
  { key: 'animal_handling', name: 'Animal Handling', ability: 'wisdom', abbr: 'WIS' },
  { key: 'arcana', name: 'Arcana', ability: 'intelligence', abbr: 'INT' },
  { key: 'athletics', name: 'Athletics', ability: 'strength', abbr: 'STR' },
  { key: 'deception', name: 'Deception', ability: 'charisma', abbr: 'CHA' },
  { key: 'history', name: 'History', ability: 'intelligence', abbr: 'INT' },
  { key: 'insight', name: 'Insight', ability: 'wisdom', abbr: 'WIS' },
  { key: 'intimidation', name: 'Intimidation', ability: 'charisma', abbr: 'CHA' },
  { key: 'investigation', name: 'Investigation', ability: 'intelligence', abbr: 'INT' },
  { key: 'medicine', name: 'Medicine', ability: 'wisdom', abbr: 'WIS' },
  { key: 'nature', name: 'Nature', ability: 'intelligence', abbr: 'INT' },
  { key: 'perception', name: 'Perception', ability: 'wisdom', abbr: 'WIS' },
  { key: 'performance', name: 'Performance', ability: 'charisma', abbr: 'CHA' },
  { key: 'persuasion', name: 'Persuasion', ability: 'charisma', abbr: 'CHA' },
  { key: 'religion', name: 'Religion', ability: 'intelligence', abbr: 'INT' },
  { key: 'sleight_of_hand', name: 'Sleight of Hand', ability: 'dexterity', abbr: 'DEX' },
  { key: 'stealth', name: 'Stealth', ability: 'dexterity', abbr: 'DEX' },
  { key: 'survival', name: 'Survival', ability: 'wisdom', abbr: 'WIS' },
];

// ── Point buy ─────────────────────────────────────────────────────────────────

/** 5e point-buy cost table (mirror of rules.point_buy_cost). */
export const POINT_BUY_COST: Readonly<Record<number, number>> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;

/** Every score starts at 8 (0 points spent). */
export const DEFAULT_SCORES: AbilityScores = {
  strength: 8,
  dexterity: 8,
  constitution: 8,
  intelligence: 8,
  wisdom: 8,
  charisma: 8,
};

export function costFor(score: number): number {
  const cost = POINT_BUY_COST[score];
  return cost !== undefined ? cost : Infinity;
}

export function pointsSpent(scores: AbilityScores): number {
  return ABILITY_KEYS.reduce((sum, k) => sum + costFor(scores[k]), 0);
}

export function pointsRemaining(scores: AbilityScores): number {
  return POINT_BUY_BUDGET - pointsSpent(scores);
}

// ── Ability math ──────────────────────────────────────────────────────────────

/** 5e ability modifier: floor((score - 10) / 2). */
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Signed modifier string, e.g. "+2" / "-1" / "+0". */
export function formatMod(score: number): string {
  const m = abilityMod(score);
  return m >= 0 ? `+${m}` : `${m}`;
}

// ── Skill helpers ─────────────────────────────────────────────────────────────

/** 'sleight_of_hand' → 'Sleight of Hand'. */
export function humanizeSkill(skill: string): string {
  return skill
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ── Racial bonus application ──────────────────────────────────────────────────

/**
 * Apply fixed racial bonuses to a base point-buy spread, clamped to 1–30.
 * Mirrors engine races.apply_racial_bonuses. Only used for the review preview
 * (the engine re-applies server-side on POST /characters).
 */
export function applyRacialBonuses(
  base: AbilityScores,
  bonuses: Partial<Record<AbilityKey, number>> | undefined,
): AbilityScores {
  const out: AbilityScores = { ...base };
  if (!bonuses) return out;
  for (const k of ABILITY_KEYS) {
    const bonus = bonuses[k] ?? 0;
    out[k] = Math.max(1, Math.min(30, out[k] + bonus));
  }
  return out;
}

// ── Derived stats ─────────────────────────────────────────────────────────────

export interface DerivedStats {
  maxHp: number;
  ac: number;
  initiative: number;
  speed: number;
  proficiencyBonus: number;
}

/**
 * Compute level-1 derived stats from FINAL (post-racial) scores.
 * Mirrors cmd_create: HP = hit die + CON mod; AC = 10 + DEX mod
 * (+ CON for Barbarian unarmored, + WIS for Monk unarmored).
 */
export function derivedStats(
  finalScores: AbilityScores,
  cls: { id: string; hitDie: number } | undefined,
  speed: number,
): DerivedStats {
  const conMod = abilityMod(finalScores.constitution);
  const dexMod = abilityMod(finalScores.dexterity);
  const wisMod = abilityMod(finalScores.wisdom);
  const hitDie = cls?.hitDie ?? 8;
  let ac = 10 + dexMod;
  if (cls?.id === 'barbarian') ac = 10 + dexMod + conMod;
  else if (cls?.id === 'monk') ac = 10 + dexMod + wisMod;
  return {
    maxHp: Math.max(1, hitDie + conMod),
    ac,
    initiative: dexMod,
    speed,
    proficiencyBonus: 2,
  };
}

// ── UI-only decoration tables ─────────────────────────────────────────────────
// These fields are visual/flavor only and will never appear in the catalog API.
// Keyed by the catalog slug (name.toLowerCase()).

export const RACE_DECORATION: Record<
  string,
  { icon: IconName; sub: string }
> = {
  human:      { icon: 'Users',     sub: 'ambitious · versatile' },
  'half-elf': { icon: 'Bard',      sub: 'diplomatic · between worlds' },
  elf:        { icon: 'Druid',     sub: 'graceful · keen-sighted' },
  dwarf:      { icon: 'Shield',    sub: 'stoic · stonecunning' },
  halfling:   { icon: 'Lantern',   sub: 'cheerful · lucky' },
  tiefling:   { icon: 'Warlock',   sub: 'charming · infernal' },
  gnome:      { icon: 'Wizard',    sub: 'clever · curious' },
  dragonborn: { icon: 'Sword',     sub: 'proud · ancestral breath' },
  'half-orc': { icon: 'Barbarian', sub: 'fierce · relentless' },
};

// `accent` is the decorative card tint (borders/fills/gradients). `accentInk` is
// the contrast-safe TEXT variant for the selected-card bonus label — only the
// cool/crit accents need it (they fail AA as text on candlelit; see globals.css
// --cool-ink/--crit-ink). Others read AA already, so accentInk is omitted.
export const CLASS_DECORATION: Record<
  string,
  { icon: IconName; accent: string; accentInk?: string; flavor: string }
> = {
  rogue:     { icon: 'Rogue',     accent: 'var(--accent)',   flavor: 'Sneak, stab, vanish.' },
  wizard:    { icon: 'Wizard',    accent: 'var(--cool)',     accentInk: 'var(--cool-ink)', flavor: 'A spell for every problem.' },
  fighter:   { icon: 'Fighter',   accent: 'var(--cool)',     accentInk: 'var(--cool-ink)', flavor: 'Hit it until it stops.' },
  cleric:    { icon: 'Cleric',    accent: 'var(--accent-3)', flavor: 'Mend, smite, repeat.' },
  bard:      { icon: 'Bard',      accent: 'var(--warm)',     flavor: 'Talk your way through anything.' },
  ranger:    { icon: 'Ranger',    accent: 'var(--good)',     flavor: 'The wilds answer to you.' },
  druid:     { icon: 'Druid',     accent: 'var(--good)',     flavor: 'Be the bear.' },
  paladin:   { icon: 'Paladin',   accent: 'var(--warn)',     flavor: 'An oath, kept loudly.' },
  sorcerer:  { icon: 'Sorcerer',  accent: 'var(--crit)',     accentInk: 'var(--crit-ink)', flavor: 'Magic in the blood.' },
  warlock:   { icon: 'Warlock',   accent: 'var(--accent-2)', flavor: 'A bargain with consequences.' },
  barbarian: { icon: 'Barbarian', accent: 'var(--bad)',      flavor: 'Rage first, ask never.' },
  monk:      { icon: 'Monk',      accent: 'var(--accent-2)', flavor: 'Fists, focus, ki.' },
};

// ── Caster gate (T4/DDX-11t creation slice) ───────────────────────────────────
// Mirrors engine/classes.py's SpellcastingProfile setup (verified by read,
// NekoNova-DnDEngine 2026-07-09): the 6 classes below get real cantrips AND
// 1st-level slots at character level 1. Paladin/ranger DO set a
// spellcasting_ability (surfaced by the catalog's CatalogClassData) but their
// `cantrips_known` table is empty and their half-caster slot table starts at
// level 2 (see spellbook.py's max_castable_spell_level docstring) — so they
// have a ZERO spell budget at creation and are correctly excluded here. This
// is the "class -> caster" map the DDX-11t creation-wizard slice uses to gate
// the Spells step; it does NOT reflect casters unlocked by subclass (e.g.
// Eldritch Knight/Arcane Trickster at level 3), which are out of scope for a
// level-1 creation flow.
//
// `kind` mirrors engine/spellbook.py's caster_kind() classification and
// decides which hop the creation wizard uses for a chosen 1st-level spell:
//  - 'known'     (bard/sorcerer/warlock) -> learnSpell, capped by
//                 AvailableSpellsResult.budget.spells_max.
//  - 'prepared'  (cleric/druid) -> prepareSpell(slug, true), capped by
//                 budget.prepared_max (they auto-know the full class list;
//                 5e "preparing" a spell for the first time IS how they add
//                 it to today's repertoire — see spells_msm.py's set_prepared,
//                 kind=='prepared' branch, which upserts a new row).
//  - 'spellbook' (wizard) -> learnSpell, capped by WIZARD_LEVEL1_SPELLBOOK_SIZE
//                 (the engine's wire budget only exposes wizard's *prepared*
//                 cap, not spellbook capacity — see spellbook.py's
//                 wizard_spellbook_size, a static SRD formula not on the wire).
export type CasterKind = 'known' | 'prepared' | 'spellbook';

export const CLASS_CASTER_KIND: Record<string, CasterKind> = {
  bard: 'known',
  sorcerer: 'known',
  warlock: 'known',
  cleric: 'prepared',
  druid: 'prepared',
  wizard: 'spellbook',
};

/** SRD wizard spellbook size at level 1 (engine/spellbook.py:110,
 *  `wizard_spellbook_size`: `6 + 2 * (level - 1)`). Hardcoded here because a
 *  freshly created character is always level 1 and this figure is not part
 *  of the wire budget — the engine still enforces the real cap server-side
 *  on learn (over_spellbook_limit), this is only a client-side UX hint. */
export const WIZARD_LEVEL1_SPELLBOOK_SIZE = 6;

// Keyed by the catalog slug the engine actually emits for a background — SRD
// display names are slugified as name.replace(" ", "-") (see
// NekoNova-DnDEngine scripts/import_srd.py::build_backgrounds and
// engine/rules_catalog.py::_slugify), e.g. "Folk Hero" -> 'folk-hero', NOT
// 'folk hero'. A key here that uses a space instead of a dash silently misses
// catalogItemToBackground's lookup and falls back to blurb: '' — that WAS the
// bug for 'folk hero'/'guild artisan' below, on top of 10 backgrounds that had
// no entry at all (UIR2-TAV-22). BackgroundStep's render guard in page.tsx
// (hasBackgroundBlurb) is the defense-in-depth fix for any future gap here.
export const BACKGROUND_DECORATION: Record<string, { blurb: string }> = {
  acolyte:         { blurb: 'you were good at the prayers and bad at the meetings.' },
  charlatan:       { blurb: "you've lied your way out of three towns; the fourth is suspicious." },
  'city-watch':    { blurb: "you know which alleys the lamplight skips. You used to patrol them for a badge; now it's habit." },
  'clan-crafter':  { blurb: "your clan's mark is stamped into the work. You've never signed a piece you weren't proud of." },
  courtier:        { blurb: 'you learned to read a room before you learned to read. This one is lying to you, politely.' },
  criminal:        { blurb: 'a friend you cannot name owes you a favor in a city you cannot enter.' },
  entertainer:     { blurb: "the crowd remembered you. You wish they hadn't." },
  'far-traveler':  { blurb: "you crossed a very long way to sit at this table. People still ask where you're really from." },
  'folk-hero':     { blurb: 'one town tells a story about you. You were there; it went differently.' },
  gladiator:       { blurb: 'the crowd learned your name before you learned to duck. You bow better than you block.' },
  'guild-artisan': { blurb: 'you make a thing well, and you will tell anyone who stands still.' },
  'haunted-one':   { blurb: "something followed you out of somewhere. You stopped looking behind you; it didn't stop." },
  hermit:          { blurb: 'you learned something in the quiet. You are not sure who to tell.' },
  inheritor:       { blurb: "something was left to you — a map, a key, a debt. You still haven't worked out which." },
  knight:          { blurb: 'you swore an oath in front of witnesses who are still watching to see if you meant it.' },
  noble:           { blurb: 'you have a house. Or you used to. Or you said you did.' },
  outlander:       { blurb: 'you slept under sky more nights than under roof. The roofs feel small.' },
  pirate:          { blurb: "you signed articles in blood, or close enough. The ship's gone; the habits kept sailing." },
  sage:            { blurb: 'you grew up in a library. You still suspect the library.' },
  sailor:          { blurb: 'the sea took something of yours and you keep going back for it.' },
  soldier:         { blurb: 'you took an oath, broke it once, and never spoke of it again.' },
  spy:             { blurb: "you work for someone who denies knowing you. That was the deal; you're still holding up your end." },
  urchin:          { blurb: 'you knew every roof in the city before you knew your letters.' },
};

/**
 * Whether a background's flavor line has real content worth showing.
 * BackgroundStep wraps a non-empty blurb in curly quotes — an empty, missing,
 * or whitespace-only blurb (e.g. a catalog background not yet decorated
 * above) must render nothing at all, never a literal `""` (UIR2-TAV-22).
 */
export function hasBackgroundBlurb(blurb: string | null | undefined): boolean {
  return typeof blurb === 'string' && blurb.trim().length > 0;
}

// ── Suzu commentary (ST-053 v1 — hardcoded) ───────────────────────────────────

export const SUZU_LINES: {
  race: Record<string, string>;
  class: Record<string, string>;
} = {
  race: {
    human:      'A human. Reliable. Suzu approves of reliable.',
    'half-elf': "Half-elf. Half in, half out. The narrator's pick.",
    elf:        'An elf. Long-lived. Suzu has been waiting.',
    dwarf:      'A dwarf. The chimney conversation may go differently.',
    halfling:   'A halfling. Small, hard to hit, fond of pockets.',
    tiefling:   'A tiefling. Several NPCs will mind. Some will not.',
    gnome:      'A gnome. The mechanism in the basement just got more interesting.',
    dragonborn: 'A dragonborn. The barkeep is reconsidering the no-flame policy.',
    'half-orc': 'A half-orc. The door, again, will not survive this.',
  },
  class: {
    rogue:     "Rogue. Trickster. You're going up the chimney first.",
    wizard:    'Wizard. Suzu has prepared 14 (fourteen) spell tables.',
    fighter:   'Fighter. Direct. Refreshing, frankly.',
    cleric:    'Cleric. Someone has to be sensible. (Briefly.)',
    bard:      'Bard. The barkeep already dislikes you. (Charisma will fix it.)',
    ranger:    'Ranger. Suzu has stocked the woods with appropriately suspicious tracks.',
    druid:     'Druid. The cat in chapter 2 is now possibly you.',
    paladin:   'Paladin. Suzu finds your oath endearing. (For now.)',
    sorcerer:  'Sorcerer. Born with it. Suzu envies you and resents you in equal measure.',
    warlock:   'Warlock. Your patron has notes. They will appear at inconvenient times.',
    barbarian: 'Barbarian. The door will be opened. The door will not survive.',
    monk:      'Monk. Quiet. Disciplined. Suzu is taking some of that energy for herself.',
  },
};
