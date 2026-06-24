/**
 * B2: Bind / re-bind a campaign member's character.
 * POST /api/dnd/sessions/[id]/bind
 *
 * This specific route sits inside the Next.js App Router route tree and is
 * resolved BEFORE the catch-all /api/dnd/[...path]/route.ts. It is the ONLY
 * place in the Tavern BFF that has the logged-in user's identity (via the
 * st_access httpOnly cookie), making it the correct layer for the self-vs-DM
 * authorization gate.
 *
 * Auth gate:
 *   - Caller may bind for their OWN username (always allowed).
 *   - Campaign DM may bind for ANY campaign member.
 *   - Anyone else gets 403 forbidden_other_user without forwarding to the proxy.
 *
 * Identity resolution:
 *   - Read st_access cookie → call AUTH_API_URL/auth/me → obtain caller username.
 *   - If target username === caller username: self-bind, allow.
 *   - Else: fetch /api/dnd/sessions/{id} from the proxy to get dm_username.
 *     If caller is DM: allow. Otherwise: 403.
 *
 * The engine (via the proxy) still enforces character OWNERSHIP — a caller may
 * not bind a character they don't own regardless of DM status. The proxy's
 * shared DND_API_KEY token is forwarded as-is by the catch-all proxy; this
 * route forwards it the same way (via the st_access Bearer injection).
 *
 * Error tunnelling: engine 400 reasons (not_a_member, not_your_character,
 * unknown_character) and 503 (msm_disabled) are tunnelled back unchanged so
 * the client can branch on them.
 */
import { NextRequest, NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { readAccess } from '@/lib/auth/cookies';

type Ctx = { params: Promise<{ id: string }> };

const NEKANOVA_URL = env.NEKANOVA_URL;

/** Resolve the logged-in username by calling /auth/me with the access token. */
async function resolveCallerUsername(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${env.AUTH_API_URL}/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json() as { user?: { username?: string } };
    return data?.user?.username ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch the session's dm_username from the NekoNova proxy.
 * Uses the Bearer token the proxy already understands (the DND API key injected
 * by the catch-all proxy, which injects the st_access Bearer).
 */
/**
 * Fetch the session's dm_username from the NekoNova proxy.
 *
 * Response chain (verified against engine routes/sessions.py::get_session_route and
 * proxy api/routes/dnd_sessions.py::get_session):
 *   Engine  → {"success": true, "data": {"session": {..., "dm_username": "..."}}}
 *   Proxy   → {"success": true, "data": {"session": {..., "dm_username": "..."}}}
 *   Shape   → data.session.dm_username  ← the correct path.
 *
 * The proxy's get_session returns `result.get("data", {})` where the engine's
 * _ok({"session": _session_summary(session)}) wraps the summary under "session".
 * So the correct path is data.session.dm_username, NOT data.dm_username.
 *
 * Defensive console.warn if neither shape matches so it surfaces in dev without
 * silently falling through to null and granting a 403 to the DM.
 */
async function fetchSessionDm(sessionId: string, accessToken: string): Promise<string | null> {
  try {
    const upstreamUrl = new URL(`/api/dnd/sessions/${encodeURIComponent(sessionId)}`, NEKANOVA_URL);
    const res = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = await res.json() as {
      data?: {
        session?: { dm_username?: string };
      };
    };
    // Correct path: data.session.dm_username (engine wraps summary under "session" key).
    const dmUsername = body?.data?.session?.dm_username ?? null;
    if (dmUsername == null) {
      // If the shape ever changes this warn surfaces it in dev logs without crashing.
      console.warn(
        '[bind/route] fetchSessionDm: dm_username not found at data.session.dm_username.',
        'Check engine _session_summary or proxy get_session response shape.',
        'Received data keys:',
        Object.keys(body?.data ?? {}),
      );
    }
    return dmUsername;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id: sessionId } = await ctx.params;

  // ── 1. Parse the request body ──────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const targetUsername = typeof body.username === 'string' ? body.username.trim() : '';
  if (!targetUsername) {
    return NextResponse.json(
      { success: false, error: 'username is required' },
      { status: 400 },
    );
  }

  // ── 2. Resolve caller identity from the httpOnly access cookie ─────────────
  const accessToken = readAccess(req.cookies);
  if (!accessToken) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated' },
      { status: 401 },
    );
  }

  const callerUsername = await resolveCallerUsername(accessToken);
  if (!callerUsername) {
    return NextResponse.json(
      { success: false, error: 'Could not resolve caller identity' },
      { status: 401 },
    );
  }

  // ── 3. Self-vs-DM gate ─────────────────────────────────────────────────────
  const isSelf = targetUsername.toLowerCase() === callerUsername.toLowerCase();

  if (!isSelf) {
    // Not self — check if caller is the campaign DM.
    const dmUsername = await fetchSessionDm(sessionId, accessToken);
    const isDm =
      dmUsername != null &&
      dmUsername.toLowerCase() === callerUsername.toLowerCase();

    if (!isDm) {
      return NextResponse.json(
        {
          success: false,
          error: 'You may only change your own character binding.',
          data: { reason: 'forbidden_other_user' },
        },
        { status: 403 },
      );
    }
  }

  // ── 4. Forward to the NekoNova proxy ──────────────────────────────────────
  const upstreamUrl = new URL(
    `/api/dnd/sessions/${encodeURIComponent(sessionId)}/bind`,
    NEKANOVA_URL,
  );

  const forwardHeaders = new Headers();
  forwardHeaders.set('content-type', 'application/json');
  forwardHeaders.set('authorization', `Bearer ${accessToken}`);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Upstream unavailable' },
      { status: 502 },
    );
  }

  // Tunnel the response (including engine error reasons) back unchanged.
  const responseData: unknown = await upstream.json();
  return NextResponse.json(responseData, { status: upstream.status });
}
