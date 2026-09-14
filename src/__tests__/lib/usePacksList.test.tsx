/**
 * Tests for src/lib/dnd/usePacksList.ts (TAV-CODEX-SOURCE-PICKER-NPC).
 *
 * Fetches the actor's visible packs (GET /api/dnd/catalog/packs) exactly
 * once per mount, best-effort: a rejection degrades to status:'error' +
 * packs:[] rather than throwing into the caller (the codex's source picker
 * then falls back to "All sources only" — see CodexSourcePicker.tsx).
 */
import { StrictMode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';

jest.mock('../../lib/api/dnd', () => ({
  getPacks: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { usePacksList } from '../../lib/dnd/usePacksList';
import type { ContentPack } from '../../lib/api/types';

const mockGetPacks = dnd.getPacks as jest.MockedFunction<typeof dnd.getPacks>;

const SRD: ContentPack = {
  pack_id: 'srd-5e',
  display_name: 'D&D 5e SRD 5.1',
  precedence: 0,
  system_id: 'dnd5e',
  kind: 'srd',
  visibility: 'public',
  is_owner: false,
};
const NARUTO: ContentPack = {
  pack_id: 'leon-naruto-5e',
  display_name: 'Naruto — Genin Dawn (private)',
  precedence: 10,
  system_id: 'dnd5e',
  kind: 'homebrew',
  visibility: 'private',
  is_owner: true,
};

beforeEach(() => {
  mockGetPacks.mockReset();
});

it('fetches once on mount and populates packs with status "ok"', async () => {
  mockGetPacks.mockResolvedValue([SRD, NARUTO]);
  const { result } = renderHook(() => usePacksList());

  expect(result.current.status).toBe('loading');

  await waitFor(() => expect(result.current.status).toBe('ok'));
  expect(result.current.packs).toEqual([SRD, NARUTO]);
  expect(mockGetPacks).toHaveBeenCalledTimes(1);
  expect(mockGetPacks).toHaveBeenCalledWith('dnd5e', expect.anything());
});

it('degrades to status "error" and an empty packs list on rejection — never throws', async () => {
  mockGetPacks.mockRejectedValue(new Error('engine unavailable'));
  const { result } = renderHook(() => usePacksList());

  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.packs).toEqual([]);
});

it('does not re-fetch on re-render (fetched exactly once per mount)', async () => {
  mockGetPacks.mockResolvedValue([SRD]);
  const { result, rerender } = renderHook(() => usePacksList());

  await waitFor(() => expect(result.current.status).toBe('ok'));
  rerender();
  rerender();

  expect(mockGetPacks).toHaveBeenCalledTimes(1);
});

it('aborts the in-flight request on unmount (no React "state update on unmounted component" warning)', async () => {
  // Kage-CR #23: "resolving a promise cannot throw" — a bare
  // `expect(() => resolvePacks(...)).not.toThrow()` is vacuous (resolving a
  // promise is never synchronously throwable regardless of unmount state,
  // so it can't actually catch anything). The real contract is that React
  // never logs its unmounted-component setState warning — assert THAT.
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  let resolvePacks!: (v: ContentPack[]) => void;
  mockGetPacks.mockReturnValue(
    new Promise((res) => {
      resolvePacks = res;
    }),
  );
  const { result, unmount } = renderHook(() => usePacksList());
  expect(result.current.status).toBe('loading');

  unmount();
  resolvePacks([SRD]);
  await new Promise((r) => setTimeout(r, 0));

  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

it('StrictMode double-mount still settles to status "ok" (Kage-CR #2 regression guard — a fetchedRef "already ran" guard deadlocks here)', async () => {
  mockGetPacks.mockResolvedValue([SRD]);
  const { result } = renderHook(() => usePacksList(), { wrapper: StrictMode });

  await waitFor(() => expect(result.current.status).toBe('ok'));
  expect(result.current.packs).toEqual([SRD]);
});
