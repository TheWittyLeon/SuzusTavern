// src/lib/dnd/moveRows.ts
//
// B8c-3 M2b (Sora's mount brief 3a and the coordinator's addendum, Iro's ruling 2): observers hear a move.
//
// A poll carries each participant's `at` and the turn, and no message; a move writes no session event. So the Tavern builds the sentence, one function on every seat, and
// writes ONE story-log row per creature per turn, WHEN THE TURN PASSES: a creature that moves, attacks and moves again is one row; one that goes out and back in a turn is none
// (silence is acceptable, a wrong statement is not). The comparison is the square last ACCOUNTED FOR against the square now, so any number of steps in a turn coalesces by itself.
//
// Pure: `moveRows(seen, state)` returns the rows to append and the `seen` to keep. The thin effect that appends them is in hooks/useBoard.ts.
import type { CombatState, SpaceCoordinate } from '@/lib/api/types';
import { isFightEnded } from '@/lib/dnd/combatState';
import { coordsEqual, isSpaceUsable } from '@/components/tactical-map/reach';

/** More rows than this in ONE flush (a tab that was hidden across several turns) is a single row instead of a flood. */
export const MOVE_ROWS_PER_FLUSH_MAX = 6;

/** What several creatures moving in one flush read as. */
export const MOVE_ROWS_COLLAPSED = 'Several creatures move.';

/**
 * The words of an observer's row. One function, both seats: they read the same words by construction. It takes a NAME and nothing else, so it cannot state a number it does not know.
 * debt: the row says a creature moved and never how far (the first mount's sentence carries no feet: a straight-line figure under-reports a detour, and Iro holds the build for the engine's number).
 * ceiling: "Kestrel Ashwood moves." for any distance. until: Backlog ENGINE-STATE-MOVED-THIS-TURN lands (the engine projects feet moved this turn on the participant); the number then returns in this one expression.
 */
export function moveRowText(name: string): string {
  return `${name} moves.`;
}

/** What has been accounted for: the fight it belongs to, the turn it was last flushed at, and each creature's square then. */
export interface MoveSeen {
  combatId: string;
  /** `round|active participant`, or `ended`: a change is "the turn has passed". */
  turn: string;
  at: Record<string, SpaceCoordinate | null>;
}

function turnKey(state: CombatState): string {
  return isFightEnded(state) ? 'ended' : `${state.round}|${state.active_participant_id ?? ''}`;
}

function squares(state: CombatState): Record<string, SpaceCoordinate | null> {
  return Object.fromEntries(state.participants.map((p) => [p.participant_id, p.at ?? null]));
}

/**
 * The rows an applied state owes, and the `seen` to carry to the next one.
 *   - not served with a usable board (no `space` key, `space: null`, a malformed board): no rows, and nothing remembered (so a board that appears later is a first state);
 *   - the first state of a fight this page sees (`seen` null, or another fight): no rows, everything accounted for (a reload replays nothing);
 *   - inside a turn (the key `round|active` is the one last flushed): no rows, `seen` unchanged;
 *   - the turn has passed, or the fight has ended: one row for each creature whose square differs from the one accounted for, in the state's order; then every square is accounted for.
 *     A creature placed for the first time, or taken off the board, has no square on one side and writes no row. More than MOVE_ROWS_PER_FLUSH_MAX collapse to one row.
 */
export function moveRows(seen: MoveSeen | null, state: CombatState): { rows: string[]; seen: MoveSeen | null } {
  if (!('space' in state) || !isSpaceUsable(state.space)) return { rows: [], seen: null };
  const turn = turnKey(state);
  if (seen == null || seen.combatId !== state.combat_id) return { rows: [], seen: { combatId: state.combat_id, turn, at: squares(state) } };
  if (seen.turn === turn) return { rows: [], seen };
  const rows: string[] = [];
  for (const p of state.participants) {
    const was = seen.at[p.participant_id];
    if (was != null && p.at != null && !coordsEqual(was, p.at)) rows.push(moveRowText(p.name));
  }
  return {
    rows: rows.length > MOVE_ROWS_PER_FLUSH_MAX ? [MOVE_ROWS_COLLAPSED] : rows,
    seen: { combatId: state.combat_id, turn, at: squares(state) },
  };
}

/**
 * The mover's own seat (B8c-3 M3): its landed move writes ITS row at the 200, so the square is ACCOUNTED FOR then: the boundary that follows compares against it and writes no second row
 * for the same creature. A `seen` that does not exist yet (no state seeded) stays absent; the hook never invents one.
 */
export function accountMove(seen: MoveSeen | null, participantId: string, to: SpaceCoordinate): MoveSeen | null {
  return seen ? { ...seen, at: { ...seen.at, [participantId]: to } } : seen;
}
