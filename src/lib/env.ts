// src/lib/env.ts
//
// Centralised, typed env access. Read once at module load; throws in
// production if anything required is missing; falls back to dev defaults
// only when NODE_ENV !== 'production'.
//
// MUST NOT import anything Next-server-only at the top level (this file is
// imported by client code too — only NEXT_PUBLIC_* is read on the client side).

export interface Env {
  /** Public — used by client + dnd/narration proxies. Spelt NEKANOVA on purpose. */
  NEKANOVA_URL: string;           // NEXT_PUBLIC_NEKANOVA_URL
  /** Server-only — used by the auth BFF to reach Authentication-Python. */
  AUTH_API_URL: string;           // AUTH_API_URL (server-only)
  /** Public — optional, only set if a client component must link to auth UI. */
  PUBLIC_AUTH_URL: string | null; // NEXT_PUBLIC_AUTH_URL
  /** Set automatically by Next. */
  IS_PROD: boolean;
  /**
   * Whether session cookies carry the `Secure` attribute (HTTPS-only). Defaults
   * to IS_PROD (secure-by-default), but can be explicitly overridden via the
   * COOKIE_SECURE env var. MUST be set false for an HTTP-only deployment (e.g.
   * the homelab LAN), because browsers silently DROP `Secure` cookies served
   * over plain HTTP — which breaks the login session entirely.
   */
  COOKIE_SECURE: boolean;         // COOKIE_SECURE (server-only)
  /**
   * Deployment environment signal — baked in at build/container time.
   * Drives the <EnvBanner/>: 'prod' renders nothing; 'dev' or 'local'
   * renders a high-contrast sticky banner on every page.
   * Missing or empty value defaults to 'prod' (safe default).
   * Set via NEXT_PUBLIC_DEPLOY_ENV in docker-compose env (homelab).
   */
  DEPLOY_ENV: 'prod' | 'dev' | 'local';  // NEXT_PUBLIC_DEPLOY_ENV
  /**
   * Whether the Codex nav tab / route is enabled. Defaults to `!IS_PROD`
   * (on in dev/test, off in prod) — a var-unset build is byte-identical to
   * pre-flag behaviour. Explicit override via NEXT_PUBLIC_CODEX_ENABLED lets
   * a deploy turn the Codex on in production WITHOUT flipping IS_PROD, which
   * also gates the admin/dnd-proxy Bearer-fallback security interlocks (see
   * config.ts's CODEX_ENABLED doc comment for the full rationale).
   */
  CODEX_ENABLED: boolean;         // NEXT_PUBLIC_CODEX_ENABLED
}

/** Parse a boolean-ish env var. Returns undefined when unset/empty. */
function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === '') return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return undefined;
}

function loadEnv(): Env {
  const isProd = process.env.NODE_ENV === 'production';

  const isServer = typeof window === 'undefined';

  // NEXT_PUBLIC_* vars MUST be referenced statically as `process.env.NEXT_PUBLIC_x`
  // at the call site (below) so Next/Turbopack inlines the build-time value into
  // the client bundle. A dynamic `process.env[name]` lookup is NOT inlined and
  // resolves to undefined on the client — which threw at module load in prod.
  function requirePublic(val: string | undefined, varName: string, devDefault: string): string {
    if (val) return val;
    if (isProd) {
      throw new Error(
        `Missing required environment variable "${varName}". Set this in your environment before starting the production server.`,
      );
    }
    return devDefault;
  }

  // Server-only vars are never inlined into the client bundle, so only enforce
  // them on the server; on the client they fall back to the dev default (they
  // are never actually read client-side).
  function requireServer(val: string | undefined, varName: string, devDefault: string): string {
    if (val) return val;
    if (isProd && isServer) {
      throw new Error(
        `Missing required environment variable "${varName}". Set this in your environment before starting the production server.`,
      );
    }
    return devDefault;
  }

  // Secure cookies by default in prod; allow an explicit override for HTTP-only
  // deployments (homelab LAN) where Secure cookies would be dropped by browsers.
  const cookieSecure = parseBool(process.env.COOKIE_SECURE) ?? isProd;

  // DEPLOY_ENV — build-time constant. Explicit default 'prod' so a missing var
  // is always safe (no banner leaks into production accidentally).
  const rawDeployEnv = process.env.NEXT_PUBLIC_DEPLOY_ENV?.trim().toLowerCase();
  const DEPLOY_ENV: 'prod' | 'dev' | 'local' =
    rawDeployEnv === 'dev' ? 'dev'
    : rawDeployEnv === 'local' ? 'local'
    : 'prod';

  // Codex nav/route flag — defaults to !isProd (on in dev/test, off in prod);
  // an explicit NEXT_PUBLIC_CODEX_ENABLED overrides that default either way.
  // Referenced as a static `process.env.NEXT_PUBLIC_x` literal (not a dynamic
  // lookup) so Next inlines the build-time value into the client bundle —
  // same requirement as every other NEXT_PUBLIC_* read in this file.
  const codexEnabled = parseBool(process.env.NEXT_PUBLIC_CODEX_ENABLED) ?? !isProd;

  return Object.freeze({
    NEKANOVA_URL: requirePublic(process.env.NEXT_PUBLIC_NEKANOVA_URL, 'NEXT_PUBLIC_NEKANOVA_URL', 'http://localhost:8080'),
    AUTH_API_URL: requireServer(process.env.AUTH_API_URL, 'AUTH_API_URL', 'http://localhost:5000'),
    PUBLIC_AUTH_URL: process.env.NEXT_PUBLIC_AUTH_URL ?? null,
    IS_PROD: isProd,
    COOKIE_SECURE: cookieSecure,
    DEPLOY_ENV,
    CODEX_ENABLED: codexEnabled,
  });
}

export const env: Env = loadEnv();
