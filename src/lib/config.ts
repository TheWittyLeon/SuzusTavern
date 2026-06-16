/**
 * src/lib/config.ts
 *
 * Feature flags and environment-driven config accessible to client components.
 * These are compile-time constants — flip them here and rebuild.
 *
 * One constant per gate; never scatter bare `false` literals across the UI.
 */

/**
 * When false: Twitch and Discord OAuth buttons are disabled with an
 * "aria-disabled" + "soon" affordance. Flip to true once OAuth routes
 * are wired in Authentication-Python and the BFF handles the callbacks.
 */
export const OAUTH_ENABLED = false;
