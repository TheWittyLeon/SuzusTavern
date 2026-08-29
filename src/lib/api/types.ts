// src/lib/api/types.ts
// Types derived from the real api/routes/dnd_*.py and narration.py shapes.
// Do not invent fields.

// ── Envelope ───────────────────────────────────────────────────────────────
export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface ApiError extends Error {
  /** HTTP status; 0 for network/abort. */
  status: number;
  /** Upstream error string, normalised. */
  code: string;
  /** Raw body if JSON-parsable, else undefined. */
  body?: unknown;
}

// ── DM mode ────────────────────────────────────────────────────────────────
// 'ai' | 'human' are engine-understood values (STORY-312 now LIVE on engine branch).
// 'solo' was a client-only alias; the engine has no 'solo' mode — the Tavern maps
// solo → dm_mode:'human' + ai_assist_level:'off' before sending. Do not send 'solo'
// to the engine.
export type DmMode = 'ai' | 'human' | 'solo';

// ── Auth ───────────────────────────────────────────────────────────────────
export interface User {
  id: number;
  username: string;
  email: string | null;
  roles?: string[];
  permissions?: string[];
}

/** What the browser ever sees from POST /api/auth/login. */
export type LoginResult =
  | { kind: 'ok'; user: User }
  | { kind: '2fa'; partial_token: string };

// ── DnD: characters ────────────────────────────────────────────────────────
export interface CharacterCreateRequest {
  username: string;
  name: string;
  race?: string;       // default 'Human' upstream
  char_class?: string; // 'class' is accepted as an alias upstream — prefer 'char_class'
  background?: string;
  /**
   * Base point-buy ability spread from the creation wizard (ST-050), pre-racial
   * (8–15 each, ≤27 points). Omit on the Twitch path → engine rolls 4d6-drop-low.
   * The engine validates legality and applies racial bonuses server-side.
   */
  ability_scores?: Record<string, number>;
  /**
   * TAV-CREATE-SUBRACE-ASI-PICKER — case-insensitive subrace display name
   * (e.g. "Wood Elf"), from the chosen race's catalog `data.subraces` keys.
   * Omit for a race with no named subraces. The engine hard-400s a subrace
   * that doesn't belong to the chosen race.
   */
  subrace?: string;
  /**
   * TAV-CREATE-SUBRACE-ASI-PICKER — Half-Elf's floating "+1 to two other
   * abilities" (the +2 Charisma is automatic, applied engine-side). Exactly
   * two DISTINCT ability names, neither 'charisma'. Only meaningful when
   * `race` is 'Half-Elf' — the engine 400s an ASI submitted for any other
   * race, and 400s anything other than two distinct non-Charisma abilities.
   */
  half_elf_asi?: string[];
  /**
   * 2026-07-24 Starting Equipment design — the player's resolved starting-gear
   * choices (one per class/background EquipChoice group), from the new
   * Equipment wizard step. Omitting this field entirely (undefined, not an
   * empty array) is the back-compat/kill-switch gate: the engine's
   * `_apply_starting_equipment` stamp no-ops on `selections is None`, so a
   * client that never sends this field (Twitch `~create`, or the Tavern
   * wizard degrading after a failed GET /starting-equipment) produces exactly
   * today's gearless character. An empty array is meaningfully different (it
   * still grants every FIXED item — only choice-group grants are skipped) —
   * only send `[]` when the packages genuinely resolved with zero choices,
   * never as a stand-in for "fetch failed".
   */
  equipment_selections?: EquipmentSelection[];
}
export interface CharacterCreated { character_id: string; [k: string]: unknown }

// ── DnD: starting equipment (2026-07-24 design) ─────────────────────────────
// Shapes confirmed against NekoNova-DnDEngine's routes/starting_equipment.py
// (GET /starting-equipment?class=&background=) — every grant is enriched
// server-side with the catalog's `name`/`description` (a slug that fails to
// resolve is still included as {name: slug, description: ''}, never omitted).

export interface EquipGrant {
  slug: string;
  qty: number;
  name: string;
  description: string;
}

export interface EquipOption {
  id: string;
  label: string;
  grants: EquipGrant[];
}

export interface EquipChoice {
  id: string;
  prompt: string;
  options: EquipOption[];
}

export interface EquipPackage {
  fixed: EquipGrant[];
  choices: EquipChoice[];
}

/** GET /api/dnd/starting-equipment response data. Unknown class/background
 *  resolves to an EMPTY package ({fixed: [], choices: []}) on that side,
 *  never a 4xx — degrade to "no starting gear" for that half, not an error. */
export interface StartingEquipmentResult {
  class: string;
  background: string;
  class_package: EquipPackage;
  background_package: EquipPackage;
}

/** One resolved choice-group pick, sent back on CharacterCreateRequest.
 *  `choice_id`/`option_id` are index-only — the engine always re-resolves the
 *  actual item slug from its own server-side package, never trusts the
 *  client to name one (see the design doc's §4.1 security note). */
export interface EquipmentSelection {
  choice_id: string;
  option_id: string;
}

export interface Character {
  character_id: string;
  username: string;
  name: string;
  race: string;
  char_class: string;
  level: number;
  hp: { current: number; max: number };
  ac: number;
  /**
   * ONE-CHAR-ONE-CAMPAIGN-UX — additive fields on GET /characters (engine
   * `msm.campaign_members_one_char` unique index: a character is bound to at
   * most one campaign globally, across all statuses). All four are OPTIONAL —
   * a pre-upgrade backend simply omits them. Degrade gracefully:
   * `in_use` undefined ⇒ treat the character as free.
   */
  in_use?: boolean;
  active_campaign_id?: string | null;
  active_campaign_name?: string | null;
  active_campaign_status?: 'active' | 'paused' | 'ended' | null;
  // Sheet is loosely structured upstream — keep an open index map for
  // sub-fields we haven't typed yet. Wrap further in Sprint 6.
  [k: string]: unknown;
}
export interface InventoryItem { name: string; quantity: number; equipped?: boolean }
export interface Inventory { items: InventoryItem[] }

// ── DnD: structured character sheet (ST-054–058) ────────────────────────────
// Shape of GET /api/dnd/characters/:id/sheet (engine get_character_sheet_data).
// Distinct from the loose `Character` above and from the cmd_sheet display string.
export interface AbilityBlock { score: number; modifier: number }
export interface SheetSpellSlot { max: number; used: number; remaining: number }
/** T5 (DDX-09 HP + spell-slots slice) — POST /characters/:id/hp response. */
export interface HpAdjustResult {
  current_hp: number;
  max_hp: number;
  temp_hp: number;
  is_down: boolean;
}
/** T5 — POST /spells/:id/slots/adjust returns the ONE adjusted level, flat:
 *  `{level, max, remaining, used}` — NOT a slots-by-level map. (The sheet's
 *  `spell_slots` is the by-level map; this is a single-level delta the panel
 *  merges into its state.) */
export interface SpellSlotsResult {
  level: number;
  max: number;
  remaining: number;
  used: number;
}
/** T12 (DDX-23t) — POST /characters/:id/currency/spend response. Confirmed
 *  from NekoNova-DnDEngine routes/characters.py::spend_currency_route
 *  (`_ok({"currency_gp": new_balance, "spent": body.amount})`, ~line 1385). */
export interface SpendCurrencyResult {
  currency_gp: number;
  spent: number;
}

/** T12 (DDX-23t) — request body for POST /api/dnd/sessions/{id}/grant-currency.
 *  No `username` field: the acting identity is the session's DM, proven
 *  server-side by `guard_dm` against the verified actor — see
 *  NekoNova-DnDEngine routes/sessions.py::GrantCurrencyRequest (~line 210). */
export interface GrantCurrencyRequest {
  character_id: string;
  gold: number;
}

/** T12 (DDX-23t) — POST /sessions/:id/grant-currency response. Confirmed from
 *  NekoNova-DnDEngine routes/sessions.py::grant_currency_route
 *  (`_ok({"currency_gp": new_balance, "granted": body.gold})`, ~line 618). */
export interface GrantCurrencyResult {
  currency_gp: number;
  granted: number;
}

export interface SheetSpellcasting { ability: string; save_dc: number; attack_bonus: number }

// ── DnD: spell repertoire (T4 / DDX-11 sheet Spells tab) ────────────────────
// Shapes of GET /spells/:id/list, GET /spells/:id/available, POST
// /spells/:id/learn, POST /spells/:id/prepare — engine's
// engine/spells_msm.py (list_repertoire / available_spells / learn_spell /
// set_prepared) is the source of truth; the NekoNova proxy
// (api/routes/dnd_combat.py) forwards `result.get("data", {})` verbatim, and
// the Tavern BFF catch-all forwards THAT verbatim, so the wire shape here is
// identical to the engine's own `data` payload — no proxy-side reshaping.

/** How a class's repertoire model works — drives which mutating affordances
 *  a caster gets: 'known' casters (sorcerer/bard) only ever learn; 'prepared'
 *  casters (cleric/druid/paladin) prepare straight off the full class list;
 *  'spellbook' (wizard) learns into the book, then separately prepares;
 *  'none' = non-caster. */
export type SpellCasterKind = 'none' | 'known' | 'prepared' | 'spellbook';

/** Shared `data.budget` block on both the list and available endpoints.
 *  spells_known/spells_max are null for anything but a 'known' caster;
 *  prepared_used/prepared_max are null for anything but 'prepared'/'spellbook'. */
export interface SpellBudget {
  cantrips_known: number;
  cantrips_max: number;
  spells_known: number | null;
  spells_max: number | null;
  prepared_used: number | null;
  prepared_max: number | null;
}

/**
 * LEVELUP-UX: descriptive spell fields the info popover renders, inlined on
 * both spell-list wires by the engine (spells_msm._spell_wire_info). ALL
 * optional — a frontend deploy that lands before the engine enrichment
 * ships degrades safely (undefined -> the popover simply shows what it has;
 * the SheetSpellEntry.heals convention).
 */
export interface SpellWireInfo {
  casting_time?: string;
  range?: string;
  /** SRD component flags: V/S true when required, M the material text (or
   *  true). E.g. {V: true, S: true, M: "a bit of fur"}. */
  components?: Record<string, boolean | string>;
  duration?: string;
  description?: string;
  higher_levels?: string | null;
}

/** One entry in the character's own repertoire (GET /spells/:id/list). */
export interface SheetSpellEntry extends SpellWireInfo {
  slug: string;
  name: string;
  level: number;
  school: string;
  source: string;
  prepared: boolean;
  is_cantrip: boolean;
  concentration: boolean;
  ritual: boolean;
  castable_now: boolean;
  /** Present on leveled (non-cantrip) entries only. */
  min_slot_level?: number;
  /** True when the spell has `healing_dice` (TAV-CAST-SELF-HEAL-UI) — drives
   *  whether the cast panel offers the caster as their own target. Optional
   *  so a frontend deploy that lands before the engine field ships degrades
   *  safely: undefined -> falsy -> self simply isn't offered yet. */
  heals?: boolean;
}

