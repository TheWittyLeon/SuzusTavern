/**
 * TAV-PLAY-SHELL step 1 — breakpoint constants.
 *
 * `/play` has exactly one width breakpoint, 880px. `resolveLayout` (step 6,
 * decomposition plan §3.3) switches the phone row on it in JS (via
 * `useMediaQuery`, `src/lib/useMediaQuery.ts` — reused as-is, not
 * reimplemented), so this is the one source of truth.
 *
 * CSS custom properties cannot be used inside an `@media` feature query
 * (no browser resolves `var()` there). Until A9d E4 Play.module.css and
 * Drawer.module.css carried their own 880/881 copies; both are gone, and
 * `scripts/check-layout-tokens.mjs` (Rule 2) now fails if a literal near this
 * number reappears in either, rather than keeping copies in sync.
 *
 * Deliberately ONE export. The repo has 20 distinct breakpoints across 71
 * CSS files (measured 2026-09-21); consolidating all of them is 2.0
 * design-system work (CLAUDE.md's "explicitly not the design-system
 * rebuild"), not something the play shell needs. Add the next constant here
 * when the next region genuinely needs its own breakpoint, not before.
 */
export const PLAY_PHONE_MAX_WIDTH = 880;

/** `useMediaQuery` query string for "is the play shell in its phone layout". */
export const PLAY_PHONE_QUERY = `(max-width: ${PLAY_PHONE_MAX_WIDTH}px)`;
