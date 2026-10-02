/**
 * engineReasons — TAV-COMBAT-NO-ACTION-REMAINING-UNMAPPED +
 * TAV-401-ACTOR-REQUIRED-UNMAPPED (2026-08-06).
 *
 * There was ZERO test coverage of this vocabulary before this file
 * (`grep -rn no_action_remaining src/` returned nothing pre-diff).
 *
 * Two concerns, tested separately:
 *   1. CONTRACT tests — the maps' keys are pinned against a literal snapshot
 *      of the engine's own reason vocabulary (independently re-derived from
 *      NekoNova-DnDEngine source below, not copied from engineReasons.ts's
 *      own comments). If a future engine change adds/removes a reason and
 *      nobody updates the Tavern map, THIS is what goes red.
 *   2. WIRE tests — engineErrorMessage really does produce curated copy
 *      through the ACTUAL shape ProjectNekoNova's proxy sends for these two
 *      routes (api/routes/dnd_combat.py::_handle_dnd_error +
 *      core/dnd_actor.py::require_actor_or_401), built via the real
 *      `makeApiError` from src/lib/api/client.ts — not a hand-rolled shape.
 *      `message` is deliberately ABSENT: the proxy renames the engine's
 *      `message` key to `error` and forwards `data` whole, so a body carrying
 *      `message` is not something a D&D route can ever actually send. If a
 *      test here silently regressed to relying on `body.message`, it would
 *      be proving nothing about production.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { engineErrorMessage } from '@/lib/dnd/engineError';
import { makeApiError } from '@/lib/api/client';
import {
  SHARED_REASON_COPY,
  ACTION_ECONOMY_REASON_COPY,
  COMBAT_REFUSAL_REASON_MAP,
  CAST_REFUSAL_REASON_MAP,
} from '@/lib/dnd/engineReasons';

// ── Independently re-derived engine vocabulary (source of truth: grep, not engineReasons.ts) ──
//
// engine/combat.py::COMBAT_REASON_STATUS (24 keys) — verified 2026-08-06 by
// reading the dict literal directly, not this ticket's own comments.
//
// B8c-2 (2026-09-29): +9 keys, verified by reading the dict literal on
// the engine's B8b move verb at engine `main` @ `3a5d18b`
// (`engine/combat.py::COMBAT_REASON_STATUS`) — a branch name dies with its
// worktree (Kage-CR B8b-2 verify 🟢 4, 2026-09-29), a commit does not. Real
// count today (`main`, unrelated to this
// item) is actually higher still — `unknown_npc`/`npc_has_statblock`/
// `standin_tier_required`/`unknown_standin_tier`/`participant_cap`/
// `damage_apply_failed` are ALSO live on `main` but predate this list's last
// sync and are not this item's scope; flagged, not fixed, here.
//
// debt: this array is a hand-maintained client mirror of engine.combat.COMBAT_REASON_STATUS. ceiling: drifts silently whenever the engine adds a code. until: the engine publishes COMBAT_REASON_STATUS as a digest-pinned fixture (Backlog TAV-ENGINE-REASON-VOCAB-HAND-MIRROR).
const ENGINE_COMBAT_REASON_STATUS_KEYS = [
  'no_combat',
  'no_active_turn',
  'not_your_turn',
  'not_a_monsters_turn',
  'no_target',
  'attacker_not_found',
  'target_not_found',
  'participant_not_found',
  'target_down',
  'target_dead',
  'target_already_stable',
  'target_not_downed',
  'not_your_character',
  'actor_incapacitated',
  'combat_over',
  'no_action_remaining',
  'no_bonus_remaining',
  'no_reaction_remaining',
  'unknown_monster',
  'no_active_session',
  'no_participants',
  'invalid_condition',
  'db_unavailable',
  'error',
  // A9d-2 (F3 re-verify IMPORTANT-A): the DM's /monster-turn refusal, engine/combat.py::COMBAT_REASON_STATUS
  // ("monster_statblock_unresolved": 500) at engine branch `homebrew-monsters-1001` @ ca57e00.
  'monster_statblock_unresolved',
  // ── B8b move verb (design §3.4), engine/combat.py::COMBAT_REASON_STATUS ──
  'positioning_disabled',
  'no_space',
  'same_cell',
  'mover_unplaced',
  'invalid_destination',
  'no_movement_remaining',
  'unreachable',
  'position_changed',
  'destination_required',
] as const;

// engine/spells.py::SPELL_REASON_STATUS (18 keys).
const ENGINE_SPELL_REASON_STATUS_KEYS = [
  'no_combat',
  'not_found',
  'unknown_character',
  'unknown_spell',
  'not_your_turn',
  'no_active_turn',
  'invalid_slot',
  'no_slots',
  'not_prepared',
  'not_ritual',
  'target_not_found',
  'no_spell_name',
  'actor_incapacitated',
  'no_action_remaining',
  'no_bonus_remaining',
  'no_reaction_remaining',
  'error',
  'db_unavailable',
] as const;

// Emitted via a positional CombatResult(False, reason, message) tuple rather
// than the COMBAT_REASON_STATUS dict literal (engine/combat.py:4388 /
// engine/commands/combat_commands.py) — real, live emitters, just not in the
// status dict, so the route's `.get(reason, 400)` supplies the default.
const ENGINE_COMBAT_ROUTE_LEVEL_KEYS = ['target_is_self', 'not_found', 'invalid_outcome', 'victory_refused', 'msm_disabled'] as const;

// IMP-3 RESOLVED (WF-A reconciliation, 2026-08-12): `not_your_character` is a
// real, live engine key (still in COMBAT_REASON_STATUS) but is DELIBERATELY
// absent from COMBAT_REFUSAL_REASON_MAP — see the map's own inline comment.
// The engine emits it at two branches of combat_commands.py with two
// genuinely different causes (:897 named someone else's downed PC, :919 no
// downed character of your own), so no single curated string can be honest
// for both; tier 2 (the engine's own branch-specific `message`, forwarded
// verbatim since `ebdc5b2`) owns this code instead. This is the one
// deliberate exception to "the map is complete over the engine vocabulary".
const DELIBERATELY_UNCURATED_COMBAT_KEYS = new Set(['not_your_character']);

// design brief §5.1 (B8c-2, 2026-09-29): `destination_required` is a real,
// live engine key (DM path only — `npc-action move` on a boarded encounter
// with no `to`) but no Tavern surface drives `npc-action` today, so curating
// it would be an unjustified entry. Different reason from
// `DELIBERATELY_UNCURATED_COMBAT_KEYS` above (that one is ambiguous — two
// branches, two messages; this one is simply unreachable from here), same
// precedent: a real code deliberately left out of the map.
const NO_TAVERN_EMITTER_COMBAT_KEYS = new Set(['destination_required']);

describe('engineReasons — contract: map keys against the engine vocabulary', () => {
  it('COMBAT_REFUSAL_REASON_MAP covers every key in engine.combat.COMBAT_REASON_STATUS except the deliberate tier-2 and no-Tavern-emitter exceptions', () => {
    for (const key of ENGINE_COMBAT_REASON_STATUS_KEYS) {
      if (DELIBERATELY_UNCURATED_COMBAT_KEYS.has(key) || NO_TAVERN_EMITTER_COMBAT_KEYS.has(key)) continue;
      expect(COMBAT_REFUSAL_REASON_MAP).toHaveProperty(key);
      expect(typeof COMBAT_REFUSAL_REASON_MAP[key]).toBe('string');
      expect(COMBAT_REFUSAL_REASON_MAP[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('not_your_character is DELIBERATELY absent from COMBAT_REFUSAL_REASON_MAP (IMP-3) so tier 2 owns the branch-specific message', () => {
    expect(COMBAT_REFUSAL_REASON_MAP).not.toHaveProperty('not_your_character');
  });

  it('destination_required is DELIBERATELY absent from COMBAT_REFUSAL_REASON_MAP (design brief §5.1) — no Tavern surface emits it', () => {
    expect(COMBAT_REFUSAL_REASON_MAP).not.toHaveProperty('destination_required');
  });

  it('COMBAT_REFUSAL_REASON_MAP covers the route-level / positional-tuple codes reachable from onCombatAction', () => {
    for (const key of ENGINE_COMBAT_ROUTE_LEVEL_KEYS) {
      expect(COMBAT_REFUSAL_REASON_MAP).toHaveProperty(key);
      expect(COMBAT_REFUSAL_REASON_MAP[key].trim().length).toBeGreaterThan(0);
    }
  });

  // ── The reverse direction (Kage-CR #6, 2026-08-06) ──────────────────────
  // The three checks above prove COVERAGE (engine ⊆ map). Nothing proved the
  // converse, so a typo'd or hallucinated key — the exact failure mode this
  // project has hit before ("I invented three engine refusal codes") — was
  // invisible: it would simply never match a real refusal and silently fall
  // through to the generic fallback forever. Every key must now be justified.
  it('COMBAT_REFUSAL_REASON_MAP contains NO key that is not a real, traced emitter', () => {
    const justified = new Set<string>([
      ...ENGINE_COMBAT_REASON_STATUS_KEYS,
      ...ENGINE_COMBAT_ROUTE_LEVEL_KEYS,
      // Proxy/engine 401 — ProjectNekoNova core/dnd_actor.py::require_actor_or_401
      // AND NekoNova-DnDEngine main.py::_actor_required_handler.
      'actor_required',
      // Documented in engine/combat.py's cmd_attack docstring (~:4341) with NO
      // live emitter. Deliberately kept, deliberately listed here so its
      // presence reads as verified rather than accidental.
      'no_character_bound',
      // F2 (1.7 audit, 2026-08-11/12): NOT an engine emitter — synthesized by
      // the Tavern's OWN BFF proxy routes (api/dnd/[...path],
      // api/dnd/sessions/[id]/bind, api/narration/[...path] x2) when
      // `upstream.json()` throws on a non-JSON upstream body. Same class of
      // exception as `actor_required` above: a real refusal that can land on
      // ANY proxied route, just never from the engine itself.
      'upstream_non_json',
      // B8c-2 (2026-09-29): the move verb's reason codes are now REAL engine
      // keys (spread in via ENGINE_COMBAT_REASON_STATUS_KEYS above) rather
      // than a separate hand-listed quartet here — `no_space`,
      // `invalid_destination`, `no_movement_remaining`, `unreachable`,
      // `positioning_disabled`, `same_cell`, `mover_unplaced`,
      // `position_changed` all move OUT of this literal per design brief
      // §5.1 ("the four movement codes move out of the hand-maintained
      // `justified` list and into `ENGINE_COMBAT_REASON_STATUS_KEYS`, which
      // is re-derived from the engine … the list stops being
      // hand-maintained"). `destination_required` is also a real engine key
      // now but is never added to the map (see
      // NO_TAVERN_EMITTER_COMBAT_KEYS above), so it needs no entry here
      // either.
    ]);
    const unjustified = Object.keys(COMBAT_REFUSAL_REASON_MAP).filter((k) => !justified.has(k));
    expect(unjustified).toEqual([]);
  });

  it('CAST_REFUSAL_REASON_MAP contains NO key that is not a real, traced emitter', () => {
    const justified = new Set<string>([
      ...ENGINE_SPELL_REASON_STATUS_KEYS,
      'actor_required',
      // F2 — see COMBAT_REFUSAL_REASON_MAP's identical justification above.
      'upstream_non_json',
    ]);
    const unjustified = Object.keys(CAST_REFUSAL_REASON_MAP).filter((k) => !justified.has(k));
    expect(unjustified).toEqual([]);
  });

  it('CAST_REFUSAL_REASON_MAP covers every key in engine.spells.SPELL_REASON_STATUS', () => {
    for (const key of ENGINE_SPELL_REASON_STATUS_KEYS) {
      expect(CAST_REFUSAL_REASON_MAP).toHaveProperty(key);
      expect(typeof CAST_REFUSAL_REASON_MAP[key]).toBe('string');
      expect(CAST_REFUSAL_REASON_MAP[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('the two tickets\' specific missing keys are present: no_action_remaining and actor_required', () => {
    // This is the literal regression this batch fixes -- if either key is
    // ever deleted, this fails directly rather than via a generic loop.
    expect(COMBAT_REFUSAL_REASON_MAP.no_action_remaining).toBe(
      "You've already used your action this turn — end your turn.",
    );
    expect(CAST_REFUSAL_REASON_MAP.no_action_remaining).toBe(
      "You've already used your action this turn — end your turn.",
    );
    // Copy corrected 2026-08-06 (Kage-CR #2): the original "your sign-in has
    // expired — sign in again" is FALSE for every emitter that matters. By the
    // time this renders, apiFetch's refresh has already SUCCEEDED, and the two
    // most likely causes (proxy/engine REQUIRE_ACTOR flag skew, auth service
    // down) cannot be fixed by signing in again — that copy sent the player
    // into a login loop with no terminating state. Assert the promise is gone,
    // not just that some string is present.
    expect(COMBAT_REFUSAL_REASON_MAP.actor_required).toMatch(/verify who you are/i);
    expect(CAST_REFUSAL_REASON_MAP.actor_required).toMatch(/verify who you are/i);
    for (const copy of [
      COMBAT_REFUSAL_REASON_MAP.actor_required,
      CAST_REFUSAL_REASON_MAP.actor_required,
    ]) {
      expect(copy).not.toMatch(/expired/i);
      expect(copy).not.toMatch(/sign in again/i);
    }
  });

  it('ACTION_ECONOMY_REASON_COPY and SHARED_REASON_COPY are the SAME string in both maps (no copy fork)', () => {
    for (const key of Object.keys(ACTION_ECONOMY_REASON_COPY) as Array<
      keyof typeof ACTION_ECONOMY_REASON_COPY
    >) {
      expect(COMBAT_REFUSAL_REASON_MAP[key]).toBe(ACTION_ECONOMY_REASON_COPY[key]);
      expect(CAST_REFUSAL_REASON_MAP[key]).toBe(ACTION_ECONOMY_REASON_COPY[key]);
    }
    for (const key of Object.keys(SHARED_REASON_COPY) as Array<keyof typeof SHARED_REASON_COPY>) {
      expect(COMBAT_REFUSAL_REASON_MAP[key]).toBe(SHARED_REASON_COPY[key]);
      expect(CAST_REFUSAL_REASON_MAP[key]).toBe(SHARED_REASON_COPY[key]);
    }
  });

  it('"not_found" is DELIBERATELY route-specific — combat and cast disagree on purpose', () => {
    // Combat's not_found means "combat not found"; cast's means "no active
    // character found" (engine/commands/spell_commands.py:321/399). Sharing
    // this key across the two maps would silently show the wrong noun on
    // one of the two routes -- lock the divergence in as intentional.
    expect(COMBAT_REFUSAL_REASON_MAP.not_found).not.toBe(CAST_REFUSAL_REASON_MAP.not_found);
    expect(COMBAT_REFUSAL_REASON_MAP.not_found).toMatch(/combat/i);
    expect(CAST_REFUSAL_REASON_MAP.not_found).toMatch(/character/i);
  });

  it('no_character_bound is present but its docstring-only status is unverifiable from TS alone (documented, not asserted live)', () => {
    // Confirmed via source grep during this QA pass: the ONLY occurrence of
    // "no_character_bound" in the entire engine repo is the docstring at
    // engine/combat.py:4341 -- zero live emitters. Kept in the map on
    // purpose per its own comment. This test only pins that the entry
    // still exists and is non-empty; it cannot prove liveness from the
    // Tavern side, and doesn't pretend to.
    expect(COMBAT_REFUSAL_REASON_MAP.no_character_bound).toBeTruthy();
  });
});

// ── Wire-shape tests: the REAL proxy body, message ABSENT ───────────────────

/** Mirrors api/routes/dnd_combat.py::_handle_dnd_error exactly: on an
 *  httpx.HTTPStatusError, `error` is upstream.message/upstream.error/str(e),
 *  `data` is forwarded whole when present, and there is NEVER a top-level
 *  `message` key. `code` mirrors apiFetch's own non-2xx parsing
 *  (src/lib/api/client.ts: `if (typeof e['error'] === 'string') code =
 *  e['error']`). */
