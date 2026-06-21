// src/lib/dnd/useCatalog.ts
//
// React hook — fetches races, classes, and backgrounds from the engine catalog
// in parallel on mount. Returns typed arrays for the wizard to render.
//
// Graceful degradation: on any fetch failure the hook returns status='error'
// with empty arrays. The wizard surfaces an error/retry UI instead of crashing.
// There is NO hardcoded-SRD fallback — the engine is the source of truth.

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

export type CatalogStatus = 'loading' | 'ok' | 'error';

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
    setStatus('loading');

    Promise.all([
      getCatalog(SYSTEM, { type: 'race' }, ac.signal),
      getCatalog(SYSTEM, { type: 'class' }, ac.signal),
      getCatalog(SYSTEM, { type: 'background' }, ac.signal),
    ])
      .then(([raceRes, classRes, bgRes]) => {
        if (ac.signal.aborted) return;
        setData({
          races: raceRes.items.map(catalogItemToRace),
          classes: classRes.items.map(catalogItemToClass),
          backgrounds: bgRes.items.map(catalogItemToBackground),
        });
        setStatus('ok');
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setData(EMPTY);
        setStatus('error');
      });

    return () => ac.abort();
   
  }, [attempt]);

  return { status, data, retry };
}
