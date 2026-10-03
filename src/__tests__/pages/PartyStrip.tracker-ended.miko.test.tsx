/**
 * Miko-QA, A10 step 11 round 3 (point 3): the initiative tracker after a POLLED `ended`.
 *
 * Cause (measured, not guessed): `PartyStrip.tsx` renders the tracker when `combatState && combatState.participants.length > 0`. A polled `ended` keeps `combatState` (the poller stops at
 * `state === 'ended'` and never clears it), while `combatIsActive` (a prop PartyStrip already receives) flips false and the page's moment goes `exploring`. So the combat artifact stays in the
 * exploring band until a reload or the next fight. The line is identical at 0e12fc9, 2321f3b, edb0b66 and b8de57f: round 3 did not introduce it. What round 3 changed is the CONSEQUENCE:
 * Story's log was 215 (under its 240 floor, page fits) before, and is 240 with the page scrolling 25px at 1440x900 now.
 *
 * Round 5: fixed (PartyStrip gates the tracker on combatIsActive); the former `it.failing` is a plain `it`.
 */
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import PartyStrip from '@/app/play/[sessionId]/regions/PartyStrip';
import type { CombatState, Participant } from '@/lib/api/types';

jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/api/dnd', () => ({ bindCharacter: jest.fn(), listMyCharacters: jest.fn(() => Promise.resolve([])) }));

const party: Participant[] = [{ username: 'leon', is_dm: false, character: { character_id: 'c1', name: 'Anomaly', char_class: 'Ranger', level: 1, current_hp: 10, max_hp: 10, ac: 13 } }];
const fight = (state: 'active' | 'ended') => ({
  combat_id: 'cb', session_id: 's1', round: 2, state, turn_index: 0, active_participant_id: state === 'active' ? 'p1' : null, initiative: ['p1', 'w1'],
  participants: [
    { participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 10, hp_max: 10, ac: 13, conditions: [], is_alive: true, can_be_targeted: false, is_active_turn: true, took_turn: false },
    { participant_id: 'w1', entity_id: 'g1', name: 'Timberwolf', is_pc: false, initiative: 9, hp_current: 0, hp_max: 19, ac: 13, conditions: [], is_alive: false, can_be_targeted: false, is_active_turn: false, took_turn: false },
  ],
}) as unknown as CombatState;

const strip = (combatState: CombatState, combatIsActive: boolean) =>
  render(<PartyStrip participants={party} selfUsername="leon" combatState={combatState} onSelectMember={() => {}} isDm={false} sessionId="s1" combatIsActive={combatIsActive} sessionLocked={false} onRebindChanged={() => {}} round={2} selfPcId="p1" />);

describe('PartyStrip initiative tracker', () => {
  it('control: an ACTIVE fight shows the tracker', () => {
    const { container } = strip(fight('active'), true);
    expect(container.querySelector('#initiative-label')).not.toBeNull();
  });

  it('after a polled `ended` (combatState kept, combatIsActive false) the tracker is gone', () => {
    const { container } = strip(fight('ended'), false);
    expect(container.querySelector('#initiative-label')).toBeNull();
  });
});