function proxyCombatError(status: number, errorText: string, data: Record<string, unknown>) {
  const body = { success: false, error: errorText, data };
  return makeApiError(status, errorText, body);
}

describe('engineReasons — wire shape: no_action_remaining through the REAL proxy body', () => {
  it('a level-5 Fighter\'s second Extra Attack swing (400, no_action_remaining, state present, message ABSENT) gets curated copy', () => {
    const err = proxyCombatError(400, '[Combat] Torvin has already used their action this turn.', {
      reason: 'no_action_remaining',
      state: { combat_id: 'c1', round: 2 },
    });
    expect(err.body).not.toHaveProperty('message');
    const message = engineErrorMessage(err, {
      fallback: "That combat action didn't go through.",
      reasonMap: COMBAT_REFUSAL_REASON_MAP,
    });
    expect(message).toBe("You've already used your action this turn — end your turn.");
    // Prove this ISN'T accidentally the fallback string under a different name.
    expect(message).not.toBe("That combat action didn't go through.");
  });

  it('same reason on the cast path (CAST_REFUSAL_REASON_MAP, no `state` key -- spells._err never sets one)', () => {
    const err = proxyCombatError(400, '[Spell] No action remaining to cast Fire Bolt this turn.', {
      reason: 'no_action_remaining',
    });
    expect(err.body).not.toHaveProperty('message');
    const message = engineErrorMessage(err, {
      fallback: 'Could not cast Fire Bolt. Try again in a moment.',
      reasonMap: CAST_REFUSAL_REASON_MAP,
    });
    expect(message).toBe("You've already used your action this turn — end your turn.");
  });
});

