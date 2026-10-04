/**
 * B8c-3 M2b (Sora's brief 3a, the coordinator's addendum, Iro's ruling 2) — observers hear a move: one story-log row per creature per turn, written when the turn passes.
 * The pure `moveRows(seen, state)`; the effect that appends them is `useBoard`'s (play.board-rows.test.tsx).
 *
 * Mutations seen red (each one line, run in this suite):
 *   - flush on EVERY state (drop the `seen.turn === turn` early return)            -> "none inside a turn" and "a move, an attack and a second move" go red
 *   - the first state not seeded (return `{ rows: [], seen: null }` on the first)  -> "a reload replays nothing" and "none on the first state" go red
 *   - the cap removed                                                              -> "seven in one flush" goes red
 *   - the sentence stating a number                                                -> "never states a number" goes red
 */
import type { CombatParticipantState, CombatSpace, CombatState, SpaceCoordinate } from '@/lib/api/types';
import { MOVE_ROWS_COLLAPSED, MOVE_ROWS_PER_FLUSH_MAX, accountMove, moveRowText, moveRows, type MoveSeen } from '@/lib/dnd/moveRows';

const SPACE: CombatSpace = { kind: 'square', width: 13, height: 7, cell: { value: 5, unit: 'ft' }, blocked: [], features: [] };

const who = (id: string, name: string, at: SpaceCoordinate | null): CombatParticipantState =>
  ({ participant_id: id, entity_id: id, name, is_pc: id.startsWith('p'), initiative: 10, hp_current: 7, hp_max: 7, ac: 12, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false, at, movement_remaining: 30 }) as unknown as CombatParticipantState;

function state(o: { round?: number; active?: string; at?: Record<string, SpaceCoordinate | null>; space?: CombatSpace | null | 'absent'; state?: string; combat?: string; extra?: CombatParticipantState[] } = {}): CombatState {
  const at = { p1: [1, 3], g1: [9, 3], ...(o.at ?? {}) } as Record<string, SpaceCoordinate | null>;
  const s = {
    combat_id: o.combat ?? 'c1', session_id: 's1', round: o.round ?? 1, state: o.state ?? 'active', turn_index: 0, active_participant_id: o.active ?? 'p1', initiative: ['p1', 'g1'],
    participants: [who('p1', 'Kestrel Ashwood', at.p1), who('g1', 'Goblin Skulker', at.g1), ...(o.extra ?? [])],
  } as unknown as CombatState & { space?: unknown };
  if (o.space !== 'absent') s.space = o.space === undefined ? SPACE : o.space;
  return s;
}

/** Feed a sequence of states through, as the effect does; returns every row in order. */
function run(states: CombatState[], from: MoveSeen | null = null): { rows: string[]; seen: MoveSeen | null } {
  let seen = from;
  const rows: string[] = [];
  for (const st of states) {
    const r = moveRows(seen, st);
    rows.push(...r.rows);
    seen = r.seen;
  }
  return { rows, seen };
}

describe('moveRowText: the words, and no number', () => {
  it('is "<name> moves." and states no number it cannot know, for any name', () => {
    expect(moveRowText('Kestrel Ashwood')).toBe('Kestrel Ashwood moves.');
    expect(moveRowText('Goblin Skulker')).not.toMatch(/\d/);
    // the function takes a NAME and nothing else: it has no way to state feet, squares or a distance
    expect(moveRowText.length).toBe(1);
    expect(moveRowText('x')).not.toMatch(/ft|feet|square|\d/i);
  });
});

