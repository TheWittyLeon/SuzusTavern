// src/lib/api/dnd.ts
//
// Typed wrappers for the DnD proxy at /api/dnd/*.
// Method + path taken verbatim from the NekoNova bridge files.
import { apiCall } from './client';
import type {
  AdvanceSceneRequest,
  AdvanceSceneResult,
  BindCharacterRequest,
  BindCharacterResult,
  CatalogCounts,
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
  NpcActionRequest,
  NpcActionResult,
  OpeningLine,
  OverrideResult,
  Participant,
  ResolveCheckRequest,
  ResolveCheckResult,
  SceneCheck,
  Session,
  SessionEvent,
  SessionPolicyRequest,
  SessionPolicyResult,
  SessionStartRequest,
  SetFlagRequest,
  SpellCastRequest,
  SubmitOverrideRequest,
  SystemDefinition,
  WriteSessionEventRequest,
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

/**
 * DDX-10: level up a character (mechanical only — HP, hit dice, caster spell
 * slots, and the new class-feature NAME list; no ASI/subclass choice UI yet,
 * see the DDX-14/15 seam note on LevelUpButton).
 * POST /api/dnd/characters/{id}/levelup
 *
 * Contract fix (same bug class as DDX-25's session-control wrappers): the
 * engine's levelup_character route (NekoNova-DnDEngine routes/characters.py)
 * always `return _ok({"message": result})` on success — the wire payload is
 * `{message: string}`, never a Character. The pre-existing `apiCall<Character>`
 * annotation was aspirational (zero UI call sites before DDX-10, so it was
 * never exercised) and wrong; fixed here. Callers MUST refetch via
 * getCharacterSheet to observe the new level/HP/slots/features — the engine
 * is the source of truth, never this response.
 *
 * Also note: the engine's "not enough XP" refusal is ALSO a 200/`_ok` (the
 * message text just says so) — routes/characters.py's `_classify()` only
 * flags a handful of fixed prefixes as errors, and that refusal string isn't
 * one of them. This resolving is therefore NOT proof a level-up happened;
 * callers must confirm the level actually incremented on the refetched sheet.
 */
export const levelUpCharacter = (
  characterId: string,
  username: string,
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string }>(
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
    // FIX-4: return null on error (sentinel) so checkShouldOpen can
    // distinguish "no events" from "engine unreachable → don't open".
    .catch(() => null as SessionEvent[] | null);

/**
 * PLAY-PERSIST §6.1 — raw session events reader (rehydration).
 *
 * Unlike getSessionEvents (which flattens to the recap-shaped SessionEvent and
 * DROPS `data`), this returns the RAW engine event shape — `seq`, `kind`,
 * `actor`, `visibility`, `data`, `created_at` all intact — so the play screen
 * can rebuild real LogRow content (player_action/narration/dm_narration/etc.)
 * on mount. Do NOT reuse/modify getSessionEvents — the recap feature depends
 * on its current flattened shape.
 *
 * Returns null on error (engine unreachable) — same resilient sentinel
 * convention as getSessionEvents. Callers must treat null as "skip
 * rehydration, render what we have" rather than crash.
 */
export const getSessionEventsRaw = (sessionId: string, signal?: AbortSignal) =>
  apiCall<{ events: EngineSessionEvent[] }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/events`,
    { method: 'GET', signal },
  )
    .then((d) => d.events ?? [])
    .catch(() => null as EngineSessionEvent[] | null);

/**
 * A1 — Write a durable session event via the proxy passthrough.
 * POST /api/dnd/sessions/{id}/events → engine POST /sessions/{id}/events.
 * Engine enforces a kind allowlist (currently just 'opening_narrated').
 * Tolerate-failure: callers should .catch(() => {}) — a failed write is
 * non-fatal; the gate will re-check on the next mount and retry the opening.
 */
export const postSessionEvent = (
  sessionId: string,
  req: WriteSessionEventRequest,
  signal?: AbortSignal,
) =>
  apiCall<{ seq?: number; kind?: string; created_at?: string }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/events`,
    { method: 'POST', json: req, signal },
  );

// DDX-25 R2: DEAD code (zero production call sites — only exercised directly
// by the api-dnd unit test) but retyped anyway for the same reason as
// pauseSession/resumeSession/endSession/awardSessionXp below: the engine's
// POST /sessions route resolves to `{message, session?}`, never a bare
// Session — apiCall<Session> was never accurate to the wire shape.
export const startSession = (req: SessionStartRequest, signal?: AbortSignal) =>
  apiCall<{ message?: string; session?: Session }>('/api/dnd/sessions', {
    method: 'POST',
    json: req,
    signal,
  });

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

// DDX-25 R2: LIVE at lobby/page.tsx (fire-and-forget — the resolved value is
// never read there), but retyped for the same reason as startSession above:
// the engine's POST /sessions/{id}/join route resolves to `{message,
// session?}`, never a bare Session.
export const joinSession = (
  sessionId: string,
  req: SessionStartRequest,
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string; session?: Session }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/join`,
    { method: 'POST', json: req, signal },
  );

/**
 * DDX-25: pause/resume/end/xp all wrap a chat-command string result as
 * `_ok({"message": result})` engine-side (NekoNova-DnDEngine routes/sessions.py
 * pause_session/resume_session/end_session/award_xp all `return _ok({"message":
 * result})`) — the wire payload is `{message: string}`, never a Session. The
 * `apiCall<Session>` annotation these four had before was aspirational, not
 * accurate to the engine. Callers must GET /sessions/{id} again to observe the
 * post-action status/xp_pool (see the play page's session-controls handlers).
 */
export const pauseSession = (
  sessionId: string,
  req: SessionStartRequest,
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/pause`,
    { method: 'POST', json: req, signal },
  );

