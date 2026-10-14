/**
 * PLAY-PERSIST §6.3 — durable session event → rehydrated LogRow mapper.
 *
 * Pure function, no side effects. Used by the play screen's mount-time
 * rehydration (§6.2 of the design doc) to turn the raw event log returned by
 * getSessionEventsRaw into the same LogRow shape the live composer appends,
 * so a rejoin/refresh restores the transcript instead of showing it blank.
 */
import type { EngineSessionEvent } from '@/lib/api/types';
import type { LogRow } from '@/components/ChatLog';

/**
 * TAV-7 — reverse NekoNova's `html.escape(v, quote=True)` (Python) applied to
 * every free-text field it validates (username/message/mechanics/adventure —
 * see api/validation.py::DMNarrationStreamRequest.sanitize_string). That
 * escaping is meant to defend places the string might later be inserted as
 * markup; ChatLog never does that (plain JSX text nodes only, always safe
 * regardless of content) — so a persisted `"` shows up on screen as the
 * literal, un-rendered characters `&quot;` instead of a real quote. Decoding
 * here (the single chokepoint every rehydrated/session-event-sourced row
 * passes through) is safe: it only ever turns entity syntax back into plain
 * characters before a React text node renders it — it can NEVER cause markup
 * to be interpreted, so there's no XSS surface reintroduced by decoding.
 *
 * Order matters and is the EXACT reverse of html.escape's own replacement
 * order (which does `&` first, so no substitution downstream of it can ever
 * introduce a fresh bare `&`): decode `&amp;` LAST here, so a literal
 * "&lt;" a real player typed (escaped once to "&amp;lt;") round-trips back
 * to "&lt;" rather than being over-decoded to "<".
 *
 * Confirmed against the live-persisted shape (not guessed) — read via a
 * direct suzu_dnd_dev query, e.g. `data->>'text'` = 'Give a short
 * &quot;previously on&quot; recap of our last session.' for a player_action
 * row sourced from SessionRecap's request message.
 */
export function decodeHtmlEntities(s: string): string {
  // Defensive: callers cast unvalidated JSONB `data.*` as string; a truthy
  // non-string (corrupted/legacy row or engine schema drift) would otherwise
  // throw `s.replace is not a function` and crash the whole play screen via the
  // rehydration mount catch (Miko-QA). Pass non-strings through untouched.
  if (typeof s !== 'string' || !s) return s;
  return s
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&amp;/gi, '&');
}

/** Format an event's `created_at` ISO timestamp the same way live rows are
 *  stamped (nowStamp() in page.tsx). Empty string on missing/invalid input —
 *  a rehydrated row should never crash on a malformed timestamp. Exported so
 *  the play screen can reuse it for the opening-reconciliation rows (§6.4),
 *  which aren't produced by eventToLogRow itself. */