// ── IMP-3 (WF-A reconciliation, 2026-08-12): not_your_character is
// deliberately UNCURATED — see COMBAT_REFUSAL_REASON_MAP's own comment and
// the `DELIBERATELY_UNCURATED_COMBAT_KEYS` note above. Unlike
// `proxyCombatError` above (which mirrors the STALE pre-`ebdc5b2` shape,
// `message` always absent), these two bodies mirror the CURRENT shape —
// `message` present, forwarded verbatim by dnd_combat.py since `ebdc5b2`
// (2026-08-07) — because the whole point of removing the curated entry is
// that tier 2 now genuinely carries the engine's own text through.
describe('engineReasons — wire shape: not_your_character (IMP-3, tier 2 owns this code)', () => {
  it('combat_commands.py:897 branch ("named someone else\'s downed PC") surfaces its own message', () => {
    const body = {
      success: false,
      message: 'You can only roll a death save for your own character.',
      data: { reason: 'not_your_character' },
    };
    const err = makeApiError(400, body.message, body);
    const message = engineErrorMessage(err, {
      fallback: "That combat action didn't go through.",
      reasonMap: COMBAT_REFUSAL_REASON_MAP,
    });
    expect(message).toBe('You can only roll a death save for your own character.');
  });

  it('combat_commands.py:919 branch (the C2 fix, "no downed character of your own") surfaces a DIFFERENT message for the SAME reason code', () => {
    const body = {
      success: false,
      message:
        "You don't have a downed character of your own in this encounter to make a death save for.",
      data: { reason: 'not_your_character' },
    };
    const err = makeApiError(400, body.message, body);
    const message = engineErrorMessage(err, {
      fallback: "That combat action didn't go through.",
      reasonMap: COMBAT_REFUSAL_REASON_MAP,
    });
    expect(message).toBe(
      "You don't have a downed character of your own in this encounter to make a death save for.",
    );
    // The two branches genuinely disagree -- proof that a single curated
    // string could not have been honest for both, which is the whole IMP-3
    // ruling.
  });
});

