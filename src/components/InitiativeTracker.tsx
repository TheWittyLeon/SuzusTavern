'use client';
/**
 * InitiativeTracker (ST-020) — turn order during combat, shown in the left pane.
 *
 * v1 note: the engine reports combat results as chat strings, not structured
 * turn-order JSON, so `entries` are assembled client-side from the party + the
 * monsters this session spawned, and `currentIndex` is best-effort. Live,
 * engine-authoritative turn sync lands when the engine grows a structured-status
 * endpoint (deferred). Rendered only while combat is active.
 */
import styles from './InitiativeTracker.module.css';

export interface InitEntry {
  id: string;
  name: string;
  initiative: number | null;
  kind: 'pc' | 'monster';
  isYou?: boolean;
}

export interface InitiativeTrackerProps {
  entries: InitEntry[];
  round: number | null;
  /** Index of the entry whose turn it is, or null if unknown. */
  currentIndex?: number | null;
}

export default function InitiativeTracker({
  entries,
  round,
  currentIndex = null,
}: InitiativeTrackerProps) {
  if (entries.length === 0) return null;
  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label} id="initiative-label">Initiative</span>
        {round != null && <span className={styles.round}>round {round}</span>}
      </div>
      <ol className={styles.list} aria-labelledby="initiative-label">
        {entries.map((e, i) => {
          const current = currentIndex === i;
          return (
            <li
              key={e.id}
              className={current ? `${styles.entry} ${styles.current}` : styles.entry}
              aria-current={current ? true : undefined}
            >
              <span
                className={styles.dot}
                style={{ background: e.kind === 'monster' ? 'var(--bad)' : 'var(--accent)' }}
                aria-hidden
              />
              <span className={styles.name}>
                {e.name}
                {e.isYou && <span className={styles.you}>you</span>}
              </span>
              <span className={styles.init}>{e.initiative ?? '—'}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
