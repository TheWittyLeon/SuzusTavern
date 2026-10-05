'use client';
import { useState } from 'react';

/**
 * A value as it was when `open` turned true, held until it turns false. A dialog's words that depend on live state (the End-session confirm names a held fight) must not change under the
 * reader: a grown body moves the buttons while a tap on one is in flight, and a confirm is then given without the new words having been read (Tora MINOR-8).
 * Closed, it returns the live value, so the next opening starts from the present. Adjusted while rendering, not in an effect.
 */
export function useOpenSnapshot<T>(open: boolean, value: T): T {
  const [held, setHeld] = useState<{ open: boolean; value: T }>({ open, value });
  if (held.open !== open) setHeld({ open, value });
  return open && held.open ? held.value : value;
}
