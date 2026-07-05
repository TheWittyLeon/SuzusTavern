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
