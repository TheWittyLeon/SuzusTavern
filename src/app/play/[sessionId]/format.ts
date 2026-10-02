/**
 * TAV-PLAY-SHELL — shared helpers for the /play route (formatting +
 * cross-concern predicates/constants).
 *
 * Kage-CR C2 (2026-09-21 review, blocking): `titleCaseSkill` used to live in
 * page.tsx and be imported by regions/Offers.tsx via `from '../page'` — a
 * leaf region reaching up into the route entry point, a circular import and
 * an inverted dependency direction (plan §2.2: "dependencies flow downward
 * only; nothing reaches sideways"). Behaviourally safe (hoisted `export
 * function`, `npm run build` succeeded) but exactly the boundary this
 * refactor exists to establish — step 5 extracts ~9 hooks that will each
 * want shared helpers, and repeating this pattern makes page.tsx the
 * de-facto shared module regardless of the file layout (Option B wearing
 * Option A's clothes). This file is the actual shared module: page.tsx and
 * every region/hook import FROM here, nothing imports from page.tsx.
 *
 * Step 5 (hooks behind the provider): `sessionsEqual`/`stableKey` and
 * `POLL_INTERVAL_MS` moved here from page.tsx for the same C2 reason —
 * `useSessionLifecycle`'s session-status poll needs `sessionsEqual` and
 * `POLL_INTERVAL_MS`, and page.tsx's own combat/dice-roll polls (not yet
 * extracted) keep needing `POLL_INTERVAL_MS` too. Importing either from
 * `../page` would reproduce the exact circular/inverted dependency C2 fixed.
 *
 * Hook 4 (`useScene`, original plan numbering — this file predates
 * Amendment A's reorder): `isSessionLocked` and `buildReadAloudBlock` moved
 * here too, for the same reason — `onMoveOn`/`onAttemptCheck`/`openScene`
 * need both, and page.tsx's own onRoll/monster-auto-driver (not yet
 * extracted) keep needing `isSessionLocked`.
 *
 * A3 (`useTranscript`, Amendment A §A.2's AMENDED row 4): `nowStamp` moved
 * here too — shared by `useTranscript`'s `appendLog`/stream-row writers and
 * page.tsx's own narrate()/narrateDurable() (not yet extracted, A5), which
 * write `setLog` directly rather than through `appendLog` and therefore
 * need the same stamp a second place.
 *
 * A4 (`useSessionEvents`, Amendment A §A.2's AMENDED row 11): `scanXCardTracking`
 * (+ its `NARRATION_BEAT_KINDS` constant) moved here too — page.tsx's mount
 * effect (rehydration branch) and the new `hooks/useSessionEvents.ts` poll
 * both need it, and it can't live in either file alone without one importing
 * the other (the same circular-dependency shape C2 fixed, and exactly what
 * "the poll never imports a sibling hook" (decomposition plan §2.2) rules
 * out for `useSessionEvents.ts` reaching into page.tsx).
 */
import type { CombatParticipantState, CombatState, EngineSessionEvent, GroundingData, Session } from '@/lib/api/types';

