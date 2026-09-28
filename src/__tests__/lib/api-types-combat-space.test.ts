/**
 * ENGINE-MOVEMENT-PLAYER-VISIBLE-COORDS, design step 6 (Tavern wire types,
 * no renderer — `SuzusTavern/.worktrees/movement-s6-0928`).
 *
 * Type-level proof, not runtime logic: `CombatState` gained `space` and
 * `CombatParticipantState` gained `at` / `movement_remaining`, all
 * optional/nullable per the requirement that today's engine payload (no
 * `space` at all) and every pre-existing fixture across the repo keep
 * compiling untouched. Two literals below are the contract:
 *
 *   1. a pre-feature payload — no `space`, no `at`, no `movement_remaining`
 *      — still satisfies `CombatState` (flag-off / today's wire, byte-shape
 *      identical to every existing fixture in this repo).
 *   2. a full movement payload — `space` + `at` + `movement_remaining` on
 *      every participant, per design §4.3's example body — also satisfies
 *      it, including an unplaced (`at: null`) participant.
 *
 * If either literal below stops compiling, `npx tsc --noEmit` fails the
 * build gate — that IS the test. The `expect` calls exist so Jest records a
 * pass/fail rather than a silent compile-only file, mirroring how this repo
 * has no other type-only test file to pattern-match (checked: no existing
 * `satisfies CombatState` / `@ts-expect-error` fixture anywhere in `src/`).
 */
import type {
  CombatState,
  CombatParticipantState,
  CombatSpace,
  SpaceCoordinate,
  SpaceKind,
} from '@/lib/api/types';

describe('api/types — CombatState.space / participant at+movement_remaining (design step 6)', () => {
  it('a pre-feature payload (no space, no at, no movement_remaining) satisfies CombatState', () => {
    const participant: CombatParticipantState = {
      participant_id: 'p1',
      entity_id: 'char-1',
      name: 'Bren',
      is_pc: true,
      initiative: 14,
      hp_current: 14,
      hp_max: 14,
      ac: 16,
      conditions: [],
      is_alive: true,
      can_be_targeted: true,
      is_active_turn: true,
      took_turn: false,
    };
    const state: CombatState = {
      combat_id: 'c1',
      session_id: 's1',
      round: 2,
      state: 'active',
      turn_index: 0,
      active_participant_id: 'p1',
      initiative: ['p1'],
      participants: [participant],
    };
    expect(state.space).toBeUndefined();
    expect(state.participants[0].at).toBeUndefined();
    expect(state.participants[0].movement_remaining).toBeUndefined();
  });

  it('a full movement payload (space + at + movement_remaining, one unplaced participant) satisfies CombatState — design §4.3', () => {
    const space: CombatSpace = {
      kind: 'square',
      width: 21,
      height: 8,
      cell: { value: 5, unit: 'ft' },
      blocked: [[3, 4]],
      features: [{ id: 'crates', kind: 'prop', label: 'Crates', at: [[6, 2], [6, 3]] }],
    };
    const at: SpaceCoordinate = [4, 6];
    const mover: CombatParticipantState = {
      participant_id: 'p1',
      entity_id: 'char-1',
      name: 'Bren',
      is_pc: true,
      initiative: 14,
      hp_current: 14,
      hp_max: 14,
      ac: 16,
      conditions: [],
      is_alive: true,
      can_be_targeted: true,
      is_active_turn: true,
      took_turn: false,
      action_available: true,
      bonus_action_available: true,
      reaction_available: true,
      at,
      movement_remaining: 25,
    };
    const unplaced: CombatParticipantState = {
      participant_id: 'p2',
      entity_id: 'goblin-1',
      name: 'Bandit',
      is_pc: false,
      initiative: 9,
      hp_current: 7,
      hp_max: 7,
      ac: 13,
      conditions: [],
      is_alive: true,
      can_be_targeted: true,
      is_active_turn: false,
      took_turn: false,
      at: null,
      movement_remaining: null,
    };
    const state: CombatState = {
      combat_id: 'c1',
      session_id: 's1',
      round: 2,
      state: 'active',
      turn_index: 0,
      active_participant_id: 'p1',
      initiative: ['p1', 'p2'],
      participants: [mover, unplaced],
      space,
    };
    expect(state.space?.kind).toBe('square');
    expect(state.participants[0].at).toEqual([4, 6]);
    expect(state.participants[0].movement_remaining).toBe(25);
    expect(state.participants[1].at).toBeNull();
    expect(state.participants[1].movement_remaining).toBeNull();
  });

  it('space is null-able (encounter authored none, or the flag is off) — design §5/§9.2', () => {
    const state: CombatState = {
      combat_id: 'c1',
      session_id: 's1',
      round: 1,
      state: 'active',
      turn_index: 0,
      active_participant_id: null,
      initiative: [],
      participants: [],
      space: null,
    };
    expect(state.space).toBeNull();
  });

  it('SpaceKind is square-only today (design M6/§1.2) — a second kind is a type-only addition, not a Tavern code change', () => {
    const kind: SpaceKind = 'square';
    expect(kind).toBe('square');
  });
});
