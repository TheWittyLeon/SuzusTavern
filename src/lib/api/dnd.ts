// src/lib/api/dnd.ts
//
// Typed wrappers for the DnD proxy at /api/dnd/*.
// Method + path taken verbatim from the NekoNova bridge files.
import { apiCall } from './client';
import type {
  AdvanceSceneRequest,
  AdvanceSceneResult,
  ApplyConditionRequest,
  ApplyFloorResult,
  AvailableSpellsResult,
  BindCharacterRequest,
  BindCharacterResult,
  FloorApplied,
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
  EndSessionResult,
  EngineSessionEvent,
  EventsPage,
  GameSystem,
  GrantCurrencyResult,
  GroundingData,
  HpAdjustResult,
  Inventory,
  LearnSpellResult,
  LevelUpStep,
  NpcActionRequest,
  NpcActionResult,
  OpeningLine,
  OverrideResult,
  Participant,
  PrepareSpellResult,
  RebuildResult,
  ResolveCheckRequest,
  ResolveCheckResult,
  RemoveConditionRequest,
  RollRequest,
  RollResult,
  SceneCheck,
  SceneEncounterInfo,
  SceneNpc,
  SceneTransition,
  Session,
  SessionEvent,
  SessionNote,
  SessionPolicyRequest,
  SessionPolicyResult,
  SessionStartRequest,
  SetFlagRequest,
  SpellCastRequest,
  SpellListResult,
  SpellSlotsResult,
  SpendCurrencyResult,
  StartingEquipmentResult,
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
  // LEVELUP-UX: how HP gain is determined — 'roll' asks the ENGINE for an
  // authoritative 1d(hit_die) (never rolled client-side), 'average' keeps
  // the classic fixed formula. Omitted -> the engine's own default
  // (average), so pre-upgrade proxies/back ends behave exactly as before.
  hpMode?: 'roll' | 'average',
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string; levelup?: LevelUpStep | null }>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/levelup`,
    {
      method: 'POST',
      json: hpMode ? { username, hp_mode: hpMode } : { username },
      signal,
    },
  );

/**
 * T13 (DDX-14t/15t) — resolve one pending level-up choice queued by
 * levelUpCharacter (subclass archetype pick, or an Ability Score
 * Improvement — a real +2/+1+1 ability increase or a feat in its place).
 * POST /api/dnd/characters/{id}/level-choices/{choiceId}
 *
 * `selection` shape depends on the pending choice's `type` (see
 * NekoNova-DnDEngine routes/characters.py::LevelChoiceRequest +
 * engine/commands/character_msm.py::resolve_level_choice):
 *   - subclass -> {"subclass": "<slug or name>"}
 *   - asi, ability increase -> {"mode": "increase", "allocations": {"<ability>": 1|2, ...}}
 *     (every key one of the 6 full ability names; values sum to exactly 2;
 *     at most 2 distinct abilities)
 *   - asi, feat instead -> {"mode": "feat", "feat": "<slug>"}
 *
 * Same wire-shape bug class as levelUpCharacter/equipItem: the engine's
 * route always `return _ok({"message": message})` on success — never the
 * updated Character/sheet. Callers MUST refetch via getCharacterSheet to
 * observe the new subclass/class_features, ability_scores/hp/ac (CON/DEX
 * deltas recompute those), or feats list — same refetch-after-mutate
 * contract as every other mutating dnd.ts wrapper.
 *
 * Throws ApiError with `body.data.reason` on refusal — see the engine
 * route's docstring for the full set (choice_not_found, invalid_subclass,
 * already_chosen, not_owner, unsupported_choice_type, invalid_asi,
 * ability_cap_exceeded, unknown_feat, feat_prereq_unmet,
 * feat_already_taken -> 400; save_failed -> 500; not_found -> 404).
 */
export const resolveLevelChoice = (
  characterId: string,
  username: string,
  choiceId: string,
  selection: Record<string, unknown>,
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string }>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/level-choices/${encodeURIComponent(choiceId)}`,
    { method: 'POST', json: { username, selection }, signal },
  );

