// src/lib/api/dnd.ts
//
// Typed wrappers for the DnD proxy at /api/dnd/*.
// Method + path taken verbatim from the NekoNova bridge files.
import { apiCall } from './client';
import type {
  CatalogCounts,
  CatalogResponse,
  Character,
  CharacterCreateRequest,
  CharacterCreated,
  CharacterSheet,
  CombatActionRequest,
  CombatInitiativeRequest,
  CombatMessageResult,
  CombatMonsterTurnRequest,
  CombatSpawnRequest,
  CombatStartRequest,
  GameSystem,
  Inventory,
  Participant,
  Session,
  SessionStartRequest,
  SpellCastRequest,
  SystemDefinition,
  XpAwardRequest,
} from './types';

// ── Characters ──────────────────────────────────────────────────────────────

export const createCharacter = (
  req: CharacterCreateRequest,
  signal?: AbortSignal,
) => apiCall<CharacterCreated>('/api/dnd/characters', { method: 'POST', json: req, signal });

export const getCharacter = (
  characterId: string,
  username: string,
  signal?: AbortSignal,
) =>
  apiCall<Character>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}?username=${encodeURIComponent(username)}`,
    { method: 'GET', signal },
  );

export const levelUpCharacter = (
  characterId: string,
  username: string,
  signal?: AbortSignal,
) =>
  apiCall<Character>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/levelup`,
    { method: 'POST', json: { username }, signal },
  );

export const equipItem = (
  characterId: string,
  username: string,
  itemName: string,
  signal?: AbortSignal,
) =>
  apiCall<Character>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/equip`,
    { method: 'POST', json: { username, item_name: itemName }, signal },
  );

export const unequipItem = (
  characterId: string,
  username: string,
  itemName: string,
  signal?: AbortSignal,
) =>
  apiCall<Character>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/unequip`,
    { method: 'POST', json: { username, item_name: itemName }, signal },
  );

/** Structured character sheet (ST-054–058). Distinct from getCharacter, which
 *  returns the cmd_sheet display string. */
export const getCharacterSheet = (
  characterId: string,
  username: string,
  signal?: AbortSignal,
) =>
  apiCall<{ character: CharacterSheet }>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/sheet?username=${encodeURIComponent(username)}`,
    { method: 'GET', signal },
  ).then((d) => d.character);

// NOTE: bridge route pending — wired in Sprint 6 (ST-057).
export const getInventory = (
  characterId: string,
  username: string,
  signal?: AbortSignal,
) =>
  apiCall<Inventory>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/inventory?username=${encodeURIComponent(username)}`,
    { method: 'GET', signal },
  );

/** List all of a user's characters (dashboard my-characters grid). ST-044.
 *  Returns [] on empty; callers treat a thrown ApiError as an empty/degraded state. */
export const listMyCharacters = (username: string, signal?: AbortSignal) =>
  apiCall<{ characters: Character[] }>(
    `/api/dnd/characters?username=${encodeURIComponent(username)}`,
    { method: 'GET', signal },
  ).then((d) => d.characters ?? []);

// ── Delete / restore / trash (DEL-6) ──────────────────────────────────────────
// Soft-delete is recoverable for 7 days (server retention); restore is the undo.
// Ownership is enforced server-side by `username`. The admin hard-purge is NOT
// exposed to the client — it's an engine-direct LAN op.

/** Soft-delete (trash) a character the user owns. Recoverable via restoreCharacter. */
export const deleteCharacter = (
  characterId: string,
  username: string,
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string }>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}?username=${encodeURIComponent(username)}`,
    { method: 'DELETE', signal },
  );

/** Restore a trashed character the user owns (the undo for deleteCharacter). */
export const restoreCharacter = (
  characterId: string,
  username: string,
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string }>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/restore`,
    { method: 'POST', json: { username }, signal },
  );

/** A user's trashed characters (the restore view). Returns [] on empty/degraded. */
export const listTrashedCharacters = (username: string, signal?: AbortSignal) =>
  apiCall<{ characters: Character[] }>(
    `/api/dnd/characters/trash?username=${encodeURIComponent(username)}`,
    { method: 'GET', signal },
  ).then((d) => d.characters ?? []);