/** Title-case an engine skill slug ('sleight_of_hand' -> 'Sleight Of Hand'). */
export function titleCaseSkill(skill: string): string {
  return skill
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The ActionBar's death-save tally from the active combatant, or null when it has none. */
export function deathSaveTally(
  p: Pick<CombatParticipantState, 'death_saves'> | null | undefined,
): { successes: number; failures: number } | null {
  return p?.death_saves ? { successes: p.death_saves.successes, failures: p.death_saves.failures } : null;
}

/**
 * TAV-COMBAT-VERB-NO-MECHANICS — the precise gate for the combat-verb guard,
 * deliberately NOT `sceneHasEncounter` (true after the fight is over; refusing
 * "I attack" over a resolved encounter would be wrong). Mirrors NekoNova's
 * `core/dm_narrator.py::combat_encounter_unstarted`: kind must be `combat`, and
 * the encounter must have NO `encounter_state` entry at all (an entry is stamped
 * `unresolved` the moment combat starts and `resolved_*` after, so presence
 * either way means "not our case"). `grounding.encounter_state` is the
 * flattened `campaign.progress.encounter_state` (dnd.ts normalizeGrounding).
 */
export function isCombatEncounterUnstarted(grounding: GroundingData | null): boolean {
  const enc = grounding?.encounter;
  if (!enc || typeof enc !== 'object') return false;
  if (enc.kind !== 'combat') return false;
  const encId = typeof enc.id === 'string' ? enc.id : '';
  if (!encId) return false;
  const encState = grounding?.encounter_state;
  if (!encState || typeof encState !== 'object') return true;
  return !(encId in encState);
}

/**
 * The scene's authored creature names, for the guard's tier-2 (targeted)
 * matcher. `monsters_resolved` is projected flavor-only by the engine
 * (project_monster_for_wire) and is present pre-combat. Defensive: any
 * non-array/odd shape yields [].
 */
export function groundingCreatureNames(grounding: GroundingData | null): string[] {
  const raw = (grounding?.encounter as { monsters_resolved?: unknown } | null | undefined)
    ?.monsters_resolved;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => (m && typeof m === 'object' ? (m as { name?: unknown }).name : undefined))
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
}

