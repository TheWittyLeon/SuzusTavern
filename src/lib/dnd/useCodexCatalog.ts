// src/lib/dnd/useCodexCatalog.ts
//
// DDX-21 — data hook for the /codex compendium.
//
// Two independent fetches:
//   1. Counts (GET /api/dnd/catalog, no `type`) — fetched once per SOURCE
//      (TAV-CODEX-SOURCE-PICKER-NPC: re-fetched whenever the active `pack`
//      filter changes, since rail counts must reflect the active source, not
//      the global totals), used to badge the rail tabs. Best-effort: a
//      failure just omits the counts, it never blocks the list.
//   2. Per-(kind, source) item list (GET /api/dnd/catalog?type=X&pack=Y) —
//      fetched lazily the first time a tab is opened under the active
//      source, then cached in component state for the lifetime of the mount
//      so switching tabs (or switching back to a previously-loaded source)
//      doesn't re-fetch. This cache lives in React state (per browser
//      tab/session), never a module singleton, so it is never shared across
//      users or persisted — including any `dm_only` sub-object a row may
//      carry (SEC-5/§7 of Sora-Arch's design: no localStorage/sessionStorage,
//      ever).
//
// TAV-CODEX-SOURCE-PICKER-NPC (FR-19/FR-20/FR-21) — background paging: the
// first page (limit=500) is fetched and rendered as soon as it lands; if the
// response's own `total` exceeds what's loaded so far, subsequent pages
// (offset += 500) continue fetching in the BACKGROUND — the list is already
// interactive (`status` is 'ok') while `pageProgress` reports {loaded,
// total} until they converge. A hard 20-page runaway guard exists in case an
// engine bug ever reports a `total` that can never be satisfied. A page
// failure mid-sequence keeps every row already fetched (`status: 'partial'`)
// rather than wiping the list; `retryRemainder()` resumes from the current
// offset rather than restarting from zero.
//
// `ensureKind(kind)` lets a caller (the NPC drawer's client-side stat_ref
// join — see Sora-Arch §5) kick off a background load for a DIFFERENT kind
// under the CURRENT source without switching the active tab. Its results are
// read via `getCachedItems(kind)`, which always reflects the same
// RLS-approved cache the active kind uses — a stat_ref join can never reach
// into a pack the actor can't see, because the cache never holds one.
//
// No server-side search param exists (routes/catalog.py: system/type/pack/
// packs/user/limit/offset only) — filtering is client-side over the loaded
// list, done by the page component via matchesSearch().
//
// DDX21-1 (fix pass 3, architectural — Aoi-UI live-browser re-verify,
// 2026-07-05): `items`/`status` are only ever updated from inside the effect
// below, keyed on `activeKind`. So for the one render right after a caller
// flips its `activeKind` (a tab click updates that state synchronously), this
// hook is called with the NEW `activeKind` argument while `items` is STILL
// the PREVIOUS kind's rows — React doesn't run effects until after that
// render commits. Handing that mismatched pair to a kind-specific renderer
// (CodexRow/CodexDetail's per-kind branches) is exactly what crashed the
// whole /codex route — e.g. a stale monster row's runtime-only `skills`
// bonus-map object (present on the wire, absent from CatalogMonsterData's
// type) fed into the 'background' branch's `(d.skills ?? []).slice()`.
// Guarding individual fields against this only wins one field at a time
// (~13 exist across RowMeta + CodexDetail's kind components).
//
// `itemsKind` below exists so a caller can detect and gate on that exact
// mismatch instead: it is set in the SAME state-update batch as `items`
// (cache-hit, fetch-success, and fetch-error alike) — NEVER derived from, or
// assumed equal to, the `activeKind` argument. `itemsKind !== activeKind` is
// therefore true for precisely the stale render(s) and false once `items`
// genuinely reflects the requested kind. Callers MUST treat `items`/`status`
// as unsafe to render as `activeKind` whenever `itemsKind !== activeKind` —
// see app/codex/page.tsx's top-of-component gate, which forces both to an
// empty/loading shape for that window instead.
//
// TAV-CODEX-SOURCE-PICKER-NPC extends the SAME invariant to `itemsSource`:
// `itemsKind === activeKind` alone is insufficient once a source filter
// exists — a source switch at a FIXED kind reproduces the identical stale-
// render hazard with a different mismatched pair (kind matches, source
// doesn't). Callers must gate on `itemsKind === activeKind && itemsSource ===
// source`.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCatalog, getCatalogCounts } from '@/lib/api/dnd';
import { useAuth } from '@/lib/auth/AuthProvider';
import type { CatalogItem } from '@/lib/api/types';
import type { CodexKind, CodexSource } from './codex';

