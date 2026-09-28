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
 * Hook 4 (`useScene`): `isSessionLocked` and `buildReadAloudBlock` moved
 * here too, for the same reason — `onMoveOn`/`onAttemptCheck`/`openScene`
 * need both, and page.tsx's own onRoll/monster-auto-driver (not yet
 * extracted) keep needing `isSessionLocked`.
 */
import type { GroundingData, Session } from '@/lib/api/types';

/** Title-case an engine skill slug ('sleight_of_hand' -> 'Sleight Of Hand'). */
export function titleCaseSkill(skill: string): string {
  return skill
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
