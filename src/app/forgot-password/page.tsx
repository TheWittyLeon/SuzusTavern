'use client';
/**
 * /forgot-password — request a reset link.
 *
 * ── The one rule this page must not break ──────────────────────────────────
 * Upstream ALWAYS answers 200 whether or not the address exists. That is
 * deliberate anti-enumeration: an attacker must not be able to use this form
 * to discover which emails have accounts. So the success state here is
 * UNCONDITIONAL and identically worded either way — it says "if that address
 * has an account", never "we've sent you an email".
 *
 * Do not add a "no account found" branch, and do not vary the wording, the
 * timing, or the presence of the confirmation based on the response. The only
 * thing that may change the outcome shown is a transport failure or a 429.
 *
 * (Upstream also declines to send when `email_verified` is false — another
 * case that must look identical from here.)
 */
import { useState } from 'react';
import Link from 'next/link';
import Button from '@/components/Button';
import { requestPasswordReset } from '@/lib/api/auth';
import type { ApiError } from '@/lib/api/types';
import styles from './ForgotPassword.module.css';

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      // Only transport/rate-limit failures reach here — a NON-existent
      // address still resolves 200 and lands in the branch above.
      if (isApiError(err) && err.status === 429) {
        setError('Too many requests. Wait a little while and try again.');
      } else {
        setError('Could not reach the server. Try again in a moment.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <main id="main-content" className={styles.wrap} tabIndex={-1}>
        <div className={`glass ${styles.card}`}>
          <h1 className={styles.title}>Check your email</h1>
          <p className={styles.sub} role="status">
            If that address has an account, a reset link is on its way. The link
            works once and expires.
          </p>
          <Link className="btn" href="/login">
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className={styles.wrap} tabIndex={-1}>
      <div className={`glass ${styles.card}`}>
        <h1 className={styles.title}>Forgotten passphrase</h1>
        <p className={styles.sub}>
          Give us the email on your account and we&rsquo;ll send a reset link.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.fieldGroup}>
            <label htmlFor="forgot-email" className="label">
              Email
            </label>
            <input
              id="forgot-email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              aria-required="true"
            />
          </div>

          {error && (
            <p className={styles.errorLine} role="alert">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" disabled={submitting || !email.trim()}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>

        <p className={styles.sub} style={{ marginTop: 16, marginBottom: 0 }}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