describe('engineReasons — wire shape: actor_required 401 through the REAL proxy body', () => {
  it('core/dnd_actor.py::require_actor_or_401\'s exact body (401, no `state`, message ABSENT) gets curated copy', () => {
    // Byte-for-byte the dict literal at core/dnd_actor.py lines 251-258.
    const body = { success: false, error: 'Actor identity required.', data: { reason: 'actor_required' } };
    const err = makeApiError(401, body.error, body);
    expect(err.body).not.toHaveProperty('message');
    const message = engineErrorMessage(err, {
      fallback: "That combat action didn't go through.",
      reasonMap: COMBAT_REFUSAL_REASON_MAP,
    });
    expect(message).toBe("Couldn't verify who you are. Try reloading — if it keeps happening, the sign-in service may be down.");
  });

  it('actor_required also resolves on the cast map (SHARED_REASON_COPY is genuinely shared, not just present in one)', () => {
    const body = { success: false, error: 'Actor identity required.', data: { reason: 'actor_required' } };
    const err = makeApiError(401, body.error, body);
    const message = engineErrorMessage(err, {
      fallback: 'Could not cast that spell. Try again in a moment.',
      reasonMap: CAST_REFUSAL_REASON_MAP,
    });
    expect(message).toBe("Couldn't verify who you are. Try reloading — if it keeps happening, the sign-in service may be down.");
  });
});

