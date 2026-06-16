// src/lib/api/dnd.ts
//
// Typed wrappers for the DnD proxy at /api/dnd/*.
// Method + path taken verbatim from the NekoNova bridge files.
import { apiCall } from './client';
import type {
  Character,
  CharacterCreateRequest,
  CharacterCreated,
  CombatActionRequest,
  CombatStatus,
  Inventory,
  Session,
  SessionStartRequest,
  SpellCastRequest,
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

// ── Combat ──────────────────────────────────────────────────────────────────

export const attack = (
  req: Required<Pick<CombatActionRequest, 'username' | 'combat_id' | 'target'>>,
  signal?: AbortSignal,
) => apiCall<CombatStatus>('/api/dnd/combat/attack', { method: 'POST', json: req, signal });

export const dodge = (req: CombatActionRequest, signal?: AbortSignal) =>
  apiCall<CombatStatus>('/api/dnd/combat/dodge', { method: 'POST', json: req, signal });

export const dash = (req: CombatActionRequest, signal?: AbortSignal) =>
  apiCall<CombatStatus>('/api/dnd/combat/dash', { method: 'POST', json: req, signal });

export const endTurn = (req: CombatActionRequest, signal?: AbortSignal) =>
  apiCall<CombatStatus>('/api/dnd/combat/endturn', { method: 'POST', json: req, signal });

export const getCombatStatus = (sessionId: string, signal?: AbortSignal) =>
  apiCall<CombatStatus>(
    `/api/dnd/combat/${encodeURIComponent(sessionId)}/status`,
    { method: 'GET', signal },
  );

export const castSpell = (req: SpellCastRequest, signal?: AbortSignal) =>
  apiCall<CombatStatus>('/api/dnd/spells/cast', { method: 'POST', json: req, signal });
