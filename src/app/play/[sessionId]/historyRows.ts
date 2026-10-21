/**
 * The transcript rows a stretch of the event log becomes — ONE builder for the mount's
 * rehydration and for the poll tick that heals a cut-off mount read
 * (TAV-HEAL-SHARES-MOUNT-ROW-BUILDER), so what the heal draws is what the mount would have.
 */
import type { LogRow } from '@/components/ChatLog';
import type { EngineSessionEvent, GroundingData } from '@/lib/api/types';
import { eventToLogRow, formatEventTimestamp } from '@/lib/rehydration';
import { buildReadAloudBlock } from './format';

/** Rows for `events` (oldest first). `g` is the CURRENT grounding, for `opening_narrated`. */
export function buildHistoryRows(events: EngineSessionEvent[], g: GroundingData | null): LogRow[] {
  const rows: LogRow[] = [];
  for (const e of events) {
    if (e.kind === 'opening_narrated') {
      // §6.4 — reconstruct the verbatim read-aloud from CURRENT grounding, but only while the
      // player is still on the scene it was shown for; if they've advanced, the (different)
      // current boxed_text would misrepresent it as "the opening", so a compact marker instead.
      const openingSceneId = (e.data?.['scene_id'] as string | undefined) || undefined;
      const ts = formatEventTimestamp(e.created_at);
      if (g && openingSceneId && openingSceneId === g.scene_id) {
        rows.push({ id: `ev${e.seq ?? 'opening'}-read-aloud`, ts, who: 'Scene', kind: 'read_aloud', text: buildReadAloudBlock(g) });
        // TAV-HISTORYROWS-DUP-SPEAKER-KEY: the id is the line's position, not its speaker — one NPC
        // can speak twice in a scene, and ChatLog keys on this id.
        (g.opening_lines ?? []).forEach((line, i) => {
          rows.push({ id: `ev${e.seq ?? 'opening'}-line-${i}`, ts, who: line.speaker_display_name, kind: 'read_aloud_line', text: line.line });
        });
      } else if (g) {
        rows.push({ id: `ev${e.seq ?? 'opening'}-marker`, ts, who: 'Scene', kind: 'system', text: `— ${g.adventure_title ?? 'the adventure'} · opening —` });
      }
      continue;
    }
    const row = eventToLogRow(e);
    if (row) rows.push(row);
  }
  return rows;
}

/** Rows built from the log have ids `ev…`; rows this page appended itself (a turn, the opening) do not. */
const isLive = (r: LogRow) => !r.id.startsWith('ev');
const sameLine = (r: LogRow) => `${r.kind}\u0000${r.text}`;

/**
 * Fold the heal's rows into a transcript that may already hold this page's own turns: history goes
 * BEFORE the first row the page appended, and a healed row that one of those live rows already
 * shows (same kind and text; one healed row per live row) is dropped, so a turn taken
 * while the heal was pending is drawn once. A healed row whose id the log already holds is dropped too:
 * a history row's id is its event's, so "an event is drawn once" is a property of the merge, not of
 * timing (a tick that read the log before the mount drew it must not draw it a second time).
 *
 * debt: the live-turn match is by line content, because a live row carries no event seq. ceiling: a live narration the server stored truncated or re-escaped is drawn a second time; an identical older line is dropped once per live row (the mount's seed merges through here too: a history line equal to a live row's is drawn once, in the live row's place). until: live rows are stamped with their event's seq.
 */
export function mergeHealedRows(log: LogRow[], healed: LogRow[]): LogRow[] {
  const drawn = new Set(log.map((r) => r.id));
  const liveLines = new Map<string, number>();
  for (const r of log) if (isLive(r)) liveLines.set(sameLine(r), (liveLines.get(sameLine(r)) ?? 0) + 1);
  const fresh: LogRow[] = [];
  for (const r of [...healed].reverse()) {
    if (drawn.has(r.id)) continue;
    const left = liveLines.get(sameLine(r)) ?? 0;
    if (left > 0) liveLines.set(sameLine(r), left - 1);
    else fresh.unshift(r);
  }
  const at = log.findIndex(isLive);
  return at < 0 ? [...log, ...fresh] : [...log.slice(0, at), ...fresh, ...log.slice(at)];
}
