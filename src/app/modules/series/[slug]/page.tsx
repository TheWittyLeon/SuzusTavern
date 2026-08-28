'use client';
/**
 * Series detail — /modules/series/[slug] (T4p1 / TAV-SERIES-GROUPING).
 *
 * Cover + modules in play order, per the 2026-08-25 Campaign Series design
 * doc and the hearthlight-refined series.html artboard. No detail endpoint
 * exists yet (GET /catalog/{public_id} is Thread D's decided-but-unbuilt
 * scope — design doc §18 D1), so this page refetches the SAME
 * `type=series` list the catalog page uses and filters by slug client-side.
 * That also means member NAMES are not resolved here either (D1) — only
 * `ref`/`act_handle`/an author-supplied `label` travel on the wire; a
 * member with no `label` falls back to "Part N".
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
  toSeriesCatalogItem,
  formatLevelRange,
  formatMemberCount,
  memberLabel,
} from '@/lib/dnd/adventureCatalog';
import type { SeriesCatalogItem } from '@/lib/api/types';
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
  const [status, setStatus] = useState<DetailStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    // Canonical fetch-on-mount pattern (mirrors modules/page.tsx's own effect).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading');
    getCatalog('dnd5e', { type: 'series' }, ac.signal)
      .then((res) => {
        if (ac.signal.aborted) return;
        const items = res.items
          .map(toSeriesCatalogItem)
          .filter((s): s is SeriesCatalogItem => s !== null);
        const match = items.find((s) => s.slug === slug || s.public_id === slug);
        if (match) {
          setSeries(match);
          setStatus('ok');
        } else {
          setSeries(null);
          setStatus('not-found');
        }
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setSeries(null);
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
              {series.summary.members.length > 0 && (
                <div className={styles.heroActions}>
                  <Button
                    variant="primary"
                    size="lg"
                    href={`/modules?adventure=${encodeURIComponent(series.summary.members[0].ref)}`}
                    leadingIcon={<Icon name="D20" size={14} aria-hidden />}
                  >
                    Begin with {memberLabel(series.summary.members[0], 1)}
                  </Button>
                </div>
              )}
            </div>
          </section>

          <div className={styles.sectionLabelRow}>
            <h3 className={styles.sectionLabel}>Play order</h3>
          </div>

          <ol className={styles.partList} aria-label={`${series.name} — play order`}>
            {series.summary.members.map((member, i) => {
              const position = i + 1;
              return (
                <li key={`${member.ref}-${position}`} className={styles.partRow}>
                  <span className={styles.partNum} aria-hidden>
                    {position}
                  </span>
                  <div className={styles.partMeta}>
                    {member.act_handle && <span className={styles.partAct}>{member.act_handle}</span>}
                    <span className={styles.partTitle}>{memberLabel(member, position)}</span>
                  </div>
                  <Button
                    variant="primary"
                    href={`/modules?adventure=${encodeURIComponent(member.ref)}`}
                    aria-label={`Run this — ${memberLabel(member, position)}`}
                  >
                    Run this
                  </Button>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </TavernShell>
  );
}