describe('moveRows: one row per creature per turn, when the turn passes', () => {
  it('the first state a page sees writes nothing and accounts for every square (a reload replays nothing)', () => {
    const r = moveRows(null, state());
    expect(r.rows).toEqual([]);
    expect(r.seen).toEqual({ combatId: 'c1', turn: '1|p1', at: { p1: [1, 3], g1: [9, 3] } });
    // a reload mid-fight with creatures long since moved: still nothing
    expect(run([state({ at: { p1: [4, 4] } })]).rows).toEqual([]);
  });

  it('inside a turn nothing is written, however far a creature goes', () => {
    const r = run([state(), state({ at: { p1: [2, 3] } }), state({ at: { p1: [3, 3] } }), state({ at: { p1: [6, 3] } })]);
    expect(r.rows).toEqual([]);
    expect(r.seen?.at.p1).toEqual([1, 3]); // still the square accounted for at the start of the turn
  });

  it('a move, an attack and a second move in one turn are ONE row, written in the poll that shows the turn passing', () => {
    const r = run([state(), state({ at: { p1: [2, 3] } }), state({ at: { p1: [2, 3] } }), state({ at: { p1: [5, 3] } }), state({ active: 'g1', at: { p1: [5, 3] } })]);
    expect(r.rows).toEqual(['Kestrel Ashwood moves.']);
    // and no second row when the next turn passes with nothing moved
    expect(run([state({ active: 'g1', at: { p1: [5, 3] } }), state({ round: 2, active: 'p1', at: { p1: [5, 3] } })], r.seen).rows).toEqual([]);
  });

  it('an out-and-back in one turn writes no row (silence is acceptable, a wrong statement is not)', () => {
    expect(run([state(), state({ at: { p1: [4, 3] } }), state({ active: 'g1', at: { p1: [1, 3] } })]).rows).toEqual([]);
  });

  it('each creature that moved gets its own row, in the state\'s order, on a boundary', () => {
    const r = run([state(), state({ active: 'g1', at: { p1: [2, 3], g1: [8, 3] } })]);
    expect(r.rows).toEqual(['Kestrel Ashwood moves.', 'Goblin Skulker moves.']);
  });

  it('a creature placed for the first time, or taken off the board, writes no row (a placement is not a move)', () => {
    const placed = run([state({ at: { g1: null } }), state({ active: 'g1', at: { g1: [9, 3] } })]);
    expect(placed.rows).toEqual([]);
    const removed = run([state(), state({ active: 'g1', at: { g1: null } })]);
    expect(removed.rows).toEqual([]);
    // a creature that joins the fight (not in `seen`) is accounted for, silently
    const joined = run([state(), state({ active: 'g1', extra: [who('g2', 'Goblin Archer', [10, 4])] })]);
    expect(joined.rows).toEqual([]);
    expect(joined.seen?.at.g2).toEqual([10, 4]);
  });

  it('the fight ending flushes once (a creature that moved in the last turn is heard), and the ended state again writes nothing', () => {
    const ended = state({ state: 'ended', active: undefined, at: { g1: [8, 3] } });
    const r = run([state(), ended]);
    expect(r.rows).toEqual(['Goblin Skulker moves.']);
    expect(run([ended], r.seen).rows).toEqual([]);
  });

  it('a tab that was hidden across several turns writes the diff once: one row per creature, or the single collapsed row past the cap', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => who(`m${i}`, `Wolf ${i}`, [i, 0]));
    const moved = (n: number) => many(n).map((p) => ({ ...p, at: [p.at![0], 1] as SpaceCoordinate }));
    const a = state({ extra: many(7) });
    const b = (n: number) => state({ round: 3, active: 'g1', extra: [...moved(n), ...many(7).slice(n)] });
    expect(run([a, b(MOVE_ROWS_PER_FLUSH_MAX)]).rows).toEqual(Array.from({ length: MOVE_ROWS_PER_FLUSH_MAX }, (_, i) => `Wolf ${i} moves.`));
    expect(run([a, b(MOVE_ROWS_PER_FLUSH_MAX + 1)]).rows).toEqual([MOVE_ROWS_COLLAPSED]);
    expect(MOVE_ROWS_PER_FLUSH_MAX).toBe(6);
  });

  it('nothing is written, and nothing remembered, for a fight that is not served with a usable board: no `space` key, `space: null`, a malformed board', () => {
    for (const space of ['absent', null, { ...SPACE, cell: null } as unknown as CombatSpace, { ...SPACE, width: 0 }] as const) {
      const r = run([state({ space }), state({ space, active: 'g1', at: { p1: [6, 3] } })]);
      expect(r.rows).toEqual([]);
      expect(r.seen).toBeNull();
    }
    // a board that APPEARS later is a first state, not a diff against nothing
    const first = moveRows(null, state({ active: 'g1', at: { p1: [6, 3] } }));
    expect(first.rows).toEqual([]);
    expect(first.seen).not.toBeNull();
  });

  it('another fight is a first state, never a diff against the last one', () => {
    const r = run([state(), state({ combat: 'c2', active: 'g1', at: { p1: [9, 9] } })]);
    expect(r.rows).toEqual([]);
    expect(r.seen?.combatId).toBe('c2');
  });

  it('applying the same state twice (a strict-mode double effect, a poll that changed nothing) never writes a second row', () => {
    const boundary = state({ active: 'g1', at: { p1: [3, 3] } });
    const once = run([state(), boundary]);
    expect(once.rows).toEqual(['Kestrel Ashwood moves.']);
    expect(run([boundary, boundary], once.seen).rows).toEqual([]);
  });
});

describe('accountMove: the mover\'s own landed move is accounted for, so the boundary writes it no second row (M3)', () => {
  it('after accounting, the turn passing writes no row for the mover; without it the boundary writes one (the control); another creature that moved still writes its own', () => {
    const start = moveRows(null, state()).seen as MoveSeen;
    const moved = state({ at: { p1: [4, 3] } });
    const boundary = state({ active: 'g1', at: { p1: [4, 3], g1: [8, 3] } });
    expect(moveRows(start, boundary).rows).toEqual(['Kestrel Ashwood moves.', 'Goblin Skulker moves.']); // the control: nothing accounted
    const accounted = accountMove(start, 'p1', [4, 3]) as MoveSeen;
    expect(moveRows(accounted, moved).rows).toEqual([]);
    expect(moveRows(accounted, boundary).rows).toEqual(['Goblin Skulker moves.']);
    expect(accountMove(null, 'p1', [1, 1])).toBeNull();
  });
});
