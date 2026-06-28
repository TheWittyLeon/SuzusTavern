'use client';
/**
 * /signup — Self-registration page.
 *
 * On mount, fetches the current registration mode from the auth BFF and
 * renders accordingly:
 *
 *   closed   → "Sign-ups are currently closed" message, no form.
 *   open     → username + password + optional email.
 *   invite   → same + invite code field (pre-filled from ?invite= query param).
 *   approval → username + password + required email. On 202 shows pending state.
 *
 * On 201 (created, active account): shows a success state with a link to /login.
 * On 202 (pending approval): shows a "your request is pending" state.
 * Error surfaces: 400/403/409/429 all get specific user-facing messages.
 *
 * Accessible: labelled inputs, focus management, role="alert" error regions,
 * no Secure cookie assumptions (homelab is plain HTTP).
 *
 * B3 — signup UI.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Card from '@/components/Card';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import { useReducedMotion } from '@/lib/useReducedMotion';
import {
  getRegistrationMode,
  submitRegister,
  type RegistrationMode,
} from '@/lib/api/signup';
import type { ApiError } from '@/lib/api/types';
import styles from './Signup.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type PageState =
  | { status: 'loading-mode' }
  | { status: 'closed'; message: string }
  | { status: 'form'; mode: RegistrationMode }
  | { status: 'submitting'; mode: RegistrationMode }
  | { status: 'success'; username: string }
  | { status: 'pending'; username: string }
  | { status: 'error-mode' }; // failed to load registration mode

type FormError =
  | null
  | { kind: 'validation'; message: string }
  | { kind: 'bad-invite'; message: string }
  | { kind: 'taken'; message: string }
  | { kind: 'rate-limited'; message: string }
  | { kind: 'network'; message: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractErrorMessage(err: ApiError, requiresInvite: boolean): FormError {
  const msg =
    (typeof (err.body as Record<string, unknown> | undefined)?.['msg'] === 'string'
      ? (err.body as Record<string, unknown>)['msg'] as string
      : null) ??
    err.message;

  if (err.status === 429) {
    return { kind: 'rate-limited', message: 'Too many sign-up attempts. Try again later.' };
  }
  if (err.status === 409) {
    return { kind: 'taken', message: 'That username or email is already taken.' };
  }
  if (err.status === 403) {
    if (requiresInvite) {
      const lower = (msg ?? '').toLowerCase();
      if (lower.includes('revoked')) return { kind: 'bad-invite', message: 'That invite code has been revoked.' };
      if (lower.includes('expired')) return { kind: 'bad-invite', message: 'That invite code has expired.' };
      if (lower.includes('used') || lower.includes('exhausted')) return { kind: 'bad-invite', message: 'That invite code has already been used.' };
      return { kind: 'bad-invite', message: 'Invalid or unknown invite code.' };
    }
    return { kind: 'validation', message: msg ?? 'Registration is not allowed right now.' };
  }
  if (err.status === 400) {
    return { kind: 'validation', message: msg ?? 'Please check your details and try again.' };
  }
  if (err.status === 0) {
    return { kind: 'network', message: "Can't reach the server right now. Check your connection and try again." };
  }
  return { kind: 'network', message: msg ?? 'Something went wrong. Please try again.' };
}

// ── SignupForm — the interactive component ────────────────────────────────────

function SignupForm() {
  const searchParams = useSearchParams();
  const reduced = useReducedMotion();

  // Prefill invite code from ?invite= query param
  const inviteParam = searchParams.get('invite') ?? '';

  const [pageState, setPageState] = useState<PageState>({ status: 'loading-mode' });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState(inviteParam);
  const [formError, setFormError] = useState<FormError>(null);

  // Refs for focus management
  const usernameRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // ── Load registration mode on mount ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    getRegistrationMode(controller.signal)
      .then((mode) => {
        if (cancelled) return;
        if (!mode.signup_enabled || mode.mode === 'closed') {
          setPageState({ status: 'closed', message: mode.message });
        } else {
          setPageState({ status: 'form', mode });
        }
      })
      .catch(() => {
        if (!cancelled) setPageState({ status: 'error-mode' });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  // Focus username on form ready
  useEffect(() => {
    if (pageState.status === 'form') {
      usernameRef.current?.focus();
    }
  }, [pageState.status]);

  // Scroll error into view
  useEffect(() => {
    if (formError) {
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [formError]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (pageState.status !== 'form') return;

      const { mode } = pageState;

      // Client-side required field guard
      if (!username.trim()) {
        setFormError({ kind: 'validation', message: 'Username is required.' });
        usernameRef.current?.focus();
        return;
      }
      if (!password) {
        setFormError({ kind: 'validation', message: 'Password is required.' });
        return;
      }
      if (mode.mode === 'approval' && !email.trim()) {
        setFormError({ kind: 'validation', message: 'Email is required so an admin can identify you.' });
        return;
      }
      if (mode.requires_invite_code && !inviteCode.trim()) {
        setFormError({ kind: 'bad-invite', message: 'An invite code is required.' });
        return;
      }

      setFormError(null);
      setPageState({ status: 'submitting', mode });

      try {
        await submitRegister({
          username: username.trim(),
          password,
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(mode.requires_invite_code ? { invite_code: inviteCode.trim() } : {}),
        });
        // Both 201 (created+active) and 202 (pending approval) resolve here —
        // apiFetch only rejects on non-2xx. Dispatch on the mode we fetched:
        // approval → the account is created inactive and needs admin approval
        // before login; everything else → active, can log in now.
        if (mode.mode === 'approval') {
          setPageState({ status: 'pending', username: username.trim() });
        } else {
          setPageState({ status: 'success', username: username.trim() });
        }
      } catch (err: unknown) {
        const apiErr = err as ApiError;
        const fe = extractErrorMessage(apiErr, mode.requires_invite_code);
        setFormError(fe);
        setPageState({ status: 'form', mode });
      }
    },
    [pageState, username, password, email, inviteCode],
  );

  // ── Render states ─────────────────────────────────────────────────────────

  if (pageState.status === 'loading-mode') {
    return (
      <main id="main-content" className={`aurora ${styles.wrapper}`} tabIndex={-1}>
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}
        >
          <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading…</span>
        </div>
      </main>
    );
  }

  if (pageState.status === 'error-mode') {
    return (
      <main id="main-content" className={`aurora ${styles.wrapper}`} tabIndex={-1}>
        <Card pop className={styles.closedCard}>
          <p style={{ color: 'var(--bad-ink)', fontSize: 14 }}>
            Could not load sign-up availability. The auth service may be down.
          </p>
          <Button variant="ghost" href="/login">Go to sign in</Button>
        </Card>
      </main>
    );
  }

  if (pageState.status === 'closed') {
    return (
      <main id="main-content" className={`aurora ${styles.wrapper}`} tabIndex={-1}>
        <Card pop>
          <div className={styles.closedCard}>
            <div className={styles.stateIcon} aria-hidden="true">🔒</div>
            <h1 className={styles.stateHeading}>Sign-ups are currently closed.</h1>
            <p className={styles.stateBody}>{pageState.message}</p>
            <Button variant="ghost" href="/login">Sign in instead</Button>
          </div>
        </Card>
      </main>
    );
  }

  if (pageState.status === 'success') {
    return (
      <main id="main-content" className={`aurora ${styles.wrapper}`} tabIndex={-1}>
        <Card pop>
          <div className={styles.stateCard}>
            <div className={styles.stateIcon} aria-hidden="true">
              <Icon name="Check" size={36} />
            </div>
            <h1 className={styles.stateHeading}>You&apos;re in.</h1>
            <p className={styles.stateBody}>
              Account created for <strong>{pageState.username}</strong>. You can sign in now.
            </p>
            <Button variant="ghost" href="/login">Sign in</Button>
          </div>
        </Card>
      </main>
    );
  }

  if (pageState.status === 'pending') {
    return (
      <main id="main-content" className={`aurora ${styles.wrapper}`} tabIndex={-1}>
        <Card pop>
          <div className={styles.stateCard}>
            <div className={styles.stateIcon} aria-hidden="true">
              <Icon name="History" size={36} />
            </div>
            <h1 className={styles.stateHeading}>Request submitted.</h1>
            <p className={styles.stateBody}>
              Your request for <strong>{pageState.username}</strong> is pending review.
              You&apos;ll be able to sign in once an admin approves it.
            </p>
            <Button variant="ghost" href="/">Back to home</Button>
          </div>
        </Card>
      </main>
    );
  }

  // ── Form states (form | submitting) ──────────────────────────────────────

  const mode = pageState.mode;
  const submitting = pageState.status === 'submitting';
  const isApproval = mode.mode === 'approval';
  const needsInvite = mode.requires_invite_code;

  let headingText = 'Create your account.';
  let subText = 'Fill in the details below to get started.';
  if (isApproval) {
    headingText = 'Request access.';
    subText = 'An admin will review your request before you can sign in.';
  } else if (needsInvite) {
    headingText = 'Join with an invite.';
    subText = inviteCode
      ? 'Your invite code is pre-filled. Just add your handle and passphrase.'
      : 'Enter your invite code plus a handle and passphrase.';
  }

  return (
    <main id="main-content" className={`aurora ${styles.wrapper}`} tabIndex={-1}>
      <Card pop className={styles.card}>
        <Button
          variant="ghost"
          href="/login"
          className={styles.backLink}
          aria-label="Back to sign in"
          disabled={submitting}
        >
          ← Back to sign in
        </Button>

        <div className={styles.headingBlock}>
          <h1 className={styles.heading}>{headingText}</h1>
          <p className={styles.subheading}>{subText}</p>
        </div>

        {/* Error banner */}
        {formError && (
          <div
            ref={errorRef}
            id="signup-error"
            role="alert"
            className={styles.errorBanner}
          >
            <Icon name="Close" size={14} aria-hidden className={styles.errorIcon} />
            <span>{formError.message}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Invite code — shown first so pre-filled value is visible */}
          {needsInvite && (
            <div className={styles.fieldGroup}>
              <label
                htmlFor="invite-code"
                className={`label ${styles.fieldLabel}`}
              >
                Invite code
              </label>
              <input
                id="invite-code"
                className="input"
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="abc…xyz"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                disabled={submitting}
                aria-required="true"
                aria-invalid={formError?.kind === 'bad-invite' || undefined}
                aria-describedby={formError?.kind === 'bad-invite' ? 'signup-error' : undefined}
              />
              {inviteParam && (
                <span className={styles.fieldHint}>Pre-filled from your invite link.</span>
              )}
            </div>
          )}

          {/* Username */}
          <div className={styles.fieldGroup}>
            <label htmlFor="signup-username" className={`label ${styles.fieldLabel}`}>
              Tavern handle
            </label>
            <input
              id="signup-username"
              ref={usernameRef}
              className="input"
              type="text"
              autoComplete="username"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="3–80 characters"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
              aria-required="true"
              aria-invalid={
                formError?.kind === 'validation' || formError?.kind === 'taken' || undefined
              }
              aria-describedby={
                formError?.kind === 'validation' || formError?.kind === 'taken'
                  ? 'signup-error'
                  : undefined
              }
            />
          </div>

          {/* Password */}
          <div className={styles.fieldGroup}>
            <label htmlFor="signup-password" className={`label ${styles.fieldLabel}`}>
              Passphrase
            </label>
            <input
              id="signup-password"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              aria-required="true"
            />
          </div>

          {/* Email — required for approval mode, optional for open/invite */}
          <div className={styles.fieldGroup}>
              <label htmlFor="signup-email" className={`label ${styles.fieldLabel}`}>
                Email{!isApproval ? ' (optional)' : ''}
              </label>
              <input
                id="signup-email"
                className="input"
                type="email"
                autoComplete="email"
                placeholder={isApproval ? 'required for admin review' : 'optional'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                aria-required={isApproval ? 'true' : 'false'}
              />
              {isApproval && (
                <span className={styles.fieldHint}>
                  Lets the admin identify you during review.
                </span>
              )}
            </div>

          {/* Submit */}
          <button
            type="submit"
            className={`btn btn-primary btn-lg ${styles.submitBtn}`}
            disabled={submitting}
            aria-label={submitting ? 'Submitting…' : isApproval ? 'Request access' : 'Create account'}
          >
            {submitting && !reduced && (
              <span className={styles.spinner} aria-hidden="true" />
            )}
            {submitting
              ? (reduced ? 'Submitting…' : 'Working…')
              : isApproval
              ? 'Request access'
              : 'Create account'}
          </button>
        </form>

        <div className={styles.divider} aria-hidden="true" />
        <p className={styles.footer}>
          Already have an account?{' '}
          <a href="/login" className={styles.footerLink}>Sign in</a>
        </p>
      </Card>
    </main>
  );
}

// ── Default export — Suspense wrapper for useSearchParams ─────────────────────

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <main id="main-content" className="aurora" tabIndex={-1}
          style={{ minHeight: '100svh', display: 'grid', placeItems: 'center' }}>
          <div
            role="status"
            aria-live="polite"
            aria-busy="true"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading…</span>
          </div>
        </main>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
