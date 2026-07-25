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