/**
 * T5 (DDX-09 inventory slice) — contract fix, same bug class as levelUpCharacter/
 * pauseSession/resumeSession/etc above: NekoNova-DnDEngine's equip_item/
 * unequip_item routes (routes/characters.py) both `return _ok({"message":
 * result})` where `result` is cmd_equip/cmd_unequip's plain chat-formatted
 * string — the wire payload is `{message: string}`, NEVER a Character and
 * NEVER a recomputed `ac` field (verified against the engine source; cmd_equip
 * persists the new AC to the DB as a side effect but never returns it). The
 * pre-existing `apiCall<Character>` annotations were the same kind of
 * aspirational-not-accurate typing DDX-10/DDX-25 already fixed elsewhere.
 * Callers MUST refetch via getCharacterSheet to observe the recomputed `ac`
 * and the item's new `equipped` state — never read either off this response.
 */
export const equipItem = (
  characterId: string,
  username: string,
  itemName: string,
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string }>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/equip`,
    { method: 'POST', json: { username, item_name: itemName }, signal },
  );

export const unequipItem = (
  characterId: string,
  username: string,
  itemName: string,
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string }>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/unequip`,
    { method: 'POST', json: { username, item_name: itemName }, signal },
  );

/**
 * T5 — self-service item add (DM/test command, OWNER-auth per the engine's
 * DDX-GIVE-ITEM-AUTHZ docstring: a player may mint an item onto their OWN
 * character; there is no session-scoped DM gate on this route today — see
 * the engine docstring's TRIPWIRE note to re-decide this the moment
 * multiplayer unparks). Same wire shape as equip/unequip: engine's give_item
 * route also `return _ok({"message": result})` — no recomputed inventory or
 * ac. `quantity` is accepted by the route's Pydantic model (default 1) but is
 * NOT threaded through to cmd_give_item today (engine passes only item_name;
 * add_item is always called with qty=1) — a pre-existing engine-side gap, out
 * of scope for this Tavern-only slice; the param is kept here so the wrapper
 * shape matches the real request model and starts working for free the
 * moment the engine wires it through. Callers must refetch via
 * getCharacterSheet to see the new item.
 */
export const giveItem = (
  characterId: string,
  username: string,
  itemName: string,
  quantity?: number,
  signal?: AbortSignal,
) =>
  apiCall<{ message?: string }>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/give-item`,
    {
      method: 'POST',
      json: { username, item_name: itemName, ...(quantity != null ? { quantity } : {}) },
      signal,
    },
  );

/**
 * T5 (DDX-09 HP + spell-slots slice) — adjust a character's HP.
 * POST /api/dnd/characters/{id}/hp
 * `op` is 'damage' | 'heal' | 'set_temp'; `amount` must be a non-negative
 * int (the proxy rejects a bool/NaN/non-int — callers must guard before
 * calling, see HpControl's `amountValid`). Returns the FULL post-mutation HP
 * state — current_hp/max_hp/temp_hp/is_down — so callers can update the HP
 * bar immediately without waiting on a refetch; HpControl still refetches
 * via getCharacterSheet afterward to keep every other derived sheet field
 * (e.g. conditions) in sync, mirroring InventoryPanel's
 * refetch-after-mutate convention.
 */
export const adjustHp = (
  characterId: string,
  username: string,
  op: 'damage' | 'heal' | 'set_temp',
  amount: number,
  signal?: AbortSignal,
) =>
  apiCall<HpAdjustResult>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/hp`,
    { method: 'POST', json: { username, op, amount }, signal },
  );

/**
 * T5 — spend/restore one spell slot at a given level.
 * POST /api/dnd/spells/{id}/slots/adjust
 * `level` must be a real int 1-9 (the proxy rejects bool/non-int per the
 * DDX-09 handoff) — SpellSlotsPanel only ever sends `Number(lvl)` off the
 * rendered slot-level keys, never a user-typed value, so this is enforced by
 * construction rather than a runtime guard here. Returns the updated slots
 * for the SAME shape as getSpellSlots.
 */
