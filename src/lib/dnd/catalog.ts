// src/lib/dnd/catalog.ts
//
// Transforms raw GET /api/dnd/catalog items into the typed display shapes
// the wizard uses. Mechanical fields come from the catalog; UI-only decoration
// (icons, flavor, blurbs) comes from the local decoration tables in helpers.ts.
//
// This adapter is the single point of contact between catalog data and wizard
// rendering — change the catalog schema, update it here.

import {
  RACE_DECORATION,
  CLASS_DECORATION,
  BACKGROUND_DECORATION,
  ABILITY_KEYS,
  casterKindFromSpellcasting,
  castingModelFromSpellcasting,
  slugifyName,
  DEFAULT_POINTS_LABEL,
  type AbilityKey,
  type CasterKind,
} from './helpers';
import type { IconName } from '@/components/Icon';
import type {
  CatalogItem,
  CatalogRaceData,
  CatalogClassData,
  CatalogBackgroundData,
  CatalogSubclassData,
  FeatureChoiceOption,
} from '@/lib/api/types';

// ── Wizard display types ──────────────────────────────────────────────────────

/**
 * TAV-CREATE-SUBRACE-ASI-PICKER — one named subrace from the catalog's
 * `data.subraces` map (e.g. Elf -> "Wood Elf"). `name` is the exact display
 * name POSTed to the engine as `subrace` (the engine matches it case-
 * insensitively). `bonuses`/`bonusLabel` mirror WizardRace's own convention;
 * `speed` is only present when the subrace overrides the base race's speed
 * (e.g. Wood Elf 35 ft).
 */
export interface WizardSubrace {
  name: string;
  bonuses: Partial<Record<AbilityKey, number>>;
  bonusLabel: string;
  speed?: number;
  /** RACE-SKILLS-STAMP / Iro live-walk follow-up (2026-09-09) — a
   *  subrace's OWN skill-proficiency grant, additive with the base race's
   *  (mirrors the engine's `race_skill_proficiencies`: union, never
   *  override — no real 5e subrace removes its base race's grant). Empty
   *  for every subrace seeded today (verified live on suzu_dnd_dev,
   *  2026-09-08: zero subraces declare their own key) — this is
   *  forward-compatible plumbing, not yet exercised by real content. */
  skillProficiencies?: string[];
}

export interface WizardRace {
  /** Catalog slug == name.toLowerCase(). POSTed to the engine as `race` via name. */
  id: string;
  /** Canonical name to POST to the engine. */
  name: string;
  sub: string;
  /** Human-readable bonus summary derived from ability_bonus. */
  bonusLabel: string;
  /** Fixed racial ability bonuses the engine applies at create. */
  bonuses: Partial<Record<AbilityKey, number>>;
  /** Base walking speed in feet. */
  speed: number;
  icon: IconName;
  /**
   * TAV-CREATE-SUBRACE-ASI-PICKER — named subraces from the catalog (e.g.
   * Elf -> High/Wood/Dark). Empty for a race with none (Human, Half-Orc,
   * Half-Elf — the latter uses the floating ASI instead, see needsAsiChoice).
   */
  subraces: WizardSubrace[];
  /**
   * TAV-CREATE-SUBRACE-ASI-PICKER — true only for Half-Elf (item.slug ===
   * 'half-elf'), the one SRD race with a floating "+1 to two other
   * abilities" instead of fixed subrace bonuses. Mirrors the engine's own
   * hardcoded gate (NekoNova-DnDEngine races.py).
   */
  needsAsiChoice: boolean;
  /**
   * Whether the player MUST pick a subrace before continuing.
   *
   * Defaults to true, which is right for every SRD race that declares
   * subraces (Elf, Dwarf, Halfling, Gnome all require one). It is WRONG
   * wherever the base race is itself playable and the subrace is a variant:
   * Dragon Ball's Saiyan declares exactly one subrace (Half-Saiyan), so the
   * unconditional gate made a full-blooded Saiyan — the campaign's signature
   * lineage — impossible to create in the browser, while the engine accepted
   * `subrace=None` perfectly well.
   *
   * Content decides, via `data.subrace_required: false` on the race row.
   */
  subraceRequired?: boolean;
  /** RACE-SKILLS-STAMP / Iro live-walk follow-up (2026-09-09) — the race's
   *  fixed skill-proficiency grant (e.g. SRD Elf's Perception via Keen
   *  Senses, FT Human's Persuasion), now genuinely stamped into
   *  proficient_skills at creation (NekoNova-DnDEngine
   *  `rules_catalog.race_skill_proficiencies`, unioned into
   *  `build_level1_character` BEFORE the class's own `skills:1` choice is
   *  queued — so the engine's authoritative skills:1 option pool already
   *  excludes these). The Skills step mirrors that exclusion client-side
   *  so a race-granted skill is never offered as a wasted pick. */
  skillProficiencies?: string[];
}

