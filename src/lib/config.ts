/**
 * src/lib/config.ts
 *
 * Feature flags and environment-driven config accessible to client components.
 * These are compile-time constants — flip them here and rebuild.
 *
 * One constant per gate; never scatter bare `false` literals across the UI.
 */

import { env } from './env';

/**
 * When false: Twitch and Discord OAuth buttons are disabled with an
 * "aria-disabled" + "soon" affordance. Flip to true once OAuth routes
 * are wired in Authentication-Python and the BFF handles the callbacks.
 */
export const OAUTH_ENABLED = false;

/**
 * When false: the Codex nav tab (TavernShell) renders disabled exactly like
 * the other not-yet-shipped tabs, and the /codex route itself redirects to
 * /dashboard — so it cannot be reached by direct URL either.
 *
 * Sourced from env.ts's CODEX_ENABLED, which defaults to `!IS_PROD` (off in
 * prod, on everywhere else — same "no extra env config needed for dev/CI"
 * behaviour this flag always had) but can be explicitly overridden via the
 * NEXT_PUBLIC_CODEX_ENABLED build var. This is deliberately a SEPARATE flag
 * from IS_PROD rather than a re-read of it: IS_PROD also gates three
 * security interlocks (the dev-only Authorization-header Bearer fallback in
 * the admin/auth, admin/flags, and dnd proxy BFF routes) that must keep
 * refusing a bare header in production regardless of whether the Codex is
 * turned on there. Flipping IS_PROD to enable the Codex would silently
 * reopen those interlocks — this flag lets ops turn the Codex on in prod
 * (e.g. NEXT_PUBLIC_CODEX_ENABLED=true at build time) without touching them.
 */
export const CODEX_ENABLED = env.CODEX_ENABLED;

/**
 * DDX-20 — durable server-side generation + unified events poll.
 *
 * When false (default): the play screen is byte-for-byte today's shipped
 * behaviour — DM turns POST to the legacy generate-and-stream
 * `/api/narration/dm/stream`, and the events poll renders ONLY `dice_roll`/
 * `x_card` rows (player/narration rows stay on the optimistic-append + SSE
 * paths). This is the current, executed code path — nothing new is dormant
 * OR active until the flag flips.
 *
 * When true: the poll adopts the `since_seq` cursor and becomes the
 * transcript's source of truth for the FULL unified event set; DM turns POST
 * to the new durable-job endpoint `/api/narration/dm/turn` and subscribe to
 * the job's SSE tail by `job_id`; every optimistic/streaming row is
 * reconciled to its durable `seq` via a client-minted `turn_key` so an
 * originating client never double-renders and a reload reconstructs purely
 * from the poll. See "DDX-20 — Tavern Client Integration Design" (Sora-Arch)
 * for the full mechanism.
 *
 * Rollout ordering (§2, §11 of that design): the engine flag
 * `SUZU_DND_DURABLE_GENERATION` must be ON first; only THEN rebuild Tavern
 * with this const `true`. Flipping this before the engine is ready 404s on
 * `/dm/turn`. Rollback: flip back to `false` and redeploy — no client-side
 * migration needed.
 */
export const DURABLE_GENERATION_ENABLED = false;
