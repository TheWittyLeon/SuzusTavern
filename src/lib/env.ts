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
}

function loadEnv(): Env {
  const isProd = process.env.NODE_ENV === 'production';

  function require(varName: string, devDefault: string): string {
    const val = process.env[varName];
    if (val) return val;
    if (isProd) {
      throw new Error(
        `Missing required environment variable "${varName}". Set this in your environment before starting the production server.`,
      );
    }
    return devDefault;
  }

  return Object.freeze({
    NEKANOVA_URL: require('NEXT_PUBLIC_NEKANOVA_URL', 'http://localhost:8080'),
    AUTH_API_URL: require('AUTH_API_URL', 'http://localhost:5000'),
    PUBLIC_AUTH_URL: process.env.NEXT_PUBLIC_AUTH_URL ?? null,
    IS_PROD: isProd,
  });
}

export const env: Env = loadEnv();
