// src/lib/dnd/engineReasons.ts
//
// TAV-COMBAT-NO-ACTION-REMAINING-UNMAPPED + TAV-401-ACTOR-REQUIRED-UNMAPPED
// (2026-08-06) — the single home for engine `data.reason` -> player-facing copy.
//
// WHY ONE MODULE: these two tickets share a root cause, and so does the cast
// path. Before this, each call site owned a hand-written subset of the reason
// vocabulary; a code missing from a subset fell through to that site's generic
// fallback. `no_action_remaining` was missing from BOTH the combat map and the
// cast map, so a level-5 Fighter who spent both Extra Attack swings was told
// "That combat action did not land. Try again." — the language of a MISSED
// attack roll, plus an invitation to retry something that cannot succeed until
// the turn ends.
//
// SOURCED, NOT GUESSED. Every key below is traced to a live emitter:
//   - combat: `engine.combat.COMBAT_REASON_STATUS` (24 entries, locked at that
//     count by tests/test_ddx_classify_systemic_c3_combat_adversarial.py) plus
//     `target_is_self` (engine/combat.py, emitted but absent from that dict, so
//     it takes the route's `.get(reason, 400)` default) and the route-level
//     codes in NekoNova-DnDEngine/routes/combat.py.
//   - spells: `engine.spells.SPELL_REASON_STATUS` (18 entries) plus
//     `engine/commands/spell_commands.py`'s own `not_found`.
//   - `actor_required`: emitted by BOTH services, indistinguishably at the
//     client — ProjectNekoNova's proxy (core/dnd_actor.py::require_actor_or_401)
//     and the engine itself (main.py::_actor_required_handler, raised by
//     engine/authz.py when DND_REQUIRE_ACTOR=true and X-Actor-Username is
//     missing). A 401 on ANY /api/dnd route.
//
// `not_found` is DELIBERATELY not shared: it means "combat not found" on the
// combat path and "no active character found" on the cast path. Keep it
// per-map so the copy stays truthful to the route the player actually hit.
//
// WHY A MAP AND NOT A DISABLED BUTTON (do not "fix" this later by disabling
// Attack): the attacks-remaining counter is deliberately OFF the wire — it
// lives in `Participant.ability_scores` and `build_combat_state`'s projection
// never spreads it, an invariant defended by
// tests/test_ddx18_multiattack_extra_attack.py::TestAttacksRemainingCounterNeverOnTheWire.
// `action_available` IS on the wire, but gating on it would wrongly block a
// Fighter's SECOND Extra Attack swing — the action is spent after the first.
// Honest copy after the 400 is the correct shape.

/**
 * Refusals that can land on ANY NekoNova D&D proxy route, engine or not.
 *
 * `actor_required` survives `apiFetch`'s 401 refresh-and-retry: the refresh
 * SUCCEEDS (the token is fine — actor RESOLUTION is what failed), the retry
 * 401s again, and the second pass carries `data.reason` through intact.
 *
 * COPY IS DELIBERATELY NON-COMMITTAL. "Your sign-in has expired, sign in
 * again" was the first draft and it is a lie in most of the emitters
 * (Kage-CR #2, 2026-08-06) — by the time this string renders, the refresh has
 * already proven the sign-in is live. The three real causes are:
 *   1. proxy could not resolve actor identity from a valid token;
 *   2. flag skew — NEKONOVA_REQUIRE_ACTOR off on the proxy while
 *      DND_REQUIRE_ACTOR is on in the engine, so no X-Actor-Username is
 *      stamped. This one hits EVERY player at once and re-logging-in can
 *      never fix it;
 *   3. the auth service is down — `resolve_actor` returns None when
 *      `introspect_token()` raises (core/dnd_actor.py).
 * None of those are fixed by signing in again, so the copy must not send the
 * player into a login loop that cannot terminate.
 */
export const SHARED_REASON_COPY: Record<string, string> = {
  actor_required:
    "Couldn't verify who you are. Try reloading — if it keeps happening, the sign-in service may be down.",
};

/**
 * 5e action-economy refusals. The engine mirrors these three codes across
 * `COMBAT_REASON_STATUS` and `SPELL_REASON_STATUS` deliberately (see the DDX-12
 * comment in engine/spells.py), so both maps below spread them.
 *
 * Copy note: "already used your action" is the rules-correct framing even when
 * a Fighter has just made two attacks — Extra Attack grants extra ATTACKS
 * within one Attack ACTION, so the action really is spent. It reads correctly
 * for dodge/dash/cast too, which share the same pool.
 */
export const ACTION_ECONOMY_REASON_COPY: Record<string, string> = {
  no_action_remaining: "You've already used your action this turn — end your turn.",
  no_bonus_remaining: "You've already used your bonus action this turn.",
  no_reaction_remaining: "You've already used your reaction this round.",
};

