/**
 * B8c-3 M2 / M2b — `useBoard`: what the page hands the stage's body, and the observers' move rows through the real effect.
 *   - `stage` is null when the state has no `space` key, when the fight is over, when there is no state, and when the row's stage has no body (the phone: F-k);
 *   - `label` names the body only when a BOARD is in it; the reach is shown to every seat all turn (T1): board room, active state, a mover with a square and a budget;
 *   - the rows: appended once at a turn boundary, never inside a turn, never on the first state, never twice for one state.
 * Mutations seen red: the child ungated from `stageHasBody` -> "no body"; the rows effect keyed on every render -> "never twice"; `showReach` read from `moveMode`-style input -> "reach".
 */
import { renderHook } from '@testing-library/react';
import type { CombatSpace, CombatState } from '@/lib/api/types';
import { useBoard, type UseBoardArgs } from '@/app/play/[sessionId]/hooks/useBoard';
import type { UseCombatStateResult } from '@/app/play/[sessionId]/hooks/useCombatState';

const SPACE: CombatSpace = { kind: 'square', width: 13, height: 7, cell: { value: 5, unit: 'ft' }, blocked: [], features: [] };

function st(o: { space?: unknown; active?: string; round?: number; at?: [number, number]; mr?: number | null; state?: string } = {}): CombatState {
  const at = o.at ?? [1, 3];
  return {
    combat_id: 'c1', session_id: 's1', round: o.round ?? 1, state: o.state ?? 'active', turn_index: 0, active_participant_id: o.active ?? 'p1', initiative: ['p1', 'w1'],
    participants: [
      { participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, hp_current: 10, hp_max: 10, conditions: [], is_alive: true, is_active_turn: (o.active ?? 'p1') === 'p1', at, movement_remaining: o.mr === undefined ? 30 : o.mr },
      { participant_id: 'w1', entity_id: 'g1', name: 'Timberwolf', is_pc: false, hp_current: 19, hp_max: 19, conditions: [], is_alive: true, is_active_turn: o.active === 'w1', at: [9, 3], movement_remaining: 30 },
    ],
    ...(o.space === 'absent' ? {} : { space: o.space === undefined ? SPACE : o.space }),
  } as unknown as CombatState;
}

const rescue = jest.fn();
type Over = Partial<Omit<UseBoardArgs, 'cs'>> & { combatIsActive?: boolean; combatBusy?: boolean; activeIsMine?: boolean };
/** The combat state hook's result as the board reads it: the state, the viewer's seat and the shared latch and writers. */
export function fakeCs(state: CombatState | null, over: Over = {}): UseCombatStateResult {
  return {
    combatState: state, combatIsActive: over.combatIsActive ?? (state != null && state.state !== 'ended'), selfPcId: 'p1', round: state?.round ?? null, combatId: 'c1', combatBusy: over.combatBusy ?? false,
    combatBusyRef: { current: false }, stateSeqRef: { current: 0 }, setCombatBusy: jest.fn(), setRefusedReason: jest.fn(), applyState: jest.fn(), refreshState: jest.fn(), activeIsMine: over.activeIsMine ?? true,
  } as unknown as UseCombatStateResult;
}
function args(state: CombatState | null, over: Over = {}): UseBoardArgs {
  const { combatIsActive, combatBusy, activeIsMine, ...rest } = over;
  return { cs: fakeCs(state, { combatIsActive, combatBusy, activeIsMine }), room: 'board', stageHasBody: true, sessionLocked: false, appendLog: jest.fn(), rescueStrandedFocus: rescue, railRef: { current: null }, ...rest };
}

