/**
 * The "Revive…" opener on the DM panel and the last-alive-HP tracker behind
 * Revive's default HP.
 */
import React from 'react';
import { render, screen, fireEvent, renderHook, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockSubmitOverride = jest.fn();
jest.mock('../../lib/api/dnd', () => ({
  setSessionPolicy: jest.fn(),
  npcAction: jest.fn(),
  postSessionEvent: jest.fn(),
  submitOverride: (...a: unknown[]) => mockSubmitOverride(...a),
}));

import DmNarrationPanel from '@/components/DmNarrationPanel';
import { useLastAliveHp } from '@/lib/useLastAliveHp';
import { OverrideHostFor } from '@/test-utils/OverrideHostFor';
import type { CombatState, CombatParticipantState } from '@/lib/api/types';

const mk = (id: string, name: string, hp: number, max: number, extra: Partial<CombatParticipantState> = {}): CombatParticipantState => ({
  participant_id: id, entity_id: id, name, is_pc: id.startsWith('pc'), initiative: 10,
  hp_current: hp, hp_max: max, ac: 12, conditions: [], is_alive: true, can_be_targeted: true,
  is_active_turn: false, took_turn: false, ...extra,
});
const GOBLIN = mk('goblin-1', 'Goblin', 7, 7);
const KESTREL_ALIVE = mk('pc-1', 'Kestrel', 12, 34);
const KESTREL_DEAD = mk('pc-1', 'Kestrel', 0, 34, { is_alive: false });

const state = (participants: CombatParticipantState[], st: CombatState['state'] = 'active'): CombatState => ({
  combat_id: 'c1', session_id: 's1', round: 1, state: st, turn_index: 0,
  active_participant_id: 'goblin-1', initiative: participants.map((p) => p.participant_id), participants,
});
// The dialog is the page's one mount (overrideDialog.tsx); the panel only opens it, so a panel on its own needs the host around it.
const panel = (cs: CombatState) => (
  <OverrideHostFor combatState={cs}>
    <DmNarrationPanel
      combatId="c1" combatState={cs} sessionId="s1" dmUsername="dm"
      onMessage={jest.fn()} onStateUpdate={jest.fn()} onStateRefresh={jest.fn()}
    />
  </OverrideHostFor>
);

describe('Revive… opener', () => {
  it('shows beside DM Override only while a PC has fallen in a live fight', () => {
    render(panel(state([GOBLIN, KESTREL_DEAD])));
    expect(screen.getByRole('button', { name: /Revive…/ })).toBeInTheDocument();
  });

  it.each([
    ['nobody has fallen', state([GOBLIN, KESTREL_ALIVE])],
    ['only a monster has died', state([mk('goblin-2', 'G2', 0, 7, { is_alive: false }), KESTREL_ALIVE])],
    ['the fight has ended', state([GOBLIN, KESTREL_DEAD], 'ended')],
  ])('is absent when %s', (_label, cs) => {
    render(panel(cs));
    expect(screen.queryByRole('button', { name: /Revive…/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open DM override modal/i })).toBeInTheDocument();
  });

  // The engine takes a revive while a fight is running OR held (ENGINE TPK-HOLD); before initiative and between turns it does not. The opener follows (it retired the debt marker
  // that said a held fight was not covered).
  it.each([
    ['active', true], ['held', true], ['between_turns', false], ['rolling_initiative', false], ['idle', false], ['ended', false],
  ] as const)("a fallen PC in a '%s' fight: Revive… shown %s", (st, shown) => {
    render(panel(state([GOBLIN, KESTREL_DEAD], st)));
    expect(screen.queryByRole('button', { name: /Revive…/ }) !== null).toBe(shown);
  });

  it('a held fight\'s DM Override opens the dialog on Revive only (the opener asked for Attack; the engine takes nothing else)', () => {
    render(panel(state([GOBLIN, KESTREL_DEAD], 'held')));
    fireEvent.click(screen.getByRole('button', { name: /Open DM override modal/i }));
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /Revive/i })).toBeChecked();
  });

  it('a held fight\'s DM Override puts focus where a Revive opener would: the HP field (one fallen), not nowhere', async () => {
    render(panel(state([GOBLIN, KESTREL_DEAD], 'held')));
    fireEvent.click(screen.getByRole('button', { name: /Open DM override modal/i }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Restore to HP/i)));
  });

  it('opens the dialog on Revive, with the fallen character preselected', () => {
    render(panel(state([GOBLIN, KESTREL_DEAD])));
    fireEvent.click(screen.getByRole('button', { name: /Revive…/ }));
    expect(screen.getByRole('radio', { name: /Revive/i })).toBeChecked();
    expect((screen.getByLabelText(/^Character/) as HTMLSelectElement).value).toBe('pc-1');
  });

  it('DM Override still opens on Attack, even after a Revive… open', () => {
    render(panel(state([GOBLIN, KESTREL_DEAD])));
    fireEvent.click(screen.getByRole('button', { name: /Revive…/ }));
    fireEvent.click(screen.getByRole('button', { name: /Close override modal/i }));
    fireEvent.click(screen.getByRole('button', { name: /Open DM override modal/i }));
    expect(screen.getByRole('radio', { name: /Attack/i })).toBeChecked();
  });

  it('defaults the HP to what this tab last saw them alive with', () => {
    const { rerender } = render(panel(state([GOBLIN, KESTREL_ALIVE])));
    rerender(panel(state([GOBLIN, KESTREL_DEAD])));
    fireEvent.click(screen.getByRole('button', { name: /Revive…/ }));
    expect((screen.getByLabelText(/Restore to HP/i) as HTMLInputElement).value).toBe('12');
  });

  it('a tab that never saw them alive defaults to 1', () => {
    render(panel(state([GOBLIN, KESTREL_DEAD])));
    fireEvent.click(screen.getByRole('button', { name: /Revive…/ }));
    expect((screen.getByLabelText(/Restore to HP/i) as HTMLInputElement).value).toBe('1');
  });
});

