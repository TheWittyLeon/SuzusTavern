// src/lib/dnd/useCatalog.ts
//
// React hook — fetches races, classes, and backgrounds from the engine catalog
// in parallel on mount. Returns typed arrays for the wizard to render.
//
// Graceful degradation: on a fetch failure the hook returns empty arrays and an
// error status. The wizard surfaces an error/retry UI instead of crashing.
// There is NO hardcoded-SRD fallback — the engine is the source of truth.
//
// TAV-AUDIT-401-DEADEND (2026-08-09): a dead SESSION is reported separately
// from a dead NETWORK. It used to be one `catch` that threw both away, so an
// expired token rendered "Suzu can't reach the catalog right now — check your
// connection" behind a Try again button that re-fetched, 401'd, and rendered
// the same card forever. The user is told to check a connection that is fine,
// and the one control offered cannot possibly help. Distinguishing the two is
// the whole fix; see `status: 'unauthorized'` below.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { getCatalog } from '@/lib/api/dnd';
import {
  catalogItemToRace,
  catalogItemToClass,
  catalogItemToBackground,
  type WizardRace,
  type WizardClass,
  type WizardBackground,
} from './catalog';

export interface CatalogData {
  races: WizardRace[];
  classes: WizardClass[];
  backgrounds: WizardBackground[];
}

/**
 * `'unauthorized'` = the request reached the server and the SESSION was
 * rejected (401 or 403 — see below — after `client.ts` already spent its one
 * silent refresh attempt). `'error'` keeps its original meaning: anything
 * else — offline, DNS, 5xx, a malformed payload. They need opposite
 * remedies, so a consumer that collapses them back into one branch has
 * re-created the bug.
 */
export type CatalogStatus = 'loading' | 'ok' | 'error' | 'unauthorized';

export interface UseCatalogResult {
  status: CatalogStatus;
  data: CatalogData;
  /** Re-attempt the fetch (e.g. from an error/retry button). */
  retry: () => void;
}

const EMPTY: CatalogData = { races: [], classes: [], backgrounds: [] };
const SYSTEM = 'dnd5e';

export function useCatalog(): UseCatalogResult {
  const [status, setStatus] = useState<CatalogStatus>('loading');
  const [data, setData] = useState<CatalogData>(EMPTY);
  // Monotonic counter — increment to trigger a re-fetch.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const ac = new AbortController();
    // Canonical fetch-on-mount pattern (React docs "Fetching data" example).
    // There's no external store to subscribe to here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading');

    Promise.all([
      getCatalog(SYSTEM, { type: 'race' }, ac.signal),
      getCatalog(SYSTEM, { type: 'class' }, ac.signal),
      getCatalog(SYSTEM, { type: 'background' }, ac.signal),
    ])
      .then(([raceRes, classRes, bgRes]) => {
        if (ac.signal.aborted) return;
        setData({
          // TAV-RETIRE-MLP-HUMAN: hide the 'mlp-human' race from the creation
          // wizard's race list — this is the ONLY place the race list is
          // assembled (see the module doc comment). Nothing engine-side
          // changes; an existing character with this race keeps working.
          races: raceRes.items
            .filter((it) => it.slug !== 'mlp-human')
            .map(catalogItemToRace),
          classes: classRes.items.map(catalogItemToClass),
          backgrounds: bgRes.items.map(catalogItemToBackground),
        });
        setStatus('ok');
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setData(EMPTY);
        // client.ts has already spent its one silent `/api/auth/refresh` +
        // retry by the time a 401 surfaces here, so this is a CONFIRMED dead
        // session, not a transient token expiry the client can fix itself.
        // Kage-CR item 1: 403 is ALSO a confirmed dead session, not a generic
        // error — Authentication-Python's /auth/refresh returns 403 (not 401)
        // for a deactivated account (app/auth.py:830) and a token-binding
        // mismatch (app/auth.py:848), both real rejections client.ts's own
        // 401-retry already surfaces as `err.status`.
        const status = (err as { status?: number } | null)?.status;
        setStatus(status === 401 || status === 403 ? 'unauthorized' : 'error');
      });

    return () => ac.abort();
   
  }, [attempt]);

  return { status, data, retry };
}
