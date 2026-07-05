'use client';

import { useEffect, useState } from 'react';

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
 * - Returns `false` on the server / before first render so SSR markup is stable.
 * - Also re-checks on `window.resize` as a belt-and-suspenders fallback —
 *   matchMedia's own `change` event is the correct primitive and already
 *   covers viewport-width changes (including browser-zoom-induced ones), but
 *   a resize listener costs nothing extra and guards environments with a
 *   spotty `change` implementation.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);

    const handler = () => setMatches(mq.matches);
    mq.addEventListener('change', handler);
    window.addEventListener('resize', handler);
    return () => {
      mq.removeEventListener('change', handler);
      window.removeEventListener('resize', handler);
    };
  }, [query]);

  return matches;
}
