/**
 * B8c-3 M2 / M2b — `useBoard`: what the page hands the stage's body, and the observers' move rows through the real effect.
 *   - `stage` is null when the state has no `space` key, when the fight is over, when there is no state, and when the row's stage has no body (the phone: F-k);
 *   - `label` names the body only when a BOARD is in it; the reach is shown to every seat all turn (T1): board room, active state, a mover with a square and a budget;
 *   - the rows: appended once at a turn boundary, never inside a turn, never on the first state, never twice for one state.
 * Mutations seen red: the child ungated from `stageHasBody` -> "no body"; the rows effect keyed on every render -> "never twice"; `showReach` read from `moveMode`-style input -> "reach".
 */
jest.mock('../../lib/api/dnd', () => ({ ...jest.requireActual('../../lib/api/dnd'), moveToken: jest.fn() }));

import { act, renderHook } from '@testing-library/react';
import { moveToken } from '@/lib/api/dnd';
import { makeApiError } from '@/lib/api/client';
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
  return { cs: fakeCs(state, { combatIsActive, combatBusy, activeIsMine }), room: 'board', stageHasBody: true, moveAllowed: true, sessionLocked: false, appendLog: jest.fn(), rescueStrandedFocus: rescue, railRef: { current: null }, ...rest };
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

