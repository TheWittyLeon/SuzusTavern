'use client';
/**
 * src/app/dashboard/page.tsx
 *
 * Dashboard stub — Sprint 4 authed seam.
 *
 * Behaviour per SPRINT4_UI_SPEC.md §4:
 * - While loading + maybeAuthed (silent refresh in flight): render PageSkeleton.
 *   This prevents the logged-out flash for returning users (M2 fix).
 * - When resolved + user: authed top-bar + Sign out button + placeholder card.
 * - When resolved + no user: redirect to /login (shouldn't normally happen since
 *   proxy.ts guards protected routes, but we handle it gracefully).
 *
 * Full dashboard shell (nav, lobby, character list) lands in Sprint 5.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthProvider';
import { Skeleton } from '@/components/PageSkeleton';
import PageSkeleton from '@/components/PageSkeleton';
import SuzuDM from '@/components/SuzuDM';
import Button from '@/components/Button';
import Card from '@/components/Card';

// ── Logout button ─────────────────────────────────────────────────────────────
function LogoutButton({ onLogout }: { onLogout: () => Promise<void> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const handleLogout = async () => {
    setPending(true);
    await onLogout(); // clears user state immediately, then best-effort BFF call
    router.replace('/login');
  };

  return (
    <Button
      variant="ghost"
      onClick={() => void handleLogout()}
      disabled={pending}
      aria-label={pending ? 'Signing out…' : 'Sign out'}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}

// ── Dashboard skeleton ────────────────────────────────────────────────────────
function DashboardSkeleton() {
  return (
    <>
      {/* Top-bar skeleton */}
      <header
        style={{
          height: 56,
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          gap: 12,
        }}
      >
        <Skeleton circle width={32} height={32} />
        <Skeleton height={14} width={120} />
        <div style={{ marginLeft: 'auto' }}>
          <Skeleton height={32} width={80} radius={99} />
        </div>
      </header>

      {/* Content skeleton */}
      <main
        aria-label="Loading your dashboard"
        aria-busy="true"
        style={{ padding: '32px 24px', maxWidth: 720, margin: '0 auto' }}
      >
        <PageSkeleton variant="lines" lines={2} />
        <div style={{ marginTop: 32 }}>
          <PageSkeleton variant="card" lines={3} />
        </div>
        <div style={{ marginTop: 16 }}>
          <PageSkeleton variant="list" lines={4} />
        </div>
      </main>
    </>
  );
}

// ── Authed stub content ───────────────────────────────────────────────────────
function DashboardStub({
  username,
  onLogout,
}: {
  username: string | null;
  onLogout: () => Promise<void>;
}) {
  return (
    <>
      {/* Top-bar */}
      <header
        style={{
          height: 56,
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          gap: 12,
        }}
      >
        <SuzuDM size={32} glow={false} aria-hidden />
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            letterSpacing: '-0.02em',
          }}
        >
          Suzu's Tavern
        </span>
        <div style={{ marginLeft: 'auto' }}>
          <LogoutButton onLogout={onLogout} />
        </div>
      </header>

      {/* Main content */}
      <main
        id="main-content"
        style={{ padding: '40px 24px', maxWidth: 720, margin: '0 auto' }}
        tabIndex={-1}
      >
        <h1>Welcome back{username ? `, ${username}` : ''}.</h1>
        <p style={{ color: 'var(--ink-2)', marginTop: 8 }}>
          Sprint 5 will bring the full dashboard here. For now, the table is set.
        </p>
        <div style={{ marginTop: 32 }}>
          <Card pop style={{ padding: 24 }}>
            <p className="label" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              Dashboard — coming in Sprint 5
            </p>
          </Card>
        </div>
      </main>
    </>
  );
}

// ── Page default export ───────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user, loading, maybeAuthed, logout } = useAuth();
  const router = useRouter();

  // When resolved with no user (edge case — proxy.ts should have redirected),
  // redirect to login instead of rendering a broken authed state.
  useEffect(() => {
    if (!loading && !user && !maybeAuthed) {
      router.replace('/login');
    }
  }, [loading, user, maybeAuthed, router]);

  // While loading and we believe the user may be authed (silent refresh in flight),
  // render the skeleton to avoid the logged-out flash.
  if (loading && maybeAuthed) {
    return <DashboardSkeleton />;
  }

  // Not loading, user resolved — render authed content.
  if (user) {
    return (
      <DashboardStub
        username={user.username ?? null}
        onLogout={logout}
      />
    );
  }

  // Loading without maybeAuthed (fresh load, not a returning user) or waiting
  // for redirect effect — show a minimal skeleton to avoid blank flash.
  return <DashboardSkeleton />;
}
