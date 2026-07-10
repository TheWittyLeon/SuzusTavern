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
}
export interface CharacterCreated { character_id: string; [k: string]: unknown }

export interface Character {
  character_id: string;
  username: string;
  name: string;
  race: string;
  char_class: string;
  level: number;
  hp: { current: number; max: number };
  ac: number;
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

/** One entry in the character's own repertoire (GET /spells/:id/list). */
export interface SheetSpellEntry {
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
export interface AvailableSpellEntry {
  slug: string;
  name: string;
  level: number;
  school: string;
  concentration: boolean;
  ritual: boolean;
  in_repertoire: boolean;
  prepared: boolean;
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
 * `'subclass'` or `'asi'` today (kept as `string`, not a union, since
 * `resolve_level_choice` already has an `unsupported_choice_type` fallback
 * for anything else — a future third type should render as "coming soon"
 * rather than fail typechecking). `class` is the character's class name at
 * queue time (subclass options are filtered to it); absent it should fall
 * back to the sheet's own `char_class`.
 */
export interface PendingLevelChoice {
  id: string;
  type: string;
  level: number;
  class?: string;
  label: string;
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
  speed: number;
  xp: number;
  xp_next: number | null;
  hit_dice_remaining: number;
  proficient_saves: string[];
  proficient_skills: string[];
  class_features: string[];
  conditions: string[];
  spellcasting: SheetSpellcasting | null;
  /** Keyed by slot level "1".."9"; only non-zero levels present. */
  spell_slots: Record<string, SheetSpellSlot>;
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
  /** T12 (DDX-23t): gold purse. Confirmed on both engine backends —
   *  `engine/commands/character_msm.py:349` and
   *  `engine/commands/character_commands.py:517` both project
   *  `currency_gp` onto the structured sheet (0 for a fresh character).
   *  Optional for the same fixture-blast-radius reason as `feats`/
   *  `pending_choices` above — the engine always sends a real int on the
   *  live wire, this is purely so pre-existing `CharacterSheet` object
   *  literals across the test suite keep compiling. */
  currency_gp?: number;
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
  /** hp_current === 0 && is_alive (still making saves). */
  is_downed: boolean;
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
}

/** Mechanical data shape for a class catalog item. */
export interface CatalogClassData {
  hit_die: number;
  primary_ability?: string[];
  saving_throws?: string[];
  armor_proficiencies?: string;
  weapon_proficiencies?: string;
  tool_proficiencies?: string;
  skill_choices?: string[];
  skill_count?: number;
  subclass_level?: number;
  spellcasting_ability?: string | null;
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

/** A valid transition from the current scene to another. */
export interface SceneTransition {
  to: string;
  label?: string;
  /** When present: this transition is locked until the named encounter is resolved. */
  requires_encounter_resolved?: string;
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

/**
 * P1-PLAYFIX §3.4 — an authored skill check offered by the current scene.
 * Deliberately omits `on_success`/`on_failure` (the authored flag names): the
 * client only needs to know WHICH skill can be attempted, never what flag it
 * sets. Authored branching stays opaque to the browser (C8).
 */
export interface SceneCheck {
  skill: string;
  dc: number;
  note?: string;
}

/** Grounding data for the current session / scene (ADV-5). */
export interface GroundingData {
  scene_id?: string;
  scene_name?: string;
  /** Boxed text / description for the current scene. */
  boxed_text?: string;
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
  [k: string]: unknown;
}

/** Request body for POST /api/dnd/sessions/{id}/advance (ADV-7). */
export interface AdvanceSceneRequest {
  to_scene: string;
  flags?: Record<string, unknown>;
}

/** Response from POST /api/dnd/sessions/{id}/advance. */
export interface AdvanceSceneResult {
  from_scene: string;
  to_scene: string;
  flags_set?: string[];
  visited_scenes_count?: number;
  ends_adventure?: boolean;
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
}

// ── DnD: catalog — adventure items (ADV-9) ────────────────────────────────────

/** Summary block projected from the adventure data JSONB for catalog list mode. */
export interface AdventureSummary {
  subtitle?: string;
  level_range?: { min: number; max: number };
  length?: string;
  content_rating?: string;
  tags?: string[];
}

/** A catalog item for content_type='adventure'. */
export interface AdventureCatalogItem {
  public_id: string;
  name: string;
  summary: AdventureSummary;
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
  /** A1 — beat kind. 'opening' = system-authored scene open; default 'beat'. */
  kind?: 'beat' | 'opening';
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
