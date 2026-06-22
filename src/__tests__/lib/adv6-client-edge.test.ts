/**
 * @jest-environment node
 *
 * ADV-6 combatFromScene client-layer edge tests.
 *
 * Tests the api/dnd.ts combatFromScene function directly (not the React component).
 * These live in __tests__/lib/ to match the rest of the api-dnd.test.ts suite.
 *
 * Gaps filled vs api-dnd.test.ts:
 *   1. success:false on a 2xx response → apiCall throws (not silently succeeds).
 *   2. Non-JSON body on 4xx → client throws without crashing.
 *   3. Network failure → throws ApiError with status 0.
 */

import { combatFromScene } from '../../lib/api/dnd';

const mockFetch = jest.fn();

beforeAll(() => {
  (global as Record<string, unknown>).fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  // Most tests don't need auth — stub the refresh endpoint to avoid 401 loops.
  // The client retries once on 401; stub the refresh to avoid side effects.
  process.env.NEXT_PUBLIC_NEKANOVA_URL = 'http://localhost:8080';
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_NEKANOVA_URL;
});

describe('combatFromScene client (ADV-6) — adversarial inputs', () => {
  it('success:false on 2xx → apiCall throws, not silently returns data', async () => {
    // The engine MIGHT return success:false with status 200 in a degenerate
    // proxy path.  apiCall must throw in that case — callers rely on the
    // throw to display error messages.
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: 'No encounter available for the current scene.',
          data: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(combatFromScene({ session_id: 's1' })).rejects.toThrow();
  });

  it('non-JSON body on 400 → throws without crashing the client', async () => {
    // The proxy might forward a plain-text error from the engine.
    // The client must throw (not return undefined) and must not crash.
    mockFetch.mockResolvedValueOnce(
      new Response('Bad Request', {
        status: 400,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    await expect(combatFromScene({ session_id: 's1' })).rejects.toThrow();
  });

  it('network failure → throws with status 0', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const err = await combatFromScene({ session_id: 's1' }).catch((e) => e);
    expect(err).toBeDefined();
    // ApiError sets status 0 for network errors
    expect((err as Record<string, unknown>).status).toBe(0);
  });

  it('encounter_id omitted → body does not contain encounter_id key', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            combat_id: 'c1',
            round: 1,
            monsters: [],
            encounter_id: 'enc1',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await combatFromScene({ session_id: 's1' });

    const [, fetchOpts] = mockFetch.mock.calls[0] as [
      string,
      RequestInit & { body?: string },
    ];
    const body = JSON.parse(fetchOpts.body ?? '{}') as Record<string, unknown>;
    expect(body['encounter_id']).toBeUndefined();
  });

  it('encounter_id provided → forwarded in body', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { combat_id: 'c2', round: 1, monsters: [], encounter_id: 'krell_band' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await combatFromScene({ session_id: 's1', encounter_id: 'krell_band' });

    const [, fetchOpts] = mockFetch.mock.calls[0] as [
      string,
      RequestInit & { body?: string },
    ];
    const body = JSON.parse(fetchOpts.body ?? '{}') as Record<string, unknown>;
    expect(body['encounter_id']).toBe('krell_band');
  });
});