export interface WizardClass {
  id: string;
  name: string;
  hitDie: number;
  /** Two saving-throw proficiency ability keys. */
  saves: AbilityKey[];
  icon: IconName;
  /** CSS custom property for the card accent (decorative fills/borders). */
  accent: string;
  /** Contrast-safe TEXT variant of the accent for the selected bonus label. */
  accentInk?: string;
  flavor: string;
  /** T4/DDX-11t — true for a class with a real spell budget at level 1,
   *  derived from the catalog row's own `spellcasting` block (see
   *  casterKindFromSpellcasting in helpers.ts, TAV-WIZARD-HOMEBREW-
   *  CASTERS). Kage-CR #10: absent `spellcasting` on the wire (v1 row, or
   *  an explicit-null v2 non-caster declaration) maps here to `false` —
   *  never fabricated as a caster. Gates the wizard's Spells step. */
  isCaster: boolean;
  /** Undefined for a non-caster; see casterKindFromSpellcasting's docstring
   *  for what each kind means for the creation-time learn/prepare hop. */
  casterKind?: CasterKind;
  /** TAV-CLASS-STAT-GUIDANCE — the class's DECLARED recommended abilities
   *  (catalog `primary_ability`, validated), in declared order. [] when the
   *  class declares none — render nothing; guidance is never fabricated
   *  client-side (a hardcoded class→stats map here is an HB-P1 reject). */
  primary: AbilityKey[];
  /** The class's spellcasting ability, when it declares one (includes
   *  paladin/ranger, who cast from level 2 — still true guidance at creation). */
  spellcastingAbility?: AbilityKey;
  /** The class's Unarmored Defense ability (barbarian CON / monk WIS /
   *  homebrew-declared), when it declares one. */
  unarmoredDefenseAbility?: AbilityKey;
  /** TAV-WIZARD-HOMEBREW-CASTERS — RESOURCE model, display-only. Optional so
   *  every pre-existing WizardClass test fixture keeps compiling; consumers
   *  read `castingModel ?? 'slots'` (matches the campaign default — see
   *  castingModelFromSpellcasting's docstring). Always 'slots' in practice
   *  for anything produced by catalogItemToClass — never left undefined. */
  castingModel?: 'slots' | 'points';
  /** TAV-WIZARD-HOMEBREW-CASTERS — what a points caster calls its pool
   *  ("Chakra", "Magic Power", "Ki"). Meaningful only when
   *  castingModel === 'points'; consumers fall back to DEFAULT_POINTS_LABEL. */
  pointsLabel?: string;
  /** TAV-WIZARD-HOMEBREW-CASTERS — the catalog's `subclass_level` verbatim.
   *  The Subclass step gates on `=== 1` (an archetype pick due at THIS
   *  creation flow); higher values (wizard's 2, most SRD classes' 3) are
   *  still exposed for completeness but the wizard doesn't act on them. */
  subclassLevel?: number;
  /** R62/TAV-SUBCLASS-LEVEL-OVERRIDE — the catalog's `effective_subclass_
   *  level` (the MIN over `subclassLevel` and every visible subclass's own
   *  declared level), falling back to `subclassLevel` itself when the wire
   *  omits the field (pre-ruling engine) — that fallback is what keeps
   *  `hasSubclassStep`'s `=== 1` gate byte-identical to today whenever the
   *  field is absent. `hasSubclassStep` reads THIS field, not the plain
   *  `subclassLevel` — an SRD rogue whose class row still says
   *  `subclass_level: 3` gets a creation-time Subclass step the moment a
   *  Re:Zero archetype pulls its `effectiveSubclassLevel` down to 1;
   *  `subclassLevel` itself is untouched and still governs the individual
   *  SRD archetypes' own gate via `subclassOwnLevel`'s fallback below. */
  effectiveSubclassLevel?: number;
  /** TAV-WIZARD-HOMEBREW-CASTERS — the class's FIRST choose-N feature menu
   *  (`data.feature_choices[0]`), when the row declares one. The Rung step
   *  gates on `knownAtLevel1 > 0`. */
  rungMenu?: WizardRungMenu;
  /** ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP (2026-09-08) — the class's own
   *  skill-proficiency choice pool (catalog `skill_choices`), resolved
   *  server-side via the `skills:1` pending choice the engine now queues at
   *  creation. Undefined/empty for a v1 row or a class that declares none —
   *  the Skills step gates on `skillCount > 0 && skillChoices.length > 0`
   *  (see hasSkillsStep), so that degrades to today's background-only
   *  behaviour, never a broken step. */
  skillChoices?: string[];
  /** How many of `skillChoices` to pick (catalog `skill_count`). */
  skillCount?: number;
}