// ── ENGINE-MOVEMENT-PLAYER-VISIBLE-COORDS design §5 — the move verb's four
// new refusal codes, curated ahead of the verb shipping (design step 6, this
// batch; the verb itself is step 5 / loop item B8, not yet built). Design
// table (§5): not_your_turn (existing, no new entry — asserted separately
// below) / no_space / invalid_destination / no_movement_remaining /
// unreachable. Copy sourced from the Aoi-UI tactical-map spec, §4/§7 and the
// mockup's Show-3 refusal panel — see engineReasons.ts's own comment for the
// per-key sourcing.
describe('engineReasons — movement move-refusal codes (design §5, B8 pending)', () => {
  const MOVEMENT_CODES = ['no_space', 'invalid_destination', 'no_movement_remaining', 'unreachable'] as const;
  // B8c-2 (2026-09-29, design brief §5.1): the remaining four of the move
  // verb's vocabulary, now that the engine's B8b move verb exists. `destination_required` is
  // deliberately excluded — see NO_TAVERN_EMITTER_COMBAT_KEYS above.
  const B8C2_MOVEMENT_CODES = ['positioning_disabled', 'same_cell', 'mover_unplaced', 'position_changed'] as const;

  it('all four new codes are present in COMBAT_REFUSAL_REASON_MAP with non-empty copy', () => {
    for (const key of MOVEMENT_CODES) {
      expect(COMBAT_REFUSAL_REASON_MAP).toHaveProperty(key);
      expect(typeof COMBAT_REFUSAL_REASON_MAP[key]).toBe('string');
      expect(COMBAT_REFUSAL_REASON_MAP[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('the four B8c-2 codes are present in COMBAT_REFUSAL_REASON_MAP with non-empty copy, verbatim from the build brief §5.1', () => {
    for (const key of B8C2_MOVEMENT_CODES) {
      expect(COMBAT_REFUSAL_REASON_MAP).toHaveProperty(key);
      expect(typeof COMBAT_REFUSAL_REASON_MAP[key]).toBe('string');
      expect(COMBAT_REFUSAL_REASON_MAP[key].trim().length).toBeGreaterThan(0);
    }
    expect(COMBAT_REFUSAL_REASON_MAP.positioning_disabled).toBe("The battle map isn't available here.");
    expect(COMBAT_REFUSAL_REASON_MAP.same_cell).toBe("You're already standing there.");
    expect(COMBAT_REFUSAL_REASON_MAP.mover_unplaced).toBe(
      "Your token isn't on the board yet — the DM needs to place it.",
    );
    expect(COMBAT_REFUSAL_REASON_MAP.position_changed).toBe(
      'The board moved on — that spot is out of date. Have another look.',
    );
  });

  it('the move verb reuses the existing not_your_turn code — no duplicate/second entry', () => {
    // Design §5 lists not_your_turn as "existing code, existing check" among
    // the move verb's refusals. Prove the map still has exactly one entry
    // for it and it's the pre-existing copy, not a movement-specific fork.
    expect(COMBAT_REFUSAL_REASON_MAP.not_your_turn).toBe("It's not your turn.");
  });

  it('invalid_destination and unreachable copy matches the Aoi-UI spec verbatim', () => {
    // Design Pass v1 (Aoi-UI) §4: 'Same slot handles `invalid_destination`
    // ("You can't move there — it's blocked or occupied") and `unreachable`
    // ("There's no path there")'.
    expect(COMBAT_REFUSAL_REASON_MAP.invalid_destination).toBe(
      "You can't move there — it's blocked or occupied.",
    );
    expect(COMBAT_REFUSAL_REASON_MAP.unreachable).toBe("There's no path there.");
  });

  it('no_movement_remaining names the fix (end turn or Dash), matching the spec\'s mockup framing', () => {
    expect(COMBAT_REFUSAL_REASON_MAP.no_movement_remaining).toMatch(/movement/i);
    expect(COMBAT_REFUSAL_REASON_MAP.no_movement_remaining).toMatch(/dash/i);
  });

  it('no_space names the real cause (no board) rather than a generic refusal', () => {
    expect(COMBAT_REFUSAL_REASON_MAP.no_space).toMatch(/map|grid|board/i);
  });

  it('the move verb refusal shape reaches engineErrorMessage exactly like attack/dodge/dash — no_movement_remaining example', () => {
    const err = proxyCombatError(400, '[Combat] Bren has no movement remaining.', {
      reason: 'no_movement_remaining',
      state: { combat_id: 'c1', round: 2 },
    });
    const message = engineErrorMessage(err, {
      fallback: "That combat action didn't go through.",
      reasonMap: COMBAT_REFUSAL_REASON_MAP,
    });
    expect(message).toBe(COMBAT_REFUSAL_REASON_MAP.no_movement_remaining);
    expect(message).not.toBe("That combat action didn't go through.");
  });

  it('adding the four movement codes did not widen the fallback path — an unmapped code still falls through honestly', () => {
    // Regression proof that curating four new keys didn't turn the map into
    // a wildcard: a plausible BUT NOT ACTUALLY CURATED fifth movement-shaped
    // code still resolves to the caller's own fallback string, same as the
    // pre-existing "unknown/future reason code" behaviour this file already
    // pins below for the general case.
    const err = proxyCombatError(400, 'Some future movement refusal nobody mapped yet.', {
      reason: 'occupied_by_ally_no_swap',
    });
    const message = engineErrorMessage(err, {
      fallback: "That combat action didn't go through.",
      reasonMap: COMBAT_REFUSAL_REASON_MAP,
    });
    expect(message).toBe("That combat action didn't go through.");
  });
});

describe('engineReasons — adversarial', () => {
  it('reverting the fix (deleting the key) would fail this suite: sanity-checked by simulating the pre-fix map', () => {
    // Not a mutation of production code -- a local copy proving the assertion
    // above is actually load-bearing, not vacuously true regardless of the
    // map's contents.
    const preFixMap = { ...COMBAT_REFUSAL_REASON_MAP };
    delete (preFixMap as Record<string, string>).no_action_remaining;
    const err = proxyCombatError(400, '[Combat] already used your action', {
      reason: 'no_action_remaining',
    });
    const message = engineErrorMessage(err, {
      fallback: "That combat action didn't go through.",
      reasonMap: preFixMap,
    });
    // Falls through to the 4xx-business branch — no `message` key on this
    // body, so it lands on the fallback, reproducing the ORIGINAL bug report
    // exactly ("That combat action did not land" was the old wording of this
    // same fallback).
    expect(message).toBe("That combat action didn't go through.");
  });

  it('a body with NO data.reason at all (message-only failure) never crashes and never matches a map key by accident', () => {
    // err.code becomes the full `error` string per apiFetch's parsing (not a
    // short machine code) when data.reason is absent -- prove that string
    // never collides with a real reason key and leaks curated copy for the
    // wrong refusal.
    const body = { success: false, error: 'Unexpected upstream failure text.', data: {} };
    const err = makeApiError(400, body.error, body);
    const message = engineErrorMessage(err, {
      fallback: "That combat action didn't go through.",
      reasonMap: COMBAT_REFUSAL_REASON_MAP,
    });
    expect(message).toBe("That combat action didn't go through.");
  });

  it('a 5xx no_action_remaining-shaped body (should be impossible, but prove no leak) never surfaces raw text via curated copy bypass', () => {
    // db_unavailable/error ARE mapped (by design, per engine's own 500
    // reasons) -- confirm those specific 5xx reasons still resolve to the
    // curated 5xx copy rather than accidentally falling through to a raw
    // `error` string leak, even though engineErrorMessage's OWN 5xx guard is
    // tested elsewhere (dnd-engineError.test.ts) -- this pins it at the map
    // level specifically for the two reasons the map curates for 5xx.
    const err = proxyCombatError(500, 'Traceback (most recent call last): ...', {
      reason: 'error',
    });
    const message = engineErrorMessage(err, {
      fallback: 'Something went wrong.',
      reasonMap: COMBAT_REFUSAL_REASON_MAP,
    });
    expect(message).toBe('Something went wrong resolving that action.');
    expect(message).not.toMatch(/Traceback/);
  });

  it('an unknown/future reason code not yet in the map falls through honestly (no crash, no silent wrong-copy)', () => {
    const err = proxyCombatError(400, 'Some brand-new engine refusal.', {
      reason: 'some_future_reason_nobody_mapped_yet',
    });
    const message = engineErrorMessage(err, {
      fallback: "That combat action didn't go through.",
      reasonMap: COMBAT_REFUSAL_REASON_MAP,
    });
    // No `message` key on the real wire shape, so this is NOT the tier-2
    // business-message branch either -- straight to fallback.
    expect(message).toBe("That combat action didn't go through.");
  });
});

// ── the DM's monster-turn refusal copy (A9d-2 fix round N10; Tora MINOR-7, Iro Minor-4) ────────────────────────────────────────
describe('the monster_statblock_unresolved copy names a way out the phone really has', () => {
  const copy = COMBAT_REFUSAL_REASON_MAP.monster_statblock_unresolved;

  it('says "Reload the page" (pull-to-refresh is off on /play, so the browser\'s own reload is the only route: a bare "Reload" has no affordance on a phone)', () => {
    expect(copy).toMatch(/Reload the page/);
    expect(copy).not.toMatch(/Reload to try again/);
  });

  it('names the control by its own label, "End combat", and where it is, "the Scene panel": "the scene controls" named no control', () => {
    expect(copy).toMatch(/use End combat in the Scene panel/);
    expect(copy).not.toMatch(/scene controls/i);
  });

  it('is still the curated sentence the driver and the harness find by its opening words', () => {
    expect(copy).toMatch(/^A monster's stat block couldn't be loaded, so its turn didn't run\./);
  });

  it('is shown at 12px or more: the refusal is the DM\'s only recovery instruction and was the smallest text in the bar (Composer.module.css .refusedReason)', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/Composer.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = css.match(/\.refusedReason\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(Number(rule.match(/font-size:\s*([\d.]+)px/)?.[1])).toBeGreaterThanOrEqual(12);
  });
});
