/**
 * DDX-22 Phase 0 — Journal / Memory pane data derivation.
 *
 * Pure, side-effect-free functions that turn the play page's EXISTING
 * `session_events` array (from `getSessionEventsRaw` — already fetched by
 * rehydration on mount + the 4s events poll, see page.tsx) into the three
 * event-sourced Journal sections. No network calls here and no new poll —
 * see the design doc (`DDX-22 Journal Memory Pane Design.md` §2) for the
 * verified data-source map this mirrors:
 *
 *   Quest trail   -> `scene_advance` events, `data.description`
 *   Recap history -> `recap`-kind events, `data.text` (+ optional `data.who`)
 *   NPCs met      -> union of every event's `data.npcs_introduced` (first-seen
 *                    order) plus the current-scene grounding NPCs
 *
 * All three derivations sort defensively by `seq` ascending first — the
 * engine's GET /events has no ordering guarantee (the play page's own mount
 * rehydration re-sorts for the same reason) — so callers may pass events in
 * any order, including raw poll responses.
 */
import type { EngineSessionEvent, SceneNpc } from '@/lib/api/types';
import { decodeHtmlEntities } from '@/lib/rehydration';

export interface QuestTrailEntry {
  id: string;
  text: string;
}

export interface RecapEntry {
  id: string;
  who: string;
  text: string;
}

function sortBySeq(events: EngineSessionEvent[]): EngineSessionEvent[] {
  return [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

/** Quest log trail — every `scene_advance` event's `data.description`, oldest
 *  first (matches the main transcript's own chronological reading order).
 *  Skips entries with no description, mirroring `eventToLogRow`'s convention
 *  for the same event kind. */
export function deriveQuestTrail(events: EngineSessionEvent[]): QuestTrailEntry[] {
  const out: QuestTrailEntry[] = [];
  for (const e of sortBySeq(events)) {
    if (e.kind !== 'scene_advance') continue;
    const raw = e.data?.['description'];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    out.push({ id: `quest-${e.seq ?? out.length}`, text: decodeHtmlEntities(raw) });
  }
  return out;
}

/** Recap history — durable `recap`-kind events (the "previously on…" summary
 *  SessionRecap requests each mount — see api/routes/narration.py's
 *  `_persist_narration`), oldest first. `data.who` is optional on the wire
 *  (defaults to 'Suzu', matching `eventToLogRow`'s narration fallback) even
 *  though the current writer always stamps "Suzu" — forward-compatible with
 *  a future human-authored recap. Skips entries with no text. */
export function deriveRecapHistory(events: EngineSessionEvent[]): RecapEntry[] {
  const out: RecapEntry[] = [];
  for (const e of sortBySeq(events)) {
    if (e.kind !== 'recap') continue;
    const rawText = e.data?.['text'];
    if (typeof rawText !== 'string' || !rawText.trim()) continue;
    const rawWho = e.data?.['who'];
    const who =
      typeof rawWho === 'string' && rawWho.trim() ? decodeHtmlEntities(rawWho) : 'Suzu';
    out.push({ id: `recap-${e.seq ?? out.length}`, who, text: decodeHtmlEntities(rawText) });
  }
  return out;
}

/**
 * NPCs met — union of every event's `data.npcs_introduced` (a list of names
 * stamped by `_persist_narration` via `dm_narrator.npcs_first_introduced`,
 * see api/routes/narration.py in ProjectNekoNova) in first-seen order, PLUS
 * the current-scene grounding NPCs not already present.
 *
 * Scans EVERY event's `data.npcs_introduced` regardless of `kind` (not just
 * `narration`) — the persisted shape can carry the stamp on a `recap` event
 * too (the writer computes it unconditionally before branching on kind), so
 * gating strictly on kind==='narration' would silently under-count.
 *
 * Caveat (documented in the design doc, not a bug): `npcs_introduced` is only
 * stamped for AI-DM sessions with grounded prompting on. A solo/human-DM
 * session's only source is the grounding fallback below — expected to be
 * shallow (current scene only) for Phase 0.
 *
 * Dedup is case-insensitive (so "Zecora" and a stray "zecora" collapse to one
 * entry) but preserves the FIRST-seen casing for display.
 */
export function deriveNpcsMet(
  events: EngineSessionEvent[],
  sceneNpcs?: SceneNpc[] | null,
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  const add = (raw: string) => {
    const name = decodeHtmlEntities(raw).trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };

  for (const e of sortBySeq(events)) {
    const introduced = e.data?.['npcs_introduced'];
    if (!Array.isArray(introduced)) continue;
    for (const n of introduced) {
      if (typeof n === 'string') add(n);
    }
  }
  for (const npc of sceneNpcs ?? []) {
    if (npc && typeof npc.name === 'string') add(npc.name);
  }
  return names;
}
