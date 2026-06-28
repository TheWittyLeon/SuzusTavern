'use client';
/**
 * src/app/login/page.tsx
 *
 * Login page — two-pane Card layout per SPRINT4_LOGIN_SPECS.md.
 * State machine per SPRINT4_UI_SPEC.md §1 (7 states) + §2 (2FA TOTP step).
 *
 * Suspense boundary: useSearchParams() requires a Suspense boundary in Next 16
 * when used during prerender. The page default-exports a thin wrapper that
 * renders <Suspense><LoginForm /></Suspense>. LoginForm does all the real work.
 *
 * Open-redirect guard: ?next= must be a same-origin path (starts with '/',
 * does NOT start with '//'). Anything else falls back to /dashboard.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Card from '@/components/Card';
import SuzuDM from '@/components/SuzuDM';
import Waveform from '@/components/Waveform';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import Icon from '@/components/Icon';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { OAUTH_ENABLED } from '@/lib/config';
import { sanitizeNextPath } from '@/lib/auth/redirect';
import type { ApiError } from '@/lib/api/types';
import styles from './Login.module.css';

// ── Form state machine ────────────────────────────────────────────────────────
type FormState =
  | 'idle'
  | 'submitting'
  | 'ok'
  | '2fa'
  | 'error-badcreds'
  | 'error-ratelimited'
  | 'error-network';

// ── LoginForm — the interactive component ────────────────────────────────────
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, verify2FA } = useAuth();
  const { toast } = useToast();
  const reduced = useReducedMotion();

  // Credentials state
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');

  // 2FA state
  const [totpValue, setTotpValue] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);

  // Form FSM state
  const [formState, setFormState] = useState<FormState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Rate-limit countdown
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs for focus management
  const passwordRef = useRef<HTMLInputElement>(null);
  const totpRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const submitting = formState === 'submitting';
  const ratelimited = formState === 'error-ratelimited';
  const nextOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const nextPath = sanitizeNextPath(searchParams.get('next'), nextOrigin);

  // ── Focus management: 2FA entry ───────────────────────────────────────────
  useEffect(() => {
    if (formState === '2fa') {
      totpRef.current?.focus();
    }
  }, [formState]);

  // ── Auto-submit on 6-digit TOTP ──────────────────────────────────────────
  useEffect(() => {
    if (totpValue.length === 6 && !verifying && formState === '2fa') {
      void handleVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totpValue]);

  // ── Cleanup countdown on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (countdownRef.current !== null) clearInterval(countdownRef.current);
    };
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function startCountdown(seconds: number) {
    setCountdown(seconds);
    if (countdownRef.current !== null) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current !== null) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          setFormState('idle');
          setErrorMsg(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function formatCountdown(s: number): string {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}m ${rem}s`;
  }

  // ── Form submit (credentials) ─────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting || ratelimited) return;

      setFormState('submitting');
      setErrorMsg(null);

      try {
        const result = await login(handle, password);
        if (result === 'ok') {
          setFormState('ok');
          router.replace(nextPath);
        } else {
          // '2fa'
          setFormState('2fa');
          setTotpValue('');
          setTotpError(null);
        }
      } catch (err: unknown) {
        const apiErr = err as ApiError;
        if (apiErr?.status === 401) {
          setFormState('error-badcreds');
          setErrorMsg('Wrong handle or passphrase. Try again.');
          setPassword('');
          // Focus password after state update
          setTimeout(() => passwordRef.current?.focus(), 0);
        } else if (apiErr?.status === 429) {
          const retryAfter =
            (() => {
              try {
                const body = apiErr.body as Record<string, unknown> | undefined;
                const ra = body?.retry_after ?? body?.retryAfter;
                if (Number.isFinite(ra) && (ra as number) >= 0) return ra as number;
              } catch { /* ignore */ }
              return 60;
            })();
          setFormState('error-ratelimited');
          setErrorMsg(`Too many attempts. Try again in`);
          startCountdown(retryAfter);
          toast({
            tone: 'warn',
            title: 'Rate limited',
            message: `Too many attempts. Wait ${formatCountdown(retryAfter)}.`,
            duration: retryAfter * 1000,
          });
        } else {
          setFormState('error-network');
          setErrorMsg("Can't reach the tavern right now. Check your connection and try again.");
        }
      }
    },
    [handle, password, login, router, nextPath, submitting, ratelimited, toast],
  );

  // ── 2FA verify ───────────────────────────────────────────────────────────
  const handleVerify = useCallback(async () => {
    if (verifying || totpValue.length < 6) return;
    setVerifying(true);
    setTotpError(null);

    try {
      await verify2FA(totpValue);
      router.replace(nextPath);
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      setVerifying(false);
      setTotpValue('');
      if (apiErr?.status === 0) {
        setTotpError("Couldn't verify — check your connection.");
      } else {
        setTotpError("That code didn't work. Check your app and try again.");
      }
      setTimeout(() => totpRef.current?.focus(), 0);
    }
  }, [totpValue, verifying, verify2FA, router, nextPath]);

  const handleVerifySubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      await handleVerify();
    },
    [handleVerify],
  );

  const handleBackToCredentials = useCallback(() => {
    setFormState('idle');
    setTotpError(null);
    setTotpValue('');
    setTimeout(() => passwordRef.current?.focus(), 0);
  }, []);

  // ── Right pane — 2FA step ─────────────────────────────────────────────────
  const renderTwoFAStep = () => (
    <form onSubmit={handleVerifySubmit} className={styles.rightPane} noValidate>
      {/* Back affordance */}
      <Button
        variant="ghost"
        type="button"
        style={{ alignSelf: 'flex-start', minHeight: 44, padding: '0 12px', fontSize: 12 }}
        onClick={handleBackToCredentials}
        disabled={verifying}
      >
        ← Back to sign in
      </Button>

      {/* Heading — single h1 for the page (2FA replaces the credentials h1) */}
      <div>
        <h1 className={styles.formHeading}>One more step.</h1>
        <p className={styles.formSub}>
          Enter the 6-digit code from your authenticator app.
        </p>
      </div>

      {/* TOTP input */}
      <div className={styles.fieldGroup}>
        <label htmlFor="totp-code" className={`label ${styles.fieldLabel}`}>
          Authenticator code
        </label>
        <input
          id="totp-code"
          ref={totpRef}
          className="input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="000000"
          aria-label="6-digit authenticator code"
          aria-describedby="totp-hint"
          value={totpValue}
          onChange={(e) =>
            setTotpValue(e.target.value.replace(/\D/g, '').slice(0, 6))
          }
          disabled={verifying}
          style={{ letterSpacing: '0.3em', fontSize: 22, textAlign: 'center' }}
        />
        <span
          id="totp-hint"
          className="label"
          style={{ marginTop: 6, display: 'block', color: 'var(--ink-3)' }}
        >
          6 digits — no spaces or dashes
        </span>
      </div>

      {/* Inline 2FA error */}
      {totpError && (
        <div ref={errorRef} role="alert" className={styles.formError}>
          <Icon name="Close" size={14} aria-hidden />
          {totpError}
        </div>
      )}

      {/* Verify button */}
      <button
        type="submit"
        className="btn btn-primary btn-lg"
        style={{ marginTop: 4, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        disabled={verifying || totpValue.length < 6}
        aria-label={verifying ? 'Verifying code…' : 'Verify code'}
      >
        {verifying && !reduced && (
          <span className={styles.spinner} aria-hidden="true" />
        )}
        {verifying ? (reduced ? 'Checking…' : 'Verifying…') : 'Verify'}
      </button>
    </form>
  );

  // ── Right pane — credentials step ─────────────────────────────────────────
  const renderCredentialsStep = () => (
    <form onSubmit={handleSubmit} className={styles.rightPane} noValidate>
      {/* Back to landing */}
      <Button
        variant="ghost"
        href="/"
        style={{ alignSelf: 'flex-start', minHeight: 44, padding: '0 12px', fontSize: 12 }}
        aria-label="Back to home page"
        disabled={submitting}
      >
        ← Back
      </Button>

      {/* Heading — single h1 for the page */}
      <div>
        <h1 className={styles.formHeading}>Welcome back.</h1>
        <p className={styles.formSub}>Sign in to your tavern account.</p>
      </div>

      {/* Handle field */}
      <div className={styles.fieldGroup}>
        <label htmlFor="tavern-handle" className={`label ${styles.fieldLabel}`}>
          Tavern handle
        </label>
        <input
          id="tavern-handle"
          className="input"
          type="text"
          autoComplete="username"
          required
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          disabled={submitting}
          aria-invalid={formState === 'error-badcreds' || undefined}
          aria-describedby={formState === 'error-badcreds' ? 'creds-error' : undefined}
        />
      </div>

      {/* Passphrase field */}
      <div className={styles.fieldGroup}>
        <label htmlFor="passphrase" className={`label ${styles.fieldLabel}`}>
          Passphrase
        </label>
        <input
          id="passphrase"
          ref={passwordRef}
          className="input"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          aria-invalid={formState === 'error-badcreds' || undefined}
          aria-describedby={formState === 'error-badcreds' ? 'creds-error' : undefined}
        />
      </div>

      {/* Inline error — bad creds / network: assertive one-shot alert */}
      {(formState === 'error-badcreds' || formState === 'error-network') && (
        <div ref={errorRef} id="creds-error" role="alert" className={styles.formError}>
          <Icon name="Close" size={14} aria-hidden />
          {errorMsg}
        </div>
      )}

      {/* Rate-limited: the alert announces once (assertive); the countdown ticks
          in a SEPARATE polite region so it doesn't re-interrupt every second. */}
      {formState === 'error-ratelimited' && (
        <>
          <div ref={errorRef} role="alert" className={styles.formError}>
            <Icon name="Close" size={14} aria-hidden />
            Too many attempts.
          </div>
          <p className={styles.formCountdown} aria-live="polite" aria-atomic="true">
            Try again in {formatCountdown(countdown)}.
          </p>
        </>
      )}

      {/* Keep me signed in + recovery stub */}
      <div className={styles.rememberRow}>
        {/* cosmetic — no-op for MVP; server session length is controlled by BFF cookie maxAge */}
        <label className={styles.checkboxLabel}>
          <input type="checkbox" defaultChecked />
          Keep me signed in
        </label>
        {/* Recovery is deferred (ST-032) — muted non-interactive text. aria-label
            is inert on a plain span, so the "coming soon" state is conveyed via a
            visually-hidden suffix that screen readers do announce. */}
        <span className={`label ${styles.recoveryStub}`}>
          Recovery key
          <span className={styles.srOnly}> (coming soon)</span>
        </span>
      </div>

      {/* Submit button */}
      <button
        type="submit"
        className={`btn btn-primary btn-lg ${styles.submitBtn}`}
        disabled={submitting || ratelimited}
        aria-label={submitting ? 'Signing in…' : ratelimited ? `Wait ${formatCountdown(countdown)}…` : 'Sign in'}
      >
        {submitting && !reduced && (
          <span className={styles.spinner} aria-hidden="true" />
        )}
        {submitting
          ? (reduced ? 'Checking…' : 'Booting…')
          : ratelimited
          ? `Wait ${formatCountdown(countdown)}…`
          : (
            <>
              <Icon name="Power" size={16} aria-hidden />
              Open the door
            </>
          )}
      </button>

      {/* "or" divider */}
      <div className={styles.orDivider} aria-hidden="true">
        <span className={styles.orLine} />
        <span className={styles.orLabel}>or</span>
        <span className={styles.orLine} />
      </div>

      {/* OAuth "soon" affordance — gated on OAUTH_ENABLED constant */}
      {!OAUTH_ENABLED && (
        <div className={styles.oauthSoonRow}>
          <Pill tone="muted" aria-label="OAuth login coming soon">soon</Pill>
          <span className="label" style={{ color: 'var(--ink-3)', fontSize: 11 }}>
            Social sign-in is not available yet
          </span>
        </div>
      )}

      {/* OAuth buttons */}
      <div className={styles.oauthBtns}>
        <Button
          variant="ghost"
          className={styles.oauthBtn}
          disabled={!OAUTH_ENABLED}
          aria-disabled={!OAUTH_ENABLED ? 'true' : undefined}
          aria-describedby={!OAUTH_ENABLED ? 'oauth-soon-notice' : undefined}
          leadingIcon={<Icon name="Twitch" size={14} aria-hidden />}
        >
          Twitch
        </Button>
        <Button
          variant="ghost"
          className={styles.oauthBtn}
          disabled={!OAUTH_ENABLED}
          aria-disabled={!OAUTH_ENABLED ? 'true' : undefined}
          aria-describedby={!OAUTH_ENABLED ? 'oauth-soon-notice' : undefined}
          leadingIcon={<Icon name="Discord" size={14} aria-hidden />}
        >
          Discord
        </Button>
      </div>

      {/* Screen-reader-only description for OAuth disabled state */}
      {!OAUTH_ENABLED && (
        <span id="oauth-soon-notice" className={styles.srOnly}>
          Social sign-in via Twitch and Discord is not yet available.
        </span>
      )}

      {/* Footer */}
      <p className={`mono ${styles.footer}`}>
        session.encrypted · ed25519
      </p>

      {/* Sign-up link — shown when mode != closed (B3). Plain text; mode is
          not pre-fetched here to keep the login page dead-simple. The link is
          always present and /signup handles the closed-mode message itself. */}
      <p className={styles.footer} style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-3)' }}>
        Don&apos;t have an account?{' '}
        <a
          href="/signup"
          style={{
            color: 'var(--accent)',
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          Sign up
        </a>
      </p>
    </form>
  );

  return (
    <main id="main-content" className={`aurora ${styles.wrapper}`} tabIndex={-1}>
      <Card
        pop
        padding={false}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          maxWidth: 980,
          width: '100%',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}
        className={styles.twoPane}
      >
        {/* ── Left pane — decorative ─────────────────────────────────────── */}
        <div className={styles.leftPane} aria-hidden="true">
          {/* Brand lockup */}
          <div className={styles.brandLockup}>
            <SuzuDM size={40} glow={false} />
            <div>
              <div className={styles.brandTitle}>Aurora Tavern</div>
              <div className="label" style={{ fontSize: 9, marginTop: 2 }}>
                A NekoNova table
              </div>
            </div>
          </div>

          {/* Hero mascot */}
          <div className={styles.mascotLarge}>
            <SuzuDM size={220} />
          </div>

          {/* Tagline */}
          <h2 className={styles.tagline}>
            Hi. I was{' '}
            <em className={styles.taglineAccent}>almost expecting you.</em>
          </h2>
          <p className={styles.taglineBody}>
            Sign in to find your table. Suzu has the kettle on and the goblin
            union has questions.
          </p>

          {/* Standby strip */}
          <div className={styles.waveformStrip}>
            <Waveform bars={24} height={18} active={false} />
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              standby
            </span>
          </div>
        </div>

        {/* ── Right pane — form ──────────────────────────────────────────── */}
        {/* Inline brand (visible at ≤640px only, left pane hidden) */}
        <div style={{ display: 'contents' }}>
          {formState === '2fa' ? renderTwoFAStep() : renderCredentialsStep()}
        </div>
      </Card>
    </main>
  );
}

// ── Default export — Suspense wrapper for useSearchParams ─────────────────────
/**
 * Next 16 requires a Suspense boundary around useSearchParams() consumers
 * to enable streaming / static prerender without bailing to a full client render.
 * The outer page shell is a server component (no 'use client' at module level
 * of the default export); the actual client work is in LoginForm above.
 *
 * We mark the whole file 'use client' (top of file) because the default export
 * references Suspense from React (a client-only API in this context) and
 * LoginForm is a client component. Next 16 allows this pattern: a 'use client'
 * file that exports both a Suspense wrapper and the inner component.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main id="main-content" className={`aurora ${styles.wrapper}`} tabIndex={-1}>
          <div
            role="status"
            aria-live="polite"
            aria-busy="true"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}
          >
            <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              Loading…
            </span>
          </div>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
