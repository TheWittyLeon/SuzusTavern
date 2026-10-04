/**
 * The "Revive…" opener on the DM panel and the last-alive-HP tracker behind
 * Revive's default HP.
 */
import React from 'react';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  setSessionPolicy: jest.fn(),
  npcAction: jest.fn(),
  postSessionEvent: jest.fn(),
  submitOverride: jest.fn(),
}));

import DmNarrationPanel from '@/components/DmNarrationPanel';
import { useLastAliveHp } from '@/lib/useLastAliveHp';
import type { CombatState, CombatParticipantState } from '@/lib/api/types';

const mk = (id: string, name: string, hp: number, max: number, extra: Partial<CombatParticipantState> = {}): CombatParticipantState => ({
  participant_id: id, entity_id: id, name, is_pc: id.startsWith('pc'), initiative: 10,
  hp_current: hp, hp_max: max, ac: 12, conditions: [], is_alive: true, can_be_targeted: true,
  is_active_turn: false, took_turn: false, ...extra,
});
const GOBLIN = mk('goblin-1', 'Goblin', 7, 7);
const KESTREL_ALIVE = mk('pc-1', 'Kestrel', 12, 34);
const KESTREL_DEAD = mk('pc-1', 'Kestrel', 0, 34, { is_alive: false });

const state = (participants: CombatParticipantState[], st = 'active'): CombatState => ({
  combat_id: 'c1', session_id: 's1', round: 1, state: st, turn_index: 0,
  active_participant_id: 'goblin-1', initiative: participants.map((p) => p.participant_id), participants,
});
const panel = (cs: CombatState) => (
  <DmNarrationPanel
    combatId="c1" combatState={cs} sessionId="s1" dmUsername="dm"
    onMessage={jest.fn()} onOverrideMessage={jest.fn()} onStateUpdate={jest.fn()} onStateRefresh={jest.fn()}
  />
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
