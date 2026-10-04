/**
 * B8c-4 P1c, found by Miko-QA and kept under a behaviour name: when the turn passes, a focused tracker row must KEEP focus. A row that loses its tabindex attribute while focused is no longer focusable, and Chromium and WebKit move focus to <body>
 * (probed in both: /scratchpad/miko-phone-p0/focus-probe.mjs: tabindex removed -> activeElement BODY). Fix: every row has tabindex (0 for the stop, -1 for the rest); only the VALUE changes on a turn.
 * Red at 2ac6dfb (rows other than the active one had no tabindex attribute).
 */
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import InitiativeTracker from '@/components/InitiativeTracker';
import type { CombatState } from '@/lib/api/types';

const fight = (active: 'p1' | 'w1'): CombatState => ({
  combat_id: 'cb', session_id: 's1', round: 2, state: 'active', turn_index: 0, active_participant_id: active, initiative: ['p1', 'w1'],
  participants: [
    { participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 10, hp_max: 10, ac: 13, conditions: [], is_alive: true, can_be_targeted: false, is_active_turn: active === 'p1', took_turn: false },
    { participant_id: 'w1', entity_id: 'g1', name: 'Timberwolf', is_pc: false, initiative: 9, hp_current: 19, hp_max: 19, ac: 13, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: active === 'w1', took_turn: false },
  ],
}) as unknown as CombatState;

describe('a focused tracker row survives the turn passing', () => {
  it('the row that WAS the stop stays focusable (tabindex present) when the turn moves off it', () => {
    const { container, rerender } = render(<InitiativeTracker participants={fight('w1').participants} round={2} variant="strip" />);
    const rows = () => Array.from(container.querySelectorAll('ol > li')) as HTMLElement[];
    const wolf = rows()[1];
    wolf.focus();
    expect(wolf).toHaveFocus(); // positive control: the stop takes focus
    rerender(<InitiativeTracker participants={fight('p1').participants} round={2} variant="strip" />);
    expect(rows()[1]).toBe(wolf); // same node: the poll re-renders in place
    expect(wolf).toHaveAttribute('tabindex'); // was: attribute removed -> a real browser moves focus to <body>
    expect(rows()[0]).toHaveAttribute('tabindex', '0');
  });
  it('exactly one row is a tab stop (tabindex 0) and every other row is programmatically focusable (-1)', () => {
    const { container } = render(<InitiativeTracker participants={fight('w1').participants} round={2} variant="strip" />);
    const rows = Array.from(container.querySelectorAll('ol > li'));
    expect(rows.map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '0']);
  });
});
