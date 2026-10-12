/**
 * NEKO-ENDTURN-DUPLICATE-BEAT-ON-RACE: an npc-action answer marked `already_advanced` (the advance was
 * a no-op) makes the panel ask the page to re-read the fight; absent or false changes nothing.
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

async function skipOnce(answer: unknown) {
  mockNpcAction.mockResolvedValue(answer);
  const onStateRefresh = jest.fn();
  const onMessage = jest.fn();
  render(
    <OverrideHostFor combatState={cs}>
      <DmNarrationPanel combatId="c1" combatState={cs} sessionId="s1" dmUsername="dm"
        onMessage={onMessage} onStateUpdate={jest.fn()} onStateRefresh={onStateRefresh} />
    </OverrideHostFor>,
  );
  fireEvent.click(screen.getByRole('button', { name: /skip/i }));
  await waitFor(() => expect(mockNpcAction).toHaveBeenCalled());
  await waitFor(() => expect(onMessage).toHaveBeenCalled());
  return { onStateRefresh, onMessage };
}

describe('DmNarrationPanel: already_advanced', () => {
  it('true: re-reads the fight, and still shows the answer\'s message', async () => {
    const { onStateRefresh, onMessage } = await skipOnce({ message: 'Goblin waits.', data: { state: cs, already_advanced: true } });
    expect(onStateRefresh).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith('Goblin waits.');
  });

  it('true at the top level of the unwrapped answer (the engine\'s flat data): re-reads too', async () => {
    const { onStateRefresh } = await skipOnce({ message: 'Goblin waits.', state: cs, already_advanced: true });
    expect(onStateRefresh).toHaveBeenCalledTimes(1);
  });

  it.each([['absent', { state: cs }], ['false', { state: cs, already_advanced: false }]])('%s: no re-read', async (_n, data) => {
    const { onStateRefresh } = await skipOnce({ message: 'Goblin waits.', data });
    expect(onStateRefresh).not.toHaveBeenCalled();
  });
});
