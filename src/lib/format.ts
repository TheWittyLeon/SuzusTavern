// src/lib/format.ts
//
// Small presentational helpers for binding real engine fields into the UI.
// Kept dependency-free and defensive — engine values are loosely shaped.

/**
 * Turn a Twitch-style channel id into a readable table title.
 * "hollow_tide" → "Hollow Tide", "leon" → "Leon". Falls back to the raw value.
 */
export function titleizeChannel(channel: string | undefined | null): string {
  if (!channel) return 'Untitled table';
  const cleaned = String(channel).replace(/^#/, '').replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return 'Untitled table';
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Return the human-readable title for a session.
 *
 * Priority:
 *   1. session.name when it is a real human name (present, non-empty, and
 *      not equal to the channel slug). The `name !== channel` guard catches
 *      legacy/bot rows where `name` was set to the slug — those should still
 *      titleize cleanly via fallback.
 *   2. titleizeChannel(session.channel) — the original fallback for every
 *      pre-fix row and any row without a name.
 */
export function sessionTitle(session: { name?: string; channel?: string | null }): string {
  const n = session.name?.trim();
  if (n && n !== session.channel) return n;
  return titleizeChannel(session.channel);
}

/**
 * Format an engine timestamp (ISO 8601, "YYYY-MM-DD HH:MM:SS", or epoch) into a
 * short, locale-aware label. Returns '' on anything unparseable — never throws.
 */
export function formatStarted(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '';
  let d: Date;
  if (typeof value === 'number') {
    d = new Date(value < 1e12 ? value * 1000 : value);
  } else {
    // Engine timestamps (started_at) are stored UTC. A naive "YYYY-MM-DD HH:MM:SS"
    // (or "…THH:MM:SS" with no zone) is otherwise parsed as LOCAL time, which can
    // shift the displayed day by one. Force UTC by appending 'Z' when zoneless.
    let s = value;
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
      s = value.replace(' ', 'T') + 'Z';
    }
    d = new Date(s);
  }
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
