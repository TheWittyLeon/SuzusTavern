// src/lib/dnd/srd.ts
//
// SRD 5e catalog for the character-creation wizard (ST-048/049/050/051).
//
// Why a client-side catalog: the dnd-engine has the authoritative data
// (engine/races.py SRD_RACES, engine/classes.py SRD_CLASSES,
// _BACKGROUND_SKILLS, rules.point_buy_cost) but exposes NO HTTP catalog
// endpoint. The design canvas hardcodes these lists too. So this module mirrors
// the engine exactly; the engine remains the source of truth and re-validates
// every submission server-side (validate_race / validate_class / point-buy).
//
// INVARIANT — keep in sync with the engine:
//  • race.bonuses must equal SRD_RACES[id].ability_bonus (the FIXED bonuses the
//    engine applies at create — half-elf's "+1 to two of choice" is NOT applied
//    at creation, so it is intentionally omitted here so the review preview
//    matches the persisted character byte-for-byte).
//  • class.id / race.id / background.id are the lowercased names the engine's
//    validate_*/lookup functions accept. We POST the canonical `name`.

import type { IconName } from '@/components/Icon';

// ── Abilities + point buy ──────────────────────────────────────────────────────

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
  /** One-line flavor, from the design canvas. */
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

/** 18 SRD skills → governing ability (mirror of rules.SKILLS). Used by the sheet. */
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
  // Out-of-range scores (e.g. probing 16 when deciding whether "+" is allowed)
  // are unaffordable, never free — Infinity keeps the budget gate correct.
  const cost = POINT_BUY_COST[score];
  return cost !== undefined ? cost : Infinity;
}

export function pointsSpent(scores: AbilityScores): number {
  return ABILITY_KEYS.reduce((sum, k) => sum + costFor(scores[k]), 0);
}

export function pointsRemaining(scores: AbilityScores): number {
  return POINT_BUY_BUDGET - pointsSpent(scores);
}

/** 5e ability modifier: floor((score - 10) / 2). */
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Signed modifier string, e.g. "+2" / "-1" / "+0". */
export function formatMod(score: number): string {
  const m = abilityMod(score);
  return m >= 0 ? `+${m}` : `${m}`;
}

// ── Races ──────────────────────────────────────────────────────────────────────

export interface SrdRace {
  /** Lowercased engine key === name.toLowerCase(). */
  id: string;
  /** Canonical name POSTed to the engine. */
  name: string;
  sub: string;
  /** Human-readable bonus summary for the card. */
  bonusLabel: string;
  /** Fixed racial ability bonuses the engine applies at create. */
  bonuses: Partial<Record<AbilityKey, number>>;
  /** Base walking speed in feet (mirror of SRD_RACES[id].speed). */
  speed: number;
  icon: IconName;
}

export const RACES: SrdRace[] = [
  { id: 'human', name: 'Human', sub: 'ambitious · versatile', bonusLabel: '+1 to all', bonuses: { strength: 1, dexterity: 1, constitution: 1, intelligence: 1, wisdom: 1, charisma: 1 }, speed: 30, icon: 'Users' },
  { id: 'half-elf', name: 'Half-Elf', sub: 'diplomatic · between worlds', bonusLabel: '+2 CHA', bonuses: { charisma: 2 }, speed: 30, icon: 'Bard' },
  { id: 'elf', name: 'Elf', sub: 'graceful · keen-sighted', bonusLabel: '+2 DEX', bonuses: { dexterity: 2 }, speed: 30, icon: 'Druid' },
  { id: 'dwarf', name: 'Dwarf', sub: 'stoic · stonecunning', bonusLabel: '+2 CON', bonuses: { constitution: 2 }, speed: 25, icon: 'Shield' },
  { id: 'halfling', name: 'Halfling', sub: 'cheerful · lucky', bonusLabel: '+2 DEX', bonuses: { dexterity: 2 }, speed: 25, icon: 'Lantern' },
  { id: 'tiefling', name: 'Tiefling', sub: 'charming · infernal', bonusLabel: '+2 CHA · +1 INT', bonuses: { charisma: 2, intelligence: 1 }, speed: 30, icon: 'Warlock' },
  { id: 'gnome', name: 'Gnome', sub: 'clever · curious', bonusLabel: '+2 INT', bonuses: { intelligence: 2 }, speed: 25, icon: 'Wizard' },
  { id: 'dragonborn', name: 'Dragonborn', sub: 'proud · ancestral breath', bonusLabel: '+2 STR · +1 CHA', bonuses: { strength: 2, charisma: 1 }, speed: 30, icon: 'Sword' },
  { id: 'half-orc', name: 'Half-Orc', sub: 'fierce · relentless', bonusLabel: '+2 STR · +1 CON', bonuses: { strength: 2, constitution: 1 }, speed: 30, icon: 'Barbarian' },
];