describe('useBoard: the Move contracts that no other pin held (B8c-3 fix round: Kage 3, Miko 3, Tora gate)', () => {
  const mv = moveToken as jest.Mock;
  beforeEach(() => mv.mockReset());
  const refuseWith = (reason: string, status = 400) => makeApiError(status, reason, { success: false, data: { reason } });
  /** Arms Move and commits one step; returns the harness so a test can read what the hook did. */
  async function step(state: CombatState, over: Over = {}, to: [number, number] = [2, 3]) {
    const a = args(state, over);
    const hook = renderHook(() => useBoard(a));
    act(() => hook.result.current.bar?.onToggle());
    await act(async () => { await hook.result.current.stage?.onMove(to); });
    return { a, hook, cs: a.cs };
  }

  it('Move is OFFERED only where the row opts in: `moveAllowed: false` (the phone row) has no Move though the stage has a body and the creature a budget', () => {
    const on = renderHook(() => useBoard(args(st()))).result.current;
    const off = renderHook(() => useBoard(args(st(), { moveAllowed: false }))).result.current;
    expect(on.bar).toBeDefined();
    expect(off.stage).not.toBeNull(); // the body is still served: only the verb is withheld
    expect(off.bar).toBeUndefined();
  });

  it('disabled while the session is locked, and while a verb is in flight; enabled otherwise', () => {
    const bar = (over: Over) => renderHook(() => useBoard(args(st(), over))).result.current.bar;
    expect(bar({})?.disabled).toBe(false);
    expect(bar({ sessionLocked: true })?.disabled).toBe(true);
    expect(bar({ combatBusy: true })?.disabled).toBe(true);
  });

  it('a numeric pair is sent; a garbage `at` sends nothing and takes no latch', async () => {
    const ok = await step(st());
    expect(mv).toHaveBeenCalledWith('c1', { participant_id: 'p1', from: [1, 3], to: [2, 3] });
    mv.mockClear();
    for (const at of [['a', 3], [1], [1, 3, 5], [NaN, 3], 'x']) {
      const bad = await step(st({ at: at as never }), {}, [2, 3]);
      expect(mv).not.toHaveBeenCalled();
      expect(bad.cs.combatBusyRef.current).toBe(false);
    }
    expect(ok.cs.combatBusyRef.current).toBe(false);
  });

  it('the latch is released after a move (a second move in the same turn goes out) and after a refusal', async () => {
    mv.mockResolvedValue({ message: 'x', state: st({ at: [2, 3] }) });
    const a = args(st());
    const { result } = renderHook(() => useBoard(a));
    await act(async () => { await result.current.stage?.onMove([2, 3]); });
    expect(a.cs.combatBusyRef.current).toBe(false);
    await act(async () => { await result.current.stage?.onMove([3, 3]); });
    expect(mv).toHaveBeenCalledTimes(2);
    mv.mockRejectedValueOnce(refuseWith('invalid_destination'));
    await act(async () => { await result.current.stage?.onMove([4, 3]); });
    expect(a.cs.combatBusyRef.current).toBe(false);
  });

  it('Move\'s reason has a SOURCE here (the bar\'s described form reads it): no feet left says "No movement left", a move in flight says "Moving…", an open Move says nothing (Iro m-3)', async () => {
    const bar = (over: Over, state = st()) => renderHook(() => useBoard(args(state, over))).result.current.bar;
    expect(bar({}, st({ mr: 0 }))).toMatchObject({ disabled: true, reason: 'No movement left' });
    expect(bar({})?.reason).toBeUndefined();
    expect(bar({ sessionLocked: true })?.reason).toBeUndefined(); // locked for another reason: the turn line or nothing says why
    mv.mockReturnValue(new Promise(() => {})); // a move that never answers: in flight
    const a = args(st());
    const hook = renderHook(() => useBoard(a));
    act(() => hook.result.current.bar?.onToggle());
    act(() => { void hook.result.current.stage?.onMove([2, 3]); });
    expect(hook.result.current.bar).toMatchObject({ disabled: true, reason: 'Moving…' });
  });

  it('a 200 WITHOUT `state`: no row, no `movedSeq`, the state is re-read (the poll\'s diff writes the row once the square changes)', async () => {
    mv.mockResolvedValue({ message: 'x' });
    const { a, hook, cs } = await step(st());
    expect(a.appendLog).not.toHaveBeenCalled();
    expect(cs.refreshState).toHaveBeenCalledTimes(1);
    expect(cs.applyState).not.toHaveBeenCalled();
    expect(hook.result.current.stage?.movedSeq).toBe(0);
  });

  it('a 200 WITH `state`: the state is applied, ONE row, `movedSeq` bumps', async () => {
    mv.mockResolvedValue({ message: 'x', state: st({ at: [2, 3] }) });
    const { a, hook, cs } = await step(st());
    expect(cs.applyState).toHaveBeenCalledTimes(1);
    expect(a.appendLog).toHaveBeenCalledTimes(1);
    expect(hook.result.current.stage?.movedSeq).toBe(1);
  });

  // The set of refusals that END Move; anything else keeps it armed. Each member is pinned by name, so adding or dropping one is a visible change here.
  it.each(['no_movement_remaining', 'not_your_turn', 'no_active_turn', 'mover_unplaced', 'no_space', 'positioning_disabled', 'not_found'])('%s disarms Move', async (reason) => {
    mv.mockRejectedValue(refuseWith(reason, reason === 'not_found' || reason === 'positioning_disabled' ? 404 : 400));
    const { hook } = await step(st());
    expect(hook.result.current.bar?.pressed).toBe(false);
  });
  it.each(['position_changed', 'invalid_destination', 'same_cell', 'some_future_reason'])('%s keeps Move armed', async (reason) => {
    mv.mockRejectedValue(refuseWith(reason, reason === 'position_changed' ? 409 : 400));
    const { hook } = await step(st());
    expect(hook.result.current.bar?.pressed).toBe(true);
  });

  it('only the board-gone refusals re-read the state (positioning_disabled, not_found); a budget refusal does not', async () => {
    const reread = async (reason: string, status: number) => {
      mv.mockReset().mockRejectedValue(refuseWith(reason, status));
      return (await step(st())).cs.refreshState as jest.Mock;
    };
    expect(await reread('positioning_disabled', 404)).toHaveBeenCalledTimes(1);
    expect(await reread('not_found', 404)).toHaveBeenCalledTimes(1);
    expect(await reread('no_movement_remaining', 400)).not.toHaveBeenCalled();
    expect(await reread('position_changed', 409)).not.toHaveBeenCalled();
  });

  it('the armed intent resets when the turn passes and does NOT come back when the turn returns', () => {
    let state = st();
    const a = args(state);
    const { result, rerender } = renderHook(({ s }: { s: CombatState }) => useBoard({ ...a, cs: fakeCs(s, { activeIsMine: s.active_participant_id === 'p1' }) }), { initialProps: { s: state } });
    act(() => result.current.bar?.onToggle());
    expect(result.current.bar?.pressed).toBe(true);
    state = st({ active: 'w1' });
    rerender({ s: state });
    expect(result.current.bar?.pressed).toBe(false);
    expect(result.current.bar?.disabled).toBe(true);
    rerender({ s: st() }); // the turn comes back
    expect(result.current.bar?.disabled).toBe(false);
    expect(result.current.bar?.pressed).toBe(false); // not armed behind the user's back
  });
});