/** TAV-WIZARD-HOMEBREW-CASTERS — a class's level-1 "choose N from a list"
 *  menu, e.g. Naruto's "Path Technique" / Fairy Tail's "Magic Rung". */
export interface WizardRungMenu {
  label: string;
  /** Leon's 2026-08-23 ruling gate (`feature_choices[0].freeform`) — false
   *  means level-up-only; the Rung step renders read-only and attempts no
   *  API call (§3 of the design). */
  freeform: boolean;
  /** `known["1"]` off the wire — the exact pick count required at creation. */
  knownAtLevel1: number;
  /** The FULL unfiltered option menu (including archetype-tagged entries) —
   *  RungStep filters client-side by `option.subclass` once an archetype is
   *  chosen; see subclassesForClass's sibling filtering discipline below. */
  options: FeatureChoiceOption[];
}

/** TAV-WIZARD-HOMEBREW-CASTERS — one catalog `subclass` row, shaped for the
 *  creation wizard's Subclass step. Mirrors LevelChoicePicker's own
 *  SubclassChoiceCard display shape (id/name/blurb) plus the raw `class`
 *  field the shared filter below keys on. */
export interface WizardSubclass {
  id: string;
  name: string;
  /** Raw wire value off `data.class` (a lowercased display name, NOT a
   *  slug — see CatalogSubclassData.class's docstring). Kept for callers
   *  that want to re-derive scoping; ordinary rendering only needs id/name/blurb. */
  class: string;
  blurb: string;
  /** R62/TAV-SUBCLASS-LEVEL-OVERRIDE — this subclass's OWN effective gate
   *  level: its own declared `data.subclass_level` when present, else the
   *  owning class's plain `subclass_level` (the fallback passed into
   *  `catalogItemToSubclass`) — see `subclassOwnLevel`'s doc comment for
   *  why the fallback is the class's PLAIN level, not its `effective`
   *  (already-minned) one. Undefined only when neither resolved (no class
   *  fallback was supplied at all). */
  subclassLevel?: number;
}

export interface WizardBackground {
  id: string;
  name: string;
  /** Skill proficiency keys in engine form (e.g. 'sleight_of_hand'). */
  skills: string[];
  blurb: string;
}

// ── Bonus label helper ────────────────────────────────────────────────────────

const ABILITY_ABBR: Record<string, string> = {
  strength: 'STR',
  dexterity: 'DEX',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'WIS',
  charisma: 'CHA',
};

