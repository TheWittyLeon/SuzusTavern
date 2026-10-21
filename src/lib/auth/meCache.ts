// src/lib/auth/meCache.ts — server-only
//
// Short-lived server-side cache of Authentication-Python's `GET /auth/me`, keyed per access token
// (HUNT1020-05). Why: the root layout asks /auth/me on EVERY document render, and Auth-Python caps
// that endpoint at 20/hour and 100/day per non-admin, so ordinary reloads locked players out. Leon's
// delegated ruling (H2, 2026-10-21): cache it on the Tavern server for 60 s.
//
// The one critical property is NO CROSS-USER BLEED:
//   - the key is the SHA-256 of the exact bearer token (never the token itself, never a user id or a
//     cookie name), so an entry can only be returned to a caller presenting that same token;
//   - only a successful /auth/me that returned a user object is ever stored (never an error, a
//     timeout, a 401 or a rate-limit), so an upstream blip cannot be cached as "signed out";
//   - an entry never outlives the token's own `exp`;
//   - a 401 for a token, a logout, or a password change evicts that token's entry;
//   - the map is a bounded LRU, so it cannot grow without limit.
//
// Cached values live only in this process's memory. The map hangs off globalThis because Next bundles
// the root layout (RSC) and the route handlers separately: a plain module-level Map would be two
// caches, and logout (a route handler) would not evict what the layout reads.
import 'server-only';
import { createHash } from 'node:crypto';

import type { User } from '@/lib/api/types';

export const ME_CACHE_TTL_MS = 60_000;
export const ME_CACHE_MAX_ENTRIES = 500;

interface Entry {
  user: User;
  expiresAt: number;
}

export interface MeCache {
  get(token: string): User | null;
  set(token: string, user: User, tokenExpUnixSec?: number | null): void;
  evict(token: string | null | undefined): void;
  clear(): void;
  readonly size: number;
}

/** SHA-256 hex of the bearer token. The token itself is never stored or logged. */
function keyOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createMeCache(
  opts: { ttlMs?: number; max?: number; now?: () => number } = {},
): MeCache {
  const ttlMs = opts.ttlMs ?? ME_CACHE_TTL_MS;
  const max = opts.max ?? ME_CACHE_MAX_ENTRIES;
  const now = opts.now ?? Date.now;
  // Map iteration order is insertion order: re-inserting on a hit makes the first key the LRU one.
  const entries = new Map<string, Entry>();

  return {
    get(token) {
      if (!token) return null;
      const k = keyOf(token);
      const hit = entries.get(k);
      if (!hit) return null;
      if (hit.expiresAt <= now()) {
        entries.delete(k);
        return null;
      }
      entries.delete(k);
      entries.set(k, hit);
      return hit.user;
    },
    set(token, user, tokenExpUnixSec) {
      if (!token || !user || typeof user !== 'object') return;
      let expiresAt = now() + ttlMs;
      if (typeof tokenExpUnixSec === 'number' && Number.isFinite(tokenExpUnixSec)) {
        expiresAt = Math.min(expiresAt, tokenExpUnixSec * 1000);
      }
      if (expiresAt <= now()) return;
      const k = keyOf(token);
      entries.delete(k);
      entries.set(k, { user, expiresAt });
      while (entries.size > max) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    evict(token) {
      if (token) entries.delete(keyOf(token));
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

const GLOBAL_KEY = '__suzusTavernMeCache';

/** The process-wide cache shared by the layout and the auth BFF route handlers. */
export function getSharedMeCache(): MeCache {
  const g = globalThis as unknown as Record<string, MeCache | undefined>;
  return (g[GLOBAL_KEY] ??= createMeCache());
}
