/**
 * TAV-PLAY-SHELL — shared formatting helpers for the /play route.
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
 * every region import FROM here, nothing imports from page.tsx.
 */

/** Title-case an engine skill slug ('sleight_of_hand' -> 'Sleight Of Hand'). */
export function titleCaseSkill(skill: string): string {
  return skill
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
