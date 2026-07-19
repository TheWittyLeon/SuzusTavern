'use client';
/**
 * useAuthGate — the shared protected-page gate (UIR2-TAV-3).
 *
 * Centralises the three failure modes that protected pages used to get wrong
 * independently:
 *   1. Infinite skeleton — a page whose bespoke `if (!user) return <skeleton>`
 *      had no escape hatch once a silent refresh failed (character/[id]).
 *   2. Fabricated identity — pages that render <TavernShell> while `user` is
 *      still null (lobby/codex/modules/play), surfacing UserMenu's
 *      `user?.username ?? 'Adventurer'` fallback as if it were real.
 *   3. Silent redirect — bouncing straight to /login with no explanation
 *      (dashboard/trash/character-new/admin).
 *
 * Call `useAuthGate()` unconditionally, in a stable position, before any
 * early `return` in the page component — it calls hooks itself (useAuth,
 * useEffect, plus the router/pathname hooks below), so it must follow the
 * Rules of Hooks like any other. If it returns non-null, return that in place
 * of the page's real body.
 */
import { Children, cloneElement, isValidElement, useEffect, type ReactNode } from 'react';
import * as NextNavigation from 'next/navigation';
import { useAuth } from './AuthProvider';
import PageSkeleton, { type PageSkeletonProps } from '@/components/PageSkeleton';
import SessionExpired from '@/components/SessionExpired';

// A long tail of pre-existing page tests mock next/navigation with only the
// exports that page's OWN code touches (e.g. play/[sessionId] tests mock
// `useParams` alone — the page never called `useRouter` before this hook
// existed). The real next/navigation module always exports both `useRouter`
// and `usePathname`, so guarding the call is a no-op in production and lets
// this hook drop into every existing test suite without an unrelated,
// wide-blast-radius sweep to add router/pathname mocks everywhere it's now
// transitively used. Stable fallback references keep the effect below from
// re-running on identity churn alone.
const NOOP_ROUTER = { replace: () => { /* no router mocked in this test */ } };
const useRouterSafe =
  typeof NextNavigation.useRouter === 'function' ? NextNavigation.useRouter : () => NOOP_ROUTER;
const usePathnameSafe =
  typeof NextNavigation.usePathname === 'function' ? NextNavigation.usePathname : () => null;

export interface UseAuthGateOptions {
  /** Rendered inside the bounded loading <main> while genuinely resolving. */
  skeleton: ReactNode;
  /**
   * Per-page loading label (e.g. "Loading your dashboard"). DDX-TAV3-SKELETON-LABEL:
   * threaded onto the FIRST <PageSkeleton> found inside `skeleton` (via
   * `withSkeletonLabel` below) as that component's `label` prop — drives
   * PageSkeleton's own `role="status"` region's aria-label + sr-only text.
   * TAV-DASHBOARD-SKELETON-DOUBLE-LIVEREGION: still exactly ONE live region
   * per page (Iro-A11y MAJOR-1's constraint) even when `skeleton` stacks
   * several <PageSkeleton>s — only the first one announces; every
   * subsequent one is forced to `announce={false}`. This wrapper itself
   * never gets its own aria-live/aria-label. A <PageSkeleton> that already
   * sets an explicit `label` keeps it (but still only announces if it's the
   * first one) — this only fills in the default.
   */
  label: string;
}

/** TAV-DASHBOARD-SKELETON-DOUBLE-LIVEREGION: recursively walk the
 *  caller-supplied skeleton tree and set `label` on every <PageSkeleton>
 *  that doesn't already have its own explicit one — but only the FIRST
 *  <PageSkeleton> encountered in document order actually announces
 *  (`announce` left at its default `true`); every subsequent one gets
 *  `announce={false}` so a page that stacks several skeletons (e.g.
 *  dashboard/page.tsx's card+list) still produces exactly ONE
 *  `role="status"` region overall, not one per skeleton. `alreadyLabeled` is
 *  a closure counter (not a parameter re-initialised per recursive call) so
 *  order is tracked across the WHOLE tree walk, including across sibling
 *  subtrees at different nesting depths — Children.map's per-level
 *  recursion would otherwise reset a plain boolean parameter at each nested
 *  call. Doesn't touch any other element type. */
