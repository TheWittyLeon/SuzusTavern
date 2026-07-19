'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * SSR-safe hook that returns whether `query` currently matches the viewport.
 *
 * Same shape as useReducedMotion (matchMedia + a live `change` listener) but
 * takes an arbitrary media query string, so callers can track viewport-width
 * breakpoints in JS where a pure-CSS media query can't express the needed
 * behavior — e.g. the Codex's CRITICAL-1 fix (swapping a hidden drawer for a
 * real dismissible modal below 1280px) and MAJOR-7 fix (flipping a tablist's
 * aria-orientation below 860px).
 *
 * Built on `useSyncExternalStore` — `window.matchMedia` is a genuine external
 * store (it lives outside React), so subscribing this way avoids the
 * setState-in-effect cascading-render lint (and the real footgun it flags).
 *
 * - Returns `false` on the server / before first render so SSR markup is stable.
 * - Also re-checks on `window.resize` as a belt-and-suspenders fallback —
 *   matchMedia's own `change` event is the correct primitive and already
 *   covers viewport-width changes (including browser-zoom-induced ones), but
 *   a resize listener costs nothing extra and guards environments with a
 *   spotty `change` implementation.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onStoreChange);
      window.addEventListener('resize', onStoreChange);
      return () => {
        mq.removeEventListener('change', onStoreChange);
        window.removeEventListener('resize', onStoreChange);
      };
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