/** GET /api/dnd/spells/:id/list response data. */
export interface SpellListResult {
  is_spellcaster: boolean;
  caster_kind: SpellCasterKind;
  ability: string | null;
  budget: SpellBudget;
  cantrips: SheetSpellEntry[];
  spells: SheetSpellEntry[];
}

/** One entry in the class's learnable/preparable pool (GET
 *  /spells/:id/available). Distinct from SheetSpellEntry — no `source`/
 *  `castable_now`/`is_cantrip`/`min_slot_level`; adds `in_repertoire`. */
export interface AvailableSpellEntry extends SpellWireInfo {
  slug: string;
  name: string;
  level: number;
  school: string;
  concentration: boolean;
  ritual: boolean;
  in_repertoire: boolean;
  prepared: boolean;
}

/**
 * LVLDN — POST .../rebuild response data: the workshop level-down/reset
 * summary. `pending_added` is the choice count re-queued by the walk
 * (absent when target was 1); `reached_level` appears only on the
 * walk_incomplete 500 (coherent lower-level build, finish via Level up).
 */
export interface RebuildResult {
  from_level: number;
  to_level: number;
  name?: string;
  pending_added?: number;
  reached_level?: number;
}

/**
 * LEVELUP-UX: the engine's structured level-up step (POST .../levelup
 * `data.levelup`, filled from cmd_levelup's levelup_out on an actual
 * level-up; null/absent on refusal or a pre-upgrade backend). hp_roll is
 * the server-side 1d(hit_die) — null on the average path.
 */
export interface LevelUpStep {
  from_level: number;
  to_level: number;
  hp_gain: number;
  hp_roll: number | null;
  hp_mode: 'roll' | 'average';
  hp_max: number;
  new_features: string[];
  newly_queued: number;
}

/** GET /api/dnd/spells/:id/available response data. */
export interface AvailableSpellsResult {
  cantrips: AvailableSpellEntry[];
  /** Keyed by spell level "1".."9" (string keys, matches spell_slots convention). */
  by_level: Record<string, AvailableSpellEntry[]>;
  can_learn: boolean;
  can_prepare: boolean;
  budget: SpellBudget;
}

/** POST /api/dnd/spells/:id/learn response data. */
export interface LearnSpellResult {
  learned: boolean;
  budget: SpellBudget;
}

/** POST /api/dnd/spells/:id/prepare response data. */
export interface PrepareSpellResult {
  prepared: boolean;
  prepared_used: number;
  prepared_max: number;
}

// ── DnD: freeform feature-pick learn/forget (Leon's ruling 2026-08-23) ──────
// Shapes of GET /characters/:id/feature-picks, POST .../feature-picks/learn,
// POST .../feature-picks/forget — NekoNova-DnDEngine's engine/feature_picks.py
// (get_feature_picks / learn_feature_pick / forget_feature_pick) is the
// source of truth. A class opts in via `feature_choices[0].freeform` on its
// catalog row (the Ki Warrior); a menu that doesn't declare it (every menu
// shipped before this, including the SRD warlock's Eldritch Invocations)
// reports `freeform: false` here and refuses every mutating verb with
// `not_freeform` — the swap-at-level-up path (LevelChoicePicker's
// `feature_choice` resolver) is a SEPARATE, unaffected mechanism.

/** GET /api/dnd/characters/:id/feature-picks response data. `known`/
 *  `eligible` reuse `FeatureChoiceOption`'s shape — the same one the sheet's
 *  pending-choice enrichment already carries. `budget.cap` is the menu's
 *  `known_count` at the character's CURRENT level (1 at L1 … 5 at L18 for
 *  the Ki Warrior) — forgetting frees a slot, learning fills one up to this
 *  cap; the archetype scoping and each option's own level gate still apply
 *  to `eligible`. */
export interface FeaturePicksResult {
  menu_label: string;
  freeform: boolean;
  budget: { known: number; cap: number };
  known: FeatureChoiceOption[];
  eligible: FeatureChoiceOption[];
}

/** POST /api/dnd/characters/:id/feature-picks/learn response data. */
export interface LearnFeaturePickResult {
  learned: string;
  menu_label: string;
  known: string[];
}

/** POST /api/dnd/characters/:id/feature-picks/forget response data. */
export interface ForgetFeaturePickResult {
  forgotten: string;
  menu_label: string;
  known: string[];
}

export interface SheetInventoryItem {
  name: string;
  item_type: string;
  sub: string;
  quantity: number;
  equipped: boolean;
}

/** T13 (DDX-14t/15t): one already-taken feat, from the sheet's `feats` array
 *  (NekoNova-DnDEngine engine/commands/character_msm.py::get_character_sheet_data
 *  `feats_out`). Used by LevelChoicePicker to hide a feat the character
 *  already has from the ASI "take a feat" option list. */
export interface SheetFeat {
  slug: string;
  name: string;
  description: string;
}

/**
 * T13 (DDX-14t/15t): one queued level-up decision, from the sheet's
 * `pending_choices` array (`_queue_level_choices` in
 * NekoNova-DnDEngine engine/commands/character_msm.py). `type` is
 * `'subclass'`, `'asi'`, or (TAV-1.0-SLICE-B-FIX-4) `'spell'` today (kept as
 * `string`, not a union, since `resolve_level_choice` already has an
 * `unsupported_choice_type` fallback for anything else — a future fourth
 * type should render as "coming soon" rather than fail typechecking).
 * `class` is the character's class name at queue time (subclass options are
 * filtered to it); absent it should fall back to the sheet's own
 * `char_class`.
 */
/** INVOC: one option in a class's choose-N feature menu (warlock Eldritch
 *  Invocations; generic for any homebrew menu). `level` is the minimum
 *  character level required to take the option (2 = available as soon as
 *  the menu opens). */
export interface FeatureChoiceOption {
  slug: string;
  name: string;
  level: number;
  description?: string;
}

export interface PendingLevelChoice {
  id: string;
  type: string;
  level: number;
  class?: string;
  label: string;
  /** Present on `type === 'spell'` choices — which repertoire model this
   *  caster uses, drives whether leveled picks must be learned
   *  `prepared:true` (see LevelChoicePicker's SpellChoiceCard). */
  caster_kind?: SpellCasterKind;
  /** Present on `type === 'spell'` choices — number of new cantrip picks
   *  granted this level (may be 0 if only leveled spells grew). */
  cantrips?: number;
  /** Present on `type === 'spell'` choices — number of new leveled spell
   *  picks granted this level (may be 0 if only cantrips grew, or always 0
   *  for a 'prepared' caster_kind, which auto-knows its full class list). */
  spells?: number;
  /** INVOC — present on `type === 'feature_choice'` choices: which of the
   *  class's declared menus this choice belongs to ("Eldritch
   *  Invocations"), also the key picks are stored under. */
  menu_label?: string;
  /** INVOC — number of NEW picks this choice grants (entitlement delta,
   *  self-healing: a backfilled warlock gets the full missed count). */
  count?: number;
  /** INVOC — the full option menu, enriched onto the pending entry at
   *  SHEET READ time (display + client-side pre-validation only; the
   *  resolver re-validates server-side). Absent on a pre-upgrade backend
   *  that queued the choice without enrichment. */
  options?: FeatureChoiceOption[];
}

/** INVOC: one resolved menu group on the sheet — the character's CHOSEN
 *  picks (e.g. label "Eldritch Invocations", picks = the invocations the
 *  player actually selected), name/description resolved server-side. */
export interface SheetFeatureChoiceGroup {
  label: string;
  picks: FeatureChoiceOption[];
}

/** One skill entry returned by the engine's `skills` array on GET /sheet (A2). */
export interface SheetSkill {
  name: string;
  /** Ability that backs this skill (e.g. 'dexterity'). */
  ability: string;
  /** Total modifier (ability mod + proficiency bonus if proficient). */
  modifier: number;
  proficient: boolean;
}

/** HB-P2 spell points — the DMG p.288 variant pool, mirrored from the engine's
 *  `casting_points.get_spell_points`. Present on the sheet only for a
 *  points-initialized character.
 *
 *  `label` is what the CLASS calls its pool, declared as data on the class row
 *  (`spellcasting.points_label`): "Ki" for Dragon Ball's Ki Warrior, "Magic
 *  Power" for a Fairy Tail mage, the generic "Spell points" when a class
 *  declares nothing. Render this, never a hardcoded string — the whole point
 *  is that the tenth homebrew class needs no UI change. */
export interface SheetSpellPoints {
  casting_model: 'points';
  label: string;
  points: { current: number; maximum: number };
  /** Keyed "6".."9" — the DMG allows ONE cast of each level 6+ per long rest,
   *  not one 6+ cast total. `1` = still available, `0` = already used. Empty
   *  below level 11, where no 6+ slot exists to gate. */
  high_level_casts: Record<string, number>;
  /** Highest rank this character can currently create with points. */
  max_slot_level: number;
  /** Rank ("1".."9") → point cost. Sent by the engine rather than hardcoded
   *  here on purpose: a second copy of the DMG ladder in the frontend is how
   *  the two halves drift apart. */
  costs: Record<string, number>;
}