function withSkeletonLabel(node: ReactNode, label: string): ReactNode {
  const alreadyLabeled = { current: false };
  function walk(n: ReactNode): ReactNode {
    return Children.map(n, (child) => {
      if (!isValidElement(child)) return child;
      if (child.type === PageSkeleton) {
        const isFirst = !alreadyLabeled.current;
        alreadyLabeled.current = true;
        const props = child.props as PageSkeletonProps;
        const patch: Partial<PageSkeletonProps> = isFirst
          ? (props.label !== undefined ? {} : { label })
          : { announce: false };
        return Object.keys(patch).length > 0 ? cloneElement(child, patch) : child;
      }
      const props = child.props as { children?: ReactNode };
      if (props.children !== undefined) {
        return cloneElement(child, {
          children: walk(props.children),
        } as { children: ReactNode });
      }
      return child;
    });
  }
  return walk(node);
}

/**
 * Returns a ReactNode to render IN PLACE OF the page body, or `null` when the
 * page should render normally (a real user is present).
 *
 * Key property: the skeleton branch is reached only while genuinely resolving
 * (loading/maybeAuthed) or briefly before the genuine-logout redirect fires —
 * it can never be infinite, because a failed refresh sets `authError`, which
 * routes to <SessionExpired> instead of falling through to the skeleton.
 */
export function useAuthGate(opts: UseAuthGateOptions): ReactNode | null {
  const { user, loading, maybeAuthed, authError, retrying, retryAuth } = useAuth();
  const router = useRouterSafe();
  const pathname = usePathnameSafe();

  // Genuinely-logged-out (never had a session, no error) → bounce to /login,
  // preserving prior behavior for that case. Expired/rate-limited get a
  // prompt instead — they HAD a session; a bare redirect would erase that
  // context without explanation.
  useEffect(() => {
    if (!user && !loading && !maybeAuthed && !authError) router.replace('/login');
  }, [user, loading, maybeAuthed, authError, router]);

  if (user) return null;

  if (authError === 'rate_limited') {
    return (
      <SessionExpired
        variant="rate_limited"
        onRetry={() => void retryAuth()}
        pathname={pathname}
        // MAJOR-2 (Tora): `retrying` stays true only while THIS retry is in
        // flight; `authError` itself is untouched during it (see
        // AuthProvider's retryAuth), so this branch — and this SAME
        // SessionExpired instance — stays mounted and focused for the whole
        // attempt instead of swapping to the generic skeleton.
        busy={retrying}
      />
    );
  }
  if (authError === 'offline') {
    // TAV3-OFFLINE-VARIANT: unlike 'expired', this failure never confirmed
    // the session is actually invalid — retry, not sign-in.
    return (
      <SessionExpired
        variant="offline"
        onRetry={() => void retryAuth()}
        pathname={pathname}
        busy={retrying}
      />
    );
  }
  if (authError === 'expired') {
    return <SessionExpired variant="expired" pathname={pathname} />;
  }

  // Resolving, or genuine-logout pending the redirect above — bounded skeleton.
  // No aria-busy/aria-label here: PageSkeleton owns the single loading live
  // region (role="status"); a second one on this wrapper double-announces
  // (Iro-A11y MAJOR-1). id/tabIndex keep skip-link parity with the other two
  // gate states and the real page shell. withSkeletonLabel threads opts.label
  // into that ONE region rather than creating a second one here.
  return (
    <main id="main-content" tabIndex={-1} style={{ padding: 28 }}>
      {withSkeletonLabel(opts.skeleton, opts.label)}
    </main>
  );
}
