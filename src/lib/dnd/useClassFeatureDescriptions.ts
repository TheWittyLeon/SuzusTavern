// src/lib/dnd/useClassFeatureDescriptions.ts
//
// Fetches rules text for a class's features from the engine catalog, keyed
// by feature name, for the sheet's Features list (companion to
// classFeatureText.ts's grouping/filtering).
//
// No engine or API change required: `routes/catalog.py` already forwards
// the class row's ENTIRE `data` jsonb on GET /api/dnd/catalog?type=class,
// which includes the `features` array (schema v2, `{level, name,
// description}` per entry) — the same array
// `engine/rules_catalog.py::class_features()` reads to build the
// `class_features` name list this hook is annotating. See
// `class_stat_guidance_for_wire`, which merges keys onto a COPY of the row's
// existing data and never drops `features`.
//
// Same fetch call `useCatalog.ts` already makes for the creation wizard
// (`getCatalog(SYSTEM, { type: 'class' })`) — no new API surface, just a
// second reader of the same response shape.

'use client';

import { useEffect, useState } from 'react';
import { getCatalog } from '@/lib/api/dnd';

const SYSTEM = 'dnd5e';

/** Feature name -> rules text. */
export type ClassFeatureDescriptions = Record<string, string>;

export type ClassFeatureDescriptionsStatus = 'idle' | 'loading' | 'ok' | 'error';

interface RawFeatureRow {
  name?: unknown;
  description?: unknown;
}

function descriptionsFromCatalogData(data: unknown): ClassFeatureDescriptions {
  const rows = (data as { features?: unknown } | null | undefined)?.features;
  const out: ClassFeatureDescriptions = {};
  if (!Array.isArray(rows)) return out;
  for (const row of rows as RawFeatureRow[]) {
    const name = typeof row?.name === 'string' ? row.name : null;
    const description = typeof row?.description === 'string' ? row.description : '';
    // First occurrence wins — a name repeated across levels (e.g. Ability
    // Score Improvement) carries identical text at every level in practice;
    // if a future row ever disagreed, the earliest (lowest-level) text is
    // the more conservative choice to surface.
    if (name && description && !(name in out)) out[name] = description;
  }
  return out;
}

/**
 * Looks up the given class's feature descriptions by name. Returns `{}`
 * while loading, on error, or when `className` is nullish — callers should
 * treat a missing key as "no details available" (matches
 * `SpellInfoPopover`'s own `emptyLabel` degrade), never crash.
 */
export function useClassFeatureDescriptions(className: string | null | undefined): {
  descriptions: ClassFeatureDescriptions;
  status: ClassFeatureDescriptionsStatus;
} {
  const [descriptions, setDescriptions] = useState<ClassFeatureDescriptions>({});
  const [status, setStatus] = useState<ClassFeatureDescriptionsStatus>('idle');

  useEffect(() => {
    if (!className) {
      setDescriptions({});
      setStatus('idle');
      return;
    }
    const ac = new AbortController();
    setStatus('loading');
    getCatalog(SYSTEM, { type: 'class' }, ac.signal)
      .then((res) => {
        if (ac.signal.aborted) return;
        const match = res.items.find((it) => it.name === className);
        setDescriptions(match ? descriptionsFromCatalogData(match.data) : {});
        setStatus('ok');
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setDescriptions({});
        setStatus('error');
      });
    return () => ac.abort();
  }, [className]);

  return { descriptions, status };
}
