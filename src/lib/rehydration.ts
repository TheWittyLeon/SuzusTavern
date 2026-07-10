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
  };
}

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
 *   anything else (rebind, session_start, session_created, unknown kinds)
 *                              -> null (structural/forward-compatible skip)
 *
 * The row's `id` is derived from `seq` so rehydrated rows never collide with
 * live-appended `r${n}` ids (idRef counter in page.tsx).
 */
export function eventToLogRow(e: EngineSessionEvent): LogRow | null {
  const data = e.data ?? null;
  const text = (data?.['text'] as string | undefined) || undefined;
  const who = (data?.['who'] as string | undefined) || undefined;
  const id = `ev${e.seq ?? `${e.kind ?? 'unknown'}-${e.created_at ?? ''}`}`;
  const ts = formatEventTimestamp(e.created_at);

  switch (e.kind) {
    case 'player_action':
      if (!text) return null;
      return { id, ts, who: who ?? e.actor ?? 'You', kind: 'player', text, color: 'var(--accent)' };

    case 'narration':
      if (!text) return null;
      return { id, ts, who: who ?? 'Suzu', kind: 'narration', text };

    case 'dm_narration':
      if (!text) return null;
      return { id, ts, who: who ?? e.actor ?? 'DM', kind: 'dm_narration', text };

    case 'scene_advance':
    case 'encounter_resolved':
    case 'check_resolved': {
      const description = (data?.['description'] as string | undefined) || undefined;
      if (!description) return null;
      return { id, ts, who: 'Suzu', kind: 'system', text: description };
    }

    case 'dice_roll':
      return diceRollLogRow(e);

    // opening_narrated: not a plain row — the caller reconstructs the
    // read-aloud block (or a compact marker) from current grounding (§6.4).
    // rebind / session_start / session_created / unknown kinds: structural or
    // forward-compatible — skipped so a future event kind can't crash the log.
    default:
      return null;
  }
}