// ── Sessions ────────────────────────────────────────────────────────────────

/**
 * List sessions for the lobby/dashboard (newest first). ST-033 / ST-041.
 * `username` restricts to sessions the user participates in; `status` is a
 * comma-separated filter (engine default: active,paused).
 * Returns [] on an empty list. Callers handle a thrown ApiError (e.g. the
 * backend route not yet deployed → 404) as an empty/degraded state.
 */
export const listSessions = (
  opts?: { username?: string; status?: string },
  signal?: AbortSignal,
) => {
  const q = new URLSearchParams();
  if (opts?.username) q.set('username', opts.username);
  if (opts?.status) q.set('status', opts.status);
  const qs = q.toString();
  return apiCall<{ sessions: Session[] }>(
    `/api/dnd/sessions${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal },
  ).then((d) => d.sessions ?? []);
};

/** Get a single session by id (dashboard resume / detail). ST-041. */
export const getSession = (sessionId: string, signal?: AbortSignal) =>
  apiCall<{ session: Session }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'GET', signal },
  ).then((d) => d.session);

/** Party roster for the play screen (ST-061): members + their character HP/AC.
 *  Returns [] on an empty/degraded roster (callers treat a thrown ApiError so). */
export const getParticipants = (sessionId: string, signal?: AbortSignal) =>
  apiCall<{ participants: Participant[] }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/participants`,
    { method: 'GET', signal },
  ).then((d) => d.participants ?? []);

export const startSession = (req: SessionStartRequest, signal?: AbortSignal) =>
  apiCall<Session>('/api/dnd/sessions', { method: 'POST', json: req, signal });

/**
 * Create a session and return the structured session. ST-037.
 * The upgraded engine returns `data.session`; against the not-yet-deployed
 * backend the POST still succeeds (the session is created) but `session` is
 * absent — callers treat `null` as "created, id unknown until backend lands".
 */
export const createSession = (req: SessionStartRequest, signal?: AbortSignal) =>
  apiCall<{ message?: string; session?: Session }>('/api/dnd/sessions', {
    method: 'POST',
    json: req,
    signal,
  }).then((d) => d.session ?? null);

export const joinSession = (
  sessionId: string,
  req: SessionStartRequest,
  signal?: AbortSignal,
) =>
  apiCall<Session>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/join`,
    { method: 'POST', json: req, signal },
  );

export const pauseSession = (
  sessionId: string,
  req: SessionStartRequest,
  signal?: AbortSignal,
) =>
  apiCall<Session>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/pause`,
    { method: 'POST', json: req, signal },
  );

export const resumeSession = (
  sessionId: string,
  req: SessionStartRequest,
  signal?: AbortSignal,
) =>
  apiCall<Session>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/resume`,
    { method: 'POST', json: req, signal },
  );

export const endSession = (
  sessionId: string,
  req: SessionStartRequest,
  signal?: AbortSignal,
) =>
  apiCall<Session>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/end`,
    { method: 'POST', json: req, signal },
  );

export const awardSessionXp = (
  sessionId: string,
  req: XpAwardRequest,
  signal?: AbortSignal,
) =>
  apiCall<Session>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/xp`,
    { method: 'POST', json: req, signal },
  );

/** Soft-delete (trash) a campaign the user runs (DM). Recoverable via restoreSession. */
export const deleteSession = (
  sessionId: string,
  username: string,
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}?username=${encodeURIComponent(username)}`,
    { method: 'DELETE', signal },
  );