export function getRace(id: string | null | undefined): SrdRace | undefined {
  if (!id) return undefined;
  return RACES.find((r) => r.id === id);
}

/**
 * Apply fixed racial bonuses to a base point-buy spread, clamped to 1–30.
 * Mirrors engine races.apply_racial_bonuses so the review preview equals the
 * persisted character. Scores not touched by the race pass through unchanged.
 */
export function applyRacialBonuses(base: AbilityScores, race: SrdRace | undefined): AbilityScores {
  const out: AbilityScores = { ...base };
  if (!race) return out;
  for (const k of ABILITY_KEYS) {
    const bonus = race.bonuses[k] ?? 0;
    out[k] = Math.max(1, Math.min(30, out[k] + bonus));
  }
  return out;
}

// ── Classes ──────────────────────────────────────────────────────────────────

export interface SrdClass {
  id: string;
  name: string;
  hitDie: number;
  /** The two saving-throw proficiencies (mirror of saving_throw_proficiencies). */
  saves: AbilityKey[];
  icon: IconName;
  /** CSS custom property used as the card's identity accent. */
  accent: string;
  flavor: string;
}

export const CLASSES: SrdClass[] = [
  { id: 'rogue', name: 'Rogue', hitDie: 8, saves: ['dexterity', 'intelligence'], icon: 'Rogue', accent: 'var(--accent)', flavor: 'Sneak, stab, vanish.' },
  { id: 'wizard', name: 'Wizard', hitDie: 6, saves: ['intelligence', 'wisdom'], icon: 'Wizard', accent: 'var(--cool)', flavor: 'A spell for every problem.' },
  { id: 'fighter', name: 'Fighter', hitDie: 10, saves: ['strength', 'constitution'], icon: 'Fighter', accent: 'var(--cool)', flavor: 'Hit it until it stops.' },
  { id: 'cleric', name: 'Cleric', hitDie: 8, saves: ['wisdom', 'charisma'], icon: 'Cleric', accent: 'var(--accent-3)', flavor: 'Mend, smite, repeat.' },
  { id: 'bard', name: 'Bard', hitDie: 8, saves: ['dexterity', 'charisma'], icon: 'Bard', accent: 'var(--warm)', flavor: 'Talk your way through anything.' },
  { id: 'ranger', name: 'Ranger', hitDie: 10, saves: ['strength', 'dexterity'], icon: 'Ranger', accent: 'var(--good)', flavor: 'The wilds answer to you.' },
  { id: 'druid', name: 'Druid', hitDie: 8, saves: ['intelligence', 'wisdom'], icon: 'Druid', accent: 'var(--good)', flavor: 'Be the bear.' },
  { id: 'paladin', name: 'Paladin', hitDie: 10, saves: ['wisdom', 'charisma'], icon: 'Paladin', accent: 'var(--warn)', flavor: 'An oath, kept loudly.' },
  { id: 'sorcerer', name: 'Sorcerer', hitDie: 6, saves: ['constitution', 'charisma'], icon: 'Sorcerer', accent: 'var(--crit)', flavor: 'Magic in the blood.' },
  { id: 'warlock', name: 'Warlock', hitDie: 8, saves: ['wisdom', 'charisma'], icon: 'Warlock', accent: 'var(--accent-2)', flavor: 'A bargain with consequences.' },
  { id: 'barbarian', name: 'Barbarian', hitDie: 12, saves: ['strength', 'constitution'], icon: 'Barbarian', accent: 'var(--bad)', flavor: 'Rage first, ask never.' },
  { id: 'monk', name: 'Monk', hitDie: 8, saves: ['strength', 'dexterity'], icon: 'Monk', accent: 'var(--accent-2)', flavor: 'Fists, focus, ki.' },
];

// ── Level-1 derived stats (mirror of cmd_create math) ───────────────────────────

export interface DerivedStats {
  maxHp: number;
  ac: number;
  initiative: number;
  speed: number;
  proficiencyBonus: number;
}

/**
 * Compute the level-1 derived stats the engine would compute, from FINAL
 * (post-racial) scores. Mirrors cmd_create: HP = hit die + CON mod;
 * AC = 10 + DEX mod (+ CON for Barbarian, + WIS for Monk unarmored).
 */
export function derivedStats(
  finalScores: AbilityScores,
  cls: SrdClass | undefined,
  race: SrdRace | undefined,
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
    speed: race?.speed ?? 30,
    proficiencyBonus: 2,
  };
}

export function getClass(id: string | null | undefined): SrdClass | undefined {
  if (!id) return undefined;
  return CLASSES.find((c) => c.id === id);
}

// ── Backgrounds ──────────────────────────────────────────────────────────────

