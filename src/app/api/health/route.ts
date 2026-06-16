/**
 * Liveness probe for the container healthcheck.
 *
 * Unauthenticated by design — the proxy (proxy.ts) matcher excludes /api/*,
 * and this endpoint touches no upstream service (NekoNova / Authentication-Python),
 * so it stays green even if those are momentarily unreachable. It reports only
 * that the Next.js server process is up and serving.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok', service: 'suzus-tavern' });
}