export const adjustSpellSlot = (
  characterId: string,
  username: string,
  level: number,
  op: 'spend' | 'restore',
  signal?: AbortSignal,
) =>
  apiCall<SpellSlotsResult>(
    `/api/dnd/spells/${encodeURIComponent(characterId)}/slots/adjust`,
    { method: 'POST', json: { username, level, op }, signal },
  );

/**
 * T12 (DDX-23t) — spend gold from the character's own purse (owner-auth).
 * POST /api/dnd/characters/{id}/currency/spend
 * No `username` in the body — unlike equip/unequip/give-item, the engine's
 * SpendCurrencyRequest takes only `amount`; ownership is proven server-side
 * by `guard_owner` against the verified actor (see the N7 proxy's
 * `spend_character_currency` doc comment, api/routes/dnd_characters.py).
 * `amount` must be a positive int — callers must guard before calling (see
 * CurrencyPurse's `amountValid`, mirroring HpControl's convention). Response
 * carries the FULL post-mutation balance so the purse can update immediately
 * without waiting on a refetch, same as adjustHp.
 */
export const spendCurrency = (
  characterId: string,
  amount: number,
  signal?: AbortSignal,
) =>
  apiCall<SpendCurrencyResult>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/currency/spend`,
    { method: 'POST', json: { amount }, signal },
  );

/**
 * 2026-07-24 Starting Equipment design — per-class + per-background SRD gear
 * packages for the creation wizard's Equipment step.
 * GET /api/dnd/starting-equipment?class=<name>&background=<name>
 *
 * Confirmed against NekoNova-DnDEngine's routes/starting_equipment.py: unknown
 * class/background resolves to an EMPTY package (`{fixed: [], choices: []}`),
 * never a 4xx — the wizard degrades to "no starting gear" for that half
 * rather than blocking creation. No character_id is required — unlike
 * getAvailableSpells, starting equipment is a pure function of class+
 * background, so this is fetchable the moment both are chosen.
 */
export const getStartingEquipment = (
  charClass: string,
  background: string,
  signal?: AbortSignal,
) =>
  apiCall<StartingEquipmentResult>(
    `/api/dnd/starting-equipment?class=${encodeURIComponent(charClass)}&background=${encodeURIComponent(background)}`,
    { method: 'GET', signal },
  );

/**
 * T4 (DDX-11t sheet Spells tab) — the character's own repertoire (cantrips +
 * known/prepared leveled spells), annotated with current castability.
 * GET /api/dnd/spells/{id}/list?username=...
 *
 * msm-only: 503 reason='msm_disabled' when SUZU_DND_MSM is off (proxy
 * forwards the engine's 503 verbatim). A non-caster gets a clean 200 with
 * `is_spellcaster:false` and empty cantrips/spells — never a 4xx.
 */
export const getKnownSpells = (
  characterId: string,
  username: string,
  signal?: AbortSignal,
) =>
  apiCall<SpellListResult>(
    `/api/dnd/spells/${encodeURIComponent(characterId)}/list?username=${encodeURIComponent(username)}`,
    { method: 'GET', signal },
  );

/**
 * T4 — the server-computed selection pool: what this character's class+level
 * may learn/prepare. GET /api/dnd/spells/{id}/available?username=...
 * `can_learn`/`can_prepare` tell the UI which affordances to offer; a
 * non-caster gets both false and empty pools, not a 4xx.
 */
export const getAvailableSpells = (
  characterId: string,
  username: string,
  signal?: AbortSignal,
) =>
  apiCall<AvailableSpellsResult>(
    `/api/dnd/spells/${encodeURIComponent(characterId)}/available?username=${encodeURIComponent(username)}`,
    { method: 'GET', signal },
  );

/**
 * T4 — add a spell to the repertoire (known casters + wizard spellbook +
 * cantrips for any caster). POST /api/dnd/spells/{id}/learn.
 * Count-enforced server-side (over_known_limit / over_cantrip_limit /
 * over_spellbook_limit / not_on_class_list / already_known / etc — the
 * engine owns every rule; this wrapper only shapes the request). `source`
 * defaults to 'class' engine-side when omitted.
 * Throws ApiError on refusal (400/404/500 per the engine's reason code,
 * carried in `err.body.data.reason` — apiCall throws whenever the envelope
 * is {success:false}, so a resolved promise here IS a real success).
 *
 * `prepared` (Slice B Fix 3, optional): overrides the engine's computed
 * `prepared` flag on the new repertoire row. Only sent when defined —
 * omitting it preserves the engine's default computed behavior (a wizard's
 * leveled spellbook entry starts un-prepared). Used by the character-
 * creation picker to pass `true` for a wizard's picked leveled spells so
 * picked == prepared (castable under DND_ENFORCE_SPELL_KNOWN).
 */
export const learnSpell = (
  characterId: string,
  username: string,
  slug: string,
  source?: string,
  signal?: AbortSignal,
  prepared?: boolean,
) =>
  apiCall<LearnSpellResult>(
    `/api/dnd/spells/${encodeURIComponent(characterId)}/learn`,
    {
      method: 'POST',
      json: {
        username,
        slug,
        ...(source ? { source } : {}),
        ...(prepared !== undefined ? { prepared } : {}),
      },
      signal,
    },
  );

/**
 * T4 — toggle preparation for a prepared/spellbook caster's spell.
 * POST /api/dnd/spells/{id}/prepare. Count-enforced only when preparing
 * (unpreparing can only shrink the prepared count). Refused with
 * 'cannot_prepare_cantrip' for a cantrip slug, 'not_a_prepared_caster' for a
 * 'known'-kind caster — the engine owns these rules; this wrapper only wires
 * the hop.
 */
export const prepareSpell = (
  characterId: string,
  username: string,
  slug: string,
  prepared: boolean,
  signal?: AbortSignal,
) =>
  apiCall<PrepareSpellResult>(
    `/api/dnd/spells/${encodeURIComponent(characterId)}/prepare`,
    { method: 'POST', json: { username, slug, prepared }, signal },
  );

/**
 * LVLDN — remove a learned spell from the repertoire (the inverse of
 * learnSpell; only learned rows — the engine refuses innate/subclass grants
 * with 'innate_spell'). Forgetting frees the count-enforced budget slot, so
 * forget-then-learn is the respec path after a rebuild. Throws ApiError with
 * body.data.reason: not_known / unknown_spell / innate_spell -> 400;
 * unknown_character -> 404; save_failed -> 500.
 */
export const forgetSpell = (
  characterId: string,
  username: string,
  slug: string,
  signal?: AbortSignal,
) =>
  apiCall<{ forgotten: string }>(
    `/api/dnd/spells/${encodeURIComponent(characterId)}/forget`,
    { method: 'POST', json: { username, slug }, signal },
  );

/**
 * LVLDN — level down / reset a WORKSHOP (unbound) character: the engine
 * rebuilds the build at target_level from creation identity and re-climbs
 * (choices re-queue, HP becomes the average, recorded ASI increases are
 * subtracted; gear/gold/spells survive). Refetch-after-mutate applies — the
 * caller MUST getCharacterSheet afterwards. Throws ApiError with
 * body.data.reason: invalid_target_level / bound_to_campaign /
 * creation_scores_unavailable / asi_history_incomplete / rebuild_failed ->
 * 400; not_found -> 404; save_failed / walk_incomplete -> 500
 * (walk_incomplete leaves a coherent lower-level build — the workshop
 * Level-up button finishes the climb).
 */
export const rebuildCharacter = (
  characterId: string,
  username: string,
  targetLevel: number,
  signal?: AbortSignal,
) =>
  apiCall<RebuildResult>(
    `/api/dnd/characters/${encodeURIComponent(characterId)}/rebuild`,
    { method: 'POST', json: { username, target_level: targetLevel }, signal },
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
 * DDX-20 — cursor-paged session events read (flag-ON durable-generation poll
 * only; see DURABLE_GENERATION_ENABLED, src/lib/config.ts).
 * GET /api/dnd/sessions/{id}/events?since_seq={n}
 *
 * Unlike getSessionEventsRaw/getSessionEvents (which swallow errors to a
 * null/[] sentinel), this THROWS on failure — the flag-ON poll tick already
 * wraps its call in a try/catch that treats poll errors as non-fatal
 * (matching the existing dice-roll poll's own convention), so a bespoke
 * silent-degrade sentinel here would just be redundant, not safer.
 *
 * `apiCall` unwraps the engine's `{success, data}` envelope, so this
 * resolves directly to `{events, max_seq, has_more, pending_generation}`
 * (Technical Design §2.2) — no further unwrapping needed by callers.
 */
export const getSessionEventsPage = (
  sessionId: string,
  sinceSeq = 0,
  signal?: AbortSignal,
) =>
  apiCall<EventsPage>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/events?since_seq=${encodeURIComponent(String(sinceSeq))}`,
    { method: 'GET', signal },
  );

