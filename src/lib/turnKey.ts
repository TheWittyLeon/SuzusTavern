/**
 * DDX-20 — client-minted `turn_key` lifecycle (durable-generation idempotency
 * anchor). Flag-ON only (DURABLE_GENERATION_ENABLED, src/lib/config.ts) —
 * unused while the flag is false.
 *
 * Lifecycle (Client Integration Design §4c, spec'd exactly):
 *   set on turn start -> clear when the beat completes (narration seq
 *   observed) -> clear + mint a NEW key on retry-after-failed (a `failed`
 *   job's turn_key is deduped-forever server-side; reusing it after a
 *   failure would silently no-op instead of retrying).
 *
 * localStorage is a belt, not the mechanism — the primary resume path is
 * stateless poll-discovery (design §4b, `pending_generation` on GET /events).
 * A stale key here must never trigger a spurious re-POST on its own; callers
 * only read it to attempt the mechanism-2 idempotent re-POST fallback.
 */

const STORAGE_PREFIX = 'st:dnd:';
const STORAGE_SUFFIX = ':activeTurnKey';

function storageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}${STORAGE_SUFFIX}`;
}

/** Mint a fresh UUID v4 turn_key. */
export function mintTurnKey(): string {
  return crypto.randomUUID();
}

/**
 * Persist the active turn_key for a session (survives a reload while the
 * turn is in flight). Swallows storage errors (private-mode/SSR edge) —
 * non-fatal, since the primary resume mechanism never depends on this.
 *
 * TODO(DDX-20 mechanism-2): page.tsx calls this today purely as a write
 * (turn_key lifecycle bookkeeping, §4c) — the mechanism-2 idempotent
 * re-POST fallback (§4b, "a client that does still hold its in-flight
 * turn_key may re-POST the turn") is NOT wired up; nothing in page.tsx
 * calls `readTurnKey` on mount/resume. Don't mistake this write path for
 * live mechanism-2 coverage — the primary (and currently ONLY) resume path
 * is the stateless poll-discovery in pollDurable.
 */
export function saveTurnKey(sessionId: string, key: string): void {
  try {
    window.localStorage.setItem(storageKey(sessionId), key);
  } catch {
    // localStorage unavailable — non-fatal, see module doc above.
  }
}

/**
 * Read the persisted turn_key for a session, or null if none/unavailable.
 *
 * TODO(DDX-20 mechanism-2): exported but UNUSED by page.tsx today — see the
 * note on `saveTurnKey` above. Wiring this into a mount-time idempotent
 * re-POST fallback is deferred, not implemented.
 */
export function readTurnKey(sessionId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(sessionId));
  } catch {
    return null;
  }
}

/**
 * Clear the persisted turn_key. Call on turn completion AND on failure
 * (before minting a NEW key for retry — never reuse a failed turn_key).
 */
export function clearTurnKey(sessionId: string): void {
  try {
    window.localStorage.removeItem(storageKey(sessionId));
  } catch {
    // no-op — nothing to clear
  }
}
