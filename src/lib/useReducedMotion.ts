'use client';

import { useEffect, useState } from 'react';

/**
 * SSR-safe hook that returns `true` when the user prefers reduced motion.
 *
 * - Returns `false` on the server / before first render so SSR markup is stable.
 * - Subscribes to `prefers-reduced-motion: reduce` on mount and keeps the value
 *   live (responds to OS setting changes without a page reload).
 * - Cleans up the listener on unmount.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);

    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
}
