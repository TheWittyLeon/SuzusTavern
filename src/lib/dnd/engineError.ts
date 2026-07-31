// src/lib/dnd/engineError.ts
//
// F1/CAST-FAIL-SILENT (WF-TAV-AUDIT-BATCH-2026-07-22 Pass P, D1 — resolved by
// Riku-Orch) — single chokepoint for turning a caught engine-call ApiError
// into user-facing copy. Before this fix, several play-page catch branches
// (beginEncounter/onCombatAction/onAttemptCheck) and CastSpellPanel's own
// error path each handled only a hand-picked subset of reason codes and fell
// back to a terse generic toast for anything else — silently dropping the
// engine's own ready-to-show `message` text (e.g. "No encounter available
// for the current scene.", "Session not found.", "Unknown skill 'x'.") even
// though the engine wrote that message specifically to be shown to a player
// (NekoNova-DnDEngine's `_err()` — see routes/*.py — always sets `message` to
// human copy, `data.reason` to the machine code).
//
// Precedence (Leon's explicit "surface the error" instruction, scoped by D1):
//   1. `reasonMap[reason]` (curated copy) ALWAYS wins when present — curated
//      copy exists because it's better-worded/more specific than the raw
//      engine string, not because the raw string is unsafe.
//   2. Else, for a 4xx BUSINESS error (400/403/404/409) with a non-empty
//      `err.body.message`, surface that message verbatim.
//   3. Else `fallback`.
//
// NEVER surfaces `err.body.message` for a 5xx (could leak "Internal server
// error" / stack-adjacent text — the engine's own 500 branches use exactly
// that generic string, never anything more specific) or for a network/abort
// error (status 0 — `apiFetch` synthesizes `code: 'network'|'abort'` with no
// body at all, see src/lib/api/client.ts). Both always fall through to
// `fallback`, regardless of `reasonMap`.
import type { ApiError } from '@/lib/api/types';

/** HTTP statuses whose `_err()` message text is written to be player-facing.
 *  Deliberately excludes every 5xx and the network/abort sentinel (status 0)
 *  — see this module's header comment for why. */
const BUSINESS_4XX_STATUSES: ReadonlySet<number> = new Set([400, 403, 404, 409]);

/** Same body-shape probe used across the play page / CastSpellPanel today
 *  (data.reason / reason / e.code) — kept here so every caller shares one
 *  implementation instead of re-deriving it ad hoc. */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof Error && 'status' in err;
}

/**
 * Exported (2026-07-28, Tora-Gesture MAJOR-1 follow-up) so a caller can
 * branch on the machine-readable reason itself, not just the curated copy --
 * e.g. the play page's onAttemptCheck self-corrects (refreshes grounding)
 * specifically for `check_locked`/`check_resolved`, where stale client
 * grounding is the actual cause, without hardcoding/duplicating the
 * body-shape probe a second time.
 */
export function extractReason(err: ApiError): string | undefined {
  const body = err.body as { data?: { reason?: string }; reason?: string } | null | undefined;
  return body?.data?.reason ?? body?.reason ?? err.code;
}

function extractBodyMessage(err: ApiError): string | undefined {
  const body = err.body as { message?: unknown } | null | undefined;
  const message = body?.message;
  return typeof message === 'string' && message.trim().length > 0 ? message : undefined;
}

export interface EngineErrorOptions {
  /** Shown when nothing else applies — includes every 5xx and network/abort,
   *  and any 4xx business error whose body carries no usable `message`. */
  fallback: string;
  /** Curated reason -> copy overrides. Always wins over the raw engine
   *  message when the reason is present in this map. */
  reasonMap?: Record<string, string>;
}

/**
 * Turn a caught engine-call error into a single user-facing string. See this
 * module's header comment for the full precedence rule.
 */
export function engineErrorMessage(err: unknown, options: EngineErrorOptions): string {
  const { fallback, reasonMap } = options;
  if (!isApiError(err)) return fallback;

  const reason = extractReason(err);
  if (reason && reasonMap?.[reason] !== undefined) return reasonMap[reason];

  if (BUSINESS_4XX_STATUSES.has(err.status)) {
    const message = extractBodyMessage(err);
    if (message) return message;
  }

  return fallback;
}
