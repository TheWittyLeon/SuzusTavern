/**
 * TAV-PLAY-SHELL step 1 — breakpoint constants.
 *
 * `/play` has exactly one width breakpoint today, 880px, hardcoded twice in
 * Play.module.css (the `.mobileTabs`/mobile-pane switch and its neighbouring
 * `@media (min-width: 881px)` rule). `resolveLayout` (step 6, decomposition
 * plan §3.3) needs the SAME number in JS, so this is the one source of truth
 * — both JS (via `useMediaQuery`, `src/lib/useMediaQuery.ts` — reused as-is,
 * not reimplemented) and `scripts/check-layout-tokens.mjs` read it from here.
 *
 * CSS custom properties cannot be used inside an `@media` feature query
 * (no browser resolves `var()` there), so Play.module.css's own `@media`
 * rules still carry the literal 880/881. `check-layout-tokens.mjs` is what
 * keeps those in sync with this file — it parses both and fails on drift.
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
