/**
 * @jest-environment node
 *
 * Adversarial tests for src/app/api/dnd/sessions/[id]/bind/route.ts (B2-BFF)
 *
 * This BFF route is the ONLY layer that enforces the self-vs-DM identity gate
 * (A6/A11 from the Track B adversarial matrix). It must:
 *   - Allow a user to bind their OWN username (A9 path)
 *   - Allow the campaign DM to bind any member (A9 variant)
 *   - Deny a non-DM binding for a DIFFERENT user → 403 forbidden_other_user (A11)
 *   - Deny an unauthenticated caller → 401
 *   - Tunnel engine error reasons (not_your_character, not_a_member, msm_disabled)
 *     back to the client unchanged
 *   - Handle upstream unavailability gracefully (no 500)
 *
 * A6 (direct curl to engine bypassing Tavern): out of scope for this layer —
 * the engine's own ownership check is the backstop. Covered by engine tests
 * (test_not_your_character_returns_400).
 *
 * Pattern follows src/__tests__/api/auth-bff.test.ts:
 *   - global fetch mock via jest.fn()
 *   - import route handler after mocks
 *   - construct NextRequest objects manually
 */

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks (must be hoisted before imports)
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();

jest.mock('server-only', () => ({}));

jest.mock('../../lib/env', () => ({
  env: {
    AUTH_API_URL: 'http://auth:5000',
    NEKANOVA_URL: 'http://neko:8080',
    IS_PROD: false,
    PUBLIC_AUTH_URL: null,
  },
}));

