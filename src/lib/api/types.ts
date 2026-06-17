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

// ── DM mode (client-side only — engine support is STORY-312, NOT YET) ──────
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

// ── DnD: sessions ──────────────────────────────────────────────────────────
export type SessionStatus = 'active' | 'paused' | 'ended';

/** Table content rating. 'mature' is only selectable on private/unlisted tables.
 *  Client-annotated until the engine column lands (STORY-313). A public/streamed
 *  table is hard-forced to the SFW model server-side regardless (STORY-314). */
export type ContentRating = 'sfw' | 'mature';

/** Table visibility. Client-annotated until the engine column lands (STORY-313). */
export type Visibility = 'public' | 'unlisted' | 'private';

export interface SessionStartRequest { username: string; channel: string }
export interface Session {
  session_id: string;
  channel: string;
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
  [k: string]: unknown;
}
export interface XpAwardRequest extends SessionStartRequest { amount: number; reason?: string }

// ── DnD: combat ────────────────────────────────────────────────────────────
export interface CombatActionRequest {
  username: string;
  combat_id: string;
  target?: string;     // required for /combat/attack
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

// ── Narration SSE ──────────────────────────────────────────────────────────
export type NarrationEvent =
  | { kind: 'chunk'; text: string }
  | { kind: 'done' }
  | { kind: 'error'; error: string };

export interface NarrationRequest {
  username: string;
  message: string;
  channel: string;
}