/**
 * DDX-22 Phase 3 — read the caller's OWN private note for this session.
 *
 * GET /api/dnd/sessions/{id}/notes → proxy → engine (RLS owner-scoped:
 * the row returned is exclusively the verified actor's own; identity is the
 * session cookie, NOT a client-suppliable username). The engine wraps the row
 * as `data: { note: { body, updated_at } | null }`; we unwrap to
 * `SessionNote | null` (null = no note saved yet). Unlike getSessionEventsRaw,
 * this does NOT swallow errors — the JournalPane needs to distinguish "no note
 * yet" (null) from "load failed" (thrown ApiError) to render the right state
 * and avoid clobbering a real note with an empty autosave.
 */
export const getSessionNotes = (sessionId: string, signal?: AbortSignal) =>
  apiCall<{ note: SessionNote | null }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/notes`,
    { method: 'GET', signal },
  ).then((d) => d.note ?? null);

/**
 * DDX-22 Phase 3 — create/update the caller's OWN private note (autosave).
 *
 * PUT /api/dnd/sessions/{id}/notes with `{ body }` → proxy → engine upsert
 * (written as the verified actor's owner row under RLS). No username argument:
 * ownership is the cookie actor, never client-asserted. The engine owns
 * validation (16 KB byte cap → 400 body_too_large; NUL byte → 400 body_invalid;
 * membership guard → 404 not_found), all surfaced as a thrown ApiError whose
 * `code` carries the engine `reason`. Returns the saved note with the
 * server-stamped `updated_at`.
 */
export const putSessionNotes = (
  sessionId: string,
  body: string,
  signal?: AbortSignal,
) =>
  apiCall<{ note: SessionNote }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/notes`,
    { method: 'PUT', json: { body }, signal },
  ).then((d) => d.note);

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