/** `HH:MM` timestamp (locale default) stamped onto every transcript row. */
export function nowStamp(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Poll interval in milliseconds, shared by every /play poll (session
 * status, combat state, dice-roll events, the unified durable events poll). */
export const POLL_INTERVAL_MS = 4000;

/**
 * DDX-25 R3: order-independent structural equality for two session
 * snapshots. Used by the session-status poll (useSessionLifecycle) to
 * decide whether a freshly-fetched snapshot actually differs from what's
 * already in state — a no-op tick (nothing changed server-side) must not
 * hand the tree a fresh `session` object identity (see the poll's own
 * comment for why that matters). `Session` carries arbitrary engine
 * passthrough fields (`[k: string]: unknown`), so comparing a hand-picked
 * subset (status, xp_pool, ...) risks silently missing a field the UI later
 * starts to depend on; comparing the whole snapshot doesn't have that
 * failure mode.
 */
export function sessionsEqual(
  a: Session | null | undefined,
  b: Session | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return stableKey(a) === stableKey(b);
}

/**
 * DDX-25 R2 (D2-D4): true once the session has been paused or ended — no
 * further player action should be accepted. A module-level pure function
 * (rather than only render-scope `isPaused`/`isEnded`/`sessionLocked`
 * consts, which page.tsx's JSX render-gates still use directly) so callbacks
 * created earlier in a component's body (e.g. useScene's onMoveOn/
 * onAttemptCheck) can reference the check without a temporal-dead-zone
 * hazard from closing over a later render-scope const.
 */
export function isSessionLocked(s: Session | null | undefined): boolean {
  return s?.status === 'paused' || s?.status === 'ended';
}

/**
 * Is `username` the table's DM? One definition for every /play site (the DM seat's controls, the composer's DM mode, the
 * monster driver, the post-turn focus rule): Kage A9d-2 S3 counted a fifth hand-rolled copy of this compare. Case-insensitive on
 * both sides: `dm_username` keeps the casing the creating client sent (an admin's create stores it as typed) and the engine's own
 * guard compares lower-cased (`guard_dm`).
 */
export function isSessionDm(s: Session | null | undefined, username: string | null | undefined): boolean {
  return !!(s?.dm_username && username && s.dm_username.toLowerCase() === username.toLowerCase());
}

/**
 * Which tab drives the monsters of an AI-auto table (A9d-2 N2, Kage I-2). The engine's `/monster-turn` is `guard_dm` (the DM or an
 * admin); before the DM gate every tab POSTed it on every poll. The election is ONE tab: the one whose user is `dm_username`
 * (case-insensitive, fail-closed), and nothing else. No admin fallback: on the real wire the Tavern cannot tell a seated pure DM from a
 * table whose DM account is nobody at it (`/participants` names `dm_username` unconditionally; `participant_usernames` leaves the DM
 * out), so a fallback elected every admin's tab beside the DM at any ordinary table, the several-drivers state this gate exists to end.
 */
export function drivesMonsterTurns(s: Session | null | undefined, username: string | null | undefined): boolean {
  // debt: a table whose DM account is at no seat (a Twitch-created or `suzu` row) has no driver, and nothing on screen says so. ceiling: none live (prod has 8 campaigns, none such). until: Backlog TAV-MONSTER-TURN-SERVER-SIDE-DRIVER.
  return isSessionDm(s, username);
}

/** A live turn order is running. NOT page.tsx's `combatIsActive`
 *  (`!!combatId && state !== 'ended'`), which is also true before initiative
 *  and between turns. This is the exact predicate the scene's offer memos
 *  have always used — keep them identical. */
export function isCombatEngaged(combatState: CombatState | null): boolean {
  return combatState?.state === 'active';
}

/**
 * DDX-26 — event kinds that count as a "narration beat" for the X-card
 * banner's auto-ease-off. Mirrors the engine's own soft-redirect auto-clear
 * EXACTLY (Kage IMPORTANT-2): the engine only clears soft_redirect on
 * 'dm_narration'/'narration' — NOT on 'player_action'. A player_action event
 * persists up front, before Suzu's narration streams back, so counting it
 * here would ease the banner off for the whole streaming turn (or
 * indefinitely on an abandoned turn) while the engine is still steering, and
 * could clear the banner on an ESCALATING player action — the opposite of
 * "the table eased off". Once the table has actually moved on to a new
 * narration beat, the banner steps aside on its own (no dismiss required) —
 * the raised signal is still permanent in the durable log (eventToLogRow's
 * 'x_card' case), only the live banner clears.
 */
const NARRATION_BEAT_KINDS = new Set(['dm_narration', 'narration']);

/**
 * DDX-26 — scan a batch of raw session events (any order, any kind) for the
 * highest-seq 'x_card' event and the highest-seq narration-beat event. Pure,
 * shared by both the mount-time rehydration path (full history) and the
 * recurring events poll (only the newly-observed slice) so "what's active"
 * is computed identically regardless of which path fed it. Seq+actor are
 * returned as one pair (never two independently-tracked values) so a batch
 * containing multiple x_card events always attributes the actor belonging
 * to the highest seq, never a stale one from an earlier raise in the batch.
 */
export function scanXCardTracking(events: EngineSessionEvent[]): {
  xCard: { seq: number; actor?: string } | null;
  narrationSeq: number | null;
} {
  let xCard: { seq: number; actor?: string } | null = null;
  let narrationSeq: number | null = null;
  for (const e of events) {
    const seq = e.seq ?? 0;
    if (e.kind === 'x_card') {
      if (!xCard || seq > xCard.seq) xCard = { seq, actor: e.actor };
    } else if (e.kind && NARRATION_BEAT_KINDS.has(e.kind)) {
      if (narrationSeq == null || seq > narrationSeq) narrationSeq = seq;
    }
  }
  return { xCard, narrationSeq };
}

/**
 * P1-READALOUD: Build the verbatim read-aloud block text from grounding data.
 * Matches the authored structure the AI-off path used to produce (§3.2 of the
 * design doc), now shared by all session types (AI-on, AI-off, human-DM).
 * Pure function — no side effects.
 */
export function buildReadAloudBlock(g: GroundingData): string {
  const lines: string[] = [];
  if (g.adventure_title) lines.push(`— ${g.adventure_title} —`);
  if (g.hook) lines.push(g.hook);
  if (g.scene_name) lines.push(`\nScene: ${g.scene_name}`);
  if (g.boxed_text) lines.push(g.boxed_text);
  if (g.objective) lines.push(`\nObjective: ${g.objective}`);
  return lines.filter(Boolean).join('\n');
}

/** JSON.stringify with object keys sorted at every level, so the same
 * logical value never compares as "different" purely because the engine (or
 * JS) happened to emit its keys in a different order. Inputs here are always
 * JSON-shaped (parsed HTTP responses / plain state) — no cycles, functions,
 * or Dates. */
function stableKey(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableKey).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableKey((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}
