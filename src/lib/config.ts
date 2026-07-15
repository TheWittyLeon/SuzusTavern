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
 * Rides env.ts's IS_PROD (NODE_ENV) signal rather than DEPLOY_ENV: DEPLOY_ENV
 * is only ever populated via NEXT_PUBLIC_DEPLOY_ENV in .env.local, which
 * Next's own env loader (@next/env) deliberately skips whenever
 * NODE_ENV==='test' — so a DEPLOY_ENV-based gate would read 'prod' (disabled)
 * inside every jest run. IS_PROD is false for `next dev`, false for the jest
 * suite (NODE_ENV=test), and true only for an actual production build/server
 * — exactly "off in prod, on everywhere else" with no extra env config
 * required for the local dev stack or CI.
 */
export const CODEX_ENABLED = !env.IS_PROD;

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
