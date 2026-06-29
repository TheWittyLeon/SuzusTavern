'use client';
/**
 * /admin/flags — Read-only feature-flag panel (Phase 1).
 *
 * Fetches GET /api/admin/flags (via BFF proxy to Auth-Python) and renders the
 * full flag registry in a table: key, label/description, resolved value,
 * resolution source (env/config/default badge), scope, risk (high rows
 * highlighted), and services. No write controls — that's Phase 2.
 *
 * Admin gate: client-side redirect (UX) + server-side BFF gate (enforcement).
 * Follows the same pattern as /admin/invitations.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TavernShell from '@/components/TavernShell';
import PageSkeleton from '@/components/PageSkeleton';
import Button from '@/components/Button';
import { useAuth } from '@/lib/auth/AuthProvider';
import { listFlags, type FeatureFlag, type ResolutionSource } from '@/lib/api/adminFlags';
import styles from './Flags.module.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function SourceBadge({ source, owner }: { source: ResolutionSource; owner: string }) {
  const cls =
    source === 'env'     ? styles.sourceEnv
    : source === 'config'  ? styles.sourceConfig
    : source === 'remote'  ? styles.sourceRemote
    : styles.sourceDefault;
  const label = source === 'remote' ? `remote (${owner})` : source;
  return <span className={`${styles.sourceBadge} ${cls}`}>{label}</span>;
}

function ResolvedValue({ flag }: { flag: FeatureFlag }) {
  const v = flag.resolved_value;
  if (v === null) {
    return (
      <span className={styles.valueRemote} title={`Not visible from this panel — owned by ${flag.owner}`}>
        not visible ({flag.owner})
      </span>
    );
  }
  if (typeof v === 'boolean') {
    return (
      <span className={v ? styles.valueTrue : styles.valueFalse}>
        {String(v)}
      </span>
    );
  }
  return <span className={styles.valueString}>{String(v)}</span>;
}

function RiskLabel({ risk }: { risk: FeatureFlag['risk'] }) {
  const cls =
    risk === 'high'   ? styles.riskHigh
    : risk === 'medium' ? styles.riskMedium
    : styles.riskLow;
  return <span className={cls}>{risk}</span>;
}

// ── Table row ─────────────────────────────────────────────────────────────────

function FlagRow({ flag }: { flag: FeatureFlag }) {
  const isHigh = flag.risk === 'high';
  return (
    <tr className={`${styles.row} ${isHigh ? styles.rowHighRisk : ''}`}>
      <td className={styles.keyCell}>
        <code className={styles.keyCode}>{flag.key}</code>
        <span className={styles.labelText}>{flag.label}</span>
        {flag.description && (
          <span className={styles.descText}>{flag.description}</span>
        )}
      </td>
      <td className={styles.valueCell}>
        <ResolvedValue flag={flag} />
      </td>
      <td>
        <SourceBadge source={flag.resolution_source} owner={flag.owner} />
      </td>
      <td className={`${styles.scopeCell} ${styles.colScope}`}>
        {flag.scope.join(', ')}
      </td>
      <td className={styles.colRisk}>
        <RiskLabel risk={flag.risk} />
      </td>
      <td className={styles.colServices}>
        <ul className={styles.serviceList} aria-label={`Services for ${flag.key}`}>
          {flag.services.map((s) => (
            <li key={s} className={styles.servicePill}>{s}</li>
          ))}
        </ul>
      </td>
    </tr>
  );
}

// ── Mobile card ───────────────────────────────────────────────────────────────

function FlagCard({ flag }: { flag: FeatureFlag }) {
  const isHigh = flag.risk === 'high';
  return (
    <li className={`${styles.card} ${isHigh ? styles.cardHighRisk : ''}`}>
      <div className={styles.cardTopRow}>
        <code className={styles.keyCode}>{flag.key}</code>
        <SourceBadge source={flag.resolution_source} owner={flag.owner} />
      </div>
      <span className={styles.labelText}>{flag.label}</span>
      {flag.description && (
        <span className={styles.cardDesc}>{flag.description}</span>
      )}
      <div className={styles.cardMeta}>
        <span>Value: <ResolvedValue flag={flag} /></span>
        <span>Risk: <RiskLabel risk={flag.risk} /></span>
        <span>Scope: {flag.scope.join(', ')}</span>
      </div>
    </li>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type PageState =
  | { status: 'loading' }
  | { status: 'success'; flags: FeatureFlag[]; count: number; phase: number }
  | { status: 'error'; error: string };

function FlagsPageContent() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [pageState, setPageState] = useState<PageState>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);

  // Client-side admin gate
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!user.roles?.includes('admin')) { router.replace('/dashboard'); return; }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user?.roles?.includes('admin')) return;
    const controller = new AbortController();

    listFlags(controller.signal)
      .then((data) => {
        setPageState({ status: 'success', flags: data.flags, count: data.count, phase: data.phase });
      })
      .catch((err: { name?: string; message?: string }) => {
        if (err?.name === 'AbortError') return;
        setPageState({ status: 'error', error: 'Could not load feature flags.' });
      });

    return () => controller.abort();
  }, [user, retryKey]);

  if (authLoading || (!user?.roles?.includes('admin') && !authLoading)) {
    return null;
  }

  const flags = pageState.status === 'success' ? pageState.flags : [];
  const phase = pageState.status === 'success' ? pageState.phase : 1;

  return (
    <TavernShell active="admin" title="Feature flags">
      {/* Phase 1 notice */}
      <div className={styles.phaseBanner} role="note">
        <span>
          <strong>Phase {phase} — read-only.</strong>{' '}
          This panel shows the current environment-resolved value of every registered flag.
          Toggling controls arrive in Phase 2.
        </span>
      </div>

      <div className={styles.stateContainer}>
        {pageState.status === 'loading' && (
          <PageSkeleton variant="list" lines={7} />
        )}

        {pageState.status === 'error' && (
          <div role="alert" className={`glass ${styles.stateCard}`}>
            <p style={{ color: 'var(--bad-ink)' }}>{pageState.error}</p>
            <Button
              variant="ghost"
              onClick={() => { setPageState({ status: 'loading' }); setRetryKey((k) => k + 1); }}
            >
              Try again
            </Button>
          </div>
        )}

        {pageState.status === 'success' && flags.length === 0 && (
          <div className={`glass ${styles.stateCard}`}>
            <p style={{ color: 'var(--ink-2)' }}>No flags registered yet.</p>
          </div>
        )}

        {pageState.status === 'success' && flags.length > 0 && (
          <>
            {/* Desktop table */}
            <div className={styles.tableView}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <caption className="sr-only">
                    Feature flags — {flags.length} {flags.length === 1 ? 'flag' : 'flags'}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Key / Label</th>
                      <th scope="col">Resolved value</th>
                      <th scope="col">Source</th>
                      <th scope="col" className={styles.colScope}>Scope</th>
                      <th scope="col" className={styles.colRisk}>Risk</th>
                      <th scope="col" className={styles.colServices}>Services</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flags.map((f) => (
                      <FlagRow key={f.key} flag={f} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile cards */}
            <div className={styles.cardView}>
              <ul role="list" className={styles.cardList}>
                {flags.map((f) => (
                  <FlagCard key={f.key} flag={f} />
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </TavernShell>
  );
}

export default function AdminFlagsPage() {
  return <FlagsPageContent />;
}
