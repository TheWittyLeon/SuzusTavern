'use client';
/**
 * NewPassphraseFields — the "choose a new passphrase" half of every password
 * surface (reset-from-email, and change-while-signed-in).
 *
 * Shared deliberately: all three flows enforce the SAME server policy, and the
 * one thing worse than no policy hint is two hints that disagree with each
 * other or with the validator. The rules are FETCHED from
 * `GET /api/auth/password-policy` rather than hardcoded, so this cannot drift
 * from `Authentication-Python`'s `validate_password` — which is the only thing
 * that actually decides.
 *
 * The checklist is presented as guidance, not gatekeeping: the submit button is
 * enabled as soon as the two fields are non-empty and match. The server is the
 * authority, and a client-side rule that is subtly stricter than the server's
 * would lock a user out of a passphrase the server would have accepted.
 */
import { useEffect, useState } from 'react';
import { passwordPolicy, type PasswordPolicy } from '@/lib/api/auth';
import styles from './NewPassphraseFields.module.css';

export interface NewPassphraseFieldsProps {
  value: string;
  onValueChange: (v: string) => void;
  confirm: string;
  onConfirmChange: (v: string) => void;
  disabled?: boolean;
  /** Distinguishes the input ids when more than one form is on a page. */
  idPrefix?: string;
}

interface Rule {
  label: string;
  ok: boolean;
}

function rulesFor(policy: PasswordPolicy | null, value: string): Rule[] {
  if (!policy) return [];
  const out: Rule[] = [
    {
      label: `At least ${policy.min_length} characters`,
      ok: value.length >= policy.min_length,
    },
  ];
  if (policy.require_uppercase) {
    out.push({ label: 'An uppercase letter', ok: /[A-Z]/.test(value) });
  }
  if (policy.require_lowercase) {
    out.push({ label: 'A lowercase letter', ok: /[a-z]/.test(value) });
  }
  if (policy.require_digit) {
    out.push({ label: 'A number', ok: /\d/.test(value) });
  }
  if (policy.require_special) {
    // Deliberately broad: "not a letter, digit or space". The server's own
    // special-character set is not exposed by the policy endpoint, so a
    // narrower guess here would show a red cross for a passphrase the server
    // accepts — the exact drift this component exists to avoid.
    out.push({ label: 'A symbol', ok: /[^A-Za-z0-9\s]/.test(value) });
  }
  return out;
}

export default function NewPassphraseFields({
  value,
  onValueChange,
  confirm,
  onConfirmChange,
  disabled = false,
  idPrefix = 'np',
}: NewPassphraseFieldsProps) {
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
     
    void (async () => {
      try {
        const p = await passwordPolicy(ctrl.signal);
        if (!ctrl.signal.aborted) setPolicy(p);
      } catch {
        // The hint is an affordance, not a gate — if the policy can't be
        // fetched the form still works and the server still enforces.
      }
    })();
    return () => ctrl.abort();
  }, []);

  const rules = rulesFor(policy, value);
  const mismatch = confirm.length > 0 && confirm !== value;

  return (
    <>
      <div className={styles.fieldGroup}>
        <label htmlFor={`${idPrefix}-new`} className={`label ${styles.fieldLabel}`}>
          New passphrase
        </label>
        <input
          id={`${idPrefix}-new`}
          className="input"
          type="password"
          autoComplete="new-password"
          required
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          disabled={disabled}
          aria-required="true"
          aria-describedby={rules.length ? `${idPrefix}-rules` : undefined}
        />
      </div>

      {rules.length > 0 && (
        <ul id={`${idPrefix}-rules`} className={styles.rules}>
          {rules.map((r) => (
            <li
              key={r.label}
              className={r.ok ? styles.ruleOk : styles.rule}
              // The tick is decorative; the state is carried in the text so it
              // survives colour-blindness and a screen reader alike.
              aria-label={`${r.label} — ${r.ok ? 'met' : 'not yet met'}`}
            >
              <span aria-hidden="true">{r.ok ? '✓' : '·'}</span> {r.label}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.fieldGroup}>
        <label htmlFor={`${idPrefix}-confirm`} className={`label ${styles.fieldLabel}`}>
          Confirm new passphrase
        </label>
        <input
          id={`${idPrefix}-confirm`}
          className="input"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => onConfirmChange(e.target.value)}
          disabled={disabled}
          aria-required="true"
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? `${idPrefix}-mismatch` : undefined}
        />
        {mismatch && (
          <p id={`${idPrefix}-mismatch`} className={styles.mismatch} role="alert">
            The two passphrases don&rsquo;t match.
          </p>
        )}
      </div>
    </>
  );
}

/** Shared submit gate: non-empty and matching. Everything else is the
 *  server's call — see the component docstring. */
export function passphrasePairValid(value: string, confirm: string): boolean {
  return value.length > 0 && value === confirm;
}