/**
 * Combat-action refusals, passed as `engineErrorMessage`'s `reasonMap` from the
 * play page's `onCombatAction` (attack / dodge / dash / death-save / end-turn).
 *
 * This map is intentionally COMPLETE over the engine's combat vocabulary. That
 * matters beyond tidiness: the proxy renames the engine's `message` key to
 * `error` (ProjectNekoNova api/routes/dnd_combat.py::_handle_dnd_error), so
 * `engineErrorMessage`'s tier-2 "surface the engine's own 4xx text" branch —
 * which probes `body.message` — never fires on the combat route. Curated copy
 * is therefore the ONLY tier that can produce an honest string here; anything
 * missing falls straight to the generic fallback.
 *
 * Scope of that proxy defect, verified file-by-file (Kage-CR #3, 2026-08-06 —
 * an earlier draft of this comment overstated it as "every D&D route"):
 *   dnd_combat.py    message DROPPED (renamed to `error`)   ← this map's route
 *   dnd_sessions.py  message DROPPED                        ← check/advance/grounding
 *   dnd_vessel.py    message DROPPED (its docstring claims otherwise)
 *   dnd_catalog.py   message DROPPED **and `data` dropped entirely**, so
 *                    data.reason never reaches the Tavern on catalog routes
 *   dnd_characters.py  message PRESERVED (`{"success": False, **upstream}`)
 * 4 of 5 — the proxy is internally INCONSISTENT, which is a stronger reason to
 * fix it than uniform breakage would be. Filed as NEKONOVA-PROXY-DROPS-MESSAGE
 * for Leon's ruling (the safe fix touches a shared proxy and would start
 * surfacing "[Combat] …"-prefixed engine text to players). Until then, keep
 * this map complete.
 */
export const COMBAT_REFUSAL_REASON_MAP: Record<string, string> = {
  ...SHARED_REASON_COPY,
  ...ACTION_ECONOMY_REASON_COPY,

  // ── engine.combat.COMBAT_REASON_STATUS ──────────────────────────────────
  no_combat: 'No combat is active.',
  no_active_turn: 'No one has the active turn right now.',
  not_your_turn: "It's not your turn.",
  not_a_monsters_turn: "It's not a monster's turn.",
  no_target: 'You need to pick a target.',
  attacker_not_found: "Your character isn't part of this combat.",
  target_not_found: 'That target was not found.',
  participant_not_found: "That combatant isn't part of this combat.",
  target_down: 'That target is already down.',
  target_dead: 'That target is already dead.',
  target_already_stable: 'That target is already stable.',
  target_not_downed: "That target isn't down, so it can't be stabilised.",
  not_your_character: "That's not your character.",
  actor_incapacitated: 'Your character is incapacitated.',
  combat_over: 'Combat has ended.',
  unknown_monster: "That monster isn't recognised.",
  no_active_session: 'This table has no active session.',
  no_participants: 'No one has joined this combat yet.',
  invalid_condition: "That condition isn't valid.",
  // The two 5xx codes. `engineErrorMessage` never surfaces a 5xx body message
  // (it could leak internals), so without curated copy these would show the
  // generic fallback — worse than saying plainly that the server faulted.
  db_unavailable: 'The game database is unavailable right now — try again in a moment.',
  error: 'Something went wrong resolving that action.',

  // ── emitted by engine/combat.py but absent from COMBAT_REASON_STATUS ────
  // (the route's `COMBAT_REASON_STATUS.get(reason, 400)` default covers it)
  target_is_self: "You can't target yourself.",

  // ── route-level, NekoNova-DnDEngine/routes/combat.py ────────────────────
  not_found: 'Combat not found.',
  invalid_outcome: 'That outcome is not valid right now.',
  victory_refused: "Can't claim victory — no enemies are down.",
  msm_disabled: 'Multi-system content is not available for this session.',

  // Documented in engine/combat.py's cmd_attack docstring (line ~4341) but it
  // has NO live emitter — grep finds only the docstring. Kept so the absence
  // reads as verified rather than overlooked; harmless if it never fires.
  no_character_bound: 'No character is bound to this session.',
};

/**
 * Cast refusals for CastSpellPanel. Same completeness rationale as the combat
 * map — sourced from `engine.spells.SPELL_REASON_STATUS`.
 */
export const CAST_REFUSAL_REASON_MAP: Record<string, string> = {
  ...SHARED_REASON_COPY,
  ...ACTION_ECONOMY_REASON_COPY,

  no_combat: 'No active combat.',
  not_your_turn: "It's not your turn.",
  no_active_turn: 'No one has the active turn right now.',
  unknown_spell: "That spell couldn't be found.",
  unknown_character: "That character couldn't be found.",
  invalid_slot: 'That slot level is too low for this spell.',
  no_slots: "You're out of slots at that level.",
  not_prepared: "That spell isn't known or prepared.",
  not_ritual: "That spell can't be cast as a ritual.",
  no_spell_name: 'You need to choose a spell.',
  target_not_found: 'That target could not be found or is already down.',
  actor_incapacitated: 'Your character is incapacitated.',
  db_unavailable: 'The game database is unavailable right now — try again in a moment.',
  error: 'Something went wrong casting that spell.',

  // Spell-path meaning of `not_found` — deliberately different from combat's.
  not_found: 'No active character found.',
};