export interface CharacterSheet {
  character_id: string;
  owner_username: string;
  name: string;
  race: string;
  subrace: string;
  char_class: string;
  subclass: string;
  level: number;
  background: string;
  alignment: string;
  /** Keyed by full ability name (strength, dexterity, …). */
  ability_scores: Record<string, AbilityBlock>;
  hp: { current: number; max: number; temp: number };
  ac: number;
  initiative: number;
  proficiency_bonus: number;
  /**
   * F6/MLP-SHEET-SPEED-CRASH: widened from a bare `number` — MLP multi-mode
   * movement (walk/fly/swim) ships as a dict on the wire
   * (`{"walk": 25, "fly": 30}`), and a raw `{sheet.speed}` JSX child on a
   * dict is a hard "Objects are not valid as a React child" crash. Render
   * via `raceSpeedLabel` (src/lib/dnd/codex.ts — DDX21-1, same crash class),
   * never as a direct child. Belt-and-suspenders alongside the engine's
   * `_normalize_speed`; this client-side widen stands on its own regardless
   * of engine normalization state.
   */
  speed: number | Record<string, number>;
  /** Additive: preserves per-mode movement (fly/swim/etc.) for a later
   *  render pass when `speed` itself is normalized to a scalar engine-side. */
  speed_modes?: Record<string, number>;
  xp: number;
  xp_next: number | null;
  hit_dice_remaining: number;
  proficient_saves: string[];
  proficient_skills: string[];
  class_features: string[];
  conditions: string[];
  spellcasting: SheetSpellcasting | null;
  /** Keyed by slot level "1".."9"; only non-zero levels present.
   *
   *  LEGITIMATELY EMPTY for a points caster — see `spell_points`. A client
   *  that treats `{}` as "this caster has no resources yet" renders the pool
   *  as absent; that was the TAV-SPELLPOINTS-NO-UI bug. */
  spell_slots: Record<string, SheetSpellSlot>;
  /** HB-P2 spell-point pool, or `null` for the (overwhelmingly common) slots
   *  caster. Verified on the wire against dev character 24051 before being
   *  declared here, per this file's standing rule — a Ki Warrior returns
   *  `{casting_model:"points", label:"Spell points", points:{current:4,
   *  maximum:4}, high_level_casts:{}, max_slot_level:5}` while `spell_slots`
   *  is `{}`.
   *
   *  Optional because the field only exists on engines carrying the
   *  TAV-SPELLPOINTS-NO-UI change; an older engine omits it entirely and the
   *  panel must degrade to its slots behaviour rather than crash. */
  spell_points?: SheetSpellPoints | null;
  is_spellcaster: boolean;
  inventory: SheetInventoryItem[];
  inventory_weight: number;
  /** A2 — all 18 SRD skills with real modifiers, sorted. Present on engine ≥ A2. */
  skills?: SheetSkill[];
  /** T13 (DDX-14t/15t): feats the character already has. Optional (not a bare
   *  array default) purely so the ~13 pre-existing test fixtures across the
   *  repo that construct this type as an object literal without the new
   *  field keep compiling — the engine always sends it on the real wire
   *  (`get_character_sheet_data`'s `feats_out`, default []). */
  feats?: SheetFeat[];
  /** T13 (DDX-14t/15t): queued level-up decisions awaiting the player's
   *  resolution (subclass archetype / ability-score-improvement). Optional
   *  for the same fixture-blast-radius reason as `feats` above — the engine
   *  always sends `[]` when there is nothing pending. */
  pending_choices?: PendingLevelChoice[];
  /** INVOC — the character's resolved choose-N menu picks (warlock
   *  Eldritch Invocations today; generic for any homebrew menu). Optional
   *  for the same fixture-blast-radius reason as `feats` above. */
  feature_choices?: SheetFeatureChoiceGroup[];
  /** T12 (DDX-23t): gold purse. Confirmed on both engine backends —
   *  `engine/commands/character_msm.py:349` and
   *  `engine/commands/character_commands.py:517` both project
   *  `currency_gp` onto the structured sheet (0 for a fresh character).
   *  Optional for the same fixture-blast-radius reason as `feats`/
   *  `pending_choices` above — the engine always sends a real int on the
   *  live wire, this is purely so pre-existing `CharacterSheet` object
   *  literals across the test suite keep compiling. */
  currency_gp?: number;
  /** CHAR-LANG: concrete languages known — race's languages (choice-text
   *  placeholders like "one extra language of your choice" filtered out)
   *  plus "Equestrian", granted setting-wide to every PC regardless of race.
   *  Optional for the same fixture-blast-radius reason as `feats`/
   *  `pending_choices`/`currency_gp` above — the engine always sends a real
   *  array on the live wire (`[]` for a pre-existing character with no
   *  persisted languages), this is purely so pre-existing `CharacterSheet`
   *  object literals across the test suite keep compiling. */
  languages?: string[];
  /** LVL (FR-12/FR-14): the SERVER-decided level-up gate. The button renders
   *  this verbatim — `can_level` drives disabled, `outcome`/`mode` drive the
   *  copy; the client does NO xp/xp_next arithmetic for gating (that exact
   *  duplication is what the seam exists to kill). Optional for the same
   *  fixture-blast-radius reason as `feats`/`pending_choices` above, AND as
   *  the pre-upgrade-backend shim: when absent, LevelUpButton falls back to
   *  today's client-computed xp/xp_next logic. */
  levelup_policy?: LevelUpPolicy;
}

/** LVL — the `levelup_policy` wire block on CharacterSheet (engine
 *  `level_policy.evaluate`, design §6.1). Exactly one of five outcomes;
 *  `denied_max_level` keeps its real `mode` (a level-20 workshop character
 *  still reads as a workshop piece). The max-level discriminator is
 *  `outcome === 'denied_max_level'` (with `next_level: null` as the
 *  secondary signal) — NOT `xp_next == null`, which is ambiguous the moment
 *  workshop mode exists (reconciliation item 3). */
export interface LevelUpPolicy {
  outcome:
    | 'allowed_xp'
    | 'allowed_workshop'
    | 'allowed_floor'
    | 'denied_xp'
    | 'denied_max_level';
  /** Which ruleset is in force — drives copy selection.
   *  'xp' = XP-gated (bound, at/above floor); 'workshop' = no campaign
   *  binding (LVL-2); 'floor' = bound below the table's starting_level
   *  (LVL-1 catch-up, OQ-1 self-service). */
  mode: 'xp' | 'workshop' | 'floor';
  /** The server's decision — the button's disabled state is `!can_level`. */
  can_level: boolean;
  /** XP still needed for the next level; non-null ONLY on `denied_xp`. */
  xp_short: number | null;
  /** The bound campaign's starting_level when bound AND > 1; else null.
   *  Present in every mode so the sheet can say "this table starts at N". */
  floor: number | null;
  /** level + 1, or null at level 20. */
  next_level: number | null;
}

/** LVL-1 (FR-9): result of POST /sessions/{id}/apply-floor — the DM's
 *  explicit "Apply floor now". Partial success is a 200 with a non-empty
 *  `failures` array (some members WERE leveled; the response says so
 *  truthfully); a failures entry with to_level > from_level is a PARTIAL
 *  walk that resumes on re-invocation. */
export interface ApplyFloorResult {
  starting_level: number;
  checked: number;
  leveled: {
    username: string;
    character_id: number;
    from_level: number;
    to_level: number;
    pending_added: number;
  }[];
  skipped: {
    username: string;
    character_id: number | null;
    reason: string;
  }[];
  failures: {
    username: string;
    character_id: number | null;
    from_level: number | null;
    to_level: number | null;
    reason: string;
  }[];
}

/** LVL-1 (reconciliation item 4): the floor echo on create / join / re-bind
 *  responses — non-null when that bind auto-leveled the character to the
 *  campaign's starting_level. Mirrors EndSessionLevelUp's "tell the player
 *  what just happened to their sheet" precedent; drives the "auto-leveled to
 *  match the table" toast with its Resolve-now action. */
export interface FloorApplied {
  character_id: number;
  name: string | null;
  from_level: number;
  to_level: number;
  /** Count of newly queued pending choices across the walk (subclass/ASI/
   *  spell picks) — the toast's "N choices waiting". */
  pending_added: number;
}

// ── DnD: sessions ──────────────────────────────────────────────────────────
export type SessionStatus = 'active' | 'paused' | 'ended';

/** Table content rating. 'mature' is only selectable on private/unlisted tables.
 *  Client-annotated until the engine column lands (STORY-313). A public/streamed
 *  table is hard-forced to the SFW model server-side regardless (STORY-314). */
export type ContentRating = 'sfw' | 'mature';

/** Table visibility. Client-annotated until the engine column lands (STORY-313). */
export type Visibility = 'public' | 'unlisted' | 'private';

export interface SessionStartRequest {
  username: string;
  channel: string;
  /** Human-readable table name (free-form, as typed by the player). When present,
   *  the engine stores it as the campaign display name. Omit on the bot path —
   *  the bot has no human name and relies on get-or-create-by-channel semantics. */
  name?: string;
  /** Engine-understood DM mode. Omit = engine default ('ai'). Do NOT send 'solo'
   *  — the Tavern maps solo → dm_mode:'human' + ai_assist_level:'off'. */
  dm_mode?: Exclude<DmMode, 'solo'>;
  /** Visibility sent to the engine. Omit = engine default. */
  visibility?: Visibility;
  /** Content rating sent to the engine. Omit = engine default. */
  content_rating?: ContentRating;
  /** AI assist level. 'off' = hard interlock — no LLM calls on this table. */
  ai_assist_level?: 'full' | 'assist' | 'off';
  /** Bind the player's character to this session. Owner-checked server-side.
   *  Omit = no binding (back-compat). The Tavern auto-binds when the user has
   *  exactly one character; shows a picker when they have multiple. */
  character_id?: number;
  /** ADV-4/ADV-9: public_id of the authored adventure to run (e.g.
   *  'dnd5e:adventure:hollow-tide-cave'). Omit = freeform/sandbox campaign.
   *  The engine stamps this as campaign.adventure_ref and initialises progress. */
  adventure_ref?: string;
  /** HB-P2: casting model for this table. 'points' = DMG spell-point variant
   *  (one pool instead of slots; one 6th+ slot of each level per long rest).
   *  Omit or 'slots' = classic slots — the engine stores nothing and every
   *  existing behaviour is unchanged. Locked at creation (no mid-campaign
   *  switch). Warlocks always use slots regardless (Pact Magic is excluded
   *  from the variant). */
  casting_model?: 'slots' | 'points';
  /** LVL-1 (FR-1): campaign starting-level floor, 1–20. Omit (or 1) = the
   *  classic level-1 climb — the engine stores nothing and every existing
   *  behaviour is unchanged (the absent key IS the off switch). Characters
   *  below the floor are auto-leveled to it the moment they bind; the floor
   *  is never a ceiling (an above-floor character is untouched). */
  starting_level?: number;
}
/** A row from the engine's `session_events` log (S3.6 recap source).
 *  Field-name convention used by buildRecap and pre-existing callers. */
export interface SessionEvent {
  event_id?: string;
  /** 'combat' | 'combat_end' | 'level_up' | 'scene' | 'death' | 'xp' | 'narration' | 'join' | … */
  event_type?: string;
  actor?: string;
  description?: string;
  created_at?: string;
}

/** Wire shape returned by GET /api/dnd/sessions/<id>/events (engine branch).
 *  Distinct from SessionEvent — `kind` maps to `event_type`, `data` is a
 *  blob (may contain `description` or a `text` key for narration events).
 *  getSessionEvents adapts this → SessionEvent so buildRecap is unaffected. */
export interface EngineSessionEvent {
  seq?: number;
  kind?: string;
  actor?: string;
  visibility?: string;
  data?: Record<string, unknown> | null;
  created_at?: string;
}

// ── DDX-20: durable generation (cursor poll + job lifecycle) ────────────────
// Flag-ON only (DURABLE_GENERATION_ENABLED, src/lib/config.ts). Wire shapes
// quoted verbatim from "DDX-20 — Technical Design" §2.2/§3.2 and "DDX-20 —
// P2 Design Delta" §2.4 — not invented here.

/**
 * The `pending_generation` block on GET /events — non-null while a beat is
 * mid-flight for this campaign (Technical Design §2.2). A poll-only client
 * detects "generation in progress" from this block alone; no second endpoint.
 */
export interface PendingGeneration {
  turn_key: string;
  job_id: string;
  status: 'pending' | 'streaming';
  /** The player_action seq this beat is generating a reply to. */
  trigger_seq: number;
  started_at: string;
}

