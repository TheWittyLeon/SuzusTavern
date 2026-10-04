import { useState } from 'react';
import type { CombatParticipantState } from '@/lib/api/types';

/**
 * HP each player character was last seen ALIVE with (hp_current > 0) by this
 * tab, keyed by participant_id. Revive's default: "the HP they had before they
 * fell". A character who drops to 0 and then dies keeps the last value above
 * zero; a tab that never saw them alive has no entry (the caller falls back to 1).
 *
 * Derived state, updated during render (the React-sanctioned "adjust state on
 * prop change" shape), so no effect or ref write is involved. Returns the same
 * object until a value actually changes.
 */
export function useLastAliveHp(
  participants: readonly CombatParticipantState[],
): Readonly<Record<string, number>> {
  const [seen, setSeen] = useState<Record<string, number>>({});
  let next: Record<string, number> | null = null;
  for (const p of participants) {
    if (p.is_pc && p.is_alive && p.hp_current > 0 && seen[p.participant_id] !== p.hp_current) {
      next ??= { ...seen };
      next[p.participant_id] = p.hp_current;
    }
  }
  if (next) setSeen(next);
  return next ?? seen;
}
