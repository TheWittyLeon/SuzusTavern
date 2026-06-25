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
export interface SheetSpellcasting { ability: string; save_dc: number; attack_bonus: number }
export interface SheetInventoryItem {
  name: string;
  item_type: string;
  sub: string;
  quantity: number;
  equipped: boolean;
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

export type CatalogItemData = CatalogRaceData | CatalogClassData | CatalogBackgroundData | Record<string, unknown>;

export interface CatalogItem {
  slug: string;
  name: string;
  content_type: string;
  source_type: string;
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
  /** Progress flags. */
  flags?: Record<string, unknown>;
  /** Current encounter state (null when no encounter active or resolved). */
  encounter_state?: Record<string, unknown> | null;
  /** Adventure hook (A1 — opening scene grounding). */
  hook?: string;
  /** Adventure title (A1 — AI-off opening header). */
  adventure_title?: string;
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
export type NarrationEvent =
  | { kind: 'chunk'; text: string }
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
}

/** A1 — request body for POST /api/dnd/sessions/{id}/events (proxy passthrough). */
export interface WriteSessionEventRequest {
  kind: string;
  actor_username?: string;
  data?: Record<string, unknown>;
  visibility?: 'table' | 'dm' | 'public';
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
