'use client';
/**
 * Series detail — /modules/series/[slug] (T4p1 / TAV-SERIES-GROUPING).
 *
 * Cover + modules in play order, per the 2026-08-25 Campaign Series design
 * doc and the hearthlight-refined series.html artboard. No detail endpoint
 * exists yet (GET /catalog/{public_id} is Thread D's decided-but-unbuilt
 * scope — design doc §18 D1), so this page refetches the SAME `type=series`
 * list the catalog page uses and filters by slug client-side.
 *
 * B1 (T5 live sweep, 2026-08-28): a series' `member_refs` is a plain array
 * of bare adventure public_id strings (engine D1 ruling) — member NAMES are
 * not resolved in list mode at all. This page ALSO fetches `type=adventure`
 * and joins member_refs against it (by public_id) to resolve real titles/
 * levels — see `resolveSeriesMembers` in lib/dnd/adventureCatalog.ts. The
 * adventure fetch is best-effort: if it fails, every member just renders
 * unresolved ("Part N", no dead link) rather than failing the whole page —
 * same graceful-degrade posture as /modules' own series-fetch.
 *
 * Deliberately NOT rendered here (no data source, "thin real data" — see
 * dashboard/page.tsx's header comment): per-part played/locked/next-up
 * state. Session list responses don't carry adventure_ref or
 * progress.completed yet (2026-08-25 analysis doc §6, an unresolved gap
 * this design doesn't close) — every part renders as an equally-weighted,
 * playable row rather than a fabricated progress ladder.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthGate } from '@/lib/auth/useAuthGate';
import { getCatalog } from '@/lib/api/dnd';
import {
  toCatalogItem,
  toSeriesCatalogItem,
  resolveSeriesMembers,
  memberDisplayName,
  formatLevelRange,
  formatMemberCount,
  type ResolvedSeriesMember,
} from '@/lib/dnd/adventureCatalog';
import type { AdventureCatalogItem, SeriesCatalogItem } from '@/lib/api/types';
import TavernShell from '@/components/TavernShell';
import PageSkeleton from '@/components/PageSkeleton';
import Card from '@/components/Card';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import Icon from '@/components/Icon';
import SeriesCoverArt from '@/components/SeriesCoverArt';
import styles from './SeriesDetail.module.css';

type DetailStatus = 'loading' | 'ok' | 'not-found' | 'error';

export default function SeriesDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [series, setSeries] = useState<SeriesCatalogItem | null>(null);
  const [members, setMembers] = useState<ResolvedSeriesMember[]>([]);
  const [status, setStatus] = useState<DetailStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    // Canonical fetch-on-mount pattern (mirrors modules/page.tsx's own effect).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading');

    const seriesReq = getCatalog('dnd5e', { type: 'series' }, ac.signal);
    // Best-effort: only used to resolve member titles/levels — a failure
    // here degrades every member to "unresolved" (see the module doc
    // comment above), never the whole page to an error state.
    const adventuresReq = getCatalog('dnd5e', { type: 'adventure' }, ac.signal)
      .then((res) => res.items.map(toCatalogItem))
      .catch(() => [] as AdventureCatalogItem[]);

    Promise.all([seriesReq, adventuresReq])
      .then(([seriesRes, adventures]) => {
        if (ac.signal.aborted) return;
        const items = seriesRes.items
          .map(toSeriesCatalogItem)
          .filter((s): s is SeriesCatalogItem => s !== null);
        const match = items.find((s) => s.slug === slug || s.public_id === slug);
        if (match) {
          setSeries(match);
          setMembers(resolveSeriesMembers(match.summary.member_refs, adventures));
          setStatus('ok');
        } else {
          setSeries(null);
          setMembers([]);
          setStatus('not-found');
        }
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setSeries(null);
        setMembers([]);
        setStatus('error');
      });
    return () => ac.abort();
  }, [slug, attempt]);

  const gate = useAuthGate({
    skeleton: <PageSkeleton variant="card" lines={4} />,
    label: 'Loading series',
  });
  if (gate) return gate;

  return (
    <TavernShell active="modules" title={series?.name ?? 'Series'}>
      <Link href="/modules" className={styles.crumb}>
        <Icon name="Chevron" size={14} style={{ transform: 'rotate(180deg)' }} aria-hidden />
        Modules
      </Link>

      {status === 'loading' && <PageSkeleton variant="card" lines={4} />}

      {status === 'error' && (
        <Card className={styles.stateCard} role="alert" aria-labelledby="series-error-title">
          <p id="series-error-title" className={styles.stateTitle}>
            Suzu can&rsquo;t reach the series catalog right now.
          </p>
          <p className={styles.stateBody}>Check your connection or try again in a moment.</p>
          <Button variant="primary" size="lg" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </Card>
      )}

      {status === 'not-found' && (
        <Card className={styles.stateCard} role="status" aria-labelledby="series-notfound-title">
          <p id="series-notfound-title" className={styles.stateTitle}>
            That series isn&rsquo;t in the catalog.
          </p>
          <p className={styles.stateBody}>
            It may have been retired, or you may not have access to the pack it lives in.
          </p>
          <Button variant="ghost" href="/modules">
            Back to Modules
          </Button>
        </Card>
      )}

      {status === 'ok' && series && (
        <>
          <section className={styles.hero} aria-labelledby="series-hero-title">
            <SeriesCoverArt cover={series.summary.cover} size={112} className={styles.heroCover} />
            <div className={styles.heroBody}>
              <div className={styles.heroPills}>
                <Pill tone="lav">Series &middot; {formatMemberCount(series.summary.member_count)}</Pill>
                {series.summary.level_range && (
                  <Pill tone="muted">{formatLevelRange(series.summary.level_range)}</Pill>
                )}
                {series.summary.content_rating && series.summary.content_rating !== 'sfw' && (
                  <Pill tone="warn">{series.summary.content_rating}</Pill>
                )}
              </div>
              <h2 id="series-hero-title" className={styles.heroTitle}>
                {series.name}
              </h2>
              {series.summary.subtitle && <p className={styles.heroBlurb}>{series.summary.subtitle}</p>}
              {members.length > 0 && members[0].resolved && (
                <div className={styles.heroActions}>
                  <Button
                    variant="primary"
                    size="lg"
                    href={`/modules?adventure=${encodeURIComponent(members[0].ref)}`}
                    leadingIcon={<Icon name="D20" size={14} aria-hidden />}
                  >
                    Begin with {memberDisplayName(members[0])}
                  </Button>
                </div>
              )}
            </div>
          </section>

          <div className={styles.sectionLabelRow}>
            <h3 className={styles.sectionLabel}>Play order</h3>
          </div>

          <ol className={styles.partList} aria-label={`${series.name} — play order`}>
            {members.map((member) => (
              <li key={`${member.ref}-${member.position}`} className={styles.partRow}>
                <span className={styles.partNum} aria-hidden>
                  {member.position}
                </span>
                <div className={styles.partMeta}>
                  {member.level_range && (
                    <span className={styles.partAct}>{formatLevelRange(member.level_range)}</span>
                  )}
                  <span className={styles.partTitle}>{memberDisplayName(member)}</span>
                </div>
                {member.resolved ? (
                  <Button
                    variant="primary"
                    href={`/modules?adventure=${encodeURIComponent(member.ref)}`}
                    aria-label={`Run this — ${memberDisplayName(member)}`}
                  >
                    Run this
                  </Button>
                ) : (
                  // A "hole, not an ending" (design doc §5.4) — the ref
                  // didn't resolve against the fetched adventure list
                  // (retired/unentitled/paginated). No dead link.
                  <span className={styles.partUnresolved}>Not available</span>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </TavernShell>
  );
}
