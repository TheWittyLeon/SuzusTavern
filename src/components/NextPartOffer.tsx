import type { SeriesCompletionPointer, SeriesNextAdventure } from '@/lib/api/types';
import Card from '@/components/Card';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import Icon from '@/components/Icon';
import styles from './NextPartOffer.module.css';

export interface NextPartOfferProps {
  /** One entry of an /advance completion response's `series` array
   *  (design doc §6.4). */
  series: SeriesCompletionPointer;
  /** Mirrors the response's `next_adventure` — null unless
   *  `series.next_status === 'ok'`. */
  next: SeriesNextAdventure | null;
  className?: string;
}

function partLabel(next: SeriesNextAdventure): string {
  return next.label ?? next.name ?? 'the next part';
}

/**
 * Renders the completion payload's next-part pointer (design doc §6.4).
 *
 * No live mount point exists in this phase's in-scope surfaces (catalog,
 * series, campaigns) — the payload this renders only arrives on
 * `POST /sessions/{id}/advance`'s response, at the moment a session's DM
 * completes an adventure, and play chrome (the only place that call
 * happens) is explicitly out of scope this phase. This component is built
 * and tested against the exact wire shape now so wiring it up later is a
 * mount, not a build.
 *
 * The hop itself: `POST /sessions/{id}/next-act` (the engine's rebind —
 * carries level/character state forward in place) is broken tonight
 * (P1 SERIES-NEXTACT-SEAT-SOURCE-SPLIT) and the NekoNova proxy doesn't
 * expose the route at all. Per the design doc, browse UI (including this
 * offer's hop mechanism) is explicitly out of scope — no concrete client
 * call is prescribed. Rather than a disabled dead-looking button OR
 * inventing a rebind call that doesn't exist client-side, the CTA reuses
 * the one hop that DOES already work end-to-end: starting a fresh table
 * bound to the next adventure_ref (the same /modules?adventure= deep link
 * the series detail page's part rows use). Copy is explicit that this is a
 * NEW table, not the seamless level-carrying rebind next-act would give —
 * no invented capability, no silent downgrade.
 */
export default function NextPartOffer({ series, next, className = '' }: NextPartOfferProps) {
  const cls = `${styles.card} ${className}`.trim();

  if (series.next_status === 'end_of_series') {
    return (
      <Card className={cls} role="status" aria-labelledby="next-part-title">
        <div className={styles.head}>
          <Icon name="Crit" size={18} aria-hidden />
          <p id="next-part-title" className={styles.title}>
            You&rsquo;ve completed {series.title}.
          </p>
        </div>
        <p className={styles.body}>
          Part {series.position} of {series.total} was the last one — that&rsquo;s the whole series.
        </p>
      </Card>
    );
  }

  if (series.next_status === 'unresolved') {
    return (
      <Card className={cls} role="status" aria-labelledby="next-part-title">
        <div className={styles.head}>
          <Icon name="Shield" size={18} aria-hidden />
          <p id="next-part-title" className={styles.title}>
            The next part of {series.title} isn&rsquo;t available right now.
          </p>
        </div>
        <p className={styles.body}>
          Part {series.position + 1} of {series.total} may have been retired or moved. Ask your DM,
          or check back later.
        </p>
      </Card>
    );
  }

  // next_status === 'ok'
  if (!next) return null; // wire-shape guard — 'ok' always carries `next` per design doc §6.4

  return (
    <Card className={cls} role="status" aria-labelledby="next-part-title">
      <div className={styles.head}>
        <Pill tone="lav">
          {series.title} &middot; Part {series.position} of {series.total} complete
        </Pill>
      </div>
      <p id="next-part-title" className={styles.title}>
        Up next: {partLabel(next)}
      </p>
      {next.level_range && (
        <p className={styles.body}>
          Levels {next.level_range.min}–{next.level_range.max}
        </p>
      )}
      <div className={styles.actions}>
        <Button
          variant="primary"
          href={`/modules?adventure=${encodeURIComponent(next.ref)}`}
          leadingIcon={<Icon name="D20" size={14} aria-hidden />}
        >
          Start {partLabel(next)} as a new table
        </Button>
      </div>
      <p className={styles.note}>
        <Icon name="Shield" size={12} aria-hidden /> This opens a fresh table bound to{' '}
        {partLabel(next)} — it doesn&rsquo;t carry this table&rsquo;s characters or progress forward
        automatically yet.
      </p>
    </Card>
  );
}