const SYSTEM = 'dnd5e';
// Comfortably above the current largest type (monster, ~335) without ever
// risking the engine's _MAX_LIMIT=500 cap silently truncating a page.
const PAGE_LIMIT = 500;
// Adversarial guard (Miko-QA §2): if the engine ever reports a `total` that
// can never be satisfied by the rows actually returned (a bug, not a real
// corpus), stop paging rather than looping forever. 20 pages * 500 = 10,000
// rows — far past any kind's real size today (largest is ~335 SRD monsters;
// six-pack merge pushes naruto npc/monster past 500 but nowhere near 10k).
const MAX_PAGES = 20;

export type FetchStatus = 'idle' | 'loading' | 'ok' | 'error' | 'partial';

export interface PageProgress {
  loaded: number;
  total: number;
}

export interface UseCodexCatalogResult {
  counts: Record<string, number> | null;
  items: CatalogItem[];
  /**
   * DDX21-1 (extended by TAV-CODEX-SOURCE-PICKER-NPC): which kind `items`
   * (and `status`, once it's not 'loading') actually belong to right now.
   * `null` until the first fetch/cache-hit for ANY (kind, source) has
   * settled. See the module doc comment above for the invariant this exists
   * to let callers enforce — gate on BOTH `itemsKind` and `itemsSource`.
   */
  itemsKind: CodexKind | null;
  /** The source `items` belongs to — see `itemsKind`'s doc comment. */
  itemsSource: CodexSource;
  status: FetchStatus;
  /** Re-attempt the active (kind, source)'s fetch from scratch (e.g. from an
   *  error/retry button). Discards any partially-loaded rows for that pair. */
  retry: () => void;
  /**
   * FR-21: resume background paging for the active (kind, source) from
   * where it left off, WITHOUT discarding rows already loaded. Only
   * meaningful when `status === 'partial'`.
   */
  retryRemainder: () => void;
  /** FR-19/FR-20: {loaded, total} for the active (kind, source) while a
   *  background page is still outstanding; `null` once fully loaded (or
   *  before the first page has landed). */
  pageProgress: PageProgress | null;
  /**
   * Sora-Arch §5 — kicks off a background load for `kind` under the CURRENT
   * source WITHOUT changing the active tab (a no-op if that (kind, source)
   * is already loaded, loading, or partially loaded). Lets the NPC drawer
   * guarantee the monster page it needs to join against is at least in
   * flight the moment a user opens NPCs first.
   */
  ensureKind: (kind: CodexKind) => void;
  /** Reads the CURRENT-source cache for any kind, live (not gated on
   *  `activeKind`) — used by the NPC drawer's client-side stat_ref join. */
  getCachedItems: (kind: CodexKind) => CatalogItem[];
}

interface CacheEntry {
  items: CatalogItem[];
  total: number;
  status: FetchStatus;
  pagesFetched: number;
}

function sourceKeyOf(source: CodexSource): string {
  return source && source.length > 0 ? source : '__all__';
}

function cacheKeyOf(kind: CodexKind, source: CodexSource): string {
  return `${kind}::${sourceKeyOf(source)}`;
}