/** Runtime guard for a wire ability value — the engine normalises to full
 *  lowercase names, but this adapter never trusts the wire shape (a malformed
 *  value must degrade to "no guidance", not crash the wizard). Kage: uses
 *  ABILITY_KEYS.includes, NOT `in ABILITY_ABBR` — `in` walks the prototype
 *  chain, so a wire value of "toString"/"constructor" would pass and render
 *  "Suggested focus: TOSTRING". Also keeps one truth table for the six keys. */
function isAbilityKey(s: unknown): s is AbilityKey {
  return typeof s === 'string' && (ABILITY_KEYS as string[]).includes(s);
}

function buildBonusLabel(bonus: Partial<Record<string, number>>): string {
  const parts = Object.entries(bonus)
    .filter(([, v]) => v && v !== 0)
    // The sign comes from the NUMBER, not from a hardcoded '+'. Every SRD
    // racial bonus is positive, so the old unconditional prefix held until a
    // homebrew subrace carried a penalty — Dragon Ball's Half-Saiyan (-1 STR,
    // +1 WIS, the price of the human half) rendered as "+-1 STR" in the live
    // creation wizard.
    .map(([k, v]) => `${(v ?? 0) > 0 ? '+' : ''}${v ?? 0} ${ABILITY_ABBR[k] ?? k.toUpperCase()}`);
  return parts.length ? parts.join(' · ') : 'none';
}

// ── Catalog → wizard adapters ─────────────────────────────────────────────────

export function catalogItemToRace(item: CatalogItem): WizardRace {
  const d = item.data as CatalogRaceData;
  const deco = RACE_DECORATION[item.slug] ?? { icon: 'Users' as IconName, sub: '' };
  const bonuses = (d.ability_bonus ?? {}) as Partial<Record<AbilityKey, number>>;
  const subraces: WizardSubrace[] = Object.entries(d.subraces ?? {}).map(([name, raw]) => {
    const sub = (raw ?? {}) as {
      ability_bonus?: Partial<Record<string, number>>;
      speed?: number;
      skill_proficiencies?: unknown;
    };
    const subBonuses = (sub.ability_bonus ?? {}) as Partial<Record<AbilityKey, number>>;
    return {
      name,
      bonuses: subBonuses,
      bonusLabel: buildBonusLabel(subBonuses),
      speed: sub.speed,
      // RACE-SKILLS-STAMP — defensive against a garbage wire value the same
      // way skillChoices/rungMenu.options are elsewhere in this file:
      // Array.isArray before use, degrades to [] rather than throwing.
      skillProficiencies: Array.isArray(sub.skill_proficiencies)
        ? sub.skill_proficiencies
        : [],
    };
  });
  return {
    id: item.slug,
    name: item.name,
    sub: deco.sub,
    bonusLabel: buildBonusLabel(bonuses),
    bonuses,
    speed: d.speed ?? 30,
    icon: deco.icon,
    subraces,
    // Matches the engine's own hardcoded Half-Elf ASI gate — the only SRD
    // race with a floating "+1 to two other abilities" rather than fixed
    // subrace bonuses (Half-Elf's own `data.subraces` is empty on the wire).
    needsAsiChoice: item.slug === 'half-elf',
    // Absent → true, so every existing race keeps the SRD behaviour exactly.
    subraceRequired: d.subrace_required !== false,
    skillProficiencies: Array.isArray(d.skill_proficiencies) ? d.skill_proficiencies : [],
  };
}