/**
 * DDX-26 — raise the X-card: a durable, cross-client safety signal.
 * POST /api/dnd/sessions/{id}/x-card — empty body; the engine stamps the
 * raiser from the verified actor (same cookie-BFF identity convention as
 * every other mutating session route — callers must NOT send a username).
 * Persists an `x_card` session event (seq/actor/created_at) that every open
 * client observes via the existing events poll (getSessionEventsRaw) — there
 * is no bespoke read path for this feature, and no new poll is introduced.
 *
 * Anonymous-to-players / DM-sees-raiser is a CLIENT-side render decision (see
 * the play screen's isDm gate) — the engine always records the true raiser
 * in `actor` here; the client simply chooses who it shows that field to.
 *
 * Wire shape (Kage IMPORTANT-1): the engine returns the event NESTED —
 * `_ok({"event": {seq, kind, actor, created_at, visibility}})` — and the BFF
 * passes it through verbatim, so this resolves to `{ event: {...} }`, never a
 * flat `{seq, kind, actor, created_at}`. Do NOT flatten this on a future edit;
 * callers must read `result?.event?.seq` / `result?.event?.actor`.
 */
export const postXCard = (sessionId: string, signal?: AbortSignal) =>
  apiCall<{
    event?: {
      seq: number;
      kind: string;
      actor: string | null;
      created_at?: string;
      visibility?: string;
    };
  }>(`/api/dnd/sessions/${encodeURIComponent(sessionId)}/x-card`, {
    method: 'POST',
    signal,
  });

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