/**
 * Cursor-paged response from GET /api/dnd/sessions/{id}/events?since_seq=
 * (Technical Design §2.2). `max_seq` is the caller's own visible watermark
 * (post-RLS) — the next poll's `since_seq`. `has_more` true means the
 * campaign has visible rows beyond this page; loop until false.
 */
export interface EventsPage {
  events: EngineSessionEvent[];
  max_seq: number;
  has_more: boolean;
  pending_generation: PendingGeneration | null;
}

/**
 * Request body for POST /api/narration/dm/turn (durable job create/dedup —
 * Client Integration Design §5.1). `turn_key` is the client-minted UUID v4
 * idempotency anchor (Technical Design §4); `kind` mirrors DmNarrationRequest.
 */
export interface DmTurnRequest {
  username: string;
  channel: string;
  session_id: string;
  message: string;
  mechanics?: string;
  /**
   * DDX-20 Pass 3 (Synthetic-Beat Design §6.1) — tells the server's INTENT
   * classifier not to re-advance the scene for a beat whose caller already
   * advanced it via its own dedicated endpoint (roll/check/scene-advance/
   * combat confirmations). Already accepted end-to-end by
   * `DMNarrationStreamRequest`; this is the only Tavern-side change needed
   * to carry it on the durable `/dm/turn` payload.
   */
  suppress_intent?: boolean;
  mode?: 'say' | 'act' | 'ooc' | 'dm_narration';
  turn_key: string;
  kind?: 'beat' | 'opening' | 'recap';
}

/** Successful (200) result from POST /api/narration/dm/turn — a created or
 *  deduped job handle. `status` is freshly re-read from the job row even on
 *  a dedup hit (P2 Design Delta §1), so a re-subscribing client always sees
 *  the LIVE status, not a stale "pending". */
export interface GenerationJobHandle {
  job_id: string;
  turn_key: string;
  status: 'pending' | 'streaming' | 'final';
  deduped: boolean;
}

/**
 * The 409 `generation_in_progress` busy shape (P2 Design Delta §2.4) —
 * returned when a DIFFERENT turn_key POSTs while a beat is already in
 * flight for this campaign. `postDmTurn` (src/lib/stream.ts) returns this
 * rather than throwing, so the 409-subscribe-pivot (Client Integration
 * Design §4a) is a normal return path, not an exception path — `apiCall`
 * would throw on `{success:false}` and defeat that.
 */
export interface BusyResult {
  busy: true;
  job_id: string;
  status: 'pending' | 'streaming';
  trigger_seq: number;
}

/**
 * DDX-22 — a player's owner-private free-form note for one session.
 * One row per (session, owner) in `msm.session_notes`, RLS owner-scoped
 * engine-side. `body` is plain text (rendered as JSX text nodes, no markup).
 * GET returns `SessionNote | null` (null = no note saved yet); PUT returns the
 * saved note with the server-stamped `updated_at`.
 */
export interface SessionNote {
  body: string;
  updated_at: string;
}

export interface Session {
  session_id: string;
  channel: string;
  /** Human-readable table name stored by the engine (channel-name-decouple fix).
   *  Present on sessions created via the Tavern after the fix. Absent (or equal
   *  to channel) on bot-created sessions and pre-fix rows — sessionTitle() handles
   *  both cases with a titleizeChannel fallback. */
  name?: string;
  /** Engine-authoritative lifecycle state (present on list/detail responses). */
  status?: SessionStatus;
  /** @deprecated pre-Sprint-5 alias of `status`; the engine returns `status`. */
  state?: SessionStatus;
  dm_username?: string;
  started_at?: string;
  paused_at?: string | null;
  active_combat_id?: string | null;
  xp_pool?: number;
  participant_usernames?: string[];
  player_count?: number;
  /** LVL-1: the campaign's starting-level floor (settings.starting_level,
   *  1 when unset). Engine-authoritative via _session_summary — follows
   *  xp_pool's settings→summary path exactly. Optional purely for
   *  pre-upgrade backends; CampaignFloorPanel treats absent as 1. */
  starting_level?: number;
  // ── Client-side enrichment (engine has no column yet) ──────────────────────
  /** STORY-312 — narration mode. */
  dm_mode?: DmMode;
  /** STORY-313 — content rating; 'mature' only on private/unlisted. */
  content_rating?: ContentRating;
  /** STORY-313 — table visibility. */
  visibility?: Visibility;
  /** S2.5 — AI assist level; engine-authoritative once deployed. 'off' = hard
   *  interlock (no LLM calls). Drives the recap/commentary AI gates (S3.6/3.8). */
  ai_assist_level?: 'full' | 'assist' | 'off';
  /** S5.4 — whether DM override events are visible to players. Default true. */
  dm_override_player_visible?: boolean;
  [k: string]: unknown;
}
export interface XpAwardRequest extends SessionStartRequest { amount: number; reason?: string }

/** F5/LEVELUP-NO-MOMENT: one character's level-up, echoed by
 *  `POST /sessions/{id}/end` (routes/sessions.py `level_ups_echo`).
 *  `new_level` is that character's OWN new level (not a session-wide value)
 *  — a multiplayer table may level several characters in one ending. */
export interface EndSessionLevelUp {
  character_id: string | null;
  name: string | null;
  new_level: number | null;
}

/**
 * Response from `POST /api/dnd/sessions/{id}/end`. `message` is the
 * unchanged chat-formatted string (still what the Twitch bot consumes).
 * `level_ups` is always an array (`[]` if nobody leveled) — never absent.
 * `xp_per_player` is present only when the engine's `end_session()` result
 * carried it (the session-wide XP pool split across participants).
 */
export interface EndSessionResult {
  message?: string;
  level_ups: EndSessionLevelUp[];
  xp_per_player?: number;
}

// ── DnD: combat ────────────────────────────────────────────────────────────
export interface CombatActionRequest {
  username: string;
  combat_id: string;
  target?: string;     // required for /combat/attack (bot / name-match path)
  target_id?: string;  // ADV-7/8: preferred explicit id from CombatState.participants[]
}
export interface SpellCastRequest extends CombatActionRequest {
  spell_name: string;
  slot_level?: number;
}

/** T7 (DDX-17e): DM-only apply-condition body. DDX-CAST-TARGETID-PLUMBING:
 *  `target_id` (participant_id, from CombatState.participants[]) is now sent
 *  alongside `target` and is preferred by the engine's
 *  `_resolve_condition_target` when both are supplied — resolves by exact
 *  participant_id match first, falling back to `target`'s case-insensitive
 *  NAME match only when `target_id` is omitted. `username` is optional — the
 *  engine gates on "is the caller the DM" (guard_dm), not on turn ownership,
 *  so there's no per-caller identity the command itself needs to compare
 *  against (see NekoNova-DnDEngine routes/combat.py::ApplyConditionRequest). */
export interface ApplyConditionRequest {
  combat_id: string;
  target: string;
  target_id?: string;
  condition: string;
  /** Rounds-remaining before auto-expiry; omitted = indefinite (DM must
   *  remove manually). Engine caps 1-1000 (Pydantic Field(gt=0, le=1000)). */
  duration_rounds?: number;
  username?: string;
}

/** T7 (DDX-17e): DM-only remove-condition body. Same `target`/`target_id`
 *  resolution as ApplyConditionRequest (id preferred when both supplied);
 *  idempotent on the engine side (removing an absent condition still returns
 *  ok). */
export interface RemoveConditionRequest {
  combat_id: string;
  target: string;
  target_id?: string;
  condition: string;
  username?: string;
}
export interface CombatStatus {
  combat_id: string;
  session_id: string;
  round: number;
  turn_index: number;
  initiative: { username: string; init: number }[];
  [k: string]: unknown;
}

// ── DnD: structured combat state (ADV-7/8 — CUI-10) ─────────────────────────
// Shape of GET /api/dnd/combat/{id}/state and data.state on every mutating route.
// Source of truth is the engine's CombatState projection (build_combat_state).
// last_action is only populated on mutating responses; null on GET /state.
// scene_advance is only populated when finalize_combat auto-advanced the scene.

/** Death-save tracking block, present only on PC participants. */
export interface CombatDeathSaves {
  successes: number;
  failures: number;
  /** hp_current === 0 && is_alive. Stays true once a PC stabilises (3
   *  successes) — `is_downed` alone does NOT mean "must roll a save right
   *  now". Use `is_dying` for the actionable gate; it's false once stable. */
  is_downed: boolean;
  /** hp_current === 0 && is_active && !is_stable — the actionable "must roll a
   *  death save this turn" state (Combat-UX Fixes 2026-07-27, Fix B). Narrower
   *  than `is_downed`: a downed-but-stable PC is still `is_downed` but no
   *  longer `is_dying`, since 3 successes stops the save loop. */
  is_dying: boolean;
  /** Three successes — PC stabilised. */
  is_stable: boolean;
  /** !is_alive && entity_type === 'character'. */
  is_dead: boolean;
}

/** One participant in the turn order. */
export interface CombatParticipantState {
  participant_id: string;
  /** B1: PC = stringified character_id; monster = slug.
   *  Used to map the logged-in user to their combatant. */
  entity_id: string;
  name: string;
  /** true when entity_type === 'character'. */
  is_pc: boolean;
  initiative: number;
  hp_current: number;
  hp_max: number;
  ac: number;
  conditions: string[];
  /** T7 (DDX-17): rounds-remaining for a SUBSET of `conditions`, keyed by the
   *  lower-cased condition string (engine/combat.py::build_combat_state — a
   *  condition absent here is indefinite, no auto-expiry). Optional (not `?:`
   *  on `conditions` itself) purely so pre-existing test fixtures across the
   *  repo that construct CombatParticipantState literals without this field
   *  keep compiling; the engine always sends the key on the real wire. */
  condition_durations?: Record<string, number>;
  /** is_active (Participant.is_active). */
  is_alive: boolean;
  /** Friendly-unit targeting advisory: alive + hp > 0 for monsters; see design A3. */
  can_be_targeted: boolean;
  /** participant_id === active_participant_id. */
  is_active_turn: boolean;
  /** Took their turn this round. */
  took_turn: boolean;
  /** TAV-ATTACK-BUTTON-STALE: 5e per-turn action economy (DDX-06) — false
   *  once this participant's ACTION is spent this turn; resets at the start
   *  of their own turn. The engine sends it on every participant entry
   *  (engine/combat.py::build_combat_state). Optional purely so pre-existing
   *  test fixtures that construct literals keep compiling — same convention
   *  as condition_durations above; absent is treated as "available". */
  action_available?: boolean;
  /** PC-only; absent on monster entries. */
  death_saves?: CombatDeathSaves;
  /** Monster-only: AI tactic text from encounter meta. */
  tactics?: string;
  /** Monster-only: descriptive position string. */
  position?: string;
}

