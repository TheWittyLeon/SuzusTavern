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

/**
 * Mint a fresh UUID v4 turn_key.
 *
 * `crypto.randomUUID()` is SECURE-CONTEXT-ONLY (undefined over plain HTTP to
 * a non-localhost host). The Tavern's production deployment serves over
 * plain HTTP on the LAN (no TLS — `docker-compose.tavern.yml`,
 * `COOKIE_SECURE: "false"`), so a hard dependency on `randomUUID` throws a
 * `TypeError` before the turn is ever POSTed — silently killing the entire
 * durable-generation path (DDX-20 F11). We prefer native `randomUUID` when
 * it's available, and otherwise build a spec-correct UUIDv4 from
 * `crypto.getRandomValues()`, which is NOT secure-context-gated (unlike
 * `randomUUID`/`crypto.subtle`) and is universally available in browsers.
 *
 * `turn_key` is an idempotency anchor, not a security credential — the
 * engine authorizes durable reads via an authoritative
 * `get_generation_job(session_id, job_id)` check — so `getRandomValues`
 * entropy is more than sufficient here. There is deliberately no
 * `Math.random()` fallback: if `getRandomValues` is somehow absent, throwing
 * loudly is correct.
 */
export function mintTurnKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
