// src/lib/dnd/adventureCatalog.ts
//
// Transforms raw GET /api/dnd/catalog items (content_type='adventure' and
// content_type='series') into the typed display shapes /modules and
// /modules/series/[slug] render. Shared between the two pages so the series
// mapper has exactly one implementation (design doc §8.3 point 2 flagged
// the old adventure-only mapper as the choke point to widen).

import type {
  AdventureCatalogItem,
  AdventureSeriesStamp,
  SeriesCatalogItem,
  SeriesCover,
  SeriesMemberRef,
} from '@/lib/api/types';

/** Map a raw catalog item for content_type='adventure' onto the typed
 *  AdventureCatalogItem shape. The engine returns adventures with a
 *  `summary` projection in the item body (a JSONB slice of data, not the
 *  full data blob). We cast via unknown because CatalogItem's `data` field
 *  predates this type. */
export function toCatalogItem(raw: unknown): AdventureCatalogItem {
  const item = raw as Record<string, unknown>;
  const summary = (item['summary'] as Record<string, unknown> | undefined) ?? {};
  return {
    public_id: String(item['public_id'] ?? item['slug'] ?? ''),
    name: String(item['name'] ?? ''),
    summary: {
      subtitle: summary['subtitle'] as string | undefined,
      level_range: summary['level_range'] as { min: number; max: number } | undefined,
      length: summary['length'] as string | undefined,
      content_rating: summary['content_rating'] as string | undefined,
      tags: summary['tags'] as string[] | undefined,
      // T4p1: previously stripped by this whitelist (design doc §8.3 point 2)
      // — the engine's catalog projection already carries these when
      // SUZU_DND_SERIES is on; the mapper just needs to stop dropping them.
      series: summary['series'] as AdventureSeriesStamp | undefined,
      also_in: summary['also_in'] as number | undefined,
      editorial_role: summary['editorial_role'] as string | undefined,
    },
  };
}

/**
 * Map a raw catalog item for content_type='series' onto SeriesCatalogItem.
 * Returns null (never a broken card) when `cover`/`members` — the two fields
 * a series card cannot render without — are absent: an older engine build,
 * a foreign/malformed payload, or SUZU_DND_SERIES still resolving. Member
 * NAMES are deliberately not resolved in list mode (design doc §8.1/§18 D1)
 * — only `ref`/`act_handle`/an author-supplied `label` travel on the wire.
 */
export function toSeriesCatalogItem(raw: unknown): SeriesCatalogItem | null {
  const item = raw as Record<string, unknown>;
  const summary = (item['summary'] as Record<string, unknown> | undefined) ?? {};
  const rawCover = summary['cover'];
  const rawMembers = summary['members'];
  if (
    !rawCover ||
    typeof rawCover !== 'object' ||
    !Array.isArray(rawMembers) ||
    rawMembers.length === 0
  ) {
    return null;
  }
  const cover = rawCover as Record<string, unknown>;
  return {
    public_id: String(item['public_id'] ?? ''),
    slug: String(item['slug'] ?? ''),
    name: String(item['name'] ?? ''),
    summary: {
      subtitle: summary['subtitle'] as string | undefined,
      level_range: summary['level_range'] as { min: number; max: number } | undefined,
      length: summary['length'] as string | undefined,
      content_rating: summary['content_rating'] as string | undefined,
      tags: summary['tags'] as string[] | undefined,
      cover: {
        color: String(cover['color'] ?? '#5a4a7a'),
        pattern: (cover['pattern'] as SeriesCover['pattern']) ?? 'none',
        glyph: String(cover['glyph'] ?? 'scroll'),
        image_ref: (cover['image_ref'] as string | null | undefined) ?? null,
      },
      member_count: Number(summary['member_count'] ?? rawMembers.length),
      members: rawMembers as SeriesMemberRef[],
    },
  };
}

export function formatLevelRange(lr?: { min: number; max: number }): string {
  if (!lr) return '';
  if (lr.min === lr.max) return `level ${lr.min}`;
  return `levels ${lr.min}–${lr.max}`;
}

export function formatLength(len?: string): string {
  if (!len) return '';
  return len.replace(/_/g, ' ');
}

export function formatMemberCount(n: number): string {
  return `${n} ${n === 1 ? 'part' : 'parts'}`;
}

/** Display label for one series member row — an author-supplied `label`
 *  when present, else a positional "Part N" fallback. Member NAMES are not
 *  resolved in list mode (see this module's header comment / design doc
 *  §8.1 D1), so this is the only title text available client-side today. */
export function memberLabel(member: SeriesMemberRef, position: number): string {
  return member.label && member.label.trim().length > 0 ? member.label : `Part ${position}`;
}