/** Side-effect summary of the most recent mutating call. */
export interface CombatLastAction {
  kind: 'attack' | 'dodge' | 'dash' | 'endturn' | 'monster_turn' | 'death_save' | 'spawn' | 'initiative' | 'start' | 'from_scene' | 'end';
  actor_id: string;
  target_id?: string | null;
  /** 'hit' | 'miss' | 'crit' | 'crit_miss' | 'kill' | 'down' | 'stable' | 'death' | 'pass' | 'noop' */
  outcome: string;
  damage_dealt: number;
  damage_type?: string | null;
  target_new_hp?: number | null;
  critical_hit: boolean;
  natural_roll?: number | null;
  total_roll?: number | null;
  vs_ac?: number | null;
}

/** Populated on mutating responses when ADV-8 auto-advanced the scene. */
export interface CombatSceneAdvance {
  from_scene: string;
  to_scene: string;
  flags_set?: string[];
  outcome?: string;
}

/** Full combat state snapshot — source of truth for all UI state during combat. */
export interface CombatState {
  combat_id: string;
  session_id: string;
  round: number;
  /** 'idle' | 'rolling_initiative' | 'active' | 'between_turns' | 'ended' */
  state: string;
  turn_index: number;
  /** participant_id of the current combatant; null when ended. */
  active_participant_id: string | null;
  /** Ordered participant ids (mirrors CombatSession.initiative_order). */
  initiative: string[];
  participants: CombatParticipantState[];
  terrain?: {
    lighting?: string;
    cover?: string;
    hazards?: string[];
  } | null;
  encounter_id?: string | null;
  scene_id?: string | null;
  /** Populated only on mutating route responses, not on GET /state. */
  last_action?: CombatLastAction | null;
  /** Set when finalize_combat auto-advanced the scene (ADV-8). */
  scene_advance?: CombatSceneAdvance | null;
}

/** Error-response data when the engine rejects a combat action. */
export interface CombatErrorData {
  /** Machine-readable refusal code (e.g. 'not_your_turn', 'no_target'). */
  reason?: string;
  /** Current state snapshot so the UI can re-render without a second round-trip. */
  state?: CombatState;
}

// ── DnD: party roster (ST-061) ───────────────────────────────────────────────
// Shape of GET /api/dnd/sessions/:id/participants (engine join over characters).
export interface ParticipantCharacter {
  character_id: string | null;
  name: string | null;
  char_class: string | null;
  level: number | null;
  current_hp: number | null;
  max_hp: number | null;
  ac: number | null;
  /** F5/LEVELUP-NO-MOMENT: queued level-up decisions awaiting resolution
   *  (subclass/ASI/spell), echoed onto the roster entry (routes/sessions.py
   *  `GET /{session_id}/participants` — `entry["character"]["pending_choices"]
   *  = sheet.get("pending_choices", [])`) so PartyPanel can render a
   *  per-character "level up available" badge without a second per-character
   *  sheet fetch. Optional for the same fixture-blast-radius reason as
   *  CharacterSheet.pending_choices — the engine always sends `[]` on the
   *  real wire when nothing is pending. */
  pending_choices?: PendingLevelChoice[];
}
export interface Participant {
  username: string;
  is_dm: boolean;
  /** null when the member hasn't created a character yet. */
  character: ParticipantCharacter | null;
}

// ── DnD: combat lifecycle (ST-064) ───────────────────────────────────────────
export interface CombatStartRequest { username: string; channel: string }
export interface CombatSpawnRequest {
  username: string;
  combat_id: string;
  monster: string;
  count?: number;
}
export interface CombatInitiativeRequest {
  username: string;
  combat_id: string;
  seed?: number;
}
export interface CombatMonsterTurnRequest {
  username: string;
  combat_id: string;
  target?: string;
}
/** Engine combat routes return chat-formatted strings + (ADV-7/8) structured state.
 *  data.message for actions; data.status for status; data.combat_id on start.
 *  data.state carries the CombatState snapshot on every response once the engine
 *  is updated; existing message/status readers are unaffected. */
export interface CombatMessageResult {
  message?: string;
  status?: string;
  combat_id?: string;
  /** Structured state snapshot (ADV-7/8 — CUI-10). Present when the engine returns it. */
  state?: CombatState;
  /** Set when finalize_combat auto-advanced the scene (ADV-8). */
  scene_advance?: CombatSceneAdvance | null;
  /**
   * WF-O-OUTCOMELINE (2026-08-16, engine): authored narration for the
   * SPECIFIC outcome that just resolved (rescue/victory/flee/...), resolved
   * server-side in `apply_encounter_outcome` before the advance_to fork —
   * present whenever an outcome resolves, independent of whether
   * `scene_advance` is also set. Top-level sibling of `scene_advance`, NOT
   * nested inside it (engine `routes/combat.py` echoes both from the same
   * `finalize_combat` return dict). Replaces the retired C3-era
   * `rescue_outcome_line` grounding key (see `C3_GROUNDING_FIELD` below —
   * that mechanism is now permanently dead on the engine side, kept only so
   * a stray authored key degrades to a no-op rather than a crash). Same
   * contract as `arrival_line`: non-empty string when present, <=400 chars,
   * explicit `null` == absent.
   */
  outcome_line?: string | null;
  /** Error: machine-readable refusal reason (e.g. 'not_your_turn'). */
  reason?: string;
  [k: string]: unknown;
}

// ── DnD: catalog (S2.4 — GET /api/dnd/catalog) ───────────────────────────────

/** Mechanical data shape for a race catalog item. */
export interface CatalogRaceData {
  ability_bonus: Partial<Record<string, number>>;
  size?: string;
  speed?: number;
  traits?: string[];
  languages?: string[];
  proficiencies?: string[];
  skill_proficiencies?: string[];
  subraces?: Record<string, unknown>;
  /** Whether picking a subrace is MANDATORY. Absent/true = mandatory, which
   *  is correct for every SRD race carrying subraces. Set false where the
   *  base race is playable on its own and the subrace is a variant — Dragon
   *  Ball's Saiyan, whose sole subrace is Half-Saiyan. */
  subrace_required?: boolean;
}

/** Mechanical data shape for a class catalog item. */
export interface CatalogClassData {
  hit_die: number;
  /** One-line tagline shown under the class name in the creation picker.
   *  SRD classes get theirs from the local CLASS_DECORATION table; a homebrew
   *  class has no entry there and must supply its own or render blank. */
  description?: string;
  primary_ability?: string[];
  saving_throws?: string[];
  armor_proficiencies?: string;
  weapon_proficiencies?: string;
  tool_proficiencies?: string;
  skill_choices?: string[];
  skill_count?: number;
  subclass_level?: number;
  spellcasting_ability?: string | null;
  /** TAV-CLASS-STAT-GUIDANCE — the class's Unarmored Defense ability
   *  (barbarian → constitution, monk → wisdom, homebrew-declared), flat
   *  convenience key stamped by the engine's catalog route. Absent when the
   *  class has no unarmored defense. */
  unarmored_defense_ability?: string | null;
  level1_features?: string[];
}

/** Mechanical data shape for a background catalog item. */
export interface CatalogBackgroundData {
  skills: string[];
}

/** Mechanical data shape for a spell catalog item (DDX-21). */
export interface CatalogSpellData {
  level: number;
  school?: string;
  casting_time?: string;
  range?: string;
  components?: { V?: boolean; S?: boolean; M?: boolean };
  duration?: string;
  concentration?: boolean;
  ritual?: boolean;
  description?: string;
  higher_levels?: string | null;
  classes?: string[];
  attack_roll?: boolean;
  save_ability?: string | null;
  damage_dice?: string | null;
  damage_type?: string | null;
  healing_dice?: string | null;
}

/** One entry in a monster's actions or legendary_actions list (DDX-21). */
export interface CatalogMonsterAction {
  name: string;
  description?: string;
  desc?: string;
  attack_bonus?: number | null;
  damage_dice?: string | null;
  damage_type?: string | null;
  is_legendary?: boolean;
}

/** Mechanical data shape for a monster catalog item — the full stat block (DDX-21). */
export interface CatalogMonsterData {
  size?: string;
  monster_type?: string;
  alignment?: string;
  ac?: number;
  ac_note?: string;
  hp_formula?: string;
  speed?: Partial<Record<string, number>>;
  senses?: Partial<Record<string, number>>;
  ability_scores?: Partial<Record<string, number>>;
  cr?: number | string;
  xp?: number;
  languages?: string[];
  actions?: CatalogMonsterAction[];
  legendary_actions?: CatalogMonsterAction[];
  damage_resistances?: string[];
  damage_immunities?: string[];
  condition_immunities?: string[];
}

/** Mechanical data shape for an item (equipment) catalog item (DDX-21).
 *  Named "Equipment" (not "Item") to avoid colliding with CatalogItem, the
 *  generic catalog envelope every content_type shares. */
export interface CatalogEquipmentData {
  item_type?: string;
  weight?: number | null;
  cost_gp?: number | null;
  properties?: string[];
  damage_dice?: string | null;
  damage_type?: string | null;
  weapon_range?: string | null;
  ac_base?: number | null;
  ac_dex_cap?: number | null;
  requires_str?: number | null;
  stealth_disadvantage?: boolean | null;
  requires_attunement?: boolean;
  description?: string;
}

/** Mechanical data shape for a condition catalog item (DDX-21).
 *  Currently empty on suzu_dnd_dev — the engine has no condition rules-text
 *  column yet (see DDX-21 gap notes). Kept as an open record for forward-compat. */
export type CatalogConditionData = Record<string, unknown>;

export type CatalogItemData =
  | CatalogRaceData
  | CatalogClassData
  | CatalogBackgroundData
  | CatalogSpellData
  | CatalogMonsterData
  | CatalogEquipmentData
  | CatalogConditionData
  | Record<string, unknown>;

export interface CatalogItem {
  slug: string;
  name: string;
  content_type: string;
  source_type: string;
  /** Stable cross-system id, e.g. "dnd5e:spell:fireball" (DDX-21). */
  public_id?: string;
  /** Content pack slug this row resolved from, e.g. "srd-5e" (DDX-21). */
  pack_id?: string;
  data: CatalogItemData;
}

export interface CatalogResponse {
  system: string;
  content_type: string | null;
  items: CatalogItem[];
  total: number;
  limit: number;
  offset: number;
}

/** Counts returned when GET /catalog is called with no `type`. */
export interface CatalogCounts {
  counts: Record<string, number>;
  content_type: null;
}

// ── DnD: systems (S2.4 — GET /api/dnd/systems) ───────────────────────────────

export interface GameSystem {
  system_id: string;
  name: string;
  version: string;
  is_active: boolean;
}

export interface SystemDefinition {
  system_id: string;
  name: string;
  version: string;
  definition: {
    attributes: string[];
    content_types: string[];
    character_required: string[];
    dice: Record<string, unknown>;
  };
  is_active: boolean;
}

// ── DnD: authored adventures — combat from scene (ADV-6) ─────────────────────

/** Request body for POST /api/dnd/combat/from-scene (ADV-6). */
export interface CombatFromSceneRequest {
  /** The active game session id. */
  session_id: string;
  /** Optional: override the current scene's encounter. Omit = use current scene. */
  encounter_id?: string;
}