export const resumeSession = (
  sessionId: string,
  req: SessionStartRequest,
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/resume`,
    { method: 'POST', json: req, signal },
  );

export const endSession = (
  sessionId: string,
  req: SessionStartRequest,
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/end`,
    { method: 'POST', json: req, signal },
  );

export const awardSessionXp = (
  sessionId: string,
  req: XpAwardRequest,
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string }>(
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

/**
 * B2 — Re-bind: set (or clear) the caller's bound character on a session.
 * POST /api/dnd/sessions/{sessionId}/bind
 *
 * The Tavern BFF enforces self-vs-DM: callers may only bind for their own
 * username unless they are the session's DM. The engine additionally enforces
 * character ownership (you cannot bind a character you don't own).
 *
 * Throws ApiError on:
 *   403 — forbidden_other_user (proxy: non-DM tried to bind for another user)
 *   400 — not_a_member | not_your_character | unknown_character (engine)
 *   503 — msm_disabled (engine: msm flag is off)
 */
export const bindCharacter = (
  sessionId: string,
  req: BindCharacterRequest,
  signal?: AbortSignal,
) =>
  apiCall<BindCharacterResult>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/bind`,
    { method: 'POST', json: req, signal },
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
  apiCall<CombatState | { state: CombatState }>(
    `/api/dnd/combat/${encodeURIComponent(combatId)}/state`,
    { method: 'GET', signal },
  ).then((d) => {
    // The engine's pure-projection route nests the CombatState under data.state
    // (same convention as the mutating routes' data.state). Unwrap it; tolerate a
    // bare CombatState too so the client is robust to either shape.
    const nested = (d as { state?: CombatState })?.state;
    return (nested ?? d) as CombatState;
  });

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
 * P1-PLAYFIX §3.3.1/3.3.3 — resolve an authored skill check (Ship 2 / S2.4).
 * POST /api/dnd/sessions/{sessionId}/check
 *
 * Mirrors advanceScene exactly: same fetch pattern (apiCall), same cookie-BFF
 * auth path, same error handling, same `/api/dnd/sessions/{id}/…` route
 * convention. The engine resolves the DC + skill match against the current
 * scene's authored checks — the client only names which skill is attempted.
 *
 * After a check resolves, the CLIENT MUST call refreshGrounding() — the
 * engine may have set a flag and/or auto-advanced the scene; the new state is
 * learned from the refreshed grounding, never from this response.
 *
 * Throws ApiError on:
 *   400 reason='no_such_check'    — the current scene has no check for that skill
 *   400 reason='freeform_session' — no authored adventure on this session
 *   503                            — msm flag is off
 */
export const resolveCheck = (
  sessionId: string,
  req: ResolveCheckRequest,
  signal?: AbortSignal,
) =>
  apiCall<ResolveCheckResult>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/check`,
    { method: 'POST', json: req, signal },
  );

/**
 * Normalize the engine's nested grounding payload into the flat GroundingData
 * the play screen consumes. The engine returns `current_scene.{id,title,
 * boxed_text,objective,transitions,checks}`, `adventure.{title,hook}`, and
 * `campaign.progress.{flags,encounter_state}`; the UI reads the flat shape.
 *
 * A1: exposes `hook` (adventure.hook), `adventure_title` (adventure.title),
 *     and `objective` (current_scene.objective) so the opening beat and scene
 *     card have them without a second round-trip.
 * P1-PLAYFIX §3.4: exposes `checks` (current_scene.checks) stripped down to
 *     {skill, dc, note} — see the `checks:` mapping below.
 */
