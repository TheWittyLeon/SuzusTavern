/**
 * @jest-environment node
 *
 * Tests for src/lib/api/client.ts
 *
 * Covers:
 *   (a) JSON body serialisation
 *   (b) ApiError shape on 4xx/5xx
 *   (c) 401 triggers /api/auth/refresh + retry once
 *   (d) 401 on refresh path itself does NOT recurse
 *   (e) signal abort cancels mid-flight
 */

import { apiFetch, apiCall, makeApiError } from '../../lib/api/client';
import type { ApiError } from '../../lib/api/types';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();

beforeEach(() => {
  mockFetch.mockReset();
  (global as Record<string, unknown>).fetch = mockFetch;
  // Reset module so refreshInFlight is cleared between tests
  jest.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// makeApiError
// ---------------------------------------------------------------------------

describe('makeApiError', () => {
  it('creates an Error with status and code properties', () => {
    const err = makeApiError(404, 'not_found');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(404);
    expect(err.code).toBe('not_found');
    expect(err.body).toBeUndefined();
  });

  it('attaches body when provided', () => {
    const body = { detail: 'gone' };
    const err = makeApiError(410, 'gone', body);
    expect(err.body).toEqual(body);
  });
});

// ---------------------------------------------------------------------------
// apiFetch — JSON body serialisation
// ---------------------------------------------------------------------------

describe('apiFetch — JSON body', () => {
  it('sets Content-Type and stringified body for json option', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiFetch('/api/test', { json: { hello: 'world' }, method: 'POST' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    const headers = init.headers as Headers;
    expect(headers.get('content-type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ hello: 'world' }));
  });

  it('attaches credentials: same-origin', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiFetch('/api/test');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('same-origin');
  });

  it('passes rawBody through without setting Content-Type for json', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const raw = 'raw body content';
    await apiFetch('/api/test', { rawBody: raw, method: 'POST' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect(init.body).toBe(raw);
    // Content-Type must NOT be auto-set to application/json for rawBody
    expect((init.headers as Headers).get('content-type')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// apiFetch — ApiError on non-2xx
// ---------------------------------------------------------------------------

describe('apiFetch — ApiError shape', () => {
  it('throws ApiError with correct status on 400', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'bad_request' }, 400),
    );

    await expect(apiFetch('/api/test')).rejects.toMatchObject<Partial<ApiError>>({
      status: 400,
      code: 'bad_request',
    });
  });

  it('throws ApiError with correct status on 500', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'server_error' }, 500),
    );

    await expect(apiFetch('/api/test')).rejects.toMatchObject<Partial<ApiError>>({
      status: 500,
      code: 'server_error',
    });
  });

  it('extracts code from "code" field when "error" field is absent', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ code: 'validation_failed', detail: 'bad param' }, 422),
    );

    const err = (await apiFetch('/api/test').catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(422);
    expect(err.code).toBe('validation_failed');
  });

  it('handles non-JSON error body gracefully', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('plain text error', {
        status: 503,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const err = (await apiFetch('/api/test').catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(503);
    expect(typeof err.code).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// apiFetch — 401 retry logic
// ---------------------------------------------------------------------------

describe('apiFetch — 401 refresh-then-retry', () => {
  it('calls /api/auth/refresh on 401 then retries original request', async () => {
    // First call to /api/test → 401
    // Second call to /api/auth/refresh → 200
    // Third call to /api/test → 200
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // refresh
      .mockResolvedValueOnce(jsonResponse({ data: 'success' })); // retry

    const result = await apiFetch<{ data: string }>('/api/test');

    expect(mockFetch).toHaveBeenCalledTimes(3);
    const refreshCall = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(refreshCall[0]).toBe('/api/auth/refresh');
    expect(refreshCall[1].method).toBe('POST');
    expect(result).toEqual({ data: 'success' });
  });

  it('throws 401 ApiError if refresh fails', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: 'refresh_failed' }, 401)); // refresh fails

    await expect(apiFetch('/api/test')).rejects.toMatchObject<Partial<ApiError>>({
      status: 401,
      code: 'unauthorized',
    });
  });

  it('does NOT retry when _retried is true', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401));

    await expect(apiFetch('/api/test', { _retried: true })).rejects.toMatchObject<Partial<ApiError>>({
      status: 401,
    });

    // Should not have made a second call for refresh
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT recurse when path is /api/auth/refresh', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401));

    await expect(apiFetch('/api/auth/refresh')).rejects.toMatchObject<Partial<ApiError>>({
      status: 401,
    });

    // Should not trigger another refresh attempt
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws 401 ApiError when refresh network call itself throws', async () => {
    // Original request → 401; then refresh fetch() itself throws a network error
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))
      .mockRejectedValueOnce(new Error('ECONNREFUSED')); // refresh network failure

    await expect(apiFetch('/api/test')).rejects.toMatchObject<Partial<ApiError>>({
      status: 401,
      code: 'unauthorized',
    });
  });

  it('does not make duplicate refresh calls when two concurrent 401s fire', async () => {
    // Both first calls return 401; refresh returns 200 once; both retries succeed
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401)) // call A
      .mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401)) // call B
      .mockResolvedValueOnce(jsonResponse({ ok: true }))                   // refresh (single)
      .mockResolvedValueOnce(jsonResponse({ a: 1 }))                       // retry A
      .mockResolvedValueOnce(jsonResponse({ b: 2 }));                      // retry B

    const [a, b] = await Promise.all([
      apiFetch<{ a: number }>('/api/a'),
      apiFetch<{ b: number }>('/api/b'),
    ]);

    expect(a).toEqual({ a: 1 });
    expect(b).toEqual({ b: 2 });

    // Only one refresh call
    const refreshCalls = mockFetch.mock.calls.filter(
      ([url]) => url === '/api/auth/refresh',
    );
    expect(refreshCalls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// apiFetch — network/abort errors
// ---------------------------------------------------------------------------

describe('apiFetch — network/abort errors', () => {
  it('throws ApiError with code "network" on fetch throw', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(apiFetch('/api/test')).rejects.toMatchObject<Partial<ApiError>>({
      status: 0,
      code: 'network',
    });
  });

  it('throws ApiError with code "abort" on AbortError', async () => {
    const abortErr = new DOMException('Aborted', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortErr);

    await expect(apiFetch('/api/test')).rejects.toMatchObject<Partial<ApiError>>({
      status: 0,
      code: 'abort',
    });
  });
});

// ---------------------------------------------------------------------------
// apiCall — envelope unwrapping
// ---------------------------------------------------------------------------

describe('apiCall — envelope unwrapping', () => {
  it('returns data on {success: true, data}', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { id: 42 } }),
    );

    const result = await apiCall<{ id: number }>('/api/test');
    expect(result).toEqual({ id: 42 });
  });

  it('throws ApiError on {success: false, error}', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'not_found' }),
    );

    await expect(apiCall('/api/test')).rejects.toMatchObject<Partial<ApiError>>({
      code: 'not_found',
      // A 2xx carrying {success:false} is a business error → surfaced as 422,
      // never as a misleading 200.
      status: 422,
    });
  });
});
