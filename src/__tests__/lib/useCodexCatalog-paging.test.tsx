/**
 * Tests for the FR-19/FR-20/FR-21 background-paging rewrite of
 * src/lib/dnd/useCodexCatalog.ts (TAV-CODEX-SOURCE-PICKER-NPC).
 *
 * Covers: the offset loop reaching `total`, aborting in-flight paging on a
 * source switch, the per-(kind,source) cache making a revisit free, a
 * zero-row kind settling cleanly, the 20-page runaway guard, and
 * partial-failure keeping rows already fetched (+ retryRemainder resuming
 * rather than restarting). Also pins Kuro-Sec C2: no persistent client
 * storage of catalog data (localStorage/sessionStorage untouched) — the
 * cache lives in a mount-lifetime `useRef` only.
 */
import { renderHook, waitFor, act } from '@testing-library/react';

jest.mock('../../lib/api/dnd', () => ({
  getCatalog: jest.fn(),
  getCatalogCounts: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { useCodexCatalog } from '../../lib/dnd/useCodexCatalog';
import type { CatalogItem } from '../../lib/api/types';

const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;
const mockGetCatalogCounts = dnd.getCatalogCounts as jest.MockedFunction<typeof dnd.getCatalogCounts>;

function makeItems(kind: string, count: number, offset = 0): CatalogItem[] {
  return Array.from({ length: count }, (_, i) => ({
    slug: `${kind}-${offset + i}`,
    name: `${kind} ${offset + i}`,
    content_type: kind,
    source_type: 'homebrew',
    data: {},
  }));
}

beforeEach(() => {
  mockGetCatalogCounts.mockReset().mockResolvedValue({ counts: {}, content_type: null });
  mockGetCatalog.mockReset();
});

describe('background paging reaches total', () => {
  it('loops offset (0, 500, 1000, ...) until items.length === total', async () => {
    // 3 pages: 500 + 500 + 240 = 1240 total.
    mockGetCatalog.mockImplementation((_s, opts) => {
      const offset = (opts as { offset?: number }).offset ?? 0;
      if (offset === 0) return Promise.resolve({ system: 'dnd5e', content_type: 'npc', items: makeItems('npc', 500, 0), total: 1240, limit: 500, offset: 0 });
      if (offset === 500) return Promise.resolve({ system: 'dnd5e', content_type: 'npc', items: makeItems('npc', 500, 500), total: 1240, limit: 500, offset: 500 });
      if (offset === 1000) return Promise.resolve({ system: 'dnd5e', content_type: 'npc', items: makeItems('npc', 240, 1000), total: 1240, limit: 500, offset: 1000 });
      return Promise.resolve({ system: 'dnd5e', content_type: 'npc', items: [], total: 1240, limit: 500, offset });
    });

    const { result } = renderHook(() => useCodexCatalog('npc', undefined));

    await waitFor(() => expect(result.current.status).toBe('ok'));
    await waitFor(() => expect(result.current.items.length).toBe(1240));
    expect(result.current.pageProgress).toBeNull();
    expect(mockGetCatalog).toHaveBeenCalledTimes(3);
  });

  it('exposes pageProgress {loaded,total} while background pages remain, then null once complete', async () => {
    let resolvePage2!: (v: unknown) => void;
    mockGetCatalog.mockImplementation((_s, opts) => {
      const offset = (opts as { offset?: number }).offset ?? 0;
      if (offset === 0) {
        return Promise.resolve({ system: 'dnd5e', content_type: 'monster', items: makeItems('monster', 500, 0), total: 700, limit: 500, offset: 0 });
      }
      return new Promise((res) => {
        resolvePage2 = () =>
          res({ system: 'dnd5e', content_type: 'monster', items: makeItems('monster', 200, 500), total: 700, limit: 500, offset: 500 });
      });
    });

    const { result } = renderHook(() => useCodexCatalog('monster', undefined));

    await waitFor(() => expect(result.current.status).toBe('ok'));
    await waitFor(() => expect(result.current.items.length).toBe(500));
    // FR-19/FR-20: the list is already usable (status 'ok') while page 2 is
    // still in flight — pageProgress is the ONLY signal something's pending.
    expect(result.current.pageProgress).toEqual({ loaded: 500, total: 700 });

    await act(async () => {
      resolvePage2({});
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.items.length).toBe(700));
    expect(result.current.pageProgress).toBeNull();
  });
});

describe('abort on source change', () => {
  it('aborts the in-flight page 2 request when the source changes mid-paging', async () => {
    const abortSpy = jest.fn();
    mockGetCatalog.mockImplementation((_s, opts, signal?: AbortSignal) => {
      const offset = (opts as { offset?: number }).offset ?? 0;
      if (offset === 0) {
        return Promise.resolve({ system: 'dnd5e', content_type: 'npc', items: makeItems('npc', 500, 0), total: 900, limit: 500, offset: 0 });
      }
      // Page 2 never resolves in this test — we only care that its signal aborts.
      signal?.addEventListener('abort', abortSpy);
      return new Promise(() => {});
    });

    const { result, rerender } = renderHook(
      ({ source }: { source: string | undefined }) => useCodexCatalog('npc', source),
      { initialProps: { source: undefined as string | undefined } },
    );

    await waitFor(() => expect(result.current.items.length).toBe(500));
    // Page 2 (offset 500) is now in flight for source=undefined ("All").
    rerender({ source: 'leon-naruto-5e' });

    await waitFor(() => expect(abortSpy).toHaveBeenCalledTimes(1));
  });
});

describe('per-(kind,source) cache — switching back is free', () => {
  it('re-selecting a previously-loaded (kind,source) triggers zero new fetches', async () => {
    mockGetCatalog.mockImplementation((_s, opts) => {
      const kind = (opts as { type?: string }).type;
      return Promise.resolve({ system: 'dnd5e', content_type: kind ?? null, items: makeItems(kind ?? '', 3), total: 3, limit: 500, offset: 0 });
    });

    const { result, rerender } = renderHook(
      ({ kind }: { kind: 'npc' | 'monster' }) => useCodexCatalog(kind, 'leon-naruto-5e'),
      { initialProps: { kind: 'npc' as 'npc' | 'monster' } },
    );

    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(mockGetCatalog).toHaveBeenCalledTimes(1);

    rerender({ kind: 'monster' });
    await waitFor(() => expect(result.current.itemsKind).toBe('monster'));
    expect(mockGetCatalog).toHaveBeenCalledTimes(2);

    rerender({ kind: 'npc' });
    await waitFor(() => expect(result.current.itemsKind).toBe('npc'));
    // Cache hit — no third fetch for the already-loaded (npc, leon-naruto-5e).
    expect(mockGetCatalog).toHaveBeenCalledTimes(2);
    expect(result.current.items).toHaveLength(3);
  });
});

describe('zero-row kind', () => {
  it('settles cleanly to status ok with an empty items array (no infinite loop, no error)', async () => {
    mockGetCatalog.mockResolvedValue({ system: 'dnd5e', content_type: 'adventure', items: [], total: 0, limit: 500, offset: 0 });

    const { result } = renderHook(() => useCodexCatalog('adventure', undefined));

    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(result.current.items).toEqual([]);
    expect(mockGetCatalog).toHaveBeenCalledTimes(1);
  });
});

describe('hard stop at 20 pages (runaway guard)', () => {
  it('stops paging at page 20 when the engine reports a total that can never be satisfied', async () => {
    mockGetCatalog.mockImplementation((_s, opts) => {
      const offset = (opts as { offset?: number }).offset ?? 0;
      // Always reports a huge total no matter how many pages land — a buggy
      // engine, not a real corpus.
      return Promise.resolve({ system: 'dnd5e', content_type: 'npc', items: makeItems('npc', 500, offset), total: 999_999, limit: 500, offset });
    });

    const { result } = renderHook(() => useCodexCatalog('npc', undefined));

    await waitFor(() => expect(result.current.status).toBe('partial'), { timeout: 5000 });
    expect(mockGetCatalog).toHaveBeenCalledTimes(20);
    // Rows already fetched are NOT wiped by the runaway stop.
    expect(result.current.items.length).toBe(20 * 500);
  }, 10000);
});

describe('partial-failure keeps rows already fetched', () => {
  it('a page-2 rejection keeps page-1 rows, sets status "partial", and retryRemainder resumes rather than restarts', async () => {
    let page2Calls = 0;
    mockGetCatalog.mockImplementation((_s, opts) => {
      const offset = (opts as { offset?: number }).offset ?? 0;
      if (offset === 0) {
        return Promise.resolve({ system: 'dnd5e', content_type: 'npc', items: makeItems('npc', 500, 0), total: 900, limit: 500, offset: 0 });
      }
      page2Calls += 1;
      if (page2Calls === 1) return Promise.reject(new Error('network blip'));
      return Promise.resolve({ system: 'dnd5e', content_type: 'npc', items: makeItems('npc', 400, 500), total: 900, limit: 500, offset: 500 });
    });

    const { result } = renderHook(() => useCodexCatalog('npc', undefined));

    await waitFor(() => expect(result.current.status).toBe('partial'));
    expect(result.current.items).toHaveLength(500); // page-1 rows retained, not wiped

    act(() => result.current.retryRemainder());

    // NOTE: `status` flips to 'ok' the instant the resume starts (the 500
    // rows already held are immediately usable, per FR-19/FR-21 — never a
    // blocking re-load) — so the resumed fetch's completion is asserted via
    // `items.length`, not `status`, to avoid racing that transient 'ok'.
    await waitFor(() => expect(result.current.items).toHaveLength(900));
    expect(result.current.status).toBe('ok');
    // retryRemainder resumed from offset 500 — it did NOT re-request page 1.
    expect(mockGetCatalog).toHaveBeenCalledWith(
      'dnd5e',
      expect.objectContaining({ offset: 0 }),
      expect.anything(),
    );
    expect(mockGetCatalog.mock.calls.filter((c) => (c[1] as { offset?: number }).offset === 0)).toHaveLength(1);
  });

  it('a page mid-sequence rejecting with a non-JSON-shaped rejection still degrades to partial, no unhandled rejection / crash', async () => {
    mockGetCatalog.mockImplementation((_s, opts) => {
      const offset = (opts as { offset?: number }).offset ?? 0;
      if (offset === 0) {
        return Promise.resolve({ system: 'dnd5e', content_type: 'monster', items: makeItems('monster', 500, 0), total: 800, limit: 500, offset: 0 });
      }
      // Simulate a thrown non-Error value (e.g. a raw string/aborted-fetch
      // edge case) — the hook's catch block must not assume `Error` shape.
      return Promise.reject('upstream 500');
    });

    const { result } = renderHook(() => useCodexCatalog('monster', undefined));

    await waitFor(() => expect(result.current.status).toBe('partial'));
    expect(result.current.items).toHaveLength(500);
  });
});

describe('Kuro-Sec C2 — no persistent client storage of catalog/dm_only data', () => {
  it('never calls localStorage.setItem or sessionStorage.setItem while paging (cache is mount-lifetime useRef only)', async () => {
    const localSetSpy = jest.spyOn(Storage.prototype, 'setItem');
    const NPC_WITH_DM_ONLY: CatalogItem = {
      slug: 'itachi',
      name: 'Itachi',
      content_type: 'npc',
      source_type: 'homebrew',
      data: {
        name: 'Itachi',
        dm_only: { hidden_truth: 'A secret only the owner should ever see.' },
      },
    };
    mockGetCatalog.mockResolvedValue({
      system: 'dnd5e',
      content_type: 'npc',
      items: [NPC_WITH_DM_ONLY],
      total: 1,
      limit: 500,
      offset: 0,
    });

    const { result } = renderHook(() => useCodexCatalog('npc', 'leon-naruto-5e'));
    await waitFor(() => expect(result.current.status).toBe('ok'));

    expect(localSetSpy).not.toHaveBeenCalled();
    localSetSpy.mockRestore();
  });
});
