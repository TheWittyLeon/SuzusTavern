// src/lib/dnd/usePacksList.ts
//
// TAV-CODEX-SOURCE-PICKER-NPC — fetches the actor's visible content packs
// (GET /api/dnd/catalog/packs) once, for the codex's source picker.
//
// Best-effort, degrades: a failure sets status:'error' and packs:[] — the
// picker then falls back to "All sources only" + an inline notice (Aoi-UI
// §1) rather than blocking the rest of the page. The rest of the codex
// keeps working against the unfiltered /catalog (no `pack` param sent).
//
// Fetched exactly once per mount (not re-fetched on kind/source changes —
// the packs list itself doesn't depend on either).

'use client';

import { useEffect, useState } from 'react';
import { getPacks } from '@/lib/api/dnd';
import { useAuth } from '@/lib/auth/AuthProvider';
import type { ContentPack } from '@/lib/api/types';

const SYSTEM = 'dnd5e';

export type PacksStatus = 'loading' | 'ok' | 'error';

export interface UsePacksListResult {
  packs: ContentPack[];
  status: PacksStatus;
}

export function usePacksList(): UsePacksListResult {
  // CODEX-401-RACE (mirrors useCodexCatalog.ts): wait for auth to resolve so
  // the first request carries a fresh token rather than racing a mount-time
  // silent refresh.
  const { loading: authLoading, maybeAuthed } = useAuth();
  const authReady = !authLoading && !maybeAuthed;

  const [packs, setPacks] = useState<ContentPack[]>([]);
  const [status, setStatus] = useState<PacksStatus>('loading');

  // Kage-CR #2: a `fetchedRef` "already ran" guard here deadlocks under
  // React StrictMode's dev-only double-invoke (mount -> cleanup -> mount):
  // run 1 sets the ref and starts the fetch, the synthetic unmount's cleanup
  // aborts it, run 2 sees the ref already true and returns early — nothing
  // ever completes, `status` stays 'loading' forever (trigger permanently
  // disabled, `?source=` silently ignored, `pack` never sent). `[authReady]`
  // alone is the correct re-run guard — exactly the shape the sibling
  // counts effect in useCodexCatalog.ts already uses: every real effect run
  // gets its own AbortController, and the (StrictMode-only) first run's
  // abort is a no-op once its promise settles.
  useEffect(() => {
    if (!authReady) return;
    const ac = new AbortController();
    getPacks(SYSTEM, ac.signal)
      .then((res) => {
        if (ac.signal.aborted) return;
        setPacks(res);
        setStatus('ok');
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setPacks([]);
        setStatus('error');
      });
    return () => ac.abort();
  }, [authReady]);

  return { packs, status };
}