const normalizeGrounding = (raw: unknown): GroundingData | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const scene = (r.current_scene ?? {}) as Record<string, any>;
  // r is already `any`, so r.adventure is `any` — derive without a new explicit
  // `any` annotation to avoid adding a net-new no-explicit-any lint error.
  const adventure = r.adventure ?? {};
  const progress = ((r.campaign ?? {}).progress ?? {}) as Record<string, any>;
  return {
    ...r,
    scene_id: scene.id,
    scene_name: scene.title,
    boxed_text: scene.boxed_text,
    objective: scene.objective,
    transitions: Array.isArray(scene.transitions) ? scene.transitions : [],
    // P1-PLAYFIX §3.4: surface only {skill, dc, note} — the authored scene may
    // (and does) carry on_success/on_failure flag names on the wire, but the
    // client type/shape never exposes them. Never spread the raw check object.
    checks: Array.isArray(scene.checks)
      ? scene.checks.map(
          // scene is already `Record<string, any>` (see the r.adventure note
          // above), so `c` is implicitly `any` here — no new explicit `any`
          // annotation needed.
          (c): SceneCheck => ({
            skill: c.skill,
            dc: c.dc,
            ...(c.note ? { note: c.note } : {}),
          }),
        )
      : [],
    flags: progress.flags ?? {},
    encounter_state: progress.encounter_state ?? {},
    // A1: adventure-level fields for opening scene
    hook: adventure.hook,
    adventure_title: adventure.title,
    // P1-READALOUD: projected NPC opening lines (engine guarantees the key is present;
    // default [] when the scene has none or the engine is pre-READALOUD).
    opening_lines: Array.isArray(scene.opening_lines)
      ? (scene.opening_lines as OpeningLine[])
      : [],
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

/**
 * S5.4: Human DM submits a combat override / fiat decision.
 * POST /api/dnd/combat/{combatId}/override
 *
 * The proxy injects dm_username from the cookie — callers must NOT include it.
 * Returns {success, message, data:{applied, state, event_seq}}.
 * Throws ApiError on:
 *   400 reason='override_malformed'   — shape invalid or invariant fail
 *   400 reason='combat_not_active'    — combat.state !== ACTIVE
 *   400 reason='not_dm'               — caller is not the session DM
 *   404 reason='actor_not_found' | 'target_not_found'
 *
 * On {success:false}, the engine returns data.reason + message; do NOT apply
 * anything; keep the modal open so the DM can correct.
 */
export const submitOverride = (
  combatId: string,
  req: SubmitOverrideRequest,
  signal?: AbortSignal,
) =>
  apiCall<OverrideResult>(
    `/api/dnd/combat/${encodeURIComponent(combatId)}/override`,
    { method: 'POST', json: req, signal },
  );

/**
 * S5.4: Update a per-session policy flag (currently: dm_override_player_visible).
 * POST /api/dnd/sessions/{sessionId}/policy
 *
 * The proxy injects dm_username from the cookie. Refuses with reason='not_dm'
 * if the caller is not the session DM.
 * Returns {success, data:{session}} with the updated session row.
 */
export const setSessionPolicy = (
  sessionId: string,
  req: SessionPolicyRequest,
  signal?: AbortSignal,
) =>
  apiCall<SessionPolicyResult>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/policy`,
    { method: 'POST', json: req, signal },
  );

/**
 * S5.3: Human DM drives a monster's turn manually.
 * POST /api/dnd/combat/{combatId}/npc-action
 * The proxy injects dm_username from the cookie — callers must NOT include it.
 * Returns {success, message, data:{applied, state, turn_advanced}}.
 * Throws ApiError on 400 (not_dm, not_npc_turn, npc_incapacitated, target_required).
 */
export const npcAction = (
  combatId: string,
  req: NpcActionRequest,
  signal?: AbortSignal,
) =>
  apiCall<NpcActionResult>(
    `/api/dnd/combat/${encodeURIComponent(combatId)}/npc-action`,
    { method: 'POST', json: req, signal },
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

/**
 * Fetch per-content-type counts from GET /api/dnd/catalog (no `type` param).
 * The engine returns a distinct response shape in this mode — `{counts,
 * content_type: null}` instead of `{items, total, limit, offset}` — so this
 * is a separate typed call rather than an overload of getCatalog (DDX-21).
 * Used by the Codex rail to show per-tab counts without paging every type.
 */
export const getCatalogCounts = (
  system: string,
  opts: Pick<CatalogOpts, 'packs' | 'user'> = {},
  signal?: AbortSignal,
): Promise<CatalogCounts> => {
  const q = new URLSearchParams({ system });
  if (opts.packs) q.set('packs', opts.packs);
  if (opts.user) q.set('user', opts.user);
  return apiCall<CatalogCounts>(`/api/dnd/catalog?${q.toString()}`, {
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
