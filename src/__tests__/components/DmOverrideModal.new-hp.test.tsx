/**
 * TAV-DM-OVERRIDE-MODAL-DEFAULTS-NEW-HP-ZERO — the damage override must never
 * send a silent `target_new_hp: 0`. The engine derives "is this target down"
 * from target_new_hp, so a default 0 downs a PC / deactivates a monster.
 *
 * Contract pinned here:
 *   - New HP untouched  => follows (target.hp_current - damage_dealt), floor 0.
 *   - New HP hand-edited => the DM's value stands across Damage edits, and is
 *     released (follows the new target again) when the TARGET changes, because
 *     a number typed for one creature is wrong for another.
 *   - No known target HP, or a blanked field => refuse, nothing is POSTed.
 *   - Resolved value 0 => in-dialog ConfirmDialog naming the target; no POST
 *     until confirmed; Cancel / Escape returns to the form with values intact.
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

const mk = (id: string, name: string, hp_current: number, hp_max: number): CombatParticipantState => ({
  participant_id: id,
  entity_id: id,
  name,
  is_pc: id.startsWith('pc'),
  initiative: 10,
  hp_current,
  hp_max,
  ac: 12,
  conditions: [],
  is_alive: true,
  can_be_targeted: true,
  is_active_turn: false,
  took_turn: false,
});

const ACTOR = mk('goblin-1', 'Goblin', 7, 7);
const KAELEN = mk('pc-1', 'Kaelen', 20, 28);
const LUKE = mk('pc-2', 'Luke', 9, 30);
const BROKEN = { ...mk('pc-3', 'Mystery', 5, 5), hp_current: undefined as unknown as number };

const base = {
  open: true,
  combatId: 'c1',
  participants: [ACTOR, KAELEN, LUKE, BROKEN],
  defaultActorId: 'goblin-1',
  onSuccess: jest.fn(),
  onClose: jest.fn(),
};

function openDamage(targetId?: string) {
  const utils = render(<DmOverrideModal {...base} />);
  fireEvent.click(screen.getByRole('radio', { name: /Damage/i }));
  if (targetId) pickTarget(targetId);
  fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'ruling' } });
  return utils;
}
const pickTarget = (id: string) =>
  fireEvent.change(screen.getByLabelText(/^Target(?! new)/), { target: { value: id } });
const hpInput = () => screen.getByLabelText(/Target new HP/i) as HTMLInputElement;
const dealtInput = () => screen.getByLabelText(/Damage dealt/i) as HTMLInputElement;
const apply = async () =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Apply override/i }));
  });
const sentOutcome = () => (mockSubmitOverride.mock.calls[0][1] as { outcome: Record<string, number> }).outcome;

beforeEach(() => {
  jest.clearAllMocks();
  mockSubmitOverride.mockResolvedValue({ applied: { message: 'ok' } });
});

describe('New HP prefill', () => {
  it('untouched New HP sends the target current HP, not 0', async () => {
    openDamage('pc-1');
    expect(hpInput().value).toBe('20');
    await apply();
    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalledTimes(1));
    expect(sentOutcome()).toEqual({ damage_dealt: 0, target_new_hp: 20, raw_damage: 0 });
  });

  it('follows current - damage while untouched, floored at 0 (0 then needs confirm)', async () => {
    openDamage('pc-1');
    fireEvent.change(dealtInput(), { target: { value: '5' } });
    expect(hpInput().value).toBe('15');
    await apply();
    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalledTimes(1));
    expect(sentOutcome()).toMatchObject({ damage_dealt: 5, target_new_hp: 15 });
  });

  it('changing target re-prefills an untouched New HP', () => {
    openDamage('pc-1');
    expect(hpInput().value).toBe('20');
    pickTarget('pc-2');
    expect(hpInput().value).toBe('9');
  });

  it('a hand-edited value survives a Damage edit', async () => {
    openDamage('pc-1');
    fireEvent.change(hpInput(), { target: { value: '3' } });
    fireEvent.change(dealtInput(), { target: { value: '12' } });
    expect(hpInput().value).toBe('3');
    await apply();
    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalledTimes(1));
    expect(sentOutcome()).toMatchObject({ damage_dealt: 12, target_new_hp: 3 });
  });

  it('a target change releases a hand-edited value back to the new target HP', () => {
    openDamage('pc-1');
    fireEvent.change(hpInput(), { target: { value: '3' } });
    pickTarget('pc-2');
    expect(hpInput().value).toBe('9');
  });

  it('survives switching kind away and back (target kept, HP still derived)', () => {
    openDamage('pc-1');
    fireEvent.click(screen.getByRole('radio', { name: /Check/i }));
    fireEvent.click(screen.getByRole('radio', { name: /Damage/i }));
    expect(hpInput().value).toBe('20');
  });
});

describe('unknown HP refuses', () => {
  it('no target picked: field is empty and submit POSTs nothing', async () => {
    openDamage();
    expect(hpInput().value).toBe('');
    await apply();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });

  it('target with no hp_current: field empty, plain message, no POST', async () => {
    openDamage('pc-3');
    expect(hpInput().value).toBe('');
    await apply();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/New HP/i);
  });

  it('blanking a prefilled field refuses rather than sending 0', async () => {
    openDamage('pc-1');
    fireEvent.change(hpInput(), { target: { value: '' } });
    expect(hpInput().value).toBe('');
    await apply();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/New HP/i);
  });
});

describe('New HP = 0 needs a second, in-dialog step', () => {
  async function toZero() {
    openDamage('pc-1');
    fireEvent.change(hpInput(), { target: { value: '0' } });
    fireEvent.change(dealtInput(), { target: { value: '25' } });
    await apply();
  }

  it('does not POST until confirmed; the confirm names the target', async () => {
    await toZero();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
    const confirm = screen.getByRole('alertdialog', { name: /0 HP/i });
    expect(within(confirm).getByText(/This drops Kaelen to 0 HP\./)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: /Drop to 0 HP/i }));
    });
    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalledTimes(1));
    expect(sentOutcome()).toMatchObject({ damage_dealt: 25, target_new_hp: 0 });
  });

  it('a derived 0 (damage >= current, untouched) also needs confirm', async () => {
    openDamage('pc-1');
    fireEvent.change(dealtInput(), { target: { value: '99' } });
    expect(hpInput().value).toBe('0');
    await apply();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
    expect(screen.getByText(/This drops Kaelen to 0 HP\./)).toBeInTheDocument();
  });

  it('Cancel returns to the form with every value intact and POSTs nothing', async () => {
    await toZero();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^Cancel$/ }));
    expect(screen.queryByText(/This drops Kaelen/)).not.toBeInTheDocument();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
    expect(base.onClose).not.toHaveBeenCalled();
    expect(hpInput().value).toBe('0');
    expect(dealtInput().value).toBe('25');
    expect((screen.getByLabelText(/Reason/i) as HTMLTextAreaElement).value).toBe('ruling');
    expect((screen.getByLabelText(/^Target(?! new)/) as HTMLSelectElement).value).toBe('pc-1');
  });

  it('Escape closes only the confirm, not the override modal', async () => {
    await toZero();
    fireEvent.keyDown(screen.getByRole('alertdialog', { name: /0 HP/i }), { key: 'Escape' });
    expect(screen.queryByText(/This drops Kaelen/)).not.toBeInTheDocument();
    expect(base.onClose).not.toHaveBeenCalled();
    expect(hpInput().value).toBe('0');
  });

  it('non-zero New HP never shows the confirm', async () => {
    openDamage('pc-1');
    await apply();
    expect(screen.queryByText(/This drops/)).not.toBeInTheDocument();
  });
});

describe('accessibility + refusal copy (fix round)', () => {
  // The modal's open effect focuses the first radio on a 0ms timer; let it
  // land before the test moves focus itself.
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const alertText = () => screen.getByRole('alert').textContent ?? '';

  it('New HP refusal is wired to the New HP field, not Reason, and focus moves there', async () => {
    openDamage('pc-1');
    await settle();
    fireEvent.change(hpInput(), { target: { value: '' } });
    await apply();
    const alertEl = screen.getByRole('alert');
    expect(hpInput()).toHaveAttribute('aria-invalid', 'true');
    expect(hpInput().getAttribute('aria-describedby')).toContain(alertEl.id);
    expect(screen.getByLabelText(/Reason/i)).not.toHaveAttribute('aria-describedby');
    expect(document.activeElement).toBe(hpInput());
  });

  it('three different refusals: erased, not a whole number, unknown HP', async () => {
    openDamage('pc-1');
    fireEvent.change(hpInput(), { target: { value: '' } });
    await apply();
    expect(alertText()).toMatch(/empty/i);
    expect(alertText()).not.toMatch(/worked out|isn't known/i);

    fireEvent.change(hpInput(), { target: { value: '1.5' } });
    await apply();
    expect(alertText()).toMatch(/whole number/i);

    fireEvent.change(hpInput(), { target: { value: '1000' } });
    await apply();
    expect(alertText()).toMatch(/999/);
    expect(mockSubmitOverride).not.toHaveBeenCalled();

    pickTarget('pc-3'); // no hp_current
    await apply();
    expect(alertText()).toMatch(/isn't known/i);
  });

  it('New HP carries a visible suggestion hint wired by aria-describedby', () => {
    openDamage('pc-1');
    const hint = screen.getByText(/Fills in as current HP minus damage dealt/i);
    expect(hpInput().getAttribute('aria-describedby')).toContain(hint.id);
    expect(hint).not.toHaveAttribute('aria-live');
  });

  it('an identical repeated refusal is a fresh alert node (re-announced)', async () => {
    openDamage('pc-1');
    fireEvent.change(hpInput(), { target: { value: '' } });
    await apply();
    const first = screen.getByRole('alert');
    await apply();
    expect(screen.getByRole('alert')).not.toBe(first);
  });

  it('the override dialog is inert while the zero-confirm is up, and not otherwise', async () => {
    openDamage('pc-1');
    const dlg = () => screen.getByRole('dialog', { name: /DM Override/i });
    expect(dlg()).not.toHaveAttribute('inert');
    fireEvent.change(hpInput(), { target: { value: '0' } });
    await apply();
    expect(dlg()).toHaveAttribute('inert');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^Cancel$/ }));
    expect(dlg()).not.toHaveAttribute('inert');
  });

  it('after a failed send, focus is on the error inside the dialog', async () => {
    mockSubmitOverride.mockRejectedValueOnce({ body: { message: 'nope' } });
    openDamage('pc-1');
    await settle();
    await apply();
    const alertEl = await screen.findByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(alertEl));
    expect(alertEl).toHaveAttribute('tabindex', '-1');
  });
});

describe('target-required wiring, status notices, latch', () => {
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const withParticipants = (ps: CombatParticipantState[]) => ({ ...base, participants: ps });
  const dmg20 = () => fireEvent.change(dealtInput(), { target: { value: '20' } }); // Kaelen derives 0

  it.each(['damage', 'attack'] as const)('%s with no target: error is wired to the Target select and focus moves there', async (k) => {
    render(<DmOverrideModal {...base} />);
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(k, 'i') }));
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'ruling' } });
    await settle();
    await apply();
    const alertEl = screen.getByRole('alert');
    expect(alertEl).toHaveTextContent(/Target is required/i);
    const sel = screen.getByLabelText(/^Target(?! new)/);
    expect(sel).toHaveAttribute('aria-invalid', 'true');
    expect(sel).toHaveAttribute('aria-describedby', alertEl.id);
    expect(screen.getByLabelText(/Reason/i)).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText(/Reason/i)).not.toHaveAttribute('aria-describedby');
    expect(document.activeElement).toBe(sel);
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });

  it('a stale confirm that closes itself says so, without moving focus to the alert', async () => {
    const { rerender } = openDamage('pc-1');
    await settle();
    dmg20();
    await apply();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    rerender(<DmOverrideModal {...withParticipants([ACTOR, { ...KAELEN, hp_current: 40 }, LUKE, BROKEN])} />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    const alertEl = screen.getByRole('alert');
    expect(alertEl).toHaveTextContent("Kaelen's HP changed. New HP is now 20. Review and apply again.");
    expect(document.activeElement).not.toBe(alertEl);
    // a notice, not a field error: no field is marked invalid or described by it
    expect(screen.getByLabelText(/Reason/i)).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText(/Reason/i)).not.toHaveAttribute('aria-describedby');
    expect(hpInput()).not.toHaveAttribute('aria-invalid');
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });

  it('an Apply that lands in the same batch as such a poll gets the same message, no confirm, no POST', async () => {
    const { rerender } = openDamage('pc-1');
    await settle();
    dmg20();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply override/i }));
      rerender(<DmOverrideModal {...withParticipants([ACTOR, { ...KAELEN, hp_current: 40 }, LUKE, BROKEN])} />);
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Kaelen's HP changed\. New HP is now 20/);
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });

  it('clearing an unselectable target says so, without moving focus', async () => {
    const { rerender } = openDamage('pc-1');
    await settle();
    const reason = screen.getByLabelText(/Reason/i);
    act(() => reason.focus());
    rerender(<DmOverrideModal {...withParticipants([ACTOR, { ...KAELEN, is_alive: false }, LUKE, BROKEN])} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Kaelen is no longer a valid target. Pick another.');
    expect(document.activeElement).toBe(reason);
    expect(hpInput().value).toBe('');
  });

  it('aria-invalid on New HP clears as soon as the DM edits the field', async () => {
    openDamage('pc-1');
    fireEvent.change(hpInput(), { target: { value: '' } });
    await apply();
    expect(hpInput()).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(hpInput(), { target: { value: '5' } });
    expect(hpInput()).not.toHaveAttribute('aria-invalid');
  });

  it('two confirm clicks inside one batch post once (in-flight latch)', async () => {
    mockSubmitOverride.mockReturnValue(new Promise(() => {}));
    openDamage('pc-1');
    fireEvent.change(hpInput(), { target: { value: '0' } });
    await apply();
    const btn = within(screen.getByRole('alertdialog')).getByRole('button', { name: /Drop to 0 HP/i });
    await act(async () => { fireEvent.click(btn); fireEvent.click(btn); });
    expect(mockSubmitOverride).toHaveBeenCalledTimes(1);
  });

  it('the New HP ceiling is one value: 999 posts, 1000 refuses (message names 999)', async () => {
    openDamage('pc-1');
    fireEvent.change(hpInput(), { target: { value: '1000' } });
    await apply();
    expect(screen.getByRole('alert')).toHaveTextContent(/more than 999/);
    expect(mockSubmitOverride).not.toHaveBeenCalled();
    fireEvent.change(hpInput(), { target: { value: '999' } });
    await apply();
    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalledTimes(1));
  });
});
