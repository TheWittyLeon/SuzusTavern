/**
 * DmOverrideModal damage kind: target and New HP across participant polls, the
 * layered zero defence (each layer is redundant alone, so these pin the outcome:
 * no POST of 0 without the confirm press), and the ceiling refusal.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
const mockSubmitOverride = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('../../lib/api/dnd', () => ({
  submitOverride: (...args: Parameters<AnyFn>) => mockSubmitOverride(...args),
}));
import DmOverrideModal from '@/components/DmOverrideModal';
import type { CombatParticipantState } from '@/lib/api/types';

const mk = (id: string, name: string, hp_current: number, extra: Partial<CombatParticipantState> = {}): CombatParticipantState => ({
  participant_id: id, entity_id: id, name, is_pc: id.startsWith('pc'), initiative: 10,
  hp_current, hp_max: 30, ac: 12, conditions: [], is_alive: true, can_be_targeted: true,
  is_active_turn: false, took_turn: false, ...extra,
});
const G = mk('goblin-1', 'Goblin', 7);
const K = mk('pc-1', 'Kaelen', 20);
const L = mk('pc-2', 'Luke', 9);
const P = (ps: CombatParticipantState[]) => ({ open: true, combatId: 'c1', participants: ps, defaultActorId: 'goblin-1', onSuccess: jest.fn(), onClose: jest.fn() });
const sel = () => screen.getByLabelText(/^Target(?! new)/) as HTMLSelectElement;
const hp = () => screen.getByLabelText(/Target new HP/i) as HTMLInputElement;
const apply = () => screen.getByRole('button', { name: /Apply override|Submitting/i });
function open(ps = [G, K, L], target = 'pc-1') {
  const u = render(<DmOverrideModal {...P(ps)} />);
  fireEvent.click(screen.getByRole('radio', { name: /Damage/i }));
  fireEvent.change(sel(), { target: { value: target } });
  fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'ruling' } });
  return u;
}
beforeEach(() => { jest.clearAllMocks(); mockSubmitOverride.mockResolvedValue({ applied: { message: 'ok' } }); });

it('target leaves the list then returns: selection AND the typed New HP stay released (does not resurrect)', () => {
  const { rerender } = open();
  fireEvent.change(hp(), { target: { value: '3' } });
  rerender(<DmOverrideModal {...P([G, L])} />);
  expect(sel().value).toBe('');
  rerender(<DmOverrideModal {...P([G, K, L])} />);
  expect(sel().value).toBe('');
  expect(hp().value).toBe('');
});

it('an unselectable target is cleared: one poll without the target wipes target + typed New HP, reason survives', () => {
  const { rerender } = open();
  fireEvent.change(hp(), { target: { value: '3' } });
  rerender(<DmOverrideModal {...P([])} />);
  rerender(<DmOverrideModal {...P([G, K, L])} />);
  expect(sel().value).toBe('');
  expect((screen.getByLabelText(/Reason/i) as HTMLTextAreaElement).value).toBe('ruling');
});

it('reordered poll keeps target and typed New HP', () => {
  const { rerender } = open();
  fireEvent.change(hp(), { target: { value: '3' } });
  rerender(<DmOverrideModal {...P([L, K, G])} />);
  expect(sel().value).toBe('pc-1');
  expect(hp().value).toBe('3');
});

it('poll moves HP to another value that still resolves to 0: confirm stays up and the confirmed 0 is sent', async () => {
  const { rerender } = open();
  fireEvent.change(screen.getByLabelText(/Damage dealt/i), { target: { value: '20' } });
  await act(async () => { fireEvent.click(apply()); });
  rerender(<DmOverrideModal {...P([G, { ...K, hp_current: 5 }, L])} />);
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Drop to 0 HP/ })); });
  await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalledTimes(1));
  expect((mockSubmitOverride.mock.calls[0][1] as { outcome: { target_new_hp: number } }).outcome.target_new_hp).toBe(0);
});

it('Apply activated repeatedly in ONE batch with New HP 0 never posts and leaves exactly one confirm', async () => {
  open();
  fireEvent.change(hp(), { target: { value: '0' } });
  await act(async () => { fireEvent.click(apply()); fireEvent.click(apply()); fireEvent.click(apply()); });
  expect(mockSubmitOverride).not.toHaveBeenCalled();
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
});

it('derived New HP above 999 (target HP 1200) is refused with the ceiling message, nothing posted', async () => {
  open([G, mk('pc-1', 'Titan', 1200), L]);
  expect(hp().value).toBe('1200');
  await act(async () => { fireEvent.click(apply()); });
  expect(mockSubmitOverride).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(/more than 999/);
});

it('after the confirm is cancelled, Apply asks again (no sticky "confirmed" state)', async () => {
  open();
  fireEvent.change(hp(), { target: { value: '0' } });
  await act(async () => { fireEvent.click(apply()); });
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^Cancel$/ }));
  await act(async () => { fireEvent.click(apply()); });
  expect(mockSubmitOverride).not.toHaveBeenCalled();
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});
