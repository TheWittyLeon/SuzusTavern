'use client';
/**
 * /admin/invitations — Invite code management.
 *
 * Lists existing invitations with status. Provides a "Mint invite" button that
 * opens a modal form. On success, shows the code + signup_url ONCE in a
 * one-time reveal block with a copy-to-clipboard button.
 *
 * Admin gate: client-side redirect (UX) + server-side BFF gate (enforcement).
 * Follows the same pattern as /admin/content.
 *
 * B3 — signup UI + admin screens.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TavernShell from '@/components/TavernShell';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import PageSkeleton from '@/components/PageSkeleton';
import { ToastProvider, useToast } from '@/components/Toast';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useReducedMotion } from '@/lib/useReducedMotion';
import {
  listInvitations,
  mintInvitation,
  revokeInvitation,
  type Invitation,
  type InvitationStatus,
  type MintInviteRequest,
} from '@/lib/api/signup';
import type { ApiError } from '@/lib/api/types';
import { formatStarted } from '@/lib/format';
import type { PillTone } from '@/components/Pill';
import styles from './Invitations.module.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusTone(status: InvitationStatus | string): PillTone {
  switch (status) {
    case 'active':    return 'good';
    case 'exhausted': return 'warn';
    case 'expired':   return 'muted';
    case 'revoked':   return 'bad';
    default:          return 'muted';
  }
}

function formatExpiry(expires_at: string | null): string {
  if (!expires_at) return 'never';
  return formatStarted(expires_at);
}

// ── Mint modal ────────────────────────────────────────────────────────────────

interface MintedInfo {
  code: string;
  signup_url: string;
}

interface MintModalProps {
  onClose: () => void;
  onMinted: (inv: Invitation, mintedInfo: MintedInfo) => void;
}

function MintModal({ onClose, onMinted }: MintModalProps) {
  const reduced = useReducedMotion();
  const [note, setNote] = useState('');
  const [role, setRole] = useState('user');
  const [maxUses, setMaxUses] = useState('1');
  const [expiresHours, setExpiresHours] = useState('168'); // 7 days default
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      const parsedMax = parseInt(maxUses, 10);
      const parsedExpiry = parseInt(expiresHours, 10);

      if (isNaN(parsedMax) || parsedMax < 0) {
        setError('Max uses must be 0 (unlimited) or a positive number.');
        return;
      }
      if (parsedMax === 0 && (!expiresHours || isNaN(parsedExpiry))) {
        setError('Unlimited-use codes require an expiry.');
        return;
      }

      const body: MintInviteRequest = {
        role_to_grant: role || 'user',
        max_uses: parsedMax,
        ...(expiresHours && !isNaN(parsedExpiry) ? { expires_in_hours: parsedExpiry } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      };

      setSubmitting(true);
      try {
        const result = await mintInvitation(body);
        const inv = result.invitation;
        const code = inv.code ?? '';
        const signup_url = inv.signup_url ?? '';
        onMinted(inv, { code, signup_url });
      } catch (err: unknown) {
        const ae = err as ApiError;
        const msg =
          (typeof (ae.body as Record<string, unknown> | undefined)?.['msg'] === 'string'
            ? (ae.body as Record<string, unknown>)['msg'] as string
            : null) ??
          ae.message ??
          'Failed to mint invite.';
        setError(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [note, role, maxUses, expiresHours, onMinted],
  );

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mint-modal-heading"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`glass ${styles.modal}`}>
        <h2 id="mint-modal-heading" className={styles.modalHeading}>
          Mint invite code
        </h2>

        {error && (
          <div role="alert" className={styles.errorBanner}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.fieldGroup}>
            <label htmlFor="mint-note" className="label">Note (optional)</label>
            <input
              id="mint-note"
              className="input"
              type="text"
              placeholder="e.g. for Sam (Discord)"
              maxLength={255}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="mint-role" className="label">Role to grant</label>
            <input
              id="mint-role"
              className="input"
              type="text"
              placeholder="user"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={submitting}
            />
            <span className={styles.fieldHint}>Must be an existing role. Default: user.</span>
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="mint-max" className="label">Max uses</label>
            <input
              id="mint-max"
              className="input"
              type="number"
              min="0"
              placeholder="1"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              disabled={submitting}
            />
            <span className={styles.fieldHint}>0 = unlimited (requires expiry).</span>
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="mint-expiry" className="label">Expires in hours</label>
            <input
              id="mint-expiry"
              className="input"
              type="number"
              min="1"
              placeholder="168"
              value={expiresHours}
              onChange={(e) => setExpiresHours(e.target.value)}
              disabled={submitting}
            />
            <span className={styles.fieldHint}>168 = 7 days. Leave blank for no expiry (only valid when max uses &gt; 0).</span>
          </div>

          <div className={styles.modalActions}>
            <Button variant="ghost" type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              aria-label={submitting ? 'Minting…' : 'Mint invite'}
            >
              {submitting && !reduced && (
                <span className={styles.spinner} aria-hidden="true" />
              )}
              {submitting ? 'Minting…' : 'Mint invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── One-time reveal block ─────────────────────────────────────────────────────

/**
 * Copy text to clipboard with a fallback for non-secure (HTTP) contexts.
 *
 * On plain HTTP (e.g. homelab at http://10.69.69.127:3000) `navigator.clipboard`
 * is undefined because the Clipboard API requires a secure context. This helper
 * tries the modern API first and falls back to the legacy execCommand path.
 *
 * Returns true if the copy succeeded via either path.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  // Modern API — only available in secure contexts (HTTPS / localhost).
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy path if the browser refuses (e.g. permissions).
    }
  }

  // Legacy execCommand fallback — works on plain HTTP.
  const ta = document.createElement('textarea');
  // Capture focus origin so keyboard users aren't stranded after the textarea
  // is removed (restored in the finally block).
  const prev = document.activeElement as HTMLElement | null;
  try {
    ta.value = text;
    // Off-screen so it doesn't shift layout.
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    // readonly prevents a mobile soft-keyboard from popping open.
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    // preventScroll avoids a focus-induced page jump.
    ta.focus({ preventScroll: true });
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    // Remove the textarea regardless of success, failure, or throw.
    if (ta.parentNode) ta.parentNode.removeChild(ta);
    // Restore focus to the element that triggered the copy.
    prev?.focus?.();
  }
}

function RevealBlock({ code, signup_url, onDismiss }: MintedInfo & { onDismiss: () => void }) {
  const [copied, setCopied] = useState<'code' | 'url' | null>(null);

  // Bug fix: build the sign-up link from window.location.origin so it always
  // reflects how the Tavern was actually reached (not the backend's FRONTEND_URL
  // which defaults to localhost:3000 on the auth box).
  // Guard for SSR safety even though RevealBlock only ever mounts after a user
  // interaction — fall back to the API-provided signup_url if window is absent.
  const signupLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/signup?invite=${code}`
      : signup_url;

  const copy = useCallback(async (text: string, which: 'code' | 'url') => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    }
  }, []);

  return (
    <div role="status" className={`glass ${styles.revealBox}`}>
      <span className={styles.revealLabel}>Invite created — copy now</span>
      <p className={styles.revealWarning}>
        The invite code and sign-up link are shown <strong>once only</strong> and will not be shown again.
      </p>

      <div>
        <span className="label" style={{ marginBottom: 6, display: 'block' }}>Code</span>
        <div className={styles.codeRow}>
          <code className={styles.codeBlock}>{code}</code>
          <Button
            variant="ghost"
            onClick={() => void copy(code, 'code')}
            aria-label="Copy invite code"
          >
            {copied === 'code' ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </div>

      <div>
        <span className="label" style={{ marginBottom: 6, display: 'block' }}>Sign-up link</span>
        <div className={styles.codeRow}>
          <code className={styles.codeBlock}>{signupLink}</code>
          <Button
            variant="ghost"
            onClick={() => void copy(signupLink, 'url')}
            aria-label="Copy sign-up link"
          >
            {copied === 'url' ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </div>

      <Button variant="ghost" onClick={onDismiss} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
        Dismiss
      </Button>
    </div>
  );
}

// ── Table row ─────────────────────────────────────────────────────────────────

interface RowProps {
  inv: Invitation;
  onRevoke: (id: number) => void;
  revoking: boolean;
}

function InviteRow({ inv, onRevoke, revoking }: RowProps) {
  return (
    <tr className={styles.row}>
      <td className="mono" style={{ fontSize: 12 }}>{inv.code_prefix}…</td>
      <td>
        <Pill tone={statusTone(inv.status)}>{inv.status}</Pill>
      </td>
      <td className="mono" style={{ fontSize: 12 }}>{inv.role_to_grant}</td>
      <td className={styles.usageCell}>{inv.used_count} / {inv.max_uses === 0 ? '∞' : inv.max_uses}</td>
      <td className={`${styles.dateCell} ${styles.expiryCell}`}>{formatExpiry(inv.expires_at)}</td>
      <td className={`${styles.noteCell} ${styles.colNote}`}>{inv.note ?? '—'}</td>
      <td className={styles.dateCell}>{formatStarted(inv.created_at)}</td>
      <td>
        {inv.status === 'active' && (
          <Button
            variant="ghost"
            onClick={() => onRevoke(inv.id)}
            disabled={revoking}
            aria-label={`Revoke invite ${inv.code_prefix}`}
            style={{ color: 'var(--bad-ink)', fontSize: 12 }}
          >
            Revoke
          </Button>
        )}
      </td>
    </tr>
  );
}

// ── Mobile card ───────────────────────────────────────────────────────────────

function InviteCard({ inv, onRevoke, revoking }: RowProps) {
  return (
    <li className={styles.card}>
      <div className={styles.cardTopRow}>
        <code className="mono" style={{ fontSize: 12 }}>{inv.code_prefix}…</code>
        <Pill tone={statusTone(inv.status)}>{inv.status}</Pill>
      </div>
      <p className={styles.cardMeta}>
        Role: {inv.role_to_grant} · Uses: {inv.used_count}/{inv.max_uses === 0 ? '∞' : inv.max_uses} · Expires: {formatExpiry(inv.expires_at)}
      </p>
      {inv.note && <p className={styles.cardMeta}>{inv.note}</p>}
      {inv.status === 'active' && (
        <Button
          variant="ghost"
          onClick={() => onRevoke(inv.id)}
          disabled={revoking}
          aria-label={`Revoke invite ${inv.code_prefix}`}
          style={{ color: 'var(--bad-ink)', fontSize: 12, alignSelf: 'flex-start', marginTop: 4 }}
        >
          Revoke
        </Button>
      )}
    </li>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type PageState =
  | { status: 'loading' }
  | { status: 'success'; invitations: Invitation[] }
  | { status: 'error'; error: string };

function InvitationsPageContent() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [pageState, setPageState] = useState<PageState>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const [showMintModal, setShowMintModal] = useState(false);
  const [mintedInfo, setMintedInfo] = useState<MintedInfo | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);

  // Client-side admin gate
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!user.roles?.includes('admin')) { router.replace('/dashboard'); return; }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user?.roles?.includes('admin')) return;
    const controller = new AbortController();

    listInvitations({ signal: controller.signal })
      .then((data) => {
        setPageState({ status: 'success', invitations: data.invitations });
      })
      .catch((err: { name?: string; message?: string }) => {
        if (err?.name === 'AbortError') return;
        setPageState({ status: 'error', error: 'Could not load invitations.' });
      });

    return () => controller.abort();
  }, [user, retryKey]);

  const handleRevoke = useCallback(async (id: number) => {
    setRevoking(id);
    try {
      await revokeInvitation(id);
      toast({ tone: 'success', title: 'Revoked', message: 'Invite code revoked.' });
      setPageState({ status: 'loading' });
      setRetryKey((k) => k + 1);
    } catch {
      toast({ tone: 'error', title: 'Error', message: 'Failed to revoke invite.' });
    } finally {
      setRevoking(null);
    }
  }, [toast]);

  const handleMinted = useCallback((inv: Invitation, info: MintedInfo) => {
    setShowMintModal(false);
    setMintedInfo(info);
    // Refresh the list to include the new invite (without the code)
    setPageState({ status: 'loading' });
    setRetryKey((k) => k + 1);
    toast({ tone: 'success', title: 'Invite created', message: 'Copy the code now — it won\'t be shown again.' });
    // Silence unused inv param — it's returned from the API and we may use it later
    void inv;
  }, [toast]);

  if (authLoading || (!user?.roles?.includes('admin') && !authLoading)) {
    return null;
  }

  const invitations = pageState.status === 'success' ? pageState.invitations : [];

  return (
    <>
      {showMintModal && (
        <MintModal
          onClose={() => setShowMintModal(false)}
          onMinted={handleMinted}
        />
      )}

      <TavernShell
        active="admin"
        title="Invite codes"
        actions={
          <Button
            variant="ghost"
            onClick={() => setShowMintModal(true)}
            leadingIcon={<span aria-hidden="true">+</span>}
          >
            Mint invite
          </Button>
        }
      >
        {/* One-time reveal after mint */}
        {mintedInfo && (
          <RevealBlock
            {...mintedInfo}
            onDismiss={() => setMintedInfo(null)}
          />
        )}

        <div className={styles.stateContainer}>
          {pageState.status === 'loading' && (
            <PageSkeleton variant="list" lines={5} />
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

          {pageState.status === 'success' && invitations.length === 0 && (
            <div className={`glass ${styles.stateCard}`}>
              <p style={{ color: 'var(--ink-2)' }}>No invite codes yet. Mint the first one.</p>
            </div>
          )}

          {pageState.status === 'success' && invitations.length > 0 && (
            <>
              <div className={styles.tableView}>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <caption className="sr-only">
                      Invite codes — {invitations.length} {invitations.length === 1 ? 'code' : 'codes'}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Prefix</th>
                        <th scope="col">Status</th>
                        <th scope="col">Role</th>
                        <th scope="col">Uses</th>
                        <th scope="col" className={styles.colExpiry}>Expires</th>
                        <th scope="col" className={styles.colNote}>Note</th>
                        <th scope="col">Created</th>
                        <th scope="col" className="sr-only">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invitations.map((inv) => (
                        <InviteRow
                          key={inv.id}
                          inv={inv}
                          onRevoke={handleRevoke}
                          revoking={revoking === inv.id}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={styles.cardView}>
                <ul role="list" className={styles.cardList}>
                  {invitations.map((inv) => (
                    <InviteCard
                      key={inv.id}
                      inv={inv}
                      onRevoke={handleRevoke}
                      revoking={revoking === inv.id}
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

export default function AdminInvitationsPage() {
  return (
    <ToastProvider>
      <InvitationsPageContent />
    </ToastProvider>
  );
}