beforeAll(() => {
  (global as Record<string, unknown>).fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

// Import after mocks
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('../../app/api/dnd/sessions/[id]/bind/route') as {
  POST: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(
  body: Record<string, unknown>,
  cookieHeader?: string,
): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (cookieHeader) headers.set('cookie', cookieHeader);
  return new NextRequest('http://localhost:3000/api/dnd/sessions/sess1/bind', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** Stub /auth/me to return a specific caller username. */
function stubAuthMe(callerUsername: string) {
  mockFetch.mockImplementationOnce(async (url: string) => {
    if (String(url).includes('/auth/me')) {
      return new Response(
        JSON.stringify({ user: { username: callerUsername } }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

/** Stub the session fetch (for DM lookup) then optionally the upstream bind.
 *
 * Shape matches the real proxy get_session response:
 *   proxy wraps engine's _ok({"session": _session_summary()}) as
 *   {"success": true, "data": {"session": {"dm_username": "..."}}}
 * The BFF now reads data.session.dm_username (Kage T-IMP-2 fix).
 */
function stubSessionDm(dmUsername: string | null) {
  mockFetch.mockImplementationOnce(async (url: string) => {
    if (String(url).includes('/api/dnd/sessions/')) {
      if (dmUsername === null) {
        return new Response(null, { status: 404 });
      }
      return new Response(
        JSON.stringify({ data: { session: { dm_username: dmUsername } } }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

/** Stub the upstream /bind forwarding call with a success response. */
function stubUpstreamBindOk(responseData: Record<string, unknown>) {
  mockFetch.mockImplementationOnce(async () =>
    new Response(JSON.stringify({ success: true, data: responseData }), {
      status: 200,
    }),
  );
}

/** Stub the upstream /bind forwarding call with an error response. */
function stubUpstreamBindError(status: number, reason: string) {
  mockFetch.mockImplementationOnce(async () =>
    new Response(
      JSON.stringify({ success: false, message: 'error', data: { reason } }),
      { status },
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/dnd/sessions/[id]/bind — BFF identity gate', () => {
  // ── Unauthenticated ────────────────────────────────────────────────────────

  it('A11: no cookie → 401 before touching the engine', async () => {
    const req = makeRequest({ username: 'alice', character_id: 42 });
    // No cookie → readAccess returns null → should 401 without any fetch
    const res = await POST(req, makeCtx('sess1'));
    expect(res.status).toBe(401);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(false);
    // Must not have called auth/me or the engine
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('A11: cookie present but /auth/me returns non-ok → 401', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const req = makeRequest(
      { username: 'alice', character_id: 42 },
      'st_access=bad-token',
    );
    const res = await POST(req, makeCtx('sess1'));
    expect(res.status).toBe(401);
    // Only auth/me was called (one fetch); engine was NOT reached
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ── Missing / malformed body ───────────────────────────────────────────────

  it('missing username → 400 without calling auth/me', async () => {
    const req = makeRequest({ character_id: 42 }, 'st_access=tok');
    const res = await POST(req, makeCtx('sess1'));
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('empty string username → 400 without calling auth/me', async () => {
    const req = makeRequest({ username: '   ', character_id: 42 }, 'st_access=tok');
    const res = await POST(req, makeCtx('sess1'));
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('invalid JSON body → 400', async () => {
    const headers = new Headers({ 'content-type': 'application/json', 'cookie': 'st_access=tok' });
    const req = new NextRequest('http://localhost:3000/api/dnd/sessions/sess1/bind', {
      method: 'POST',
      headers,
      body: '{bad json',
    });
    const res = await POST(req, makeCtx('sess1'));
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Self-bind (A9: always allowed) ────────────────────────────────────────

  it('A9: self-bind — caller binds their OWN username → forwarded, 200', async () => {
    // Sequence: auth/me → upstream bind
    stubAuthMe('alice');
    stubUpstreamBindOk({
      campaign_id: 'sess1', username: 'alice', role: 'player', character_id: 42,
    });

    const req = makeRequest(
      { username: 'alice', character_id: 42 },
      'st_access=valid-token',
    );
    const res = await POST(req, makeCtx('sess1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { character_id: number } };
    expect(body.success).toBe(true);
    expect(body.data.character_id).toBe(42);

    // Auth/me called once; session NOT fetched (self-bind skips DM lookup);
    // upstream bind called once.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('A9: self-bind — case-insensitive username match allowed', async () => {
    // Caller is 'Alice' (capitalised); target is 'alice' — should be treated as self.
    stubAuthMe('Alice');
    stubUpstreamBindOk({ campaign_id: 'sess1', username: 'alice', character_id: 7 });

    const req = makeRequest(
      { username: 'alice', character_id: 7 },
      'st_access=tok',
    );
    const res = await POST(req, makeCtx('sess1'));
    expect(res.status).toBe(200);
    // DM session-info fetch must NOT have been called (identified as self).
    // The upstream /bind call URL ends with '/bind', so filter that out to check
    // that the session-lookup (no trailing /bind) was skipped.
    const calls = (mockFetch.mock.calls as [string][]).map(([url]) => url);
    const dmLookupCalled = calls.some(
      (u: string) => u.includes('/api/dnd/sessions/') && !u.endsWith('/bind'),
    );
    expect(dmLookupCalled).toBe(false);
  });

  it('A9: self-bind with character_id=null (clear bind) → forwarded intact', async () => {
    stubAuthMe('alice');
    stubUpstreamBindOk({ campaign_id: 'sess1', username: 'alice', character_id: null });

    const req = makeRequest({ username: 'alice', character_id: null }, 'st_access=tok');
    const res = await POST(req, makeCtx('sess1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { character_id: unknown } };
    expect(body.data.character_id).toBeNull();
  });

  // ── DM rebinding another member (allowed) ─────────────────────────────────

  it('DM binds a different member → session DM lookup happens, 200 forwarded', async () => {
    // Sequence: auth/me → session fetch → upstream bind
    stubAuthMe('suzu-dm');
    stubSessionDm('suzu-dm');
    stubUpstreamBindOk({
      campaign_id: 'sess1', username: 'bob', role: 'player', character_id: 99,
    });

    const req = makeRequest(
      { username: 'bob', character_id: 99 },
      'st_access=dm-token',
    );
    const res = await POST(req, makeCtx('sess1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
    // Three fetch calls: auth/me + session (DM check) + upstream bind
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // ── Non-DM binding for another user (A11: must be denied 403) ────────────

  it('A11: non-DM binding for a different user → 403 forbidden_other_user', async () => {
    // Sequence: auth/me → session fetch (caller is NOT the DM) → gate fires
    stubAuthMe('alice');
    stubSessionDm('suzu-dm');  // dm is 'suzu-dm', caller is 'alice'

    const req = makeRequest(
      { username: 'bob', character_id: 7 },
      'st_access=alice-token',
    );
    const res = await POST(req, makeCtx('sess1'));

    expect(res.status).toBe(403);
    const body = await res.json() as { success: boolean; data: { reason: string } };
    expect(body.success).toBe(false);
    expect(body.data.reason).toBe('forbidden_other_user');

    // Upstream bind must NOT have been called — gate fired before forwarding.
    const calls = (mockFetch.mock.calls as [string][]).map(([url]) => url);
    const upstreamBindCalled = calls.some((u: string) => u.includes('/bind'));
    expect(upstreamBindCalled).toBe(false);
  });

  it('A11: non-DM binding — session fetch fails (404) → still 403, not 500', async () => {
    // If we can't confirm the DM, default to deny (fail-closed).
    stubAuthMe('alice');
    stubSessionDm(null);  // session fetch returns 404

    const req = makeRequest(
      { username: 'bob', character_id: 7 },
      'st_access=alice-token',
    );
    const res = await POST(req, makeCtx('sess1'));

    // Can't confirm caller is DM → must deny, not allow
    expect(res.status).toBe(403);
    const body = await res.json() as { data: { reason: string } };
    expect(body.data.reason).toBe('forbidden_other_user');
  });

  // ── Engine error tunnelling ────────────────────────────────────────────────

  it('engine 400 not_your_character tunnelled back unchanged', async () => {
    stubAuthMe('alice');
    stubUpstreamBindError(400, 'not_your_character');

    const req = makeRequest({ username: 'alice', character_id: 99 }, 'st_access=tok');
    const res = await POST(req, makeCtx('sess1'));
    expect(res.status).toBe(400);
    const body = await res.json() as { data: { reason: string } };
    expect(body.data.reason).toBe('not_your_character');
  });

  it('engine 400 not_a_member tunnelled back unchanged', async () => {
    stubAuthMe('alice');
    stubUpstreamBindError(400, 'not_a_member');

    const req = makeRequest({ username: 'alice', character_id: 5 }, 'st_access=tok');
    const res = await POST(req, makeCtx('sess1'));
    expect(res.status).toBe(400);
    const body = await res.json() as { data: { reason: string } };
    expect(body.data.reason).toBe('not_a_member');
  });

  it('engine 503 msm_disabled tunnelled back unchanged', async () => {
    stubAuthMe('alice');
    stubUpstreamBindError(503, 'msm_disabled');

    const req = makeRequest({ username: 'alice', character_id: 5 }, 'st_access=tok');
    const res = await POST(req, makeCtx('sess1'));
    expect(res.status).toBe(503);
    const body = await res.json() as { data: { reason: string } };
    expect(body.data.reason).toBe('msm_disabled');
  });

  // ── Upstream unavailability ────────────────────────────────────────────────

  it('upstream network error → 502, not 500', async () => {
    stubAuthMe('alice');
    // fetch throws (network down)
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const req = makeRequest({ username: 'alice', character_id: 5 }, 'st_access=tok');
    const res = await POST(req, makeCtx('sess1'));
    expect(res.status).toBe(502);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(false);
  });
});
