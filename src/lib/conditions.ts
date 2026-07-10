/**
 * T7 (DDX-17e) — shared condition helpers for the combat UI.
 *
 * DND_CONDITIONS mirrors NekoNova-DnDEngine's `engine/rules.py::CONDITIONS`
 * canonical list byte-for-byte. There is no catalog endpoint that exposes this
 * list yet (the `condition` content-catalog rows from DDX-21 are rules-text
 * only and currently empty on suzu_dnd_dev — see CatalogConditionData in
 * lib/api/types.ts), so it's kept in sync by hand. If the engine list changes,
 * update this array to match.
 *
 * "dodge" isn't a formal SRD condition but IS a value the engine's
 * `cmd_apply_condition`/`cmd_remove_condition` accept (it's how the Dodge
 * action's disadvantage-on-attackers is tracked) — kept in the picker for
 * parity; a DM applying/removing it manually is an edge case, not an error.
 */
export const DND_CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'dodge',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
  'exhaustion_1',
  'exhaustion_2',
  'exhaustion_3',
  'exhaustion_4',
  'exhaustion_5',
  'exhaustion_6',
] as const;

export type DndCondition = (typeof DND_CONDITIONS)[number];

/** "exhaustion_3" -> "Exhaustion 3"; "poisoned" -> "Poisoned". */
export function formatConditionName(condition: string): string {
  const spaced = condition.replace(/_/g, ' ').trim();
  if (spaced.length === 0) return condition;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Chip label including rounds-remaining when known: "Poisoned · 3". Bare name
 *  when the condition has no tracked duration (indefinite, per engine contract). */
export function conditionChipLabel(condition: string, roundsRemaining?: number): string {
  const name = formatConditionName(condition);
  return roundsRemaining != null ? `${name} · ${roundsRemaining}` : name;
}