/** One monster spawned into the combat by the engine (ADV-6). */
export interface CombatSceneMonster {
  participant_id: string;
  name: string;
  hp: number | null;
  from_ref?: string;
  tactics?: string;
  position?: string;
}

/** Response from POST /api/dnd/combat/from-scene (ADV-6). */
export interface CombatFromSceneResult {
  combat_id: string;
  round: number;
  monsters: CombatSceneMonster[];
  terrain?: Record<string, unknown>;
  encounter_id?: string;
}

// ── DnD: scene advancement (ADV-7T) ──────────────────────────────────────────

/**
 * A valid transition from the current scene to another.
 *
 * TAV-SLICE-END-ADVANCE-NULL (engine d41351f, engine/beats.py
 * `available_transitions`): `to: null` is a real, authored shape — an
 * end-of-slice exit with no destination scene. It is what makes a terminal
 * transition ELIGIBLE for `AdvanceSceneRequest.to_scene: null` (the engine
 * checks this same list). Consumers must not assume `to` is always a scene
 * id — see intentFastPath's `ClientIntent.to` and the play page's transition
 * button rendering.
 */
export interface SceneTransition {
  to: string | null;
  label?: string;
  /** When present: this transition is locked until the named encounter is
   *  resolved. Gated CLIENT-side (see the play page's `availableTransitions`)
   *  because the engine has no equivalent — unlike flag gating, below. */
  requires_encounter_resolved?: string;
  // NOTE: the authored transition also carries `requires` (the flag gate) and
  // `note` (GM-facing prose). Neither is declared here, because neither
  // survives `normalizeGrounding` in `src/lib/api/dnd.ts`. That is a CLIENT
  // normalizer, NOT the BFF — an earlier version of this comment called it the
  // BFF, which is wrong (Kage-CR C1, 2026-08-07): the BFF is
  // `src/app/api/dnd/[...path]/route.ts` and it is a byte pass-through, so
  // both fields DO still reach the network tab. Stripping them here keeps them
  // out of client state, not off the wire; the wire fix is server-side and is
  // filed as TACTICS-WIRE-SIBLINGS.
  //
  // This type is the POST-normalizer shape. If you find yourself wanting
  // `requires` back to filter on, that is the bug — the engine already applied
  // it, and re-filtering diverges from the list the narrator was given.
}

/** P1-READALOUD: one authored read-aloud NPC dialogue line for the opening beat.
 *  Speaker display name is resolved server-side by project_opening_line_for_wire(). */
export interface OpeningLine {
  /** The author's NPC reference (bare id or content_ref e.g. 'dnd5e:npc:mira'). */
  npc_ref: string;
  /** Verbatim authored dialogue (≤400 chars). */
  line: string;
  /** Resolved display name — engine resolves from npcs_present[], falls back
   *  to slug humanisation ('rainbow-dash' → 'Rainbow Dash'). */
  speaker_display_name: string;
}

/** DDX-22 — a resolved NPC entry as projected server-side by the engine's
 *  `project_npc_for_wire()` (engine/world_content_check.py) onto
 *  `current_scene.npcs_present`. Only `name` is guaranteed present; the rest
 *  mirror the helper's documented INCLUDE list. Used by JournalPane's
 *  "NPCs met" section (merged with the event-sourced `npcs_introduced`
 *  union — see src/lib/dnd/journal.ts). */
export interface SceneNpc {
  name: string;
  id?: string;
  role?: string;
  motivation?: string;
  appearance?: string;
  location?: string;
  lineage?: string;
  aliases?: string[];
  [k: string]: unknown;
}

/**
 * Phase 4 (Package B, Sora-Arch design §3 Fork 2) — the current scene's
 * authored combat encounter block, when one is defined
 * (engine `current_scene.encounter`), regardless of `trigger` or whether
 * combat has started yet. Presence alone is what reframes the "Begin an
 * encounter" button as "Stand and fight" (page.tsx `sceneHasEncounter`).
 * Defensive/minimal shape (mirrors SceneNpc's own `[k: string]: unknown`
 * pattern) — only `kind`/`trigger` are read client-side; monsters/outcomes
 * stay server-side, never surfaced until an actual combat starts.
 */
export interface SceneEncounterInfo {
  kind?: string;
  trigger?: string;
  [k: string]: unknown;
}

/**
 * P1-PLAYFIX §3.4 — an authored skill check offered by the current scene.
 * Deliberately omits `on_success`/`on_failure` (the authored flag names): the
 * client only needs to know WHICH skill can be attempted, never what flag it
 * sets. Authored branching stays opaque to the browser (C8).
 *
 * Check Retry + Fail-Forward (2026-07-28 design §6/T1) — `state`,
 * `attempts_used`, `max_attempts`, `lock_reason` are ALL optional: absent
 * means the engine's SUZU_DND_CHECK_RETRY_POLICY flag is off (or the server
 * predates this feature), in which case the check renders exactly as
 * `available` always has. `dc` is already the EFFECTIVE dc (base +
 * escalate_dc accumulated so far) whenever `state` is present — the engine
 * projects it that way (engine/check_policy.py::project_checks_for_wire),
 * never a separate field here.
 */
export interface SceneCheck {
  skill: string;
  dc: number;
  note?: string;
  /** 'available' | 'locked' | 'resolved'. Absent = pre-CHECK-RETRY server. */
  state?: 'available' | 'locked' | 'resolved';
  attempts_used?: number | null;
  max_attempts?: number | null;
  lock_reason?: 'nat1' | 'fail_by_5' | 'max_attempts' | 'resolved' | null;
}

/** Grounding data for the current session / scene (ADV-5). */
export interface GroundingData {
  scene_id?: string;
  scene_name?: string;
  /** Boxed text / description for the current scene. */
  boxed_text?: string;
  /** DM-ARRIVAL-NARRATION — the authored beat played verbatim when a scene
   *  advance LANDS on this scene. Distinct register from `boxed_text`: that is
   *  the full scene-setting block shown when a session OPENS here, this is the
   *  short landing that connects the previous moment to this one. Absent on
   *  every scene authored before 2026-08-09 and on any pre-feature engine — the
   *  play screen keeps its existing transition behaviour when it is missing, so
   *  absence is the normal case, not a degraded one. */
  arrival_line?: string;
  /** Current scene objective (A1 — surfaces on the scene card). */
  objective?: string;
  /** Available transitions from the current scene. */
  transitions?: SceneTransition[];
  /** P1-PLAYFIX §3.4 — authored skill checks offered by the current scene. */
  checks?: SceneCheck[];
  /** Progress flags. */
  flags?: Record<string, unknown>;
  /** Current encounter state (null when no encounter active or resolved). */
  encounter_state?: Record<string, unknown> | null;
  /** Adventure hook (A1 — opening scene grounding). */
  hook?: string;
  /** Adventure title (A1 — AI-off opening header). */
  adventure_title?: string;
  /** P1-READALOUD: optional authored NPC dialogue for the opening beat.
   *  Always an array (empty when the scene has none). Projected server-side via
   *  project_opening_line_for_wire(); each entry carries speaker_display_name. */
  opening_lines?: OpeningLine[];
  /** DDX-22 — resolved NPCs present in the current scene (engine:
   *  `current_scene.npcs_present`, projected via project_npc_for_wire()).
   *  Always an array (empty when the scene has none, no scene yet, or a
   *  pre-DDX-22 engine). Used by JournalPane's "NPCs met" section. */
  npcs_present?: SceneNpc[];
  /** Phase 4 (Package B) — present when the current scene defines a combat
   *  encounter (any trigger), even before it starts. `null`/absent = no
   *  authored encounter for this scene. See SceneEncounterInfo. */
  encounter?: SceneEncounterInfo | null;
  [k: string]: unknown;
}

/**
 * Request body for POST /api/dnd/sessions/{id}/advance (ADV-7).
 *
 * TAV-SLICE-END-ADVANCE-NULL (engine d41351f, Leon decision (b) 2026-08-09):
 * `to_scene: null` is the Tavern's own shape for "take the end-of-slice
 * exit" — legal only when the current scene offers an AVAILABLE terminal
 * transition (`to: null`, same anti-skip eligibility as a named advance).
 * The engine 400s `to_scene_required` if no such exit is open; it never
 * infers completion from an absent field.
 *
 * DEPENDENCY (Kage-CR review, 2026-08-25): this type fix is currently
 * end-to-end INERT. The NekoNova Flask proxy (`api/routes/dnd_sessions.py:919`
 * — `if not body.get("to_scene"): 400`) rejects `{"to_scene": null}` before
 * the engine ever sees it, on every ref. Landing this shape live at the
 * network boundary requires the api-hop fix on
 * `fix/ddx-proxy-nondict-2026-08-25` (NekoNova lane, deployed).
 */
export interface AdvanceSceneRequest {
  to_scene: string | null;
  flags?: Record<string, unknown>;
}

/** `next_status` on a SeriesCompletionPointer (design doc §6.4). `unresolved`
 *  is a HOLE, not an ending — a retired/invisible member, never silently
 *  read as end-of-series (design doc §5.4). */
export type SeriesNextStatus = 'ok' | 'end_of_series' | 'unresolved';

/** The next adventure in a series, resolved (design doc §6.4). Absent
 *  fields (`name`/`label`/`act_handle`/`level_range`) mean the field simply
 *  wasn't authored on that member — never a signal to fall back to a guess. */
export interface SeriesNextAdventure {
  ref: string;
  name?: string;
  label?: string;
  act_handle?: string;
  level_range?: { min: number; max: number };
}

/** One entry of the `series` array on an /advance completion response
 *  (design doc §6.4). Always a list — an adventure can legitimately sit in
 *  more than one series (Dragon Ball's era-vs-full-run case, design doc
 *  §10.2); `[]` means "not in a series". */
export interface SeriesCompletionPointer {
  ref: string;
  title: string;
  /** 1-based index of the member that was just completed. */
  position: number;
  total: number;
  next_status: SeriesNextStatus;
  /** Present only when next_status === 'ok'. */
  next?: SeriesNextAdventure;
}

/**
 * Response from POST /api/dnd/sessions/{id}/advance.
 *
 * TAV-SLICE-END-ADVANCE-NULL (engine d41351f): a null `to_scene` is the
 * terminal-transition shape — `from_scene` still names where the party was,
 * but there is no destination scene because the adventure just ended.
 * `completed: true` always accompanies `to_scene: null` (and never appears
 * otherwise); `ends_adventure` is also `true` on this shape but predates
 * `completed` and is kept for existing named-transition consumers.
 *
 * T4p1: `series`/`next_adventure` are the SUZU_DND_SERIES-gated completion
 * fields from the 2026-08-25 Campaign Series design doc §6.4 — optional so
 * a flag-off or pre-series engine response still types cleanly.
 * `already_completed`/`persisted` are the idempotency fix from the same
 * design (§6.1), shipped UNFLAGGED. None of these are wired into play
 * chrome yet (out of scope this phase) — see NextPartOffer.tsx.
 */
