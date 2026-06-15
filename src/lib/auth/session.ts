// src/lib/auth/session.ts — server-only
import 'server-only';
import { cookies } from 'next/headers';

import { env } from '@/lib/env';
import type { User } from '@/lib/api/types';
import { ACCESS_COOKIE } from './cookies';

// Re-export the pure Edge-safe helpers so callers that don't need server APIs
// can import from here without hitting the server-only guard.
export { decodeJwtExp, isExpired } from './jwt';

/**
 * Server-component helper. Reads st_access from cookies, decodes exp,
 * fetches the user directly from AUTH_API_URL server-to-server.
 *
 * Does NOT call the BFF route (which resolves against window.location.origin —
 * undefined server-side). Goes directly to Authentication-Python instead.
 *
 * Returns {user: User | null, accessExpiresAt: number | null}.
 */
export async function getServerSession(): Promise<{
  user: User | null;
  accessExpiresAt: number | null;
}> {
  const { decodeJwtExp, isExpired } = await import('./jwt');
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE)?.value ?? null;
  const accessExpiresAt = token ? decodeJwtExp(token) : null;

  if (!token || isExpired(token)) {
    return { user: null, accessExpiresAt };
  }

  try {
    const res = await fetch(`${env.AUTH_API_URL}/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      // Don't cache — session state changes frequently
      cache: 'no-store',
    });

    if (!res.ok) {
      return { user: null, accessExpiresAt };
    }

    const data = await res.json() as { user?: User };
    return { user: data.user ?? null, accessExpiresAt };
  } catch {
    // Network error or parse failure — treat as no session
    return { user: null, accessExpiresAt };
  }
}
