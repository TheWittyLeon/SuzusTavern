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

// ── Sessions ────────────────────────────────────────────────────────────────

export const startSession = (req: SessionStartRequest, signal?: AbortSignal) =>
  apiCall<Session>('/api/dnd/sessions', { method: 'POST', json: req, signal });

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