export interface AdvanceSceneResult {
  from_scene: string;
  to_scene: string | null;
  flags_set?: string[];
  visited_scenes_count?: number;
  ends_adventure?: boolean;
  /** True only on the terminal (`to_scene: null`) shape — see above. */
  completed?: boolean;
  /** Whether this call's completion needed to persist anything (false on a
   *  repeat/idempotent call — see `already_completed`). */
  persisted?: boolean;
  /** True when this call found the adventure already completed and returned
   *  the terminal payload as a no-op (design doc §6.1) — HTTP 200, not 409. */
  already_completed?: boolean;
  /** Always a list when present. [] = not in any series. */
  series?: SeriesCompletionPointer[];
  /** Flattened convenience — `engine.series.flatten_next`'s output. Present
   *  (non-null) only when exactly one series entry has next_status 'ok'. */
  next_adventure?: SeriesNextAdventure | null;
}

/** Request body for POST /api/dnd/sessions/{id}/flag. */
export interface SetFlagRequest {
  flag: string;
  value: unknown;
}

/**
 * P1-PLAYFIX §3.3.1 — request body for POST /api/dnd/sessions/{id}/check.
 * DC and skill-vs-scene matching are resolved engine-side from the authored
 * adventure — the client only names which skill it is attempting. Advantage/
 * disadvantage are optional player-declared dice modifiers.
 */
export interface ResolveCheckRequest {
  skill: string;
  actor_username: string;
  advantage?: boolean;
  disadvantage?: boolean;
}

/**
 * Response from POST /api/dnd/sessions/{id}/check.
 * `mechanics` is the narrator-ready roll string; `description` is the
 * recap-ready sentence (also persisted as the `check_resolved` event's
 * data.description). `flag_set` names whatever flag THIS resolution actually
 * wrote — distinct from SceneCheck (grounding), which never reveals which
 * flag an unresolved check *would* set; the branching stays opaque until
 * it has actually happened.
 */
export interface ResolveCheckResult {
  skill: string;
  dc: number;
  total: number;
  success: boolean;
  flag_set: string[];
  mechanics: string;
  description: string;
  /** F4/CHECK-DOUBLE-RENDER: the durable `check_resolved` session event's own
   *  seq (int) that this resolution just wrote, or `null` if the write
   *  failed for some reason the route still let through as a 200 (should not
   *  happen — routes/sessions.py::resolve_scene_check 500s instead when the
   *  event write itself fails) — never absent on the real wire. Seeding this
   *  onto the client's own dedup ledger (`renderedSeqsRef`, page.tsx) before
   *  the next durable poll tick observes the same event lets
   *  reconcileDurableEvents' rule 1 (renderedSeqs.has(seq)) skip the poll's
   *  duplicate instead of double-rendering the check's result row. */
  event_seq?: number | null;
}

/**
 * DDX-08 / T3 — request body for POST /api/dnd/sessions/{id}/roll.
 * Mirrors the engine's RollRequest exactly (extra='forbid' upstream — an
 * unrecognised field 422s rather than being silently dropped). There is
 * deliberately no client-supplied modifier field: for kind in
 * {skill, save, ability} the modifier is always resolved server-side off the
 * character's own sheet.
 */
export interface RollRequest {
  username: string;
  /** Arbitrary dice notation (e.g. "1d6"). When present it always wins over
   *  `kind` — a pure dice roll, no character/modifier involved. */
  notation?: string;
  kind?: 'raw' | 'skill' | 'save' | 'ability';
  character_id?: number;
  skill?: string;
  ability?: string;
  save?: string;
  advantage?: 'straight' | 'advantage' | 'disadvantage';
}

/**
 * DDX-08 / T3 — response from POST /api/dnd/sessions/{id}/roll.
 * The SAME shape is persisted as the `dice_roll` session event's `data`
 * (see engine routes/sessions.py::roll_dice_route) — this is the
 * server-authoritative roll outcome; the client never computes it.
 */
export interface RollResult {
  kind: string;
  notation: string | null;
  skill: string | null;
  ability: string | null;
  character_id: number | null;
  modifier: number;
  advantage: 'straight' | 'advantage' | 'disadvantage';
  rolls: number[];
  kept: number | null;
  total: number;
  description: string;
  event_seq?: number | null;
}

/**
 * B3: DM-chooser outcome values. 'tpk' and 'alert' exist on the engine but are
 * reserved for system-driven resolution paths — intentionally excluded from the
 * UI chooser.
 */
export type EndCombatOutcome =
  | 'victory'
  | 'retreat'
  | 'parley'
  | 'flee'
  | 'unresolved';

/** Request body for POST /api/dnd/combat/{id}/end. */
export interface EndCombatRequest {
  username: string;
  /** Optional outcome override. Engine also accepts 'alert'|'tpk'|'unresolved' but
   *  the Tavern chooser only surfaces the EndCombatOutcome subset. */
  outcome?: EndCombatOutcome | string;
}

/** Response from POST /api/dnd/combat/{id}/end. */
export interface EndCombatResult {
  state: CombatState;
  outcome: string;
  xp_earned?: number;
  defeated?: string[];
  scene_advance?: CombatSceneAdvance | null;
  /** WF-O-OUTCOMELINE — see `CombatMessageResult.outcome_line`'s doc comment;
   *  identical contract, same top-level-sibling-of-scene_advance shape. */
  outcome_line?: string | null;
}

// ── DnD: re-bind (B2) ─────────────────────────────────────────────────────────

/** Request body for POST /api/dnd/sessions/{id}/bind (Tavern BFF route). */
export interface BindCharacterRequest {
  /** Target username to bind for. Callers may only bind for themselves unless they are the DM. */
  username: string;
  /** character_id to bind; null to clear (DM-only / no character). */
  character_id: number | null;
}

/** Response data from a successful bind. */
export interface BindCharacterResult {
  campaign_id: string;
  username: string;
  role: string;
  character_id: number | null;
  /** LVL-1: non-null when this bind floor-leveled the character (null when
   *  no floor applied, no character bound, or the walk errored — the bind
   *  itself still succeeded and is reported truthfully regardless). */
  floor_applied?: FloorApplied | null;
}

// ── DnD: catalog — adventure items (ADV-9) ────────────────────────────────────

/**
 * Series-membership stamp on an adventure's catalog summary (SUZU_DND_SERIES,
 * flag-gated — see the 2026-08-25 Campaign Series design doc §8.2). Key is
 * ABSENT entirely when the adventure isn't in any series — never present-but-
 * null — so `summary.series` doubles as its own presence check.
 */
export interface AdventureSeriesStamp {
  ref: string;
  title: string;
  /** 1-based index of this adventure within the series' member order. */
  position: number;
  total: number;
}

/** Summary block projected from the adventure data JSONB for catalog list mode. */
export interface AdventureSummary {
  subtitle?: string;
  level_range?: { min: number; max: number };
  length?: string;
  content_rating?: string;
  tags?: string[];
  /** Present only when SUZU_DND_SERIES is on and this adventure belongs to a
   *  series (first match by pack precedence when it's in more than one —
   *  see `also_in`). */
  series?: AdventureSeriesStamp;
  /** Count of ADDITIONAL series this adventure also belongs to, beyond the
   *  one named in `series` above. Absent/0 = only ever in the one (or zero). */
  also_in?: number;
  /** Ships UNFLAGGED (plain data passthrough — Leon-ruled 2026-08-26). Tags
   *  rows that are editorial inputs to spine-splice assembly (e.g. Act-I
   *  chunk rows), not standalone-playable modules — the catalog UI filters
   *  these out of the browsable one-shot grid. */
  editorial_role?: string;
}

/** A catalog item for content_type='adventure'. */
export interface AdventureCatalogItem {
  public_id: string;
  name: string;
  summary: AdventureSummary;
}

// ── DnD: catalog — series items (T4p1 / TAV-SERIES-GROUPING) ─────────────────
// See MainVault/architecture/2026-08-25 Campaign Series — Content Model &
// Runtime Design.md §8.1. Member NAMES are deliberately NOT resolved in list
// mode (design doc §8.1/§18 D1).
//
// B1 CORRECTION (T5 live sweep, 2026-08-28, engine D1 ruling verified against
// .226): `summary.member_refs` is a PLAIN STRING ARRAY of adventure public_ids
// — NOT the `{ref, act_handle, label}[]` object shape an earlier design draft
// assumed (that shape never shipped; the original `members`-keyed mapper read
// a key that never existed on the wire, so every real series mapped to null).
// The engine owns this contract. Titles are resolved client-side by joining
// member_refs against the type=adventure catalog list's own public_id/name —
// see adventureCatalog.ts's `resolveSeriesMembers`.

/** Procedural cover spec (design doc §4.1/§4.2) — franchise artwork is off
 *  the table on the vault's IP posture; `image_ref` is reserved (must be
 *  null) for a future raster-override pass. Decorative only — never the
 *  sole carrier of meaning (content_rating/level_range/title stay in text). */
export interface SeriesCover {
  color: string;
  pattern: 'stripes' | 'hatch' | 'dots' | 'none';
  glyph: string;
  image_ref: string | null;
}

/** Summary block projected from the series data JSONB for catalog list mode
 *  (design doc §8.1, corrected per the B1 note above). */
export interface SeriesSummary {
  subtitle?: string;
  level_range?: { min: number; max: number };
  length?: string;
  content_rating?: string;
  tags?: string[];
  cover: SeriesCover;
  member_count: number;
  /** Ordered adventure public_ids — play order IS array order. Bare strings
   *  on the wire (see the B1 correction note above); titles/levels are
   *  resolved client-side, not carried here. */
  member_refs: string[];
}

/** A catalog item for content_type='series'. */
export interface SeriesCatalogItem {
  public_id: string;
  /** Bare slug (e.g. "mlp-toto-campaign") — used for the /modules/series/[slug] route. */
  slug: string;
  name: string;
  summary: SeriesSummary;
}

// ── Narration SSE ──────────────────────────────────────────────────────────

/**
 * P1-PLAYFIX-2 §A.5 — an authored skill check the server's INTENT classifier
 * invited this turn (the DM calls for it; the player rolls — never auto-roll).
 * `dc` is informational only; the engine's `/check` route is still the sole
 * authority on the actual DC.
 */
export interface OfferedCheck {
  skill: string;
  dc?: number;
  /** Phase 4 — free-text note the classifier/narrator attached to the offer
   *  (mirrors SceneCheck.note for an authored check). Absent on the
   *  pre-Phase-4 authored-check-only shape; never client/classifier-supplied
   *  DC — this field is purely informational, like `dc` above. */
  note?: string;
}