export interface SrdBackground {
  id: string;
  name: string;
  /** Skill proficiency keys (rules.SKILLS form, e.g. 'sleight_of_hand'). */
  skills: string[];
  blurb: string;
}

// Mirror of _BACKGROUND_SKILLS (the 13 SRD backgrounds) in
// engine/commands/character_commands.py. Blurbs from the design canvas where
// present, else written in Suzu's register.
export const BACKGROUNDS: SrdBackground[] = [
  { id: 'acolyte', name: 'Acolyte', skills: ['insight', 'religion'], blurb: 'you were good at the prayers and bad at the meetings.' },
  { id: 'charlatan', name: 'Charlatan', skills: ['deception', 'sleight_of_hand'], blurb: "you've lied your way out of three towns; the fourth is suspicious." },
  { id: 'criminal', name: 'Criminal', skills: ['deception', 'stealth'], blurb: 'a friend you cannot name owes you a favor in a city you cannot enter.' },
  { id: 'entertainer', name: 'Entertainer', skills: ['acrobatics', 'performance'], blurb: "the crowd remembered you. You wish they hadn't." },
  { id: 'folk hero', name: 'Folk Hero', skills: ['animal_handling', 'survival'], blurb: 'one town tells a story about you. You were there; it went differently.' },
  { id: 'guild artisan', name: 'Guild Artisan', skills: ['insight', 'persuasion'], blurb: 'you make a thing well, and you will tell anyone who stands still.' },
  { id: 'hermit', name: 'Hermit', skills: ['medicine', 'religion'], blurb: 'you learned something in the quiet. You are not sure who to tell.' },
  { id: 'noble', name: 'Noble', skills: ['history', 'persuasion'], blurb: 'you have a house. Or you used to. Or you said you did.' },
  { id: 'outlander', name: 'Outlander', skills: ['athletics', 'survival'], blurb: 'you slept under sky more nights than under roof. The roofs feel small.' },
  { id: 'sage', name: 'Sage', skills: ['arcana', 'history'], blurb: 'you grew up in a library. You still suspect the library.' },
  { id: 'sailor', name: 'Sailor', skills: ['athletics', 'perception'], blurb: 'the sea took something of yours and you keep going back for it.' },
  { id: 'soldier', name: 'Soldier', skills: ['athletics', 'intimidation'], blurb: 'you took an oath, broke it once, and never spoke of it again.' },
  { id: 'urchin', name: 'Urchin', skills: ['sleight_of_hand', 'stealth'], blurb: 'you knew every roof in the city before you knew your letters.' },
];

export function getBackground(id: string | null | undefined): SrdBackground | undefined {
  if (!id) return undefined;
  return BACKGROUNDS.find((b) => b.id === id);
}

/** 'sleight_of_hand' → 'Sleight of Hand'. */
export function humanizeSkill(skill: string): string {
  return skill
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ── Suzu commentary (ST-053 v1 — hardcoded; AI streaming is v1.1, deferred) ─────

export const SUZU_LINES: {
  race: Record<string, string>;
  class: Record<string, string>;
} = {
  race: {
    human: 'A human. Reliable. Suzu approves of reliable.',
    'half-elf': 'Half-elf. Half in, half out. The narrator’s pick.',
    elf: 'An elf. Long-lived. Suzu has been waiting.',
    dwarf: 'A dwarf. The chimney conversation may go differently.',
    halfling: 'A halfling. Small, hard to hit, fond of pockets.',
    tiefling: 'A tiefling. Several NPCs will mind. Some will not.',
    gnome: 'A gnome. The mechanism in the basement just got more interesting.',
    dragonborn: 'A dragonborn. The barkeep is reconsidering the no-flame policy.',
    'half-orc': 'A half-orc. The door, again, will not survive this.',
  },
  class: {
    rogue: "Rogue. Trickster. You're going up the chimney first.",
    wizard: 'Wizard. Suzu has prepared 14 (fourteen) spell tables.',
    fighter: 'Fighter. Direct. Refreshing, frankly.',
    cleric: 'Cleric. Someone has to be sensible. (Briefly.)',
    bard: 'Bard. The barkeep already dislikes you. (Charisma will fix it.)',
    ranger: 'Ranger. Suzu has stocked the woods with appropriately suspicious tracks.',
    druid: 'Druid. The cat in chapter 2 is now possibly you.',
    paladin: 'Paladin. Suzu finds your oath endearing. (For now.)',
    sorcerer: 'Sorcerer. Born with it. Suzu envies you and resents you in equal measure.',
    warlock: 'Warlock. Your patron has notes. They will appear at inconvenient times.',
    barbarian: 'Barbarian. The door will be opened. The door will not survive.',
    monk: 'Monk. Quiet. Disciplined. Suzu is taking some of that energy for herself.',
  },
};
