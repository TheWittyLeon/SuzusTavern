/**
 * TAV-RETIRE-MLP-HUMAN: useCatalog.ts assembles the character-creation
 * wizard's race list from a single call site (GET /catalog?type=race) — this
 * is the ONLY place that list is built, so hiding a race here is sufficient
 * to retire it from the wizard without touching the engine.
 */
import { renderHook, waitFor } from '@testing-library/react';

const mockGetCatalog = jest.fn();
jest.mock('../../lib/api/dnd', () => ({
  getCatalog: (...args: unknown[]) => mockGetCatalog(...args),
}));

import { useCatalog } from '../../lib/dnd/useCatalog';
import type { CatalogItem } from '../../lib/api/types';

function raceItem(slug: string, name: string): CatalogItem {
  return {
    slug,
    name,
    content_type: 'race',
    source_type: 'srd',
    data: { ability_bonus: {}, speed: 30, subraces: {} },
  };
}

beforeEach(() => {
  mockGetCatalog.mockReset();
});

describe('useCatalog — TAV-RETIRE-MLP-HUMAN', () => {
  it('excludes the mlp-human race from the wizard race list', async () => {
    mockGetCatalog.mockImplementation((_system: string, opts: { type?: string }) => {
      if (opts.type === 'race') {
        return Promise.resolve({
          system: 'dnd5e',
          content_type: 'race',
          total: 2,
          limit: 50,
          offset: 0,
          items: [raceItem('human', 'Human'), raceItem('mlp-human', 'MLP Human')],
        });
      }
      return Promise.resolve({
        system: 'dnd5e',
        content_type: opts.type ?? null,
        total: 0,
        limit: 50,
        offset: 0,
        items: [],
      });
    });

    const { result } = renderHook(() => useCatalog());

    await waitFor(() => expect(result.current.status).toBe('ok'));

    expect(result.current.data.races.map((r) => r.id)).toEqual(['human']);
    expect(result.current.data.races.some((r) => r.id === 'mlp-human')).toBe(false);
  });

  it('keeps every other race untouched when mlp-human is absent from the response', async () => {
    mockGetCatalog.mockImplementation((_system: string, opts: { type?: string }) => {
      if (opts.type === 'race') {
        return Promise.resolve({
          system: 'dnd5e',
          content_type: 'race',
          total: 2,
          limit: 50,
          offset: 0,
          items: [raceItem('human', 'Human'), raceItem('elf', 'Elf')],
        });
      }
      return Promise.resolve({
        system: 'dnd5e',
        content_type: opts.type ?? null,
        total: 0,
        limit: 50,
        offset: 0,
        items: [],
      });
    });

    const { result } = renderHook(() => useCatalog());

    await waitFor(() => expect(result.current.status).toBe('ok'));

    expect(result.current.data.races.map((r) => r.id)).toEqual(['human', 'elf']);
  });
});

describe('useCatalog — TAV-AUDIT-401-DEADEND: a dead session is not a dead network', () => {
  it('reports a 401 as status "unauthorized", not "error"', async () => {
    // client.ts has already spent its one silent /api/auth/refresh + retry by
    // the time a 401 surfaces here, so this is a CONFIRMED dead session. The
    // old single `catch` threw the distinction away, which is why an expired
    // token rendered "check your connection" behind a Try again button that
    // could only ever 401 again.
    const err = Object.assign(new Error('API error 401: unauthorized'), {
      status: 401,
      code: 'unauthorized',
    });
    mockGetCatalog.mockRejectedValue(err);

    const { result } = renderHook(() => useCatalog());

    await waitFor(() => expect(result.current.status).toBe('unauthorized'));
    expect(result.current.data.races).toEqual([]);
  });

  it('reports a 403 as status "unauthorized", not "error" (Kage-CR item 1: Auth-Python /auth/refresh returns 403, not 401, for a deactivated account or a token-binding mismatch — both confirmed dead sessions)', async () => {
    const err = Object.assign(new Error('API error 403: unauthorized'), {
      status: 403,
      code: 'unauthorized',
    });
    mockGetCatalog.mockRejectedValue(err);

    const { result } = renderHook(() => useCatalog());

    await waitFor(() => expect(result.current.status).toBe('unauthorized'));
    expect(result.current.data.races).toEqual([]);
  });

  it('reports a refresh-422 dead session (code "unauthorized", flask-jwt-extended\'s default invalid-signature status) as "unauthorized", not "error" — Kage-CR final round', async () => {
    // client.ts's UNIFIED refresh-failure classification (Kage-CR items 2/3)
    // sets code:'unauthorized' for any refresh failure that is NOT
    // 0/>=500/429 — including a 422, which flask-jwt-extended's default
    // error handler answers for an invalid-signature/decode failure
    // (Authentication-Python registers no custom invalid_token_loader). A
    // hand-copied 401/403 status list would miss this; `code` is the single
    // source of truth for "the refresh attempt said this session is dead".
    const err = Object.assign(new Error('API error 422: unauthorized'), {
      status: 422,
      code: 'unauthorized',
    });
    mockGetCatalog.mockRejectedValue(err);

    const { result } = renderHook(() => useCatalog());

    await waitFor(() => expect(result.current.status).toBe('unauthorized'));
    expect(result.current.data.races).toEqual([]);
  });

  it('a refresh-unavailable 502 (auth backend flaky mid-session) does NOT show the sign-in state — TAV-AUTH-DEADBACKEND-AS-DEADSESSION consumer pin', async () => {
    // client.ts now carries the REAL refresh status through instead of a
    // hardcoded 401 — a 502 from an unhealthy auth backend must render the
    // generic retry state, never "your session is dead, sign in again".
    const err = Object.assign(new Error('API error 502: refresh_unavailable'), {
      status: 502,
      code: 'refresh_unavailable',
    });
    mockGetCatalog.mockRejectedValue(err);

    const { result } = renderHook(() => useCatalog());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.status).not.toBe('unauthorized');
  });

  it.each([0, 500, 502, 404, 422])(
    'still reports status %s as plain "error"',
    async (status) => {
      // The remedies are opposite — re-auth vs retry-the-network — so anything
      // that is not a confirmed session rejection must keep its old meaning.
      mockGetCatalog.mockRejectedValue(
        Object.assign(new Error(`API error ${status}`), { status }),
      );

      const { result } = renderHook(() => useCatalog());

      await waitFor(() => expect(result.current.status).toBe('error'));
    },
  );

  it('reports a thrown non-ApiError as plain "error" without crashing', async () => {
    mockGetCatalog.mockRejectedValue(new TypeError('boom'));

    const { result } = renderHook(() => useCatalog());

    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});
