'use client';
/**
 * /admin/pending — Pending registration review queue.
 *
 * Lists users who submitted a registration under 'approval' mode
 * (is_active=false, no roles). Admins can approve or deny each applicant.
 *
 * Approve: activates the account (grants 'user' role server-side).
 * Deny: prompts for an optional reason, then hard-deletes the pending row
 *       (frees the username; reason is logged on the auth backend only).
 *
 * Admin gate: client-side redirect (UX) + server-side BFF gate (enforcement).
 * Follows the same pattern as /admin/content.
 *
 * B3 — signup UI + admin screens.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import TavernShell from '@/components/TavernShell';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import PageSkeleton from '@/components/PageSkeleton';
import { ToastProvider, useToast } from '@/components/Toast';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useReducedMotion } from '@/lib/useReducedMotion';
import {
  listPending,
  approveRegistration,
  denyRegistration,
  type PendingUser,
} from '@/lib/api/signup';
import { formatStarted } from '@/lib/format';
import styles from './Pending.module.css';

// ── Deny dialog ───────────────────────────────────────────────────────────────

interface DenyDialogProps {
  user: PendingUser;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  busy: boolean;
}

function DenyDialog({ user, onClose, onConfirm, busy }: DenyDialogProps) {
  const [reason, setReason] = useState('');
  const reduced = useReducedMotion();
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, busy]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="deny-heading"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className={`glass ${styles.modal}`}>
        <h2 id="deny-heading" className={styles.modalHeading}>
          Deny {user.username}?
        </h2>
        <p className={styles.modalSub}>
          This will permanently delete the pending account and free the username.
          {user.email ? ` Email on file: ${user.email}.` : ''}
        </p>

        <div className={styles.fieldGroup}>
          <label htmlFor="deny-reason" className="label">Reason (optional)</label>
          <textarea
            id="deny-reason"
            ref={reasonRef}
            className="input"
            rows={3}
            placeholder="Logged on the auth backend only. Not shown to the user."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            style={{ height: 'auto', padding: '10px 14px', resize: 'vertical' }}
          />
          <span className={styles.fieldHint}>Not shown to the applicant — for audit records only.</span>
        </div>

        <div className={styles.modalActions}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => onConfirm(reason)}
            disabled={busy}
            aria-label={busy ? 'Denying…' : 'Confirm deny'}
          >
            {busy && !reduced && <span className={styles.spinner} aria-hidden="true" />}
            {busy ? 'Denying…' : 'Deny'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Table row ─────────────────────────────────────────────────────────────────

interface RowProps {
  user: PendingUser;
  onApprove: (id: number) => void;
  onDenyStart: (user: PendingUser) => void;
  busy: boolean;
}

function PendingRow({ user, onApprove, onDenyStart, busy }: RowProps) {
  return (
    <tr className={styles.row}>
      <td style={{ fontWeight: 500 }}>{user.username}</td>
      <td className={`${styles.emailCell} ${styles.colEmail}`}>{user.email ?? '—'}</td>
      <td className={styles.dateCell}>{formatStarted(user.created_at)}</td>
      <td>
        <div className={styles.actionCell}>
          <Button
            variant="ghost"
            onClick={() => onApprove(user.id)}
            disabled={busy}
            aria-label={`Approve ${user.username}`}
            style={{ color: 'var(--good)', fontSize: 13 }}
          >
            Approve
          </Button>
          <Button
            variant="ghost"
            onClick={() => onDenyStart(user)}
            disabled={busy}
            aria-label={`Deny ${user.username}`}
            style={{ color: 'var(--bad-ink)', fontSize: 13 }}
          >
            Deny
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ── Mobile card ───────────────────────────────────────────────────────────────

function PendingCard({ user, onApprove, onDenyStart, busy }: RowProps) {
  return (
    <li className={styles.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{user.username}</span>
        <Pill tone="warn">pending</Pill>
      </div>
      {user.email && <p className={styles.cardMeta}>{user.email}</p>}
      <p className={styles.cardMeta}>Submitted: {formatStarted(user.created_at)}</p>
      <div className={styles.cardActions}>
        <Button
          variant="ghost"
          onClick={() => onApprove(user.id)}
          disabled={busy}
          aria-label={`Approve ${user.username}`}
          style={{ color: 'var(--good)', fontSize: 13 }}
        >
          Approve
        </Button>
        <Button
          variant="ghost"
          onClick={() => onDenyStart(user)}
          disabled={busy}
          aria-label={`Deny ${user.username}`}
          style={{ color: 'var(--bad-ink)', fontSize: 13 }}
        >
          Deny
        </Button>
      </div>
    </li>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type PageState =
  | { status: 'loading' }
  | { status: 'success'; users: PendingUser[] }
  | { status: 'error'; error: string };

function PendingPageContent() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [pageState, setPageState] = useState<PageState>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [denyTarget, setDenyTarget] = useState<PendingUser | null>(null);
  const [denyBusy, setDenyBusy] = useState(false);

  // Client-side admin gate
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!user.roles?.includes('admin')) { router.replace('/dashboard'); return; }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user?.roles?.includes('admin')) return;
    const controller = new AbortController();

    listPending({ signal: controller.signal })
      .then((data) => {
        setPageState({ status: 'success', users: data.pending });
      })
      .catch((err: { name?: string; message?: string }) => {
        if (err?.name === 'AbortError') return;
        setPageState({ status: 'error', error: 'Could not load pending registrations.' });
      });

    return () => controller.abort();
  }, [user, retryKey]);

  const refreshList = useCallback(() => {
    setPageState({ status: 'loading' });
    setRetryKey((k) => k + 1);
  }, []);

  const handleApprove = useCallback(async (id: number) => {
    setBusyId(id);
    try {
      const result = await approveRegistration(id);
      toast({ tone: 'success', title: 'Approved', message: `${result.user.username} can now sign in.` });
      refreshList();
    } catch {
      toast({ tone: 'error', title: 'Error', message: 'Failed to approve registration.' });
    } finally {
      setBusyId(null);
    }
  }, [toast, refreshList]);

  const handleDenyConfirm = useCallback(async (reason: string) => {
    if (!denyTarget) return;
    setDenyBusy(true);
    try {
      await denyRegistration(denyTarget.id, reason || undefined);
      toast({ tone: 'success', title: 'Denied', message: `${denyTarget.username}'s request denied and removed.` });
      setDenyTarget(null);
      refreshList();
    } catch {
      toast({ tone: 'error', title: 'Error', message: 'Failed to deny registration.' });
    } finally {
      setDenyBusy(false);
    }
  }, [denyTarget, toast, refreshList]);

  if (authLoading || (!user?.roles?.includes('admin') && !authLoading)) {
    return null;
  }

  const pendingUsers = pageState.status === 'success' ? pageState.users : [];

  return (
    <>
      {denyTarget && (
        <DenyDialog
          user={denyTarget}
          onClose={() => { if (!denyBusy) setDenyTarget(null); }}
          onConfirm={handleDenyConfirm}
          busy={denyBusy}
        />
      )}

      <TavernShell
        active="admin"
        title="Pending registrations"
        actions={
          pageState.status === 'success' && pendingUsers.length > 0 ? (
            <Pill tone="warn" dot>
              {pendingUsers.length} pending
            </Pill>
          ) : undefined
        }
      >
        <div className={styles.stateContainer}>
          {pageState.status === 'loading' && (
            <PageSkeleton variant="list" lines={4} />
          )}

          {pageState.status === 'error' && (
            <div role="alert" className={`glass ${styles.stateCard}`}>
              <p style={{ color: 'var(--bad-ink)' }}>{pageState.error}</p>
              <Button variant="ghost" onClick={refreshList}>Try again</Button>
            </div>
          )}

          {pageState.status === 'success' && pendingUsers.length === 0 && (
            <div className={`glass ${styles.stateCard}`}>
              <p style={{ color: 'var(--ink-2)' }}>
                No pending registrations. When someone applies under approval mode, they&apos;ll appear here.
              </p>
            </div>
          )}

          {pageState.status === 'success' && pendingUsers.length > 0 && (
            <>
              <div className={styles.tableView}>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <caption className="sr-only">
                      Pending registrations — {pendingUsers.length} applicant{pendingUsers.length !== 1 ? 's' : ''}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Username</th>
                        <th scope="col" className={styles.colEmail}>Email</th>
                        <th scope="col">Submitted</th>
                        <th scope="col" className="sr-only">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingUsers.map((u) => (
                        <PendingRow
                          key={u.id}
                          user={u}
                          onApprove={handleApprove}
                          onDenyStart={setDenyTarget}
                          busy={busyId === u.id}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={styles.cardView}>
                <ul role="list" className={styles.cardList}>
                  {pendingUsers.map((u) => (
                    <PendingCard
                      key={u.id}
                      user={u}
                      onApprove={handleApprove}
                      onDenyStart={setDenyTarget}
                      busy={busyId === u.id}
                    />
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </TavernShell>
    </>
  );
}

export default function AdminPendingPage() {
  return (
    <ToastProvider>
      <PendingPageContent />
    </ToastProvider>
  );
}
