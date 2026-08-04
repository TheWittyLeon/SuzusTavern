'use client';
/**
 * ChangePassphrasePanel — change your passphrase while signed in.
 *
 * ── The behaviour that must not surprise anyone ────────────────────────────
 * `POST /auth/password/change` REVOKES EVERY SESSION on success — that is
 * Authentication-Python's documented behaviour, and the auth BFF clears this
 * browser's cookies to match. So a 200 means "you are now signed out
 * everywhere", including here.
 *
 * The panel therefore says so BEFORE the user commits, and sends them to
 * /login afterwards rather than leaving them on a page whose very next request
 * would 401 for no visible reason.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import NewPassphraseFields, {
  passphrasePairValid,
} from '@/components/NewPassphraseFields';
import { changePassword } from '@/lib/api/auth';
import type { ApiError } from '@/lib/api/types';
import styles from './ChangePassphrasePanel.module.css';

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

export default function ChangePassphrasePanel() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [value, setValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const canSubmit =
    current.length > 0 && passphrasePairValid(value, confirm) && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErrors([]);
    try {
      await changePassword(current, value);
      setDone(true);
      setCurrent('');
      setValue('');
      setConfirm('');
      // Sessions are gone — go and sign in again.
      setTimeout(() => router.push('/login'), 2200);
    } catch (err) {
      if (isApiError(err)) {
        const body = err.body as { msg?: string; errors?: string[] } | null | undefined;
        if (err.status === 429) {
          setErrors(['Too many attempts. Wait a while and try again.']);
        } else if (body?.errors?.length) {
          setErrors(body.errors);
        } else if (body?.msg) {
          setErrors([body.msg]);
        } else {
          setErrors(['Could not change your passphrase.']);
        }
      } else {
        setErrors(['Could not reach the server. Try again in a moment.']);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className={styles.wrap}>
        <h2 className={styles.title}>Passphrase changed</h2>
        <p className={styles.sub} role="status">
          Every session was signed out, including this one. Taking you to the
          door&hellip;
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrap} aria-busy={submitting}>
      <h2 className={styles.title}>Change passphrase</h2>
      <p className={styles.sub}>
        Changing it signs you out everywhere, including here.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div className={styles.fieldGroup}>
          <label htmlFor="cp-current" className={`label ${styles.fieldLabel}`}>
            Current passphrase
          </label>
          <input
            id="cp-current"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            disabled={submitting}
            aria-required="true"
          />
        </div>

        <NewPassphraseFields
          idPrefix="cp"
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

        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {submitting ? 'Changing…' : 'Change passphrase'}
        </Button>
      </form>
    </div>
  );
}
