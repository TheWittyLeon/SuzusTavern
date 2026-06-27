'use client';
/**
 * /admin/content — Content Review Queue (S8.3)
 *
 * Lists all draft content items pending human review. Filterable by pack and
 * source document (client-side, queue is admin-only and expected to be small).
 *
 * Auth gate: this page redirects to /dashboard when the session lacks the
 * 'admin' role. The real enforcement is server-side in the proxy gate
 * (/api/dnd/admin/* → 403 for non-admin), but the page-level redirect gives
 * a cleaner UX than a raw 403 from the first data fetch.
 *
 * S8.3 — Gated Content Pipeline: Tavern admin review screen.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import TavernShell from '@/components/TavernShell';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import PageSkeleton from '@/components/PageSkeleton';
import { ToastProvider } from '@/components/Toast';
import { useAuth } from '@/lib/auth/AuthProvider';
import { listDrafts, type ContentDraftListItem } from '@/lib/api/adminContent';
import { formatStarted } from '@/lib/format';
import type { PillTone } from '@/components/Pill';
import styles from './QueueList.module.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

function contentTypePillTone(contentType: string): PillTone {
  switch (contentType) {
    case 'weapon':   return 'warn';
    case 'perk':     return 'cool';
    case 'creature': return 'bad';
    default:         return 'muted';
  }
}

// ── Queue state type ──────────────────────────────────────────────────────────

type QueueState =
  | { status: 'loading' }
  | { status: 'success'; items: ContentDraftListItem[]; total: number }
  | { status: 'error'; error: string };

// ── Queue table (>720px) ─────────────────────────────────────────────────────

interface QueueTableProps {
  items: ContentDraftListItem[];
  total: number;
}

function QueueTable({ items, total }: QueueTableProps) {
  const router = useRouter();

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="sr-only">
          Pending content drafts — {total} {total === 1 ? 'item' : 'items'}
        </caption>
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Name</th>
            <th scope="col" className={styles.colSlug}>Slug</th>
            <th scope="col">Pack</th>
            <th scope="col">Source page</th>
            <th scope="col">Snippet preview</th>
            <th scope="col">Created</th>
            <th scope="col" className="sr-only">Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.draft_id}
              className={styles.row}
              onClick={() => router.push(`/admin/content/${item.draft_id}`)}
            >
              <td>
                <Pill tone={contentTypePillTone(item.content_type)}>
                  {item.content_type}
                </Pill>
              </td>
              <td className={styles.nameCell}>{item.name}</td>
              <td className={`${styles.slugCell} mono`}>{item.slug}</td>
              <td className={styles.packCell}>{item.pack_id}</td>
              <td className={`${styles.pageCell} mono`}>p. {item.source.page}</td>
              <td className={styles.snippetCell}>
                <span className={styles.snippetPreview}>
                  {item.source.snippet.slice(0, 80)}
                  {item.source.snippet.length > 80 ? '…' : ''}
                </span>
              </td>
              <td className={styles.dateCell}>
                {formatStarted(item.created_at)}
              </td>
              <td>
                <Button
                  variant="ghost"
                  href={`/admin/content/${item.draft_id}`}
                  aria-label={`Review ${item.name}`}
                >
                  Review
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Queue card list (≤720px) ─────────────────────────────────────────────────

function QueueCardList({ items }: { items: ContentDraftListItem[] }) {
  return (
    <ul role="list" className={styles.cardList}>
      {items.map((item) => (
        <li key={item.draft_id} className={styles.card}>
          <div className={styles.cardMeta}>
            <Pill tone={contentTypePillTone(item.content_type)}>
              {item.content_type}
            </Pill>
            <span className={`${styles.cardPage} mono`}>p. {item.source.page}</span>
          </div>
          <p className={styles.cardName}>{item.name}</p>
          <p className={styles.cardSnippet}>
            {item.source.snippet.slice(0, 60)}
            {item.source.snippet.length > 60 ? '…' : ''}
          </p>
          <Button
            variant="ghost"
            href={`/admin/content/${item.draft_id}`}
            className={styles.cardReview}
            aria-label={`Review ${item.name}`}
          >
            Review
          </Button>
        </li>
      ))}
    </ul>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function AdminContentQueuePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [queueState, setQueueState] = useState<QueueState>({ status: 'loading' });
  const [packFilter, setPackFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  // Client-side admin gate: redirect non-admin sessions to /dashboard.
  // The real gate is server-side in the proxy; this is UX only.
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!user.roles?.includes('admin')) { router.replace('/dashboard'); return; }
  }, [user, authLoading, router]);

  // Fetch queue data
  useEffect(() => {
    if (!user?.roles?.includes('admin')) return;

    setQueueState({ status: 'loading' });
    const controller = new AbortController();

    listDrafts({ username: user.username, signal: controller.signal })
      .then((data) => {
        setQueueState({ status: 'success', items: data.items, total: data.total });
      })
      .catch((err: { name?: string; message?: string }) => {
        if (err?.name === 'AbortError') return;
        setQueueState({ status: 'error', error: 'The review queue couldn\'t be loaded. The engine API may be down.' });
      });

    return () => controller.abort();
  }, [user, retryKey]);

  const retry = useCallback(() => setRetryKey((k) => k + 1), []);

  // Derive filter options from loaded items (client-side — queue is small)
  const allItems = queueState.status === 'success' ? queueState.items : [];
  const packOptions = useMemo(
    () => Array.from(new Set(allItems.map((i) => i.pack_id))).sort(),
    [allItems],
  );
  const sourceOptions = useMemo(
    () => Array.from(new Set(allItems.map((i) => i.source.key))).sort(),
    [allItems],
  );

  // Apply client-side filters
  const filteredItems = useMemo(() => {
    let items = allItems;
    if (packFilter) items = items.filter((i) => i.pack_id === packFilter);
    if (sourceFilter) items = items.filter((i) => i.source.key === sourceFilter);
    return items;
  }, [allItems, packFilter, sourceFilter]);

  const hasFilter = packFilter !== '' || sourceFilter !== '';
  const clearFilters = () => { setPackFilter(''); setSourceFilter(''); };

  const pendingCount = queueState.status === 'success' ? queueState.total : 0;

  if (authLoading || (!user?.roles?.includes('admin') && !authLoading)) {
    return null; // Wait for auth or redirect
  }

  return (
    <ToastProvider>
      <TavernShell
        active="admin"
        title="Content Review Queue"
        actions={
          queueState.status === 'success' ? (
            <Pill tone="warn" dot>
              {pendingCount} pending
            </Pill>
          ) : undefined
        }
      >
        {/* Filter bar */}
        <div className={`glass ${styles.filterBar}`} role="search" aria-label="Filter drafts">
          <div className={styles.filterGroup}>
            <label htmlFor="filter-pack" className="label">Pack</label>
            <select
              id="filter-pack"
              className="input"
              value={packFilter}
              onChange={(e) => setPackFilter(e.target.value)}
              aria-label="Filter by pack"
              disabled={queueState.status !== 'success'}
            >
              <option value="">All packs</option>
              {packOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className={styles.filterGroup}>
            <label htmlFor="filter-source" className="label">Source</label>
            <select
              id="filter-source"
              className="input"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              aria-label="Filter by source document"
              disabled={queueState.status !== 'success'}
            >
              <option value="">All sources</option>
              {sourceOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          {hasFilter && (
            <Button variant="ghost" onClick={clearFilters} aria-label="Clear all filters">
              Clear filters
            </Button>
          )}
        </div>

        {/* State container */}
        <div
          aria-live="polite"
          aria-busy={queueState.status === 'loading' ? 'true' : 'false'}
          className={styles.stateContainer}
        >
          {queueState.status === 'loading' && (
            <PageSkeleton variant="list" lines={8} />
          )}

          {queueState.status === 'error' && (
            <div role="alert" className={`glass ${styles.stateCard}`}>
              <p style={{ color: 'var(--bad-ink)' }}>{queueState.error}</p>
              <Button variant="ghost" onClick={retry}>Try again</Button>
            </div>
          )}

          {queueState.status === 'success' && filteredItems.length === 0 && (
            <div className={`glass ${styles.stateCard}`}>
              {hasFilter ? (
                <>
                  <p style={{ color: 'var(--ink-2)' }}>No drafts match these filters.</p>
                  <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>
                </>
              ) : (
                <p style={{ color: 'var(--ink-2)' }}>
                  No pending drafts. Run the ingest script to populate the queue,
                  then come back here to review.
                </p>
              )}
            </div>
          )}

          {queueState.status === 'success' && filteredItems.length > 0 && (
            <>
              {/* Desktop table (>720px) — hidden at ≤720 via CSS */}
              <div className={styles.tableView}>
                <QueueTable items={filteredItems} total={filteredItems.length} />
              </div>
              {/* Mobile card list (≤720px) — hidden above 720 via CSS */}
              <div className={styles.cardView}>
                <QueueCardList items={filteredItems} />
              </div>
            </>
          )}
        </div>
      </TavernShell>
    </ToastProvider>
  );
}
