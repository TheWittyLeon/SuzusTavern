/**
 * Session recap — "previously on…" (S3.6 / ST-079).
 *
 * Pure, DETERMINISTIC digest builder. Makes ZERO LLM calls — it just selects and
 * formats the most notable recent `session_events`, falling back to a metadata
 * digest (DM, players, status, when) when no event stream is available. This is
 * the load-bearing path the AI-off interlock (S2.5) requires: when
 * `ai_assist_level === 'off'` the recap is exactly this, with no narration call.
 *
 * The events come from `getSessionEvents` (the engine's paged events read); with no events the recap
 * falls back to the session-metadata digest.
 */
import { sessionTitle, formatStarted } from '@/lib/format';
import type { Session, SessionEvent } from '@/lib/api/types';
import { STRUCTURAL_EVENT_KINDS } from '@/lib/rehydration';

export type { SessionEvent };

export interface RecapResult {
  /** True when there's nothing to recap (a genuine first session). */
  empty: boolean;
  /** Short heading for the recap region. */
  headline: string;
  /** Deterministic digest lines (notable events, or a metadata summary). */
  lines: string[];
  /** Plain-text facts for grounding an optional AI summary (never fabricated). */
  facts: string;
  /**
   * True ONLY when `lines`/`facts` were derived from real play `session_events`
   * (not session metadata). The AI "previously on" narration must gate on this —
   * a fresh session with only metadata has no history to recap, and narrating
   * from metadata alone makes the LLM fabricate a nonexistent past.
   */
  fromEvents: boolean;
}

// Event types worth surfacing in a recap (A3 - real engine event kinds).
// Engine msm path emits (with text): scene_advance, encounter_resolved, xp_award, and more (session_end is bookkeeping, R64: STRUCTURAL_EVENT_KINDS)
// (the level-up row is `character_levelup`, with no text, so it never reaches the digest).
// Forward-compat aliases kept for callers normalising legacy event_type values.
// NOTABLE only ever sees story rows: `buildRecap` filters bookkeeping (STRUCTURAL_EVENT_KINDS) out before it looks, so a
// bookkeeping kind listed here would be dead code (session_end was, until R64 took it out). Keep them out.
const NOTABLE = new Set([
  // Real engine kinds (msm path)
  'scene_advance',        // scene moved on - has description
  'encounter_resolved',   // combat/encounter ended - has description
  'xp_award',             // XP granted - has description
  'level_up',             // legacy alias; the engine writes `character_levelup`, with no text
  // Forward-compat / legacy aliases
  'combat',               // legacy combat kind
  'combat_end',           // legacy combat-end kind
  'milestone',            // custom milestone events
]);

function metadataLines(session: Pick<Session, 'status' | 'dm_username' | 'player_count' | 'participant_usernames' | 'started_at'>): string[] {
  const lines: string[] = [];
  const dm = (session.dm_username ?? '').toLowerCase() === 'suzu'
    ? 'Suzu'
    : session.dm_username;
  if (dm) lines.push(`DM’d by ${dm}.`);
  const players = session.player_count ?? session.participant_usernames?.length;
  if (players != null && players > 0) {
    lines.push(`${players} ${players === 1 ? 'player' : 'players'} at the table.`);
  }
  if (session.status === 'paused') lines.push('The session is paused — pick up where you left off.');
  if (session.started_at) lines.push(`Started ${formatStarted(session.started_at)}.`);
  return lines;
}

/**
 * Build a deterministic recap. Prefers notable `session_events`; when none are
 * available, summarizes from session metadata. Returns `empty` only when there's
 * genuinely nothing to say (a brand-new first session).
 */
export function buildRecap(
  session: Pick<Session, 'name' | 'channel' | 'status' | 'dm_username' | 'player_count' | 'participant_usernames' | 'started_at'>,
  events: SessionEvent[] = [],
  opts: { maxLines?: number } = {},
): RecapResult {
  const max = opts.maxLines ?? 4;

  // The digest is built from story rows only (isStoryEvent): bookkeeping rows (a stored model recap, a session
  // start or end) never print, by any path. A log of bookkeeping alone is the metadata state (R51 F2, R63, R64).
  const withDesc = events.filter(isStoryEvent);
  // Normalize type (engine case convention isn't contract-locked yet — Kage).
  const notable = withDesc.filter((e) => NOTABLE.has((e.event_type ?? '').toLowerCase()));
  const picked = (notable.length ? notable : withDesc).slice(-max);
  const eventLines = picked.map((e) => eventText(e));

  if (eventLines.length > 0) {
    return {
      empty: false,
      headline: 'Previously on…',
      lines: eventLines,
      // Anchor the AI grounding to the campaign on the event path too (Kage).
      facts: `${sessionTitle(session)}: ${eventLines.join(' ')}`,
      fromEvents: true,
    };
  }

  const meta = metadataLines(session);
  if (meta.length === 0) {
    return { empty: true, headline: 'Your story starts here', lines: [], facts: '', fromEvents: false };
  }
  return {
    empty: false,
    headline: 'Where you left off',
    lines: meta,
    facts: `${sessionTitle(session)}: ${meta.join(' ')}`,
    // Metadata-only: NOT real play history. The AI recap must not narrate from this.
    fromEvents: false,
  };
}

/** A row's story text, trimmed; '' when it has none. The reader casts `data.description`/`data.text` without
 *  checking, and a table member can write any JSON there, so only a string counts. */
const eventText = (e: SessionEvent): string => (typeof e.description === 'string' ? e.description.trim() : '');

/**
 * The one definition of "something has happened" (R37, R51 F2): a story row, the same row `buildRecap` puts in
 * the digest: it has story text to tell (`description`, which the reader fills from `data.description` or
 * `data.text`) and its kind is not bookkeeping (STRUCTURAL_EVENT_KINDS). A row with no text (a setting change, a
 * flag, a malformed or unknown kind) has nothing to recap, whatever its kind. Both recap decisions read it:
 * whether a NEW recap is due (a story row past the last stored one) and whether ANY recap is due (a story row
 * anywhere in the log).
 */
export const isStoryEvent = (e: SessionEvent): boolean =>
  !!eventText(e) && !STRUCTURAL_EVENT_KINDS.has((e.event_type ?? '').toLowerCase());

/**
 * TAV-RECAP-ROW-PER-PAGE-OPEN (R37): what the log already says about the last "previously on".
 * `null` = no `recap` row yet (a first open: make one). Otherwise the LAST recap row's text
 * (null when blank) and whether any STORY event lies past it (bookkeeping kinds, STRUCTURAL_EVENT_KINDS, do
 * not count: a pause or resume is not "something happened"). Events are oldest first.
 */
export function lastStoredRecap(events: SessionEvent[]): { text: string | null; newerEvents: boolean } | null {
  let at = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if ((events[i].event_type ?? '').toLowerCase() === 'recap') { at = i; break; }
  }
  if (at < 0) return null;
  const newerEvents = events.slice(at + 1).some(isStoryEvent);
  return { text: eventText(events[at]) || null, newerEvents };
}