export function catalogItemToClass(item: CatalogItem): WizardClass {
  const d = item.data as CatalogClassData;
  const deco = CLASS_DECORATION[item.slug] ?? {
    icon: 'Sword' as IconName,
    accent: 'var(--accent)',
    flavor: '',
  };
  // saving_throws from catalog; fall back to empty to keep type safety
  const saves = ((d.saving_throws ?? []) as string[]).filter(
    (s): s is AbilityKey => s in ABILITY_ABBR,
  );
  // TAV-WIZARD-HOMEBREW-CASTERS — data-driven caster derivation, replacing
  // the old per-slug CLASS_CASTER_KIND lookup.
  const casterKind = casterKindFromSpellcasting(d.spellcasting);
  const castingModel = castingModelFromSpellcasting(d.spellcasting);
  const pointsLabelRaw = d.spellcasting?.points_label;
  const pointsLabel =
    typeof pointsLabelRaw === 'string' && pointsLabelRaw.trim().length > 0
      ? pointsLabelRaw.trim()
      : DEFAULT_POINTS_LABEL;
  const subclassLevel = typeof d.subclass_level === 'number' ? d.subclass_level : undefined;
  // R62/TAV-SUBCLASS-LEVEL-OVERRIDE — fall back to `subclassLevel` itself
  // when the wire omits `effective_subclass_level` (pre-ruling engine),
  // which is what keeps `hasSubclassStep`'s `=== 1` gate byte-identical to
  // today on an engine that hasn't deployed this yet.
  const effectiveSubclassLevel =
    typeof d.effective_subclass_level === 'number' ? d.effective_subclass_level : subclassLevel;
  const rungBlock = Array.isArray(d.feature_choices) ? d.feature_choices[0] : undefined;
  const rungMenu: WizardRungMenu | undefined = rungBlock
    ? {
        label: typeof rungBlock.label === 'string' ? rungBlock.label : '',
        freeform: rungBlock.freeform === true,
        knownAtLevel1: Number(rungBlock.known?.['1'] ?? 0) || 0,
        options: Array.isArray(rungBlock.options) ? rungBlock.options : [],
      }
    : undefined;
  // TAV-CLASS-STAT-GUIDANCE — guidance fields, validated defensively:
  // Array.isArray before .filter (a garbage string on the wire would
  // otherwise throw), unknown entries dropped. Absent data maps to []/
  // undefined and renders nothing — never a fabricated recommendation.
  const primary = (Array.isArray(d.primary_ability) ? d.primary_ability : []).filter(
    isAbilityKey,
  );
  const spellcastingAbility = isAbilityKey(d.spellcasting_ability)
    ? d.spellcasting_ability
    : undefined;
  const unarmoredDefenseAbility = isAbilityKey(d.unarmored_defense_ability)
    ? d.unarmored_defense_ability
    : undefined;
  // ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP — defensive against a garbage wire
  // value the same way primary/spellcastingAbility above are: Array.isArray
  // before use, a non-array skill_choices degrades to [] (no step) rather
  // than throwing.
  const skillChoices = Array.isArray(d.skill_choices) ? d.skill_choices : undefined;
  const skillCount = typeof d.skill_count === 'number' ? d.skill_count : undefined;
  return {
    id: item.slug,
    name: item.name,
    hitDie: d.hit_die ?? 8,
    saves,
    icon: deco.icon,
    accent: deco.accent,
    accentInk: deco.accentInk,
    // A homebrew class has no entry in the local CLASS_DECORATION table, so
    // it fell back to '' and rendered with NO tagline at all where every SRD
    // class has one — Ki Warrior and Vessel looked unfinished next to the
    // twelve SRD classes in the picker. Let the class row supply its own
    // (`data.description`); the decoration table still wins for SRD, so
    // nothing existing changes.
    flavor: deco.flavor || (typeof d.description === 'string' ? d.description : ''),
    isCaster: casterKind !== undefined,
    casterKind,
    castingModel,
    pointsLabel,
    subclassLevel,
    effectiveSubclassLevel,
    rungMenu,
    skillChoices,
    skillCount,
    primary,
    spellcastingAbility,
    unarmoredDefenseAbility,
  };
}

// ── Subclass adapter (TAV-WIZARD-HOMEBREW-CASTERS) ────────────────────────────

