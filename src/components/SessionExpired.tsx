'use client';
/**
 * SessionExpired — accessible re-auth prompt (UIR2-TAV-3).
 *
 * Rendered by useAuthGate() in place of a protected page's body once
 * AuthProvider's silent refresh has genuinely failed (AuthContextValue.authError).
 * Replaces three prior failure modes on protected pages — infinite skeleton
 * (character/[id] never resolved a null user), a fabricated "Adventurer"
 * identity (TavernShell's UserMenu falling back on a null user), and a silent
 * bounce to /login with no explanation — with one explicit, focusable prompt
 * that names what happened and offers the next action.
 *
 * Renders as the page's own <main id="main-content"> landmark (the shell that
 * would normally own it — TavernShell — never mounts while this is showing),
 * so the root layout's skip-link still lands somewhere useful.
 */
import { useEffect, useId, useRef } from 'react';
import Link from 'next/link';
import Card from '@/components/Card';
import Button from '@/components/Button';
import SuzuDM from '@/components/SuzuDM';
import styles from './SessionExpired.module.css';

export interface SessionExpiredProps {
  /** Which failure this is — drives copy + primary CTA. Default: 'expired'. */
  variant?: 'expired' | 'rate_limited' | 'offline';
  /** 'rate_limited' / 'offline' only: retry handler wired to the primary CTA. */
  onRetry?: () => void;
  /** Current path, forwarded to /login?next=... so sign-in returns here. */
  pathname?: string | null;
  /**
   * MAJOR-2 (Tora, interaction review): true while a retryAuth() attempt
   * triggered by THIS component's own CTA is in flight. Deliberately does
   * NOT use the native `disabled` attribute — disabling a currently-focused
   * native <button> blurs it in most browsers, which would defeat the whole
   * point (focus must never leave the CTA during a retry). Instead the CTA
   * stays fully focusable and clickable throughout; AuthProvider's own
   * `retryingRef` guard already makes a stray extra click a no-op. Only the
   * label/aria-busy change to reflect the in-flight state.
   */
  busy?: boolean;
}

export default function SessionExpired({
  variant = 'expired',
  onRetry,
  pathname,
  busy = false,
}: SessionExpiredProps) {
  const headingId = useId();
  const bodyId = useId();
  // Union ref: 'expired' renders an <a> (Button href mode), 'rate_limited'
  // renders a <button> (Button click mode) — Button forwards either.
  const ctaRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);

  // This state IS the page now — land keyboard/SR focus on the one action
  // worth taking instead of leaving focus stranded on whatever was focused
  // before the gate replaced the page body.
  //
  // MAJOR-2 follow-on (Tora, interaction review): depends on `variant`, not
  // just mount. Before MAJOR-2's fix, useAuthGate's retryAuth cleared
  // `authError` to null the instant a retry started, which always routed
  // through the (differently-typed) generic skeleton in between two
  // SessionExpired variants — forcing a genuine unmount/remount that
  // incidentally re-ran this effect. Now that `authError` stays set for the
  // WHOLE retry (see AuthProvider's retryAuth), a retry that fails with a
  // DIFFERENT classification (e.g. 'rate_limited' retried, fails as
  // 'expired') re-renders this SAME component instance with a new `variant`
  // — React reconciles by type+position, not props, so it does NOT remount
  // SessionExpired itself just because `variant` changed. Without `variant`
  // in the deps, this effect would only have fired once, ever, and focus
  // would go stale on a now-unmounted CTA (the old variant's button/link is
  // a different element than the new one). Deliberately NOT depending on
  // `busy` — toggling busy re-uses the SAME CTA element, so it must never
  // yank focus around.
  useEffect(() => {
    ctaRef.current?.focus();
  }, [variant]);

  // TAV-AUDIT-401-DEADEND — `reauth=1` is load-bearing on EVERY link out of
  // this component, not decoration. Reaching any variant means the client has
  // confirmed against the auth server that this session will not work; the
  // edge (src/proxy.ts) can only decode the access token's `exp` claim, so a
  // revoked-but-unexpired token reads as "already signed in" there and it
  // bounced these links straight back to the page that just 401'd — this
  // component's own CTA was a no-op loop. The param is how the client tells
  // the edge what only the client can know. Strip it and the loop returns.
  const loginHref = `/login?reauth=1${pathname ? `&next=${encodeURIComponent(pathname)}` : ''}`;
  const plainLoginHref = '/login?reauth=1';

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={styles.wrap}
      aria-labelledby={headingId}
    >
      <Card pop className={styles.card}>
        <SuzuDM size={72} glow={false} aria-hidden />
        {variant === 'rate_limited' ? (
          <>
            <h1 id={headingId} className={styles.title}>
              Hold on a moment
            </h1>
            <p id={bodyId} className={styles.body}>
              Too many attempts in a short window. Wait a few seconds, then try
              again.
            </p>
            <Button
              ref={ctaRef}
              variant="primary"
              size="lg"
              onClick={onRetry}
              aria-describedby={bodyId}
              aria-busy={busy || undefined}
              aria-live="polite"
            >
              {busy ? 'Retrying…' : 'Try again'}
            </Button>
            <Link href={plainLoginHref} className={styles.secondaryLink}>
              Sign in instead
            </Link>
          </>
        ) : variant === 'offline' ? (
          // TAV3-OFFLINE-VARIANT: this failure never confirmed the session
          // is actually invalid (network drop or a 5xx) — retry, not the
          // 'expired' copy's sign-out assertion, which may not be true.
          <>
            <h1 id={headingId} className={styles.title}>
              Suzu can&rsquo;t reach the tavern
            </h1>
            <p id={bodyId} className={styles.body}>
              Check your connection and try again — you may still be signed
              in.
            </p>
            <Button
              ref={ctaRef}
              variant="primary"
              size="lg"
              onClick={onRetry}
              aria-describedby={bodyId}
              aria-busy={busy || undefined}
              aria-live="polite"
            >
              {busy ? 'Retrying…' : 'Try again'}
            </Button>
            <Link href={plainLoginHref} className={styles.secondaryLink}>
              Sign in instead
            </Link>
          </>
        ) : (
          <>
            <h1 id={headingId} className={styles.title}>
              Your session has ended
            </h1>
            <p id={bodyId} className={styles.body}>
              For your security you&rsquo;ve been signed out. Sign in again to
              pick up right where you left off.
            </p>
            <Button
              ref={ctaRef}
              variant="primary"
              size="lg"
              href={loginHref}
              aria-describedby={bodyId}
            >
              Sign in again
            </Button>
          </>
        )}
      </Card>
    </main>
  );
}
