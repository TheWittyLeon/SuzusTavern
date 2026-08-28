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
 * Returns null (never a broken card) when `cover`/`member_refs` — the two
 * fields a series card cannot render without — are absent: an older engine
 * build, a foreign/malformed payload, or SUZU_DND_SERIES still resolving.
 *
 * `member_refs` is a plain array of adventure public_id STRINGS (engine D1
 * ruling, verified live 2026-08-28 against .226 — see the B1 correction note
 * on SeriesSummary in types.ts). Member NAMES are not resolved here; use
 * `resolveSeriesMembers` below against a fetched type=adventure list.
 */
export function toSeriesCatalogItem(raw: unknown): SeriesCatalogItem | null {
  const item = raw as Record<string, unknown>;
  const summary = (item['summary'] as Record<string, unknown> | undefined) ?? {};
  const rawCover = summary['cover'];
  const rawMemberRefs = summary['member_refs'];
  if (
    !rawCover ||
    typeof rawCover !== 'object' ||
    !Array.isArray(rawMemberRefs) ||
    rawMemberRefs.length === 0 ||
    !rawMemberRefs.every((r) => typeof r === 'string')
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
      member_count: Number(summary['member_count'] ?? rawMemberRefs.length),
      member_refs: rawMemberRefs as string[],
    },
  };
}

/** A series member ref joined against the type=adventure catalog list —
 *  purely a client-side derived shape, never a wire type. */
export interface ResolvedSeriesMember {
  ref: string;
  /** 1-based — array order (member_refs order) IS play order. */
  position: number;
  /** The adventure's own catalog name, when the ref resolved. */
  name?: string;
  level_range?: { min: number; max: number };
  /** False when `ref` has no match in the fetched adventure list — retired,
   *  unentitled, or simply outside that page. A "hole, not an ending"
   *  (design doc §5.4's posture for the runtime next-pointer, applied here
   *  too): the caller renders a graceful placeholder, never a broken link. */
  resolved: boolean;
}

/**
 * Joins a series' `member_refs` (bare adventure public_id strings) against a
 * fetched `type=adventure` catalog list to resolve display titles/levels.
 * Order comes from `member_refs` order — never re-sorted by any
 * adventure-side stamp.
 */
export function resolveSeriesMembers(
  memberRefs: string[],
  adventures: AdventureCatalogItem[],
): ResolvedSeriesMember[] {
  const byId = new Map(adventures.map((a) => [a.public_id, a] as const));
  return memberRefs.map((ref, i) => {
    const adv = byId.get(ref);
    return {
      ref,
      position: i + 1,
      name: adv?.name,
      level_range: adv?.summary.level_range,
      resolved: adv !== undefined,
    };
  });
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

/** Display name for one resolved series member row — the joined adventure's
 *  own catalog name when `resolved`, else a positional "Part N" fallback
 *  (an unresolved ref, not a fabricated title). */
export function memberDisplayName(member: ResolvedSeriesMember): string {
  return member.name ?? `Part ${member.position}`;
}