/**
 * Subclass rows scoped to a class — the SAME slugify-both-sides comparison
 * `LevelChoicePicker`'s `SubclassChoiceCard` runs server-verified-live
 * (TAV-SUBCLASS-CLASSKEY-MISMATCH), factored out here so the creation
 * wizard's Subclass step and the sheet's level-up picker share ONE filter
 * instead of two copies drifting apart.
 *
 * `classKey` should be the class's own catalog SLUG (`WizardClass.id` /
 * `CatalogItem.slug`, e.g. "ft-caster") whenever the caller has one — slug-
 * to-slug is the only comparison `slugifyName` can make safely (see its own
 * doc comment: it normalises SHAPE, not a name→slug PREFIX). A display name
 * ("Ki Warrior") only works by accident, when it happens to slugify to the
 * same string as the real slug — true for every SRD class (single word, no
 * prefix) and for a homebrew class whose slug has no prefix either, but NOT
 * for a prefixed slug like "ft-caster" (name "Caster (Fairy Tail)") or
 * "ninjutsu-specialist"-style rows. That gap is TAV-FT-SUBCLASS-SLUG-PREFIX
 * (2026-09-07): the creation wizard's Subclass step called this with the
 * display name and silently returned [] for every Fairy Tail caster/holder/
 * slayer despite 59 seeded rows. Both wizard call sites now pass the class
 * id/slug directly. `LevelChoicePicker`'s card has no id in scope (the
 * sheet wire only carries the class's display name) — see its own comment
 * for how it resolves one via a class-catalog lookup before falling back to
 * this same name-based degrade.
 */
export function subclassesForClass(items: CatalogItem[], classKey: string): CatalogItem[] {
  const wanted = slugifyName(classKey);
  return items.filter((item) => {
    const raw = (item.data as CatalogSubclassData).class;
    return slugifyName(String(raw ?? '')) === wanted;
  });
}

/**
 * R62/TAV-SUBCLASS-LEVEL-OVERRIDE — one subclass row's OWN archetype-pick
 * gate level: its own declared `data.subclass_level` when present, else
 * `classSubclassLevel` (the owning class's PLAIN `subclass_level`, NOT its
 * `effectiveSubclassLevel` — the effective value is already the MIN across
 * every visible subclass, so using it here would collapse every
 * non-declaring subclass's floor down to the earliest archetype's level,
 * e.g. an SRD rogue's three level-3 archetypes would wrongly read as
 * unlocking at 1 alongside Re:Zero's). Shared by the creation wizard's
 * Subclass step (via `catalogItemToSubclass`) and `LevelChoicePicker`'s
 * level-up `SubclassChoiceCard` so the per-subclass gate is derived in
 * exactly one place — mirrors the engine's own
 * `class_effective_subclass_level_for_wire` per-row fallback.
 */
export function subclassOwnLevel(
  item: CatalogItem,
  classSubclassLevel: number | undefined,
): number | undefined {
  const own = (item.data as CatalogSubclassData).subclass_level;
  return typeof own === 'number' ? own : classSubclassLevel;
}

/**
 * `classSubclassLevel` — the owning class's PLAIN `subclass_level` (see
 * `subclassOwnLevel`'s doc comment for why not `effectiveSubclassLevel`),
 * passed by the caller once it has resolved the class row. Optional and
 * defaults to `undefined` (every pre-existing call site keeps compiling and
 * `subclassLevel` on the result is simply undefined — no behavior change).
 */
export function catalogItemToSubclass(
  item: CatalogItem,
  classSubclassLevel?: number,
): WizardSubclass {
  const d = item.data as CatalogSubclassData;
  return {
    id: item.slug,
    name: item.name,
    class: String(d.class ?? ''),
    blurb: typeof d.description === 'string' ? d.description : '',
    subclassLevel: subclassOwnLevel(item, classSubclassLevel),
  };
}

export function catalogItemToBackground(item: CatalogItem): WizardBackground {
  const d = item.data as CatalogBackgroundData;
  const deco = BACKGROUND_DECORATION[item.slug] ?? { blurb: '' };
  return {
    id: item.slug,
    name: item.name,
    skills: d.skills ?? [],
    blurb: deco.blurb,
  };
}