/**
 * LVL-1: createSession's full-payload sibling. Same POST, but keeps the
 * response's `floor_applied` echo (non-null when the creator's bound
 * character was auto-leveled to the table's starting_level at create time)
 * alongside the session. `createSession` above has NO production callers
 * left (Kage m11 — modules/StarterForm was the only one and now uses this);
 * it is kept solely for its pinned wire contract in api-dnd.test.ts
 * (session-or-null, the pre-upgrade-backend null case) until a caller needs
 * it again or a cleanup pass removes both together.
 */
export const createSessionFull = (req: SessionStartRequest, signal?: AbortSignal) =>
  apiCall<{
    message?: string;
    session?: Session;
    character_bind?: string | null;
    floor_applied?: FloorApplied | null;
  }>('/api/dnd/sessions', {
    method: 'POST',
    json: req,
    signal,
  }).then((d) => ({
    session: d.session ?? null,
    floor_applied: d.floor_applied ?? null,
  }));

// DDX-25 R2: LIVE at lobby/page.tsx (fire-and-forget — the resolved value is
// never read there), but retyped for the same reason as startSession above:
// the engine's POST /sessions/{id}/join route resolves to `{message,
// session?}`, never a bare Session.
export const joinSession = (
  sessionId: string,
  req: SessionStartRequest,
  signal?: AbortSignal,
) =>
  apiCall<{
    message?: string;
    session?: Session;
    /** LVL-1: non-null when this join auto-leveled the joiner's character to
     *  the campaign's starting_level floor — drives the lobby's
     *  "auto-leveled to match the table" toast (Aoi gap C). */
    floor_applied?: FloorApplied | null;
  }>(
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
  apiCall<EndSessionResult>(
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

/**
 * T12 (DDX-23t) — DM grants gold to a character seated at this session.
 * POST /api/dnd/sessions/{sessionId}/grant-currency
 * No `username` field — DM identity is proven server-side by `guard_dm`
 * against the verified actor (see the N7 proxy's `grant_session_currency`
 * doc comment, api/routes/dnd_sessions.py); the target is named explicitly
 * via `character_id`. `gold` must be a positive int — callers must guard
 * before calling (mirrors spendCurrency's convention). Response carries the
 * FULL post-grant balance of the TARGET character, not the caller's own.
 */
export const grantCurrency = (
  sessionId: string,
  characterId: string,
  gold: number,
  signal?: AbortSignal,
) =>
  apiCall<GrantCurrencyResult>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/grant-currency`,
    { method: 'POST', json: { character_id: characterId, gold }, signal },
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
 * LVL-1 (FR-1/FR-8) — DM sets the campaign's starting-level floor.
 * POST /api/dnd/sessions/{sessionId}/starting-level
 *
 * NEVER applies the floor (D3 — a different URL owns that): existing
 * members catch up lazily at their next bind/join/re-bind (or their own
 * Level-up button), or eagerly via applyCampaignFloor below. Setting 1
 * removes the stored key (byte-identical to never-set). DM identity is
 * proven engine-side by guard_dm against the verified actor; a non-DM gets
 * a 404 (oracle-closing), never a 403.
 *
 * Refusals — status / data.reason:
 *   503 msm_disabled · 404 session_not_found · 404 not_found (guard_dm) ·
 *   400 not_dm (enforcement-off belt-and-suspenders) ·
 *   400 invalid_starting_level (not an int, or outside 1..20)
 */
export const setStartingLevel = (
  sessionId: string,
  username: string,
  startingLevel: number,
  signal?: AbortSignal,
) =>
  apiCall<{ starting_level: number; previous_starting_level: number }>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/starting-level`,
    { method: 'POST', json: { username, starting_level: startingLevel }, signal },
  );

/**
 * LVL-1 (FR-9) — DM's explicit "Apply floor now": eagerly level every
 * current member below the campaign's starting_level.
 * POST /api/dnd/sessions/{sessionId}/apply-floor
 *
 * Idempotent + resumable — safe to re-invoke; already-caught-up members are
 * skipped and a partially-walked member resumes. Partial success is a 200
 * with a non-empty `failures` array (never a 5xx — some members WERE
 * leveled and the response says so truthfully). Worst case is
 * O(members × levels) engine-side — callers should show a busy state.
 *
 * Refusals — status / data.reason:
 *   503 msm_disabled · 404 session_not_found · 404 not_found (guard_dm) ·
 *   400 not_dm (enforcement-off) · 400 no_floor (starting_level <= 1)
 */
export const applyCampaignFloor = (
  sessionId: string,
  username: string,
  signal?: AbortSignal,
) =>
  apiCall<ApplyFloorResult>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/apply-floor`,
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

/**
 * DM-only: apply a (optionally timed) condition to a combatant (DDX-17e / T7).
 * `target` must be the combatant's `name` (CombatParticipantState.name) — the
 * engine resolves by case-insensitive name match, not participant_id (see
 * ApplyConditionRequest's doc comment). Response carries the fresh CombatState
 * under `data.state` like every other mutating combat route.
 */
export const applyCondition = (req: ApplyConditionRequest, signal?: AbortSignal) =>
  apiCall<CombatMessageResult>('/api/dnd/combat/apply-condition', {
    method: 'POST',
    json: req,
    signal,
  });

/** DM-only: remove a condition (and any pending duration) from a combatant.
 *  DDX-17e / T7. Same name-based `target` resolution as applyCondition. */
export const removeCondition = (req: RemoveConditionRequest, signal?: AbortSignal) =>
  apiCall<CombatMessageResult>('/api/dnd/combat/remove-condition', {
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

/**
 * Roll a death save for your own downed PC (Combat-UX Fixes 2026-07-27, Fix B).
 * `target`/`target_id` are part of the shared `CombatActionRequest` shape but
 * should be omitted here — the engine's `cmd_deathsave` resolves the caller's
 * own downed character and rejects a target the caller doesn't own, so this
 * is an own-PC-only action, not a "roll for another member" path. (Kage-CR
 * review correction: an earlier version of this docstring claimed the engine
 * permits rolling for another downed member "in extremis" — verify against
 * the engine before relying on that claim again.)
 */
export const rollDeathSave = (req: CombatActionRequest, signal?: AbortSignal) =>
  apiCall<CombatMessageResult>('/api/dnd/combat/death-save', {
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
 * DDX-08 / T3 — server-authoritative dice roll.
 * POST /api/dnd/sessions/{sessionId}/roll (proxies to the engine's
 * POST /sessions/{id}/roll, DDX-07). The engine resolves the outcome AND
 * persists it as a `dice_roll` session event in the same call — this
 * response is a convenience echo for the caller (e.g. to auto-narrate off
 * immediately); every client (including this one) renders the roll from the
 * session-events poll, not from this response, so a roll triggered on one
 * client shows up on every other client watching the same session.
 *
 * Engine refusal reasons forwarded intact:
 *   400 reason='character_not_in_session' | 'no_bound_character'
 *   404 reason='session_not_found'
 *   503 reason='msm_disabled'
 */
export const postRoll = (
  sessionId: string,
  req: RollRequest,
  signal?: AbortSignal,
) =>
  apiCall<RollResult>(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/roll`,
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
  const r = raw as Record<string, unknown>;
  const scene = (r.current_scene ?? {}) as Record<string, unknown>;
  const adventure = (r.adventure ?? {}) as Record<string, unknown>;
  const progress = ((r.campaign as Record<string, unknown> | undefined)?.progress ?? {}) as Record<
    string,
    unknown
  >;
  return {
    ...r,
    scene_id: scene.id as string | undefined,
    scene_name: scene.title as string | undefined,
    boxed_text: scene.boxed_text as string | undefined,
    objective: scene.objective as string | undefined,
    transitions: Array.isArray(scene.transitions) ? (scene.transitions as SceneTransition[]) : [],
    // P1-PLAYFIX §3.4: surface only {skill, dc, note} — the authored scene may
    // (and does) carry on_success/on_failure flag names on the wire, but the
    // client type/shape never exposes them. Never spread the raw check object.
    // Check Retry + Fail-Forward (2026-07-28 design §6/T2): state/
    // attempts_used/max_attempts/lock_reason pass through when the engine
    // sent them (SUZU_DND_CHECK_RETRY_POLICY on); omitted entirely — not
    // even as `undefined` keys — when absent, same optional convention as
    // `note` above, so a flag-OFF server's payload round-trips unchanged.
    checks: Array.isArray(scene.checks)
      ? (scene.checks as Record<string, unknown>[]).map(
          (c): SceneCheck => ({
            skill: c.skill as string,
            dc: c.dc as number,
            ...(c.note ? { note: c.note as string } : {}),
            ...(c.state ? { state: c.state as SceneCheck['state'] } : {}),
            ...(c.attempts_used !== undefined
              ? { attempts_used: c.attempts_used as number | null }
              : {}),
            ...(c.max_attempts !== undefined
              ? { max_attempts: c.max_attempts as number | null }
              : {}),
            ...(c.lock_reason !== undefined
              ? { lock_reason: c.lock_reason as SceneCheck['lock_reason'] }
              : {}),
          }),
        )
      : [],
    flags: (progress.flags as Record<string, unknown> | undefined) ?? {},
    encounter_state: (progress.encounter_state as Record<string, unknown> | undefined) ?? {},
    // A1: adventure-level fields for opening scene
    hook: adventure.hook as string | undefined,
    adventure_title: adventure.title as string | undefined,
    // P1-READALOUD: projected NPC opening lines (engine guarantees the key is present;
    // default [] when the scene has none or the engine is pre-READALOUD).
    opening_lines: Array.isArray(scene.opening_lines)
      ? (scene.opening_lines as OpeningLine[])
      : [],
    // DDX-22: resolved current-scene NPCs (engine: current_scene.npcs_present,
    // projected via project_npc_for_wire — see engine/world_content_check.py).
    // `...r` above does NOT flatten this (it's nested under current_scene, not
    // a top-level key), so JournalPane's "NPCs met" section needs this mapped
    // field rather than reading grounding.current_scene directly. Filtered to
    // entries with a real `name` — a malformed/legacy row degrades to absent
    // rather than crashing the NPC list.
    npcs_present: Array.isArray(scene.npcs_present)
      ? (scene.npcs_present as SceneNpc[]).filter(
          (n): n is SceneNpc => !!n && typeof n.name === 'string',
        )
      : [],
    // Phase 4 (Package B) — the current scene's authored combat encounter
    // block (current_scene.encounter), when defined. `...r` above does NOT
    // flatten this (nested under current_scene, not a top-level raw key,
    // same reasoning as npcs_present just above) — mapped explicitly so
    // page.tsx's "Stand and fight" reframe can read grounding.encounter
    // directly. Defensive: anything that isn't a plain object degrades to
    // null (no authored encounter), never thrown.
    encounter:
      scene.encounter && typeof scene.encounter === 'object'
        ? (scene.encounter as SceneEncounterInfo)
        : null,
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
  /**
   * Comma-separated content-pack slugs.
   *
   * NOTE (DDX-21 SECURITY-3): on non-admin catalog paths, the BFF
   * (`src/app/api/dnd/[...path]/route.ts`) strips any client-supplied
   * `packs` query param before forwarding to the engine — this option has
   * NO effect from an ordinary (non-admin-scoped) caller. Kept for a future
   * admin-scoped caller (the strip only applies to non-admin paths), not
   * deleted — don't reach for it expecting client-side pack filtering to
   * work today.
   */
  packs?: string;
  /**
   * Filter by owning user (homebrew).
   *
   * NOTE (DDX-21 SECURITY-3): same caveat as `packs` above — stripped by the
   * BFF on non-admin paths. Inert from the client outside an admin-scoped
   * call.
   */
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