export function formatEventTimestamp(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * DDX-08 / T3 — map a `dice_roll` session event (engine routes/sessions.py
 * ::roll_dice_route) to a roll LogRow. `data` is the SAME roll_payload shape
 * returned synchronously by POST /roll: {kind, notation, skill, ability,
 * character_id, modifier, advantage, rolls, kept, total, description}.
 *
 * `sides` is derived from `notation` when present (e.g. "1d6" -> 6); a named
 * d20 check (skill/save/ability, or raw with no notation) is always a d20.
 * `value` is the die that counted (`kept` for advantage/disadvantage pairs,
 * else the single roll) — Die only ever renders one face. crit/fumble only
 * apply to d20s (mirrors the pre-DDX-08 client convention).
 *
 * Assumes the Tavern's own DiceTray never sends multi-die/modifier notation
 * (its plain-dice buttons always send "1d{sides}", no notation modifier) —
 * a roll from another client using richer notation still renders (first die
 * shown), just without a fully-accurate multi-die total.
 */
function diceRollLogRow(e: EngineSessionEvent): LogRow | null {
  const data = e.data ?? null;
  const description = (data?.['description'] as string | undefined) || undefined;
  if (!description) return null;

  const rolls = Array.isArray(data?.['rolls']) ? (data!['rolls'] as number[]) : [];
  const modifier = typeof data?.['modifier'] === 'number' ? (data['modifier'] as number) : 0;
  const kept = typeof data?.['kept'] === 'number' ? (data['kept'] as number) : undefined;
  const notation = typeof data?.['notation'] === 'string' ? (data['notation'] as string) : null;
  const skill = typeof data?.['skill'] === 'string' ? (data['skill'] as string) : null;
  const ability = typeof data?.['ability'] === 'string' ? (data['ability'] as string) : null;
  const rollKind = typeof data?.['kind'] === 'string' ? (data['kind'] as string) : 'raw';

  const notationMatch = notation ? /d(\d+)/i.exec(notation) : null;
  const sides = notationMatch ? Number(notationMatch[1]) : 20;
  const value = kept ?? rolls[0] ?? 0;
  const isD20 = sides === 20;
  const crit = isD20 && value === 20;
  const fumble = isD20 && value === 1;

  const label = skill
    ? skill.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : ability
      ? `${ability.charAt(0).toUpperCase()}${ability.slice(1)}${rollKind === 'save' ? ' save' : ''}`
      : (notation ?? `d${sides}`);

  const text = modifier !== 0 ? `${label} ${modifier >= 0 ? '+' : ''}${modifier}` : label;
  const id = `ev${e.seq ?? `dice_roll-${e.created_at ?? ''}`}`;

  return {
    id,
    ts: formatEventTimestamp(e.created_at),
    who: e.actor ?? 'Unknown',
    kind: 'roll',
    text,
    color: 'var(--accent)',
    roll: { sides, value, modifier, crit, fumble, label },
    ...(e.seq != null ? { seq: e.seq } : {}),
  };
}

/**
 * Kage-CR A4 IMPORTANT-4 (2026-09-28) — the flag-OFF/live session-events poll
 * (`hooks/useSessionEvents.ts`) renders only these two kinds as ROWS (except
 * while the mount's history read was partial: it then draws every kind it
 * reads past the watermark, until a read reaches the end); every
 * other kind is already reflected through its own optimistic-append or
 * streaming path (player_action/narration/dm_narration) and is left to a
 * future unified events poll (DDX-20) rather than double-rendered here.
 * Named and colocated with the switch below — the same pattern
 * `GROUNDING_INVALIDATING_KINDS` (hooks/useSessionEvents.ts) already uses so
 * two policies can't silently drift — for the same reason: when kind #12
 * gets a `case` in the switch immediately below, its author is looking
 * straight at this set to decide whether the poll should render it as a row
 * too, instead of the answer being encoded by omission from an inline
 * literal three files away.
 */
export const POLL_RENDERED_KINDS = new Set(['dice_roll', 'x_card']);

/**
 * Event kinds that are bookkeeping, not story: nothing happened in the fiction when one was written (a session started, paused, resumed or ended). The
 * recap reads this set once, in `isStoryEvent` (R37's "events since the last recap" and R51's "any recap at all"
 * do not count them; the assist-off digest does not print them). The play page's opening gate reads it too, through the same `isStoryEvent` (one list), but asks a different
 * question: not "is there prose to retell" but "has the table moved past the opening". Fail direction there: a wrong draw
 * happens once, a wrong hold is permanent, so a play row with no text does not hold the opening back.
 * `eventToLogRow` does not read this set (it drops these kinds through its `default` branch, like any unknown kind). A deny-list on purpose:
 * a story kind missing from it costs one stale recap, a bookkeeping kind wrongly counted costs a model call
 * on every resume.
 * debt: a client copy of the engine's event vocabulary: this kind list, plus the convention that story rows carry their prose in `description` or `text`. ceiling: a new bookkeeping kind that carries text is counted as story (one model call per occurrence, and the scene's opening withheld) until it is listed here; a play kind with no text does not hold the opening back (drawn once, written once), and does not earn a recap; a story kind the engine adds with no text, or with its prose under another key, never earns a recap. until: the engine marks an event's class (story or bookkeeping) on the row.
 */
export const STRUCTURAL_EVENT_KINDS: ReadonlySet<string> = new Set([
  'recap',
  'session_start',
  'session_created',
  'session_pause',
  'session_resume',
  'rebind', // a character bound or re-bound to the campaign: setup
  'opening_narrated',
  'session_end', // R64: ending a session is bookkeeping, text or not ("Session ended. 0 XP awarded to 0 players.")
]);

/**
 * Map one durable `session_events` row to a LogRow, or null to skip it.
 *
 * Mapping:
 *   player_action              -> kind 'player'   (skip if data.text missing)
 *   narration                  -> kind 'narration' (skip if data.text missing)
 *   dm_narration               -> kind 'dm_narration' (skip if data.text missing)
 *   scene_advance/encounter_resolved -> kind 'system' from data.description
 *                                       (skip if description missing)
 *   check_resolved              -> kind 'system' from data.description
 *                                  (P1-PLAYFIX §3.5/C13; skip if description
 *                                  missing)
 *   dice_roll                  -> kind 'roll' (DDX-08 / T3; server-authoritative
 *                                  roll outcome — see diceRollLogRow above;
 *                                  skip if description missing)
 *   opening_narrated           -> null (handled specially by the caller —
 *                                       read-aloud reconstruction, not a plain row)
 *   anything else (rebind, session_start, session_created, recap, unknown kinds)
 *                              -> null (structural/forward-compatible skip)
 *
 * The row's `id` is derived from `seq` so rehydrated rows never collide with
 * live-appended `r${n}` ids (idRef counter in page.tsx).
 */
export function eventToLogRow(e: EngineSessionEvent): LogRow | null {
  const data = e.data ?? null;
  // TAV-7: every free-text field here (text/who/description/actor) may have
  // been through NekoNova's DMNarrationStreamRequest.sanitize_string
  // (html.escape) on the way in — decode once, right at extraction, so every
  // branch below renders the real characters instead of literal entity text.
  const rawText = (data?.['text'] as string | undefined) || undefined;
  const text = rawText ? decodeHtmlEntities(rawText) : undefined;
  const rawWho = (data?.['who'] as string | undefined) || undefined;
  const who = rawWho ? decodeHtmlEntities(rawWho) : undefined;
  const actor = e.actor ? decodeHtmlEntities(e.actor) : undefined;
  const id = `ev${e.seq ?? `${e.kind ?? 'unknown'}-${e.created_at ?? ''}`}`;
  const ts = formatEventTimestamp(e.created_at);
  // DDX-20 — stamp the durable seq onto every returned row (when present) so
  // the flag-ON reconciliation ledger (src/lib/dnd/reconcileEvents.ts) has it
  // for dedup. Optional field, additive — flag-OFF rendering is unaffected
  // (ChatLog never reads `seq`).
  const seqField = e.seq != null ? { seq: e.seq } : {};

  switch (e.kind) {
    case 'player_action':
      if (!text) return null;
      return {
        id,
        ts,
        who: who ?? actor ?? 'You',
        kind: 'player',
        text,
        color: 'var(--accent)',
        ...seqField,
      };

    case 'narration':
      if (!text) return null;
      return { id, ts, who: who ?? 'Suzu', kind: 'narration', text, ...seqField };

    case 'dm_narration':
      if (!text) return null;
      return { id, ts, who: who ?? actor ?? 'DM', kind: 'dm_narration', text, ...seqField };

    case 'scene_advance':
    case 'encounter_resolved':
    case 'check_resolved': {
      const rawDescription = (data?.['description'] as string | undefined) || undefined;
      const description = rawDescription ? decodeHtmlEntities(rawDescription) : undefined;
      if (!description) return null;
      return { id, ts, who: 'Suzu', kind: 'system', text: description, ...seqField };
    }

    case 'dice_roll':
      return diceRollLogRow(e);

    // DDX-26: durable transcript marker for a raised X-card. Deliberately
    // ANON for every reader of the log (never `actor`) — the "anonymous to
    // players" product decision applies to the permanent record too, not
    // just the live banner. The DM sees the raiser ONLY in the live banner
    // (page.tsx, gated on isDm), never here — this row renders identically
    // for a DM client and a player client.
    case 'x_card':
      return {
        id,
        ts,
        who: 'Table',
        kind: 'system',
        text: '(A safety signal was raised — the table eases off.)',
        ...seqField,
      };

    // opening_narrated: not a plain row — the caller reconstructs the
    // read-aloud block (or a compact marker) from current grounding (§6.4).
    // recap: the AI "previously on…" summary is persisted under its own kind
    // (not 'narration') and is surfaced by the SessionRecap card, so it is
    // intentionally dropped here rather than duplicated into the transcript
    // (TAV-7). rebind / session_start / session_created / unknown kinds:
    // structural or forward-compatible — skipped so a future event kind can't
    // crash the log.
    default:
      return null;
  }
}
