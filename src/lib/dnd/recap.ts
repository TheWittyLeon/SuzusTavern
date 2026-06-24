/**
 * Session recap — "previously on…" (S3.6 / ST-079).
 *
 * Pure, DETERMINISTIC digest builder. Makes ZERO LLM calls — it just selects and
 * formats the most notable recent `session_events`, falling back to a metadata
 * digest (DM, players, status, when) when no event stream is available. This is
 * the load-bearing path the AI-off interlock (S2.5) requires: when
 * `ai_assist_level === 'off'` the recap is exactly this, with no narration call.
 *
 * NOTE (flagged dependency): the engine writes `session_events` but exposes no
 * READ route yet, so `getSessionEvents` returns [] today and the recap uses the
 * metadata digest. When the tiny engine `GET /sessions/{id}/events` lands, the
 * event digest below lights up with no Tavern change.
 */
import { titleizeChannel, sessionTitle, formatStarted } from '@/lib/format';
import type { Session, SessionEvent } from '@/lib/api/types';

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
}

// Event types worth surfacing in a recap (A3 - real engine event kinds).
// Engine msm path emits: scene_advance, encounter_resolved, session_start,
// session_end, xp_award, level_up, opening_narrated.
// Forward-compat aliases kept for callers normalising legacy event_type values.
const NOTABLE = new Set([
  // Real engine kinds (msm path)
  'scene_advance',        // scene moved on - has description
  'encounter_resolved',   // combat/encounter ended - has description
  'xp_award',             // XP granted - has description
  'level_up',             // character levelled - has description
  'session_end',          // session ended - has description
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

  const withDesc = events.filter((e) => e.description && e.description.trim());
  // Normalize type (engine case convention isn't contract-locked yet — Kage).
  const notable = withDesc.filter((e) => NOTABLE.has((e.event_type ?? '').toLowerCase()));
  const picked = (notable.length ? notable : withDesc).slice(-max);
  const eventLines = picked.map((e) => e.description!.trim());

  if (eventLines.length > 0) {
    return {
      empty: false,
      headline: 'Previously on…',
      lines: eventLines,
      // Anchor the AI grounding to the campaign on the event path too (Kage).
      facts: `${sessionTitle(session)}: ${eventLines.join(' ')}`,
    };
  }

  const meta = metadataLines(session);
  if (meta.length === 0) {
    return { empty: true, headline: 'Your story starts here', lines: [], facts: '' };
  }
  return {
    empty: false,
    headline: 'Where you left off',
    lines: meta,
    facts: `${sessionTitle(session)}: ${meta.join(' ')}`,
  };
}