/** Restore a trashed campaign the user runs (the undo for deleteSession). */
export const restoreSession = (
  sessionId: string,
  username: string,
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/restore`,
    { method: 'POST', json: { username }, signal },
  );

// ── Combat ──────────────────────────────────────────────────────────────────

/** Start a combat encounter for a session (ST-064). Returns the new combat_id. */
export const startCombat = (req: CombatStartRequest, signal?: AbortSignal) =>
  apiCall<CombatMessageResult>('/api/dnd/combat/start', {
    method: 'POST',
    json: req,
    signal,
  });

/** Spawn monsters into an active combat (ST-064). */
export const spawnMonster = (req: CombatSpawnRequest, signal?: AbortSignal) =>
  apiCall<CombatMessageResult>('/api/dnd/combat/spawn', {
    method: 'POST',
    json: req,
    signal,
  });

/** Roll initiative + order the turn track (ST-064). */
export const rollInitiative = (req: CombatInitiativeRequest, signal?: AbortSignal) =>
  apiCall<CombatMessageResult>('/api/dnd/combat/initiative', {
    method: 'POST',
    json: req,
    signal,
  });

/** Drive the current monster's turn (ST-064). */
export const monsterTurn = (req: CombatMonsterTurnRequest, signal?: AbortSignal) =>
  apiCall<CombatMessageResult>('/api/dnd/combat/monster-turn', {
    method: 'POST',
    json: req,
    signal,
  });

// NOTE: the engine returns chat-formatted strings (data.message / data.status),
// NOT the aspirational structured CombatStatus. These wrappers therefore resolve
// to CombatMessageResult; the play screen renders the strings into the chat log.
export const attack = (
  req: Required<Pick<CombatActionRequest, 'username' | 'combat_id' | 'target'>>,
  signal?: AbortSignal,
) =>
  apiCall<CombatMessageResult>('/api/dnd/combat/attack', {
    method: 'POST',
    json: req,
    signal,
  });

export const dodge = (req: CombatActionRequest, signal?: AbortSignal) =>
  apiCall<CombatMessageResult>('/api/dnd/combat/dodge', {
    method: 'POST',
    json: req,
    signal,
  });

export const dash = (req: CombatActionRequest, signal?: AbortSignal) =>
  apiCall<CombatMessageResult>('/api/dnd/combat/dash', {
    method: 'POST',
    json: req,
    signal,
  });

export const endTurn = (req: CombatActionRequest, signal?: AbortSignal) =>
  apiCall<CombatMessageResult>('/api/dnd/combat/endturn', {
    method: 'POST',
    json: req,
    signal,
  });

export const getCombatStatus = (sessionId: string, signal?: AbortSignal) =>
  apiCall<CombatMessageResult>(
    `/api/dnd/combat/${encodeURIComponent(sessionId)}/status`,
    { method: 'GET', signal },
  );

export const castSpell = (req: SpellCastRequest, signal?: AbortSignal) =>
  apiCall<CombatMessageResult>('/api/dnd/spells/cast', {
    method: 'POST',
    json: req,
    signal,
  });

// ── Catalog (S2.4) ────────────────────────────────────────────────────────────

export interface CatalogOpts {
  /** Content type filter: 'race' | 'class' | 'background' | ... */
  type?: string;
  /** Comma-separated content-pack slugs. */
  packs?: string;
  /** Filter by owning user (homebrew). */
  user?: string;
  limit?: number;
  offset?: number;
}

/**
 * Fetch catalog items from GET /api/dnd/catalog.
 * Pass `type` to get a typed list; omit it for summary counts.
 * Throws ApiError on failure — callers must handle the degraded state.
 */
export const getCatalog = (
  system: string,
  opts: CatalogOpts = {},
  signal?: AbortSignal,
): Promise<CatalogResponse> => {
  const q = new URLSearchParams({ system });
  if (opts.type) q.set('type', opts.type);
  if (opts.packs) q.set('packs', opts.packs);
  if (opts.user) q.set('user', opts.user);
  if (opts.limit != null) q.set('limit', String(opts.limit));
  if (opts.offset != null) q.set('offset', String(opts.offset));
  return apiCall<CatalogResponse>(`/api/dnd/catalog?${q.toString()}`, {
    method: 'GET',
    signal,
  });
};

/** List available game systems from GET /api/dnd/systems. */
export const getSystems = (signal?: AbortSignal) =>
  apiCall<{ systems: GameSystem[] }>('/api/dnd/systems', {
    method: 'GET',
    signal,
  }).then((d) => d.systems ?? []);

/** Get a system's full definition from GET /api/dnd/systems/:id/definition. */
export const getSystemDefinition = (
  systemId: string,
  signal?: AbortSignal,
) =>
  apiCall<{ system: SystemDefinition }>(
    `/api/dnd/systems/${encodeURIComponent(systemId)}/definition`,
    { method: 'GET', signal },
  ).then((d) => d.system);
