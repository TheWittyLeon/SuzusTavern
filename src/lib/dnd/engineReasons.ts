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
 * Scope of that proxy defect, AS IT STOOD when first traced (Kage-CR #3,
 * 2026-08-06 — an earlier draft of this comment overstated it as "every D&D
 * route"):
 *   dnd_combat.py    message DROPPED (renamed to `error`)   ← this map's route
 *   dnd_sessions.py  message DROPPED                        ← check/advance/grounding
 *   dnd_vessel.py    message DROPPED (its docstring claims otherwise)
 *   dnd_catalog.py   message DROPPED **and `data` dropped entirely**, so
 *                    data.reason never reaches the Tavern on catalog routes
 *   dnd_characters.py  message PRESERVED (`{"success": False, **upstream}`)
 * STALE AS OF ProjectNekoNova commit `ebdc5b2` (2026-08-07, Kage IMP-5): that
 * commit fixed the four modules still dropping `message` — all FIVE proxy
 * modules now forward the engine's `message` intact, closing
 * NEKONOVA-PROXY-DROPS-MESSAGE. This map stays complete anyway as defense in
 * depth (curated copy reads better than raw engine text regardless), not
 * because the tier-2 raw-message fallthrough is broken — it isn't, anymore.
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
  // Contract C2 (pinned 2026-08-11): replaces a previously misleading
  // `target_not_downed` message for this exact caller — the engine used to
  // (wrongly) report "that target isn't down" when the real problem may
  // instead be that the CALLER has no character bound in this encounter at
  // all.
  //
  // IMP-3 RESOLVED (WF-A reconciliation, 2026-08-12) — deliberately
  // UNCURATED, tier 2 owns this one. `not_your_character` is emitted at TWO
  // branches of `engine/commands/combat_commands.py`, with two genuinely
  // different causes:
  //   :897 — "You can only roll a death save for your own character."
  //          (named someone else's downed PC)
  //   :919 — "You don't have a downed character of your own in this
  //          encounter to make a death save for." (the C2 fix, above)
  // Two causes, one code: no single curated string can be honest for both,
  // so a curated entry here would flatten two distinct situations into one
  // message that reads wrong half the time — actively worse than no entry.
  // Letting the engine's own branch-specific text land via tier 2 instead:
  //   - the proxies forward `message` verbatim now (`ebdc5b2`, 2026-08-07),
  //     so tier 2 genuinely works on this route;
  //   - WF-A cleaned the `[Combat]` prefix from both messages, so they
  //     render cleanly to the player;
  //   - the generic fallback still covers any engine predating that fix;
  //   - the engine's own text is strictly more helpful than any neutral
  //     string we could write to cover both branches at once.
  // Supersedes F2's neutral placeholder ("That character isn't available to
  // you for this.") — removed along with its pending-citation comment now
  // that both branch locations are confirmed. Do NOT re-add an entry here;
  // `RebindCharacterButton`'s own inline map curates the SAME code for the
  // bind route's different (ownership) meaning and is unaffected — different
  // route, stays as-is (Kage SUGG-12's consolidation can revisit later).
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

/**
 * Join refusals for the lobby's "Join table" control.
 *
 * TAV-LOBBY-JOIN-ERROR-GENERIC (1.7 audit, 2026-08-10): the lobby had NO map at
 * all — a bare `catch {}` rendered one string, "Could not join that table. Try
 * again.", for every failure. The 1.7 browser pass hit that with a real 409
 * `character_in_use`, which is the worst case for that copy: the join can NEVER
 * succeed on a retry, so the only advice the player got was advice that cannot
 * work, with the actual cause (their character is seated at another table)
 * hidden. Same disease as the two tickets at the top of this file, third site.
 *
 * SOURCED, NOT GUESSED, like the maps above:
 *   - `routes/sessions.py::SESSION_REASON_STATUS` — the join route resolves
 *     every `cmd_joinsession` refusal through it via
 *     `SESSION_REASON_STATUS.get(reason, 400)`.
 *   - `engine/commands/session_commands.py::cmd_joinsession` returns exactly
 *     three of those: `not_found`, `error`, and `character_in_use`.
 *   - `actor_required` / the 5xx pair arrive via SHARED_REASON_COPY below.
 *
 * `character_in_use` copy names the CAUSE and the FIX, because the underlying
 * rule surprises people: a character is bound to one campaign at a time, and
 * (as of the 1.7 audit) ENDING a campaign does not release it — see
 * TAV-CHAR-STUCK-AFTER-CAMPAIGN-END. Until that ships, this string is the only
 * thing standing between a player and a silently unusable character.
 */
export const JOIN_REFUSAL_REASON_MAP: Record<string, string> = {
  ...SHARED_REASON_COPY,

  character_in_use:
    'That character is already at another table. Pick a different one, or leave the other campaign first.',
  not_found: 'That table is no longer available.',
  not_active: 'That table is not active right now.',
  start_failed: "That table couldn't be started.",
  msm_disabled: 'Multi-system content is not available for this session.',
  error: 'Something went wrong joining that table.',
  db_unavailable: 'The game database is unavailable right now — try again in a moment.',
};

/**
 * Leave-campaign refusals for `LeaveCampaignButton` (B1, folded in here per
 * that pass's own TODO — mirrors `JOIN_REFUSAL_REASON_MAP`'s shape).
 * POST /api/dnd/characters/{id}/leave-campaign, proxied by
 * `api/routes/dnd_characters.py`, which forwards `message` correctly
 * (`{"success": False, **upstream}`, never renamed to `error`) — so an
 * unmapped code here still reaches the player as the engine's own text via
 * `engineErrorMessage`'s tier-2 branch before ever touching the caller's
 * generic `fallback` string. CORRECTED (Kage IMP-5, 2026-08-12): this used to
 * describe itself as "the one module of the five" with correct forwarding,
 * implying the other four still dropped `message` — that stopped being true
 * at ProjectNekoNova commit `ebdc5b2` (2026-08-07), which fixed the
 * remaining four; see `COMBAT_REFUSAL_REASON_MAP`'s doc comment above for the
 * corrected, full accounting.
 *
 * Contract C1 (pinned 2026-08-11):
 *   - `400 not_in_campaign` is handled as a SUCCESS path by the caller
 *     (`LeaveCampaignButton`'s `alreadyFree` check runs and returns BEFORE
 *     this map is ever consulted — the character is already unbound, which
 *     is the player's actual goal). The entry below is NOT the live copy
 *     path for that code; it exists so the code is explicitly accounted for
 *     here too, rather than being unmapped-by-omission, which would read as
 *     "handled as success" and "simply forgotten" identically from outside
 *     this file. If that early-return is ever refactored away, this is safe,
 *     benign copy rather than a scary error string.
 *   - `404` unknown-or-unowned character: WF-A confirmed `not_found` as the
 *     PINNED code (2026-08-12) — byte-identical message for both the
 *     unknown-slug and not-yours cases, per their DDX-AUTHZ-404-ORACLE
 *     convention (closes Kuro's S5 oracle concern: distinguishing the two
 *     in our own copy would leak which characters exist to a caller probing
 *     IDs they don't own). `not_found` was already covered below by the
 *     pre-confirmation defensive guess and maps to the same generic string
 *     as its sibling entries (`unknown_character`, `character_not_found`),
 *     so no copy change was needed — those two extra slugs are kept as
 *     harmless no-ops in case an older engine ever used them. Whatever the
 *     engine actually sends, an UNlisted code still lands on the generic
 *     `error`/`db_unavailable` entries (if it's one of those two) or the
 *     tier-2 engine message / tier-3 fallback chain above — never a blank
 *     string.
 */
export const LEAVE_CAMPAIGN_REASON_MAP: Record<string, string> = {
  ...SHARED_REASON_COPY,

  not_in_campaign: "Already left — this character isn't seated at a table.",
  not_found: "That character couldn't be found.",
  unknown_character: "That character couldn't be found.",
  character_not_found: "That character couldn't be found.",
  error: 'Something went wrong leaving that campaign.',
  db_unavailable: 'The game database is unavailable right now — try again in a moment.',
};

/**
 * Restore-campaign refusals for the /trash page's campaign section
 * (TAV-CAMPAIGN-TRASH-NO-RESTORE-UI, 2026-08-11).
 * POST /api/dnd/sessions/{id}/restore, proxied through the same
 * `api/routes/dnd_sessions.py` module the big comment on
 * COMBAT_REFUSAL_REASON_MAP above traces. CORRECTED (Kage IMP-5, 2026-08-12):
 * that module was one of the four dropping `message` when this comment was
 * first written, which is STALE as of ProjectNekoNova commit `ebdc5b2`
 * (2026-08-07) — `dnd_sessions.py` now forwards `message` intact along with
 * the other three formerly-lagging modules, so the tier-2 raw-message
 * fallthrough in `engineErrorMessage` is live on this route too. This map
 * stays COMPLETE anyway, same rationale as the combat map: curated copy over
 * raw engine text, not a workaround for a drop that no longer happens.
 *
 * UNVERIFIED AGAINST THE ENGINE — this pass was explicitly UI-only (a
 * sibling lane owns the engine repo and this pass was told not to read it).
 * `restoreCharacter`, the character-trash sibling of this endpoint, has NO
 * reason map at all today (its caller just does a bare catch → generic
 * toast) so there is no established vocabulary to mirror here either. The
 * three entries below are the shared trio every other map in this file
 * carries (`not_found` / `error` / `db_unavailable`) plus one defensive
 * guess (`not_deleted`, for "nothing to restore") — anything the engine
 * actually sends that isn't listed still lands on `error`/`db_unavailable`
 * (if it's one of those two) or this caller's own `fallback` string, never a
 * blank one. Tighten once the sibling lane's contract for this route is
 * pinned.
 */
export const RESTORE_CAMPAIGN_REASON_MAP: Record<string, string> = {
  ...SHARED_REASON_COPY,

  not_found: "That campaign couldn't be found — it may already be gone for good.",
  not_deleted: 'That campaign is already active — nothing to restore.',
  error: 'Something went wrong restoring that campaign.',
  db_unavailable: 'The game database is unavailable right now — try again in a moment.',
};

/**
 * Session-start refusals for the "Set the table" flow (`modules/page.tsx`'s
 * `handleBegin` -> `createSessionFull`, POST /api/dnd/sessions).
 *
 * Before this map existed, that call site's `catch` didn't inspect the
 * caught error at all — every refusal, a 503 `msm_disabled` or a 400
 * `unknown_adventure` alike, rendered the exact same generic toast. Wired
 * through `engineErrorMessage` now (WF-A reconciliation, 2026-08-12) per the
 * two entries WF-A's engine lane approved:
 *   - `msm_disabled` (503) never reaches `engineErrorMessage`'s tier-2
 *     raw-message branch (5xx bodies are never surfaced verbatim — see
 *     engineError.ts's header comment), so without a curated entry it fell
 *     straight to the generic fallback. Same copy as the other maps in this
 *     file for consistency.
 *   - `unknown_adventure` (400, fired when the selected adventure's
 *     `public_id` doesn't resolve on the engine side) previously had no
 *     curated copy either; the generic fallback covers it today, but a
 *     player who picked a real adventure from the catalog and got a
 *     content-agnostic "try again" deserves to be told the actual cause.
 *
 * Anything else — including any 4xx whose engine `message` text comes
 * through on the BFF's forwarded body — still falls through to tier 2/3;
 * only these two codes are curated here.
 */
export const SESSION_START_REASON_MAP: Record<string, string> = {
  ...SHARED_REASON_COPY,

  msm_disabled: 'Multi-system content is not available for this session.',
  unknown_adventure: "That adventure couldn't be found — pick another one from the list.",
};
