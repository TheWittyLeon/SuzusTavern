// src/components/tactical-map/conditions.ts
//
// "Worst" condition ordering for the map's single-badge token display
// (Leon's T2 ruling on [[2026-09-27 Tactical Map (#12) — Design Pass v1
// (Aoi-UI)]]: "Top" — one badge per token showing only the most severe
// ACTIVE condition; the full list is available on focus/tap, see
// TacticalMap.tsx's per-token `title`/expanded-name wiring).
//
// SOURCE CHECKED, NOT FOUND: neither the engine's canonical vocabulary
// (`NekoNova-DnDEngine/engine/rules.py::CONDITIONS`, 21 entries) nor its
// Tavern mirror (`src/lib/conditions.ts::DND_CONDITIONS`, byte-identical)
// carries a severity/weight field — both are flat, unordered lists (grep-
// confirmed against both files, 2026-09-28). The movement design's own §3.3
// names the durable extension point for this exact need
// (`ConditionSpec.effects[...]` on the RulesSystem registry) and states it
// plainly: that registry ships OFF by default
// (`SUZU_DND_RULES_SYSTEM_REGISTRY`), so it is not a live source to import
// from today. This ordering is therefore an authored constant standing in
// for that field, not sourced engine data.
//
// debt: condition severity order is a hand-authored constant, not sourced
// from an engine severity field. ceiling: covers exactly the 21 conditions
// in engine/rules.py::CONDITIONS / src/lib/conditions.ts::DND_CONDITIONS; an
// unlisted condition is treated as lowest severity, never throws. until: a
// conditions content-catalog row (or `ConditionSpec`, movement design §3.3)
// carries a severity/weight field the engine projects on the wire.
export const CONDITION_SEVERITY_ORDER: readonly string[] = [
  // Removes agency / most likely to be lethal this turn.
  'unconscious',
  'petrified',
  'paralyzed',
  'stunned',
  'incapacitated',
  'restrained',
  'grappled',
  'blinded',
  // Exhaustion: worse level first (6 = death per SRD stacking rules).
  'exhaustion_6',
  'exhaustion_5',
  'exhaustion_4',
  'exhaustion_3',
  'exhaustion_2',
  'exhaustion_1',
  'frightened',
  'poisoned',
  'charmed',
  'deafened',
  'prone',
  // "dodge" is not a formal SRD condition (engine/rules.py's own comment) —
  // it's the lowest-severity entry, an intentional self-elected combat
  // state rather than an affliction.
  'dodge',
];

/**
 * Returns the single most severe condition in `conditions` per
 * `CONDITION_SEVERITY_ORDER`, or `undefined` for an empty list. A condition
 * absent from the ordering (an engine vocabulary addition this constant
 * hasn't caught up to) sorts last — never throws, never hides the token's
 * OTHER conditions, which the caller still has access to via the full list.
 */
export function worstCondition(conditions: readonly string[]): string | undefined {
  if (conditions.length === 0) return undefined;
  let best: string | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const raw of conditions) {
    const lower = raw.toLowerCase();
    const idx = CONDITION_SEVERITY_ORDER.indexOf(lower);
    const rank = idx === -1 ? CONDITION_SEVERITY_ORDER.length : idx;
    if (rank < bestRank) {
      bestRank = rank;
      best = raw;
    }
  }
  return best;
}
