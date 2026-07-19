'use client';

import { useCallback, useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * SSR-safe hook that returns `true` when the user prefers reduced motion.
 *
 * Built on `useSyncExternalStore` — `window.matchMedia` is a genuine external
 * store (it lives outside React), so subscribing this way avoids the
 * setState-in-effect cascading-render lint (and the real footgun it flags).
 *
 * - Returns `false` on the server / before first render so SSR markup is stable.
 * - Subscribes to `prefers-reduced-motion: reduce` on mount and keeps the value
 *   live (responds to OS setting changes without a page reload).
 * - Cleans up the listener on unmount.
 */
export function useReducedMotion(): boolean {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const mq = window.matchMedia(QUERY);
    mq.addEventListener('change', onStoreChange);
    return () => mq.removeEventListener('change', onStoreChange);
  }, []);

  const getSnapshot = useCallback(() => window.matchMedia(QUERY).matches, []);
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
