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
  variant?: 'expired' | 'rate_limited';
  /** 'rate_limited' only: retry handler wired to the primary CTA. */
  onRetry?: () => void;
  /** Current path, forwarded to /login?next=... so sign-in returns here. */
  pathname?: string | null;
}

export default function SessionExpired({
  variant = 'expired',
  onRetry,
  pathname,
}: SessionExpiredProps) {
  const headingId = useId();
  const bodyId = useId();
  // Union ref: 'expired' renders an <a> (Button href mode), 'rate_limited'
  // renders a <button> (Button click mode) — Button forwards either.
  const ctaRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);

  // This state IS the page now — land keyboard/SR focus on the one action
  // worth taking instead of leaving focus stranded on whatever was focused
  // before the gate replaced the page body.
  useEffect(() => {
    ctaRef.current?.focus();
  }, []);

  const loginHref = `/login${pathname ? `?next=${encodeURIComponent(pathname)}` : ''}`;

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
            >
              Try again
            </Button>
            <Link href="/login" className={styles.secondaryLink}>
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
