/**
 * Lane G QA (Miko), item 3, npc-action route -- the DM panel. Strictly `=== true` re-reads; the answer's
 * message and state are always used; the order is "apply the answer's state, THEN ask for a re-read".
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockNpcAction = jest.fn();
jest.mock('../../lib/api/dnd', () => ({
  setSessionPolicy: jest.fn(),
  npcAction: (...a: unknown[]) => mockNpcAction(...a),
  postSessionEvent: jest.fn(),
  submitOverride: jest.fn(),
}));

import DmNarrationPanel from '@/components/DmNarrationPanel';
import { OverrideHostFor } from '@/test-utils/OverrideHostFor';
import type { CombatState } from '@/lib/api/types';

const goblin = {
  participant_id: 'goblin-1', entity_id: 'goblin-1', name: 'Goblin', is_pc: false, initiative: 10,
  hp_current: 7, hp_max: 7, ac: 12, conditions: [], is_alive: true, can_be_targeted: true,
  is_active_turn: true, took_turn: false,
};
const cs: CombatState = {
  combat_id: 'c1', session_id: 's1', round: 1, state: 'active', turn_index: 0,
  active_participant_id: 'goblin-1', initiative: ['goblin-1'], participants: [goblin],
};

async function skipOnce(answer: unknown, settle: 'message' | 'call' = 'message') {
  mockNpcAction.mockReset();
  mockNpcAction.mockResolvedValue(answer);
  const order: string[] = [];
  const onStateRefresh = jest.fn(() => { order.push('refresh'); });
  const onStateUpdate = jest.fn(() => { order.push('update'); });
  const onMessage = jest.fn(() => { order.push('message'); });
  render(
    <OverrideHostFor combatState={cs}>
      <DmNarrationPanel combatId="c1" combatState={cs} sessionId="s1" dmUsername="dm"
        onMessage={onMessage} onStateUpdate={onStateUpdate} onStateRefresh={onStateRefresh} />
    </OverrideHostFor>,
  );
  fireEvent.click(screen.getByRole('button', { name: /skip/i }));
  await waitFor(() => expect(mockNpcAction).toHaveBeenCalled());
  if (settle === 'message') await waitFor(() => expect(onMessage).toHaveBeenCalled());
  else await new Promise((r) => setTimeout(r, 20));
  return { onStateRefresh, onStateUpdate, onMessage, order };
}

describe('npc-action: the flag is strictly boolean true', () => {
  it.each([
    ['the string "true"', 'true'],
    ['the number 1', 1],
    ['null', null],
    ['false', false],
  ])('%s at both nesting levels: no re-read', async (_n, v) => {
    const { onStateRefresh } = await skipOnce({ message: 'Goblin waits.', already_advanced: v, data: { state: cs, already_advanced: v } });
    expect(onStateRefresh).not.toHaveBeenCalled();
  });

  it('true only under data (top level false): re-reads once', async () => {
    const { onStateRefresh } = await skipOnce({ message: 'm', already_advanced: false, data: { state: cs, already_advanced: true } });
    expect(onStateRefresh).toHaveBeenCalledTimes(1);
  });

  it('true at BOTH levels still asks once, not twice', async () => {
    const { onStateRefresh } = await skipOnce({ message: 'm', already_advanced: true, data: { state: cs, already_advanced: true } });
    expect(onStateRefresh).toHaveBeenCalledTimes(1);
  });

  it('nothing in the answer is dropped: the message, the nested applied.message and the state are all used, state BEFORE the re-read', async () => {
    const { order, onStateUpdate, onMessage } = await skipOnce({ data: { state: cs, applied: { message: 'Goblin stabs.' }, already_advanced: true } });
    expect(onMessage).toHaveBeenCalledWith('Goblin stabs.');
    expect(onStateUpdate).toHaveBeenCalledWith(cs);
    expect(order).toEqual(['message', 'update', 'refresh']);
  });

  it('an answer with no message and no state, flag true: still re-reads, says nothing, shows no error', async () => {
    const { onStateRefresh, onMessage } = await skipOnce({ data: { already_advanced: true } }, 'call');
    expect(onStateRefresh).toHaveBeenCalledTimes(1);
    expect(onMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a refusal (not_npc_turn, no state) is unchanged: one re-read, an error shown', async () => {
    mockNpcAction.mockReset();
    mockNpcAction.mockRejectedValue(Object.assign(new Error('x'), { status: 400, body: { data: { reason: 'not_npc_turn' } } }));
    const onStateRefresh = jest.fn();
    render(
      <OverrideHostFor combatState={cs}>
        <DmNarrationPanel combatId="c1" combatState={cs} sessionId="s1" dmUsername="dm"
          onMessage={jest.fn()} onStateUpdate={jest.fn()} onStateRefresh={onStateRefresh} />
      </OverrideHostFor>,
    );
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onStateRefresh).toHaveBeenCalledTimes(1);
  });

  // FINDING (low, non-blocking, NEW on this branch): the added line reads `res.already_advanced` with no `?.`,
  // while every read above it (`(res as ...)?.data?.state`, `?.message`) tolerates an answer with no body.
  // apiCall returns `result.data`, which is undefined when the proxy omits it, so a successful npc-action
  // with an empty `data` now throws a TypeError into the catch and shows the DM a refusal error for an action
  // that went through. Before the branch the same answer was a silent success.
  test.failing.each([['undefined', undefined], ['null', null]])('an empty successful answer (%s) is not turned into an error', async (_n, answer) => {
    await skipOnce(answer, 'call');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
