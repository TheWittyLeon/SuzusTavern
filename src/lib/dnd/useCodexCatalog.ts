// src/lib/dnd/useCodexCatalog.ts
//
// DDX-21 — data hook for the /codex compendium.
//
// Two independent fetches:
//   1. Counts (GET /api/dnd/catalog, no `type`) — fetched once on mount, used
//      to badge the rail tabs. Best-effort: a failure just omits the counts,
//      it never blocks the list.
//   2. Per-kind item list (GET /api/dnd/catalog?type=X) — fetched lazily the
//      first time a tab is opened, then cached in component state for the
//      lifetime of the mount so switching tabs back doesn't re-fetch. This
//      cache lives in React state (per browser tab/session), never a module
//      singleton, so it is never shared across users or persisted.
//
// No server-side search param exists (routes/catalog.py: system/type/packs/
// user/limit/offset only) — filtering is client-side over the loaded list,
// done by the page component via matchesSearch().
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

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCatalog, getCatalogCounts } from '@/lib/api/dnd';
import { useAuth } from '@/lib/auth/AuthProvider';
import type { CatalogItem } from '@/lib/api/types';
import type { CodexKind } from './codex';

const SYSTEM = 'dnd5e';
// Comfortably above the current largest type (monster, ~335) without ever
// risking the engine's _MAX_LIMIT=500 cap silently truncating a page.
const PAGE_LIMIT = 500;

export type FetchStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface UseCodexCatalogResult {
  counts: Record<string, number> | null;
  items: CatalogItem[];
  /**
   * DDX21-1: which kind `items` (and `status`, once it's not 'loading')
   * actually belong to right now. `null` until the first fetch/cache-hit for
   * ANY kind has settled. See the module doc comment above for the invariant
   * this exists to let callers enforce.
   */
  itemsKind: CodexKind | null;
  status: FetchStatus;
  /** Re-attempt the active kind's fetch (e.g. from an error/retry button). */
  retry: () => void;
}

export function useCodexCatalog(activeKind: CodexKind): UseCodexCatalogResult {
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

  // Per-kind cache — survives tab switches for the life of the mount.
  const cacheRef = useRef<Partial<Record<CodexKind, CatalogItem[]>>>({});
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [itemsKind, setItemsKind] = useState<CodexKind | null>(null);
  const [status, setStatus] = useState<FetchStatus>('loading');
  // Bump to force a re-fetch of the *active* kind, bypassing its cache entry.
  const [retryTick, setRetryTick] = useState(0);

  // Counts — once auth resolves, best-effort. (CODEX-401-RACE: gated on
  // authReady so it doesn't fire with a stale token; re-runs when authReady
  // flips true after a mount-time silent refresh.)
  useEffect(() => {
    if (!authReady) return;
    const ac = new AbortController();
    getCatalogCounts(SYSTEM, {}, ac.signal)
      .then((res) => {
        if (ac.signal.aborted) return;
        setCounts(res.counts ?? {});
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setCounts(null);
      });
    return () => ac.abort();
  }, [authReady]);

  const retry = useCallback(() => {
    delete cacheRef.current[activeKind];
    setRetryTick((n) => n + 1);
  }, [activeKind]);

  useEffect(() => {
    // CODEX-401-RACE: hold in the initial 'loading' state until auth resolves,
    // so the list fetch carries a fresh token. Re-runs when authReady flips.
    if (!authReady) return;

    const cached = cacheRef.current[activeKind];
    if (cached) {
      setItems(cached);
      setItemsKind(activeKind);
      setStatus('ok');
      return;
    }

    const ac = new AbortController();
    setStatus('loading');
    getCatalog(SYSTEM, { type: activeKind, limit: PAGE_LIMIT }, ac.signal)
      .then((res) => {
        if (ac.signal.aborted) return;
        cacheRef.current[activeKind] = res.items;
        setItems(res.items);
        setItemsKind(activeKind);
        setStatus('ok');
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setItems([]);
        setItemsKind(activeKind);
        setStatus('error');
      });
    return () => ac.abort();
  }, [activeKind, retryTick, authReady]);

  return { counts, items, itemsKind, status, retry };
}
