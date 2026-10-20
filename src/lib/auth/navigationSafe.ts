'use client';
// src/lib/auth/navigationSafe.ts
//
// A long tail of page tests mock next/navigation with only the exports that page touches. The real
// module always exports `useRouter` and `usePathname`, so guarding is a no-op in production and lets
// the auth hooks drop into every suite without a mock sweep. Stable fallbacks keep effects from
// re-running on identity churn alone.
import * as NextNavigation from 'next/navigation';

const NOOP_ROUTER = { replace: (_href: string) => { /* no router mocked in this test */ } };

export const useRouterSafe: () => { replace: (href: string) => void } =
  typeof NextNavigation.useRouter === 'function' ? NextNavigation.useRouter : () => NOOP_ROUTER;

export const usePathnameSafe: () => string | null =
  typeof NextNavigation.usePathname === 'function' ? NextNavigation.usePathname : () => null;
