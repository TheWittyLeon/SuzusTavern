'use client';
/**
 * /reset-password — the landing page for the emailed reset link.
 *
 * This page is the missing half of a flow that was otherwise complete:
 * `Authentication-Python` has generated reset tokens and emailed
 * `{base_url}/reset-password?token=…` for a long time, but the Tavern had no
 * such route, so every reset link a user clicked landed on a 404. The four
 * upstream endpoints existed; nothing could reach them.
 *
 * Deliberately reachable WITHOUT a session — the whole point is that the user
 * cannot sign in. The token from the query string is the only credential, and
 * it is verified server-side; this page never inspects or trusts it.
 */
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Button from '@/components/Button';
import NewPassphraseFields, {
  passphrasePairValid,
} from '@/components/NewPassphraseFields';
import { resetPassword } from '@/lib/api/auth';
import type { ApiError } from '@/lib/api/types';
import styles from './ResetPassword.module.css';

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [token] = useState(() => params.get('token') ?? '');

  // Strip `?token=` from the visible URL as soon as it is captured (Kuro-Sec
  // finding 3). Without this the token rides in the `Referer` of the
  // policy fetch this page triggers on mount — landing it in the edge access
  // log — and stays in browser history. `replaceState` leaves no new entry.
  // The value is already held in state above, so the form is unaffected.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('token=')) {
      return;
    }
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const [value, setValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !passphrasePairValid(value, confirm)) return;
    setSubmitting(true);
    setErrors([]);
    try {
      await resetPassword(token, value);
      setDone(true);
      // Straight to sign-in: the old sessions are gone and the new passphrase
      // is the only way back in.
      setTimeout(() => router.push('/login'), 2200);
    } catch (err) {
      if (isApiError(err)) {
        const body = err.body as { msg?: string; errors?: string[] } | null | undefined;
        // `errors` carries the server's field-level complexity failures and is
        // already relayed by the BFF's key allow-list — surface them verbatim
        // rather than replacing them with a guess at what went wrong.
        if (body?.errors?.length) setErrors(body.errors);
        else if (body?.msg) setErrors([body.msg]);
        else setErrors(['Could not reset your passphrase. Try the link again.']);
      } else {
        setErrors(['Could not reach the server. Try again in a moment.']);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className={`glass ${styles.card}`}>
        <h1 className={styles.title}>Reset link incomplete</h1>
        <p className={styles.sub}>
          This page needs the link from your reset email. Open that link
          directly, or <Link href="/forgot-password">request a new one</Link>.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className={`glass ${styles.card}`}>
        <h1 className={styles.title}>Passphrase changed</h1>
        <p className={styles.sub} role="status">
          You can sign in with your new passphrase now. Taking you to the door&hellip;
        </p>
        <Link className="btn" href="/login">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className={`glass ${styles.card}`}>
      <h1 className={styles.title}>Choose a new passphrase</h1>
      <p className={styles.sub}>
        This link works once. Pick something you&rsquo;ll remember.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <NewPassphraseFields
          idPrefix="reset"
          value={value}
          onValueChange={setValue}
          confirm={confirm}
          onConfirmChange={setConfirm}
          disabled={submitting}
        />

        {errors.length > 0 && (
          <ul className={styles.errors} role="alert">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}

        <Button
          type="submit"
          variant="primary"
          disabled={submitting || !passphrasePairValid(value, confirm)}
        >
          {submitting ? 'Setting…' : 'Set new passphrase'}
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  // `useSearchParams` requires a Suspense boundary in the App Router.
  return (
    <main id="main-content" className={styles.wrap} tabIndex={-1}>
      <Suspense fallback={<div className={`glass ${styles.card}`}>Loading…</div>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