describe('useBoard: stage and label', () => {
  it('a served board with a stage that has a body: the stage props and the group name', () => {
    const { result } = renderHook(() => useBoard(args(st())));
    expect(result.current.stage).toMatchObject({ viewerParticipantId: 'p1', activeParticipantId: 'p1', round: 1, showReach: true, rescueStrandedFocus: rescue });
    expect(result.current.stage?.participants).toHaveLength(2);
    expect(result.current.label).toBe('Tactical map');
  });

  it.each<[string, Over, CombatState | null]>([
    ['no `space` key (positioning off)', {}, st({ space: 'absent' })],
    ['no state yet', {}, null],
    ['the fight is over', { combatIsActive: false }, st({ state: 'ended' })],
    ['a stage with NO body (the phone row has none yet)', { stageHasBody: false }, st()],
  ])('stage is null: %s', (_n, over, state) => {
    const { result } = renderHook(() => useBoard(args(state, over)));
    expect(result.current.stage).toBeNull();
    expect(result.current.label).toBeUndefined();
  });

  it('`space: null` and a malformed board: a stage (the band) with NO name on the body', () => {
    for (const space of [null, { ...SPACE, cell: null }]) {
      const { result } = renderHook(() => useBoard(args(st({ space }), { room: 'band' })));
      expect(result.current.stage).not.toBeNull();
      expect(result.current.label).toBeUndefined();
    }
  });
});

describe('useBoard: the reach is shown to every seat, all turn (T1)', () => {
  const reach = (state: CombatState, over: Over = {}) => renderHook(() => useBoard(args(state, over))).result.current.stage?.showReach;
  it('board room, active state, a mover with a square and a budget', () => {
    expect(reach(st())).toBe(true);
    expect(reach(st({ active: 'w1' }))).toBe(true); // a monster's turn, on a player's seat: the reach is the monster's
  });
  it.each<[string, () => boolean | undefined]>([
    ['the band room', () => reach(st(), { room: 'band' })],
    ['no budget left', () => reach(st({ mr: 0 }))],
    ['a null budget', () => reach(st({ mr: null }))],
    ['between turns', () => reach(st({ state: 'between_turns' }))],
  ])('not drawn: %s', (_n, f) => expect(f()).toBe(false));
});

describe('useBoard: the observers\' rows, through the real effect', () => {
  it('written once at the boundary, never inside a turn, never on the first state, never twice for one state', () => {
    const appendLog = jest.fn();
    const { rerender } = renderHook(({ s }) => useBoard(args(s, { appendLog })), { initialProps: { s: st() } });
    expect(appendLog).not.toHaveBeenCalled(); // the first state
    rerender({ s: st({ at: [4, 3] }) }); // inside the turn
    rerender({ s: st({ at: [6, 3] }) });
    expect(appendLog).not.toHaveBeenCalled();
    const boundary = st({ active: 'w1', at: [6, 3] });
    rerender({ s: boundary });
    expect(appendLog).toHaveBeenCalledTimes(1);
    expect(appendLog).toHaveBeenCalledWith({ who: 'Suzu', kind: 'system', text: 'Anomaly moves.' });
    rerender({ s: boundary }); // the same state again (a re-render, a double effect)
    rerender({ s: { ...boundary } }); // a poll that changed nothing: a new object, the same facts
    expect(appendLog).toHaveBeenCalledTimes(1);
  });

  it('a state that is not served (no key, no state) writes nothing and forgets, so a board that appears later is a first state', () => {
    const appendLog = jest.fn();
    const { rerender } = renderHook(({ s }) => useBoard(args(s, { appendLog })), { initialProps: { s: st({ space: 'absent' }) as CombatState | null } });
    rerender({ s: st({ space: 'absent', active: 'w1', at: [6, 3] }) });
    rerender({ s: null });
    rerender({ s: st({ active: 'w1', at: [8, 3] }) });
    expect(appendLog).not.toHaveBeenCalled();
  });
});

describe('useBoard: the stage props are STABLE between renders that bring no new state (StageBoard is memoised on it)', () => {
  it('the same state, viewer, round and rescue give the SAME stage object; a new state object gives a new one', () => {
    const state = st();
    const a = args(state);
    const { result, rerender } = renderHook((p: UseBoardArgs) => useBoard(p), { initialProps: a });
    const first = result.current;
    rerender({ ...a, appendLog: jest.fn() }); // a page render with the same facts (an unstable appendLog identity is not a prop of the stage)
    expect(result.current).toBe(first);
    expect(result.current.stage).toBe(first.stage);
    rerender(args({ ...state }));
    expect(result.current.stage).not.toBe(first.stage);
  });
});
