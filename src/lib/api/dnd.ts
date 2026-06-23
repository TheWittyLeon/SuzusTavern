// src/lib/api/dnd.ts
//
// Typed wrappers for the DnD proxy at /api/dnd/*.
// Method + path taken verbatim from the NekoNova bridge files.
import { apiCall } from './client';
import type {
  AdvanceSceneRequest,
  AdvanceSceneResult,
  CatalogResponse,
  Character,
  CharacterCreateRequest,
  CharacterCreated,
  CharacterSheet,
  CombatActionRequest,
  CombatFromSceneRequest,
  CombatFromSceneResult,
  CombatInitiativeRequest,
  CombatMessageResult,
  CombatMonsterTurnRequest,
  CombatSpawnRequest,
  CombatStartRequest,
  CombatState,
  EndCombatRequest,
  EndCombatResult,
  EngineSessionEvent,
  GameSystem,
  GroundingData,
  Inventory,
  Participant,
  Session,
  SessionEvent,
  SessionStartRequest,
  SetFlagRequest,
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

/**
 * Recent session events for the "previously on" recap (S3.6 / ST-079).
 *
 * The engine returns `{ data: { events: [ { seq, kind, actor, visibility, data,
 * created_at } ] } }`. We adapt the wire shape → SessionEvent so buildRecap is
 * unaffected: kind → event_type, data.description|data.text → description.
 * 404 / network errors → [] (recap must never break the screen).
 */
export const getSessionEvents = (sessionId: string, signal?: AbortSignal) =>
  apiCall<{ events: EngineSessionEvent[] }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/events`,
    { method: 'GET', signal },
  )
    .then((d): SessionEvent[] =>
      (d.events ?? []).map((e) => ({
        event_id: e.seq != null ? String(e.seq) : undefined,
        event_type: e.kind,
        actor: e.actor,
        // Prefer an explicit description key; fall back to a `text` key for
        // narration events where the payload stores the prose there.
        description:
          (e.data?.['description'] as string | undefined) ??
          (e.data?.['text'] as string | undefined),
        created_at: e.created_at,
      })),
    )
    .catch(() => [] as SessionEvent[]);

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
/**
 * Attack in combat. Accepts either `target` (name, bot path — backward-compat)
 * or `target_id` (explicit participant_id, preferred Tavern path; engine takes
 * target_id over target when both are supplied). Throws ApiError on 400 with
 * data.reason set (e.g. 'not_your_turn', 'target_down') — callers should surface
 * the reason to the user and refresh from the error body's data.state.
 */
export const attack = (
  req: Pick<CombatActionRequest, 'username' | 'combat_id'> &
    ({ target: string; target_id?: string } | { target?: string; target_id: string }),
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

/**
 * Start combat from the current scene's authored encounter (ADV-6).
 * The engine resolves the session → campaign → adventure → current scene and
 * spawns the scene's monsters. Returns the new combat_id + monster roster.
 *
 * Throws ApiError with status 400 when no encounter is defined for the current
 * scene (freeform session, or a scene that has no encounter block). Callers must
 * handle this gracefully — it is an expected, non-crash condition.
 */
export const combatFromScene = (
  req: CombatFromSceneRequest,
  signal?: AbortSignal,
) =>
  apiCall<CombatFromSceneResult>('/api/dnd/combat/from-scene', {
    method: 'POST',
    json: req,
    signal,
  });

export const getCombatStatus = (sessionId: string, signal?: AbortSignal) =>
  apiCall<CombatMessageResult>(
    `/api/dnd/combat/${encodeURIComponent(sessionId)}/status`,
    { method: 'GET', signal },
  );

/**
 * Fetch the current structured combat state (CUI-10 / ADV-7/8).
 * Poll target: GET /api/dnd/combat/{combatId}/state.
 * Returns the CombatState projection — pure read, no side-effects.
 * Throws ApiError 404 when the combat_id is unknown.
 */
export const getCombatState = (combatId: string, signal?: AbortSignal) =>
  apiCall<CombatState>(
    `/api/dnd/combat/${encodeURIComponent(combatId)}/state`,
    { method: 'GET', signal },
  );

/**
 * Explicitly close a combat (CUI-13 / ADV-8).
 * POST /api/dnd/combat/{combatId}/end
 * Triggers finalize_combat on the engine (clears active_combat_id, runs ADV-8 hook).
 * Optional outcome override for retreat/flee/parley (DM-driven).
 */
export const endCombat = (combatId: string, req: EndCombatRequest, signal?: AbortSignal) =>
  apiCall<EndCombatResult>(
    `/api/dnd/combat/${encodeURIComponent(combatId)}/end`,
    { method: 'POST', json: req, signal },
  );

/**
 * Advance the session to a new scene (ADV-7T).
 * POST /api/dnd/sessions/{sessionId}/advance
 * 503 when msm is off; 400 freeform_session / unknown_scene.
 */
export const advanceScene = (
  sessionId: string,
  req: AdvanceSceneRequest,
  signal?: AbortSignal,
) =>
  apiCall<AdvanceSceneResult>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/advance`,
    { method: 'POST', json: req, signal },
  );

/**
 * Set a flag in the session's progress (ADV-7T).
 * POST /api/dnd/sessions/{sessionId}/flag
 * 503 when msm is off; 400 freeform_session.
 */
export const setFlag = (sessionId: string, req: SetFlagRequest, signal?: AbortSignal) =>
  apiCall<{ flag: string; value: unknown }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/flag`,
    { method: 'POST', json: req, signal },
  );

/**
 * Normalize the engine's nested grounding payload into the flat GroundingData
 * the play screen consumes. The engine returns `current_scene.{id,title,
 * boxed_text,transitions}` and `campaign.progress.{flags,encounter_state}`;
 * the UI reads `scene_id/scene_name/transitions/flags/encounter_state`.
 */
const normalizeGrounding = (raw: unknown): GroundingData | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const scene = (r.current_scene ?? {}) as Record<string, any>;
  const progress = ((r.campaign ?? {}).progress ?? {}) as Record<string, any>;
  return {
    ...r,
    scene_id: scene.id,
    scene_name: scene.title,
    boxed_text: scene.boxed_text,
    transitions: Array.isArray(scene.transitions) ? scene.transitions : [],
    flags: progress.flags ?? {},
    encounter_state: progress.encounter_state ?? {},
  };
};

/**
 * Fetch session grounding data (ADV-5): current scene, boxed text, transitions.
 * GET /api/dnd/sessions/{sessionId}/grounding
 * Returns null gracefully when the backend route is not yet deployed.
 */
export const getGrounding = (sessionId: string, signal?: AbortSignal) =>
  apiCall<unknown>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/grounding`,
    { method: 'GET', signal },
  )
    .then(normalizeGrounding)
    .catch(() => null as GroundingData | null);

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