describe('focus after a successful revive', () => {
  it('goes to DM Override when the Revive… opener unmounts with the last fallen character', async () => {
    const revivedState = state([GOBLIN, KESTREL_ALIVE]);
    mockSubmitOverride.mockResolvedValue({ applied: { message: 'Kestrel is back.' }, state: revivedState });
    function Harness() {
      const [cs, setCs] = React.useState(state([GOBLIN, KESTREL_DEAD]));
      return (
        <OverrideHostFor combatState={cs} onStateUpdate={setCs}>
          <DmNarrationPanel
            combatId="c1" combatState={cs} sessionId="s1" dmUsername="dm"
            onMessage={jest.fn()} onStateUpdate={setCs} onStateRefresh={jest.fn()}
          />
        </OverrideHostFor>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Revive…/ }));
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'prayer' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Revive Kestrel/ })); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Revive…/ })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Open DM override modal/i }));
  });
});

describe('useLastAliveHp', () => {
  const run = (ps: CombatParticipantState[]) => renderHook(({ p }) => useLastAliveHp(p), { initialProps: { p: ps } });

  it('records living PCs with HP above 0 and keeps the last one after they fall', () => {
    const h = run([KESTREL_ALIVE]);
    expect(h.result.current).toEqual({ 'pc-1': 12 });
    h.rerender({ p: [mk('pc-1', 'Kestrel', 0, 34)] }); // downed, alive, 0 HP
    expect(h.result.current).toEqual({ 'pc-1': 12 });
    h.rerender({ p: [KESTREL_DEAD] });
    expect(h.result.current).toEqual({ 'pc-1': 12 });
  });

  it('ignores monsters; updates when HP changes; stable object when nothing changes', () => {
    const h = run([GOBLIN, KESTREL_ALIVE]);
    expect(h.result.current).toEqual({ 'pc-1': 12 });
    const first = h.result.current;
    h.rerender({ p: [GOBLIN, { ...KESTREL_ALIVE }] });
    expect(h.result.current).toBe(first);
    h.rerender({ p: [GOBLIN, { ...KESTREL_ALIVE, hp_current: 20 }] });
    expect(h.result.current).toEqual({ 'pc-1': 20 });
  });
});
