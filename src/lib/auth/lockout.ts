// src/lib/auth/lockout.ts
//
// Wording for Authentication-Python's account lockout (HTTP 423). Pure; shared by the login page.
//
// Upstream sends `locked_until` as a NAIVE UTC isoformat ("2026-10-20T23:00:00", no offset), and the
// BFF relays it (it is a timestamp, not a secret). A string without an offset is therefore read as
// UTC here — new Date("…T23:00:00") alone would read it as the browser's local time.

/** Max lock we will quote in minutes; anything beyond reads as the generic copy (clock skew / junk). */
const MAX_QUOTED_MINUTES = 24 * 60;

const GENERIC =
  "This account is locked after too many wrong passphrases. Try again in a little while.";

export function lockedMessage(lockedUntil: unknown, now: number = Date.now()): string {
  if (typeof lockedUntil !== 'string' || lockedUntil === '') return GENERIC;
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(lockedUntil);
  const ms = Date.parse(hasOffset ? lockedUntil : `${lockedUntil}Z`);
  if (!Number.isFinite(ms)) return GENERIC;
  const minutes = Math.ceil((ms - now) / 60_000);
  if (minutes < 1 || minutes > MAX_QUOTED_MINUTES) return GENERIC;
  return `This account is locked after too many wrong passphrases. Try again in about ${minutes} ${
    minutes === 1 ? 'minute' : 'minutes'
  }.`;
}