export function useCodexCatalog(
  activeKind: CodexKind,
  source: CodexSource = undefined,
): UseCodexCatalogResult {
  // CODEX-401-RACE: gate both catalog fetches until the session has resolved.
  // On a cold load after the access token's TTL lapsed, getServerSession sets
  // initialMaybeAuthed and AuthProvider runs a mount-time silent refresh; if
  // these fetches fire in parallel with it (the default), the first request
  // goes out with the stale access cookie, 401s (a browser-logged console
  // error), and only recovers via client.ts's reactive 401→refresh→retry — an
  // extra round-trip + noise. Waiting for auth to resolve makes the first
  // request carry a fresh token. Zero penalty in the common fresh-token case:
  // `loading`/`maybeAuthed` are already false at mount, so authReady is true
  // immediately and the fetch is not delayed. Outside a provider (unit tests)
  // useAuth() returns the no-op context (loading:false), so authReady is true
  // and behaviour is unchanged. A genuinely-failed session also settles to
  // authReady:true (loading:false) — the page's useAuthGate renders the
  // re-auth prompt instead of the list, so no hang.
  const { loading: authLoading, maybeAuthed } = useAuth();
  const authReady = !authLoading && !maybeAuthed;

  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  // Per-(kind, source) cache — survives tab/source switches for the life of
  // the mount. A plain ref (not state) — writes are always paired with a
  // `cacheTick` bump below so consumers re-render, but the ref itself is the
  // single source of truth `getCachedItems`/`ensureKind` read directly.
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  // The (kind, source) pair the MAIN effect below is currently driving —
  // tracked so we know exactly which single controller to abort on a kind
  // change (source unchanged), vs. every controller for the OLD source on a
  // source change (see the effect body).
  const activeKeyRef = useRef<string | null>(null);
  const activeSourceKeyRef = useRef<string | null>(null);

  const [cacheTick, setCacheTick] = useState(0);
  const bump = useCallback(() => setCacheTick((n) => n + 1), []);

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [itemsKind, setItemsKind] = useState<CodexKind | null>(null);
  const [itemsSource, setItemsSource] = useState<CodexSource>(undefined);
  const [status, setStatus] = useState<FetchStatus>('loading');
  const [pageProgress, setPageProgress] = useState<PageProgress | null>(null);
  // Bump to force a re-fetch of the *active* (kind, source), bypassing cache.
  const [retryTick, setRetryTick] = useState(0);
  const [retryRemainderTick, setRetryRemainderTick] = useState(0);

  // Counts — once auth resolves, best-effort. Re-fetched per SOURCE (rail
  // counts reflect the active source, not global totals — Aoi-UI §Rail).
  useEffect(() => {
    if (!authReady) return;
    const ac = new AbortController();
    getCatalogCounts(SYSTEM, source ? { pack: source } : {}, ac.signal)
      .then((res) => {
        if (ac.signal.aborted) return;
        setCounts(res.counts ?? {});
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setCounts(null);
      });
    return () => ac.abort();
  }, [authReady, source]);

  /** Runs the background-paging loop for one (kind, source), writing every
   *  page landed into `cacheRef` and, when this key is still the active one,
   *  mirroring it into the reactive state above. */
  const runPaging = useCallback(
    (key: string, kind: CodexKind, src: CodexSource, resumeFromOffset: number) => {
      const ctrl = new AbortController();
      controllersRef.current.set(key, ctrl);

      const existing = cacheRef.current.get(key);
      let acc: CatalogItem[] = existing ? existing.items.slice(0, resumeFromOffset) : [];
      let pagesFetched = existing?.pagesFetched ?? 0;
      // The most recently observed `total` from the engine — tracked
      // separately from `existing` (a snapshot from BEFORE this run) so the
      // runaway-guard/catch branches below report the freshest value, not a
      // stale one from a previous run.
      let lastTotal = existing?.total ?? 0;

      const isActive = () => activeKeyRef.current === key;
      const mirror = (entry: CacheEntry) => {
        if (!isActive()) return;
        setItems(entry.items);
        setItemsKind(kind);
        setItemsSource(src);
        setStatus(entry.status);
        setPageProgress(
          entry.status === 'loading' || (entry.items.length < entry.total && entry.total > 0)
            ? { loaded: entry.items.length, total: entry.total }
            : null,
        );
      };

      const writeAndMaybeMirror = (entry: CacheEntry) => {
        cacheRef.current.set(key, entry);
        mirror(entry);
        bump();
      };

      // A terminal write ('ok' | 'partial' | 'error') means this key is no
      // longer in flight — drop its controller so a later `ensureKind`/tab
      // revisit doesn't mistake a FINISHED load for one still running. Only
      // clears the entry if it's still ours (guards a theoretical race with
      // a newer run for the same key, e.g. retry() firing mid-flight).
      const finish = (entry: CacheEntry) => {
        writeAndMaybeMirror(entry);
        if (controllersRef.current.get(key) === ctrl) controllersRef.current.delete(key);
      };

      // Announce the in-flight state immediately: a genuinely FRESH load
      // (no rows yet) blocks on the 'loading' skeleton, same as today. A
      // RESUME (retryRemainder, or an ensureKind call that inherited a prior
      // partial cache) already has rows to show — those stay visible
      // (status 'ok') while `pageProgress` alone signals more is coming, per
      // FR-19/FR-20 ("rows already fetched stay usable" is the bar even
      // before this specific run's first response lands).
      writeAndMaybeMirror({
        items: acc,
        total: lastTotal,
        status: acc.length > 0 ? 'ok' : 'loading',
        pagesFetched,
      });

      const step = async () => {
        if (ctrl.signal.aborted) return;
        if (pagesFetched >= MAX_PAGES) {
          finish({ items: acc, total: lastTotal || acc.length, status: 'partial', pagesFetched });
          return;
        }
        try {
          const res = await getCatalog(
            SYSTEM,
            { type: kind, limit: PAGE_LIMIT, offset: acc.length, ...(src ? { pack: src } : {}) },
            ctrl.signal,
          );
          if (ctrl.signal.aborted) return;
          acc = acc.concat(res.items);
          pagesFetched += 1;
          lastTotal = res.total;
          const done = acc.length >= res.total || res.items.length === 0;
          if (done) {
            finish({ items: acc, total: res.total, status: 'ok', pagesFetched });
          } else {
            // FR-19/FR-20: the list is already interactive as soon as ANY
            // page has landed — `status` is 'ok', not the blocking
            // 'loading' skeleton, for every page after the first. Only
            // `pageProgress` (loaded < total) signals background work is
            // still in flight.
            writeAndMaybeMirror({ items: acc, total: res.total, status: 'ok', pagesFetched });
            await step();
          }
        } catch {
          if (ctrl.signal.aborted) return;
          finish({
            items: acc,
            total: lastTotal || acc.length,
            status: acc.length > 0 ? 'partial' : 'error',
            pagesFetched,
          });
        }
      };

      void step();
    },
    [bump],
  );

  const retry = useCallback(() => {
    const key = cacheKeyOf(activeKind, source);
    controllersRef.current.get(key)?.abort();
    controllersRef.current.delete(key);
    cacheRef.current.delete(key);
    setRetryTick((n) => n + 1);
  }, [activeKind, source]);

  const retryRemainder = useCallback(() => {
    setRetryRemainderTick((n) => n + 1);
  }, []);

  const ensureKind = useCallback(
    (kind: CodexKind) => {
      const key = cacheKeyOf(kind, source);
      if (controllersRef.current.has(key)) return; // already in flight
      const cached = cacheRef.current.get(key);
      if (cached && (cached.status === 'ok' || cached.status === 'loading' || cached.status === 'partial')) return;
      runPaging(key, kind, source, 0);
    },
    [source, runPaging],
  );

  const getCachedItems = useCallback(
    (kind: CodexKind): CatalogItem[] => {
      // Referencing cacheTick (unused otherwise) is what makes this function
      // observe fresh cache contents after a background write elsewhere —
      // consumers call it during render, and a `bump()` triggers that render.
      void cacheTick;
      return cacheRef.current.get(cacheKeyOf(kind, source))?.items ?? [];
    },
    [source, cacheTick],
  );

  useEffect(() => {
    if (!authReady) return;
    const key = cacheKeyOf(activeKind, source);
    const srcKey = sourceKeyOf(source);

    // Abort bookkeeping (Sora-Arch §7: "one AbortController per (kind,
    // source), aborted on source change, kind change and unmount").
    if (activeSourceKeyRef.current !== null && activeSourceKeyRef.current !== srcKey) {
      // Source changed: every in-flight load (active OR ensured) for the OLD
      // source is now moot — abort them all.
      for (const [k, ctrl] of controllersRef.current) {
        if (k.endsWith(`::${activeSourceKeyRef.current}`)) {
          ctrl.abort();
          controllersRef.current.delete(k);
        }
      }
    } else if (activeKeyRef.current !== null && activeKeyRef.current !== key) {
      // Kind changed, source didn't: abort only the PREVIOUS active kind's
      // fetch — an `ensureKind` load for a different kind under this same
      // source keeps running (it's independent of which tab is focused).
      controllersRef.current.get(activeKeyRef.current)?.abort();
      controllersRef.current.delete(activeKeyRef.current);
    }
    activeKeyRef.current = key;
    activeSourceKeyRef.current = srcKey;

    const cached = cacheRef.current.get(key);
    if (cached && (cached.status === 'ok' || cached.status === 'partial')) {
      // Cache hit — switching back to an already-loaded (kind, source) is
      // free (FR-19's per-(kind,source) cache).
      setItems(cached.items);
      setItemsKind(activeKind);
      setItemsSource(source);
      setStatus(cached.status);
      setPageProgress(
        cached.total > 0 && cached.items.length < cached.total
          ? { loaded: cached.items.length, total: cached.total }
          : null,
      );
      return;
    }

    runPaging(key, activeKind, source, cached?.items.length ?? 0);
    // Cleanup handled by the abort bookkeeping above on the NEXT run (and by
    // the unmount effect below) rather than here, so an in-flight background
    // page isn't aborted merely because this effect re-ran for an unrelated
    // dependency (there are none besides the ones already accounted for).
    // NOTE: `retryTick` is a deliberate dependency (retry() clears the cache
    // entry then bumps it to force this effect to re-run); `retryRemainder`
    // is handled by its own effect below, not this one.
  }, [activeKind, source, authReady, retryTick, runPaging]);

  // retryRemainder: resume from the current cache length for the active key,
  // without clearing it (unlike `retry`).
  useEffect(() => {
    if (retryRemainderTick === 0) return;
    const key = cacheKeyOf(activeKind, source);
    const cached = cacheRef.current.get(key);
    if (!cached) return;
    controllersRef.current.get(key)?.abort();
    controllersRef.current.delete(key);
    runPaging(key, activeKind, source, cached.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryRemainderTick]);

  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      for (const ctrl of controllers.values()) ctrl.abort();
    };
  }, []);

  return {
    counts,
    items,
    itemsKind,
    itemsSource,
    status,
    retry,
    retryRemainder,
    pageProgress,
    ensureKind,
    getCachedItems,
  };
}