export type NarrationEvent =
  | {
      kind: 'chunk';
      text: string;
      /**
       * P1-PLAYFIX-2 §A.5/§A.7 — FORWARD-COMPATIBLE, pending A.2 (NN
       * `api/routes/narration.py`, a parallel work item not yet landed as of
       * this edit). Present once the server validates a check-intent from
       * the model's `INTENT:` line against the current scene's authored
       * checks. Field name (`offered_check`/`{skill,dc}`) is an assumption
       * sourced from the design doc — reconcile against the real A.2
       * payload once it ships. Absent today; consumers must treat absence
       * as "no offer", never assume one.
       */
      offeredCheck?: OfferedCheck;
      /**
       * A.2 reconciliation (real `api/routes/narration.py` + `core/intent_router.py`
       * contract, confirmed post-landing) — `true` when the server-side INTENT
       * classifier executed a scene transition on THIS turn. Distinct from the
       * combat `CombatSceneAdvance` wire shape (`{from_scene, to_scene}`) used
       * elsewhere on the play page — the narration contract is flat fields.
       */
      sceneAdvanced?: boolean;
      /** The scene id the server advanced to; null/absent when sceneAdvanced is falsy. */
      advancedTo?: string | null;
      /**
       * DM-STREAM — `true` when the server streamed this beat token-by-token
       * (`SUZU_DM_STREAM_NARRATION` + `SUZU_DM_SPLIT_INTENT` both on, non-combat
       * beat). `text` is still the cumulative prose so far, same as the buffered
       * shape — this flag only tells the consumer the server is already pacing
       * the reveal, so it should render `text` directly instead of running its
       * own fake typewriter. Absent/false = today's buffered single-event beat.
       */
      streamMode?: boolean;
    }
  | { kind: 'done' }
  /** error: upstream error string. reason: structured cause when the backend
   *  sends one (e.g. 'ai_off' = table intentionally running without AI,
   *  'ai_unverified' = AI gate check failed). Absence = unknown/transient error. */
  | { kind: 'error'; error: string; reason?: string };

export interface NarrationRequest {
  username: string;
  message: string;
  channel: string;
}

/** DM-narration request (ST-062) — POST /api/narration/dm/stream.
 *  `message` is the player's line/action; `mechanics` is the engine's
 *  authoritative result string (empty for a pure roleplay beat).
 *  `kind` defaults to 'beat' (all existing callers unaffected). When
 *  'opening', message MUST be empty and the proxy writes the durable
 *  opening_narrated marker on success. */
export interface DmNarrationRequest {
  username: string;
  channel: string;
  message: string;
  mechanics?: string;
  adventure?: string;
  transcript?: string[];
  mode?: 'say' | 'act' | 'ooc' | 'dm_narration';
  session_id?: string;
  /**
   * A1 — beat kind. 'opening' = system-authored scene open; default 'beat'.
   * TAV-7 / N1: 'recap' = system-authored "previously on" beat — like
   * 'opening', the server treats `message` as NOT a player line: it skips the
   * player_action persist (so SessionRecap's internal request prompt never
   * echoes into the visible log as a fake user message) and instead persists
   * the reply, if anything, under its own `kind:'recap'` session-event kind.
   * SessionRecap.tsx is the only caller today. See
   * ProjectNekoNova/api/routes/narration.py::_persist_player_action /
   * _persist_narration for the server-side contract this mirrors.
   */
  kind?: 'beat' | 'opening' | 'recap';
  /**
   * P1-PLAYFIX-2 gate fix (Kage #1 / Miko DEFECT-2) — true ONLY on the
   * client's own synthetic confirmation beats (the `narrate()` call an
   * already-completed onMoveOn/onAttemptCheck/handleSceneAdvance fires to
   * narrate what just happened). Tells the server's INTENT classifier not to
   * advance the scene AGAIN for this beat — the advance already happened via
   * its own dedicated endpoint (advanceScene / resolveCheck). Default false;
   * real player-action beats never set this.
   */
  suppress_intent?: boolean;
}

/** A1 — request body for POST /api/dnd/sessions/{id}/events (proxy passthrough). */
export interface WriteSessionEventRequest {
  kind: string;
  actor_username?: string;
  data?: Record<string, unknown>;
  visibility?: 'table' | 'dm' | 'public';
}

// ── S5.4: DM override + visibility policy ────────────────────────────────────

/** Per-kind outcome payloads for POST /api/dnd/combat/{id}/override.
 *  Must match the engine's Pydantic models exactly (extra='forbid').
 *  Proxy injects dm_username from cookie — never send it from the client. */

export interface OverrideAttackOutcome {
  hit: boolean;
  critical_hit?: boolean;
  critical_miss?: boolean;
  natural_roll?: number | null;
  total_roll?: number | null;
  total_attack_mod?: number | null;
  vs_defense?: number | null;
  damage?: Array<{ amount: number; type: string; location_hint?: string | null }>;
}

export interface OverrideCheckOutcome {
  success: boolean;
  degree: 'crit_failure' | 'failure' | 'success' | 'crit_success';
  total: number;
  successes_rolled?: number;
  successes_needed?: number;
  natural_high?: number;
}

export interface OverrideDamageOutcome {
  target_new_hp: number;
  damage_dealt: number;
  raw_damage: number;
  is_down?: boolean;
}

export type OverrideOutcome =
  | OverrideAttackOutcome
  | OverrideCheckOutcome
  | OverrideDamageOutcome;

export type OverrideKind = 'attack' | 'check' | 'save' | 'damage';

/** Request body for POST /api/dnd/combat/{id}/override.
 *  Proxy injects dm_username. */
export interface SubmitOverrideRequest {
  kind: OverrideKind;
  actor_id: string;
  target_id?: string | null;
  outcome: OverrideOutcome;
  reason: string;
}

/** Success data from POST /api/dnd/combat/{id}/override. */
export interface OverrideResult {
  applied?: {
    message?: string;
    success?: boolean;
    damage_dealt?: number;
    damage_type?: string | null;
    target_new_hp?: number | null;
    [k: string]: unknown;
  };
  state?: CombatState;
  event_seq?: number;
}

/** Request body for POST /api/dnd/sessions/{id}/policy. */
export interface SessionPolicyRequest {
  dm_override_player_visible?: boolean;
}

/** Response data from POST /api/dnd/sessions/{id}/policy. */
export interface SessionPolicyResult {
  session?: Session;
}

// ── S5.3: NPC action (human DM drives monster turn) ──────────────────────────

/** Request body for POST /api/dnd/combat/{id}/npc-action.
 *  The proxy injects dm_username from the session cookie — do NOT send it
 *  from the client. */
export interface NpcActionRequest {
  participant_id: string;
  action: 'attack' | 'skip' | 'move';
  target_id?: string;
}

/** Response from POST /api/dnd/combat/{id}/npc-action. */
export interface NpcActionResult {
  message?: string;
  data?: {
    applied?: CombatMessageResult;
    state?: CombatState;
    turn_advanced?: boolean;
  };
  state?: CombatState;
  turn_advanced?: boolean;
  [k: string]: unknown;
}

/** VESSEL/SRD class resources — one entry from GET /api/dnd/characters/{id}/resources.
 *
 *  These are the engine's generic, class-DECLARED stat-derived resources (Ki,
 *  Rage, Action Surge, Channel Divinity, the Vessel's Resonance/Instability, a
 *  subclass's Natural Recovery, ...). Spell slots and concentration are
 *  excluded engine-side — they belong to the spell surface — so this list is
 *  safe to render wholesale.
 *
 *  `kind` drives how the number READS, and the two are not interchangeable:
 *    - "pool"  — spending counts DOWN from `maximum` (Ki 3/5 means 3 left).
 *    - "track" — a risk meter counting UP toward `maximum` (Instability 6/10
 *      means 6 accrued). A full track is BAD; a full pool is good.
 *  Rendering a track with a pool's visual language is actively misleading, so
 *  the panel branches on this rather than treating every row as a pool.
 *
 *  `maximum: 0` means "not available at this character's level yet" (a level-1
 *  monk's Ki, a level-1 warlock's Mystic Arcanum). The engine still stores the
 *  row so it can grow in place on level-up.
 */
export interface ClassResource {
  key: string;
  label: string;
  kind: 'pool' | 'track';
  current: number;
  maximum: number;
  /** "short" | "long" | "none" | "daily" | "encounter" — the cadence at THIS
   *  character's level (the engine resolves a level-gated cadence, e.g. Bardic
   *  Inspiration flipping to short-or-long at 5th, before serving it). */
  refresh: string;
  /** Currently always "class" engine-side. Do NOT branch on it — it is a
   *  provably constant field pending SOURCE-FIELD-CONSTANT. */
  source?: string;
}

/** The last spend that can still be reversed, or null. Shape mirrors the
 *  engine's `_undoable_for_wire`; the panel only needs the key + seq. */
export interface UndoableSpend {
  key: string;
  seq?: number;
  [k: string]: unknown;
}

export interface ListResourcesResult {
  resources: ClassResource[];
  undoable: UndoableSpend | null;
}

/** POST .../resources/{key}/spend — returns the FULL post-spend state, so the
 *  panel can move the number immediately without waiting on a refetch (same
 *  contract as adjustHp / spendCurrency). */
export interface SpendResourceResult {
  key: string;
  label: string;
  current: number;
  maximum: number;
  spent: number;
  undoable: UndoableSpend | null;
}

/** Which rest was taken. The NekoNova hop translates these to the engine's
 *  `/spells/{id}/longrest` / `/shortrest` and FAILS LOUD on anything else
 *  (400 `invalid_rest_type`) rather than defaulting — a typo must never
 *  silently take a long rest and wipe a track the player was carrying. */
export type RestType = 'short' | 'long';

/** POST /api/dnd/characters/{id}/rest — verified against the engine's
 *  `short_rest` / `long_rest` routes, which both return `_ok({"message": ...})`.
 *
 *  A MESSAGE IS ALL YOU GET. There is no post-rest state in this response:
 *  no HP, no hit dice, no slots, no resources. That is not an oversight to
 *  work around by inventing fields — it is why every rest must be followed by
 *  a refetch of the sheet AND of the resource panel. Typed narrowly on
 *  purpose, for the same reason `UndoResourceResult` is: declaring fields the
 *  server never sends is how this codebase already shipped an invented
 *  contract once. */
export interface RestResult {
  /** Human-readable summary from the engine (≤500 chars), e.g. what was
   *  recovered. Optional because a degraded hop can answer `{}`. */
  message?: string;
}

/** POST .../resources/undo-last — a DIFFERENT shape from a spend, verified
 *  against the engine's `undo_last_resource_route`: `{key, current, maximum,
 *  restored, requested}`. It carries NO `label`, NO `spent` and NO `undoable`.
 *
 *  Typed separately rather than reusing `SpendResourceResult` (Kage-CR I4):
 *  that reuse declared three fields that are `undefined` at runtime and left
 *  the two real ones untyped — the same species of invented-contract bug as
 *  the undo `reason` codes this panel already got wrong once. */
export interface UndoResourceResult {
  key: string;
  current: number;
  maximum: number;
  /** How much was actually restored (may be clamped). */
  restored: number;
  /** How much the undone spend originally took. */
  requested: number;
}
