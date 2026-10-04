/**
 * DmOverrideModal "Revive" kind (TAV-DM-REVIVE): restore a fallen player
 * character through the damage override (kind 'damage', target_new_hp > 0 on a
 * dead PC), plus the F-1 "already at 0 HP" notice and the 44px kind radios.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
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

const mk = (
  id: string, name: string, hp_current: number, hp_max: number,
  extra: Partial<CombatParticipantState> = {},
): CombatParticipantState => ({
  participant_id: id, entity_id: id, name, is_pc: id.startsWith('pc'), initiative: 10,
  hp_current, hp_max, ac: 12, conditions: [], is_alive: true, can_be_targeted: true,
  is_active_turn: false, took_turn: false, ...extra,
});
const GOBLIN = mk('goblin-1', 'Goblin', 7, 7);
const DEAD_GOBLIN = mk('goblin-2', 'Dead Goblin', 0, 7, { is_alive: false });
const KESTREL = mk('pc-1', 'Kestrel', 0, 34, { is_alive: false });
const LUKE = mk('pc-2', 'Luke', 0, 30, { is_alive: false });
const LIVING = mk('pc-3', 'Livia', 12, 20);

const mkProps = (participants: CombatParticipantState[], extra: Record<string, unknown> = {}) => ({
  open: true, combatId: 'c1', participants, defaultActorId: 'goblin-1',
  onSuccess: jest.fn(), onClose: jest.fn(), ...extra,
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const charSel = () => screen.getByLabelText(/^Character/) as HTMLSelectElement;
const hpIn = () => screen.getByLabelText(/Restore to HP/i) as HTMLInputElement;
const reasonIn = () => screen.getByLabelText(/Reason/i) as HTMLTextAreaElement;
const applyBtn = () => screen.getByRole('button', { name: /^Revive |^Revive$|Reviving/ });
const apply = () => act(async () => { fireEvent.click(applyBtn()); });
const sent = () => mockSubmitOverride.mock.calls[0][1] as Record<string, unknown>;

function openRevive(participants: CombatParticipantState[], extra: Record<string, unknown> = {}) {
  const utils = render(<DmOverrideModal {...mkProps(participants, extra)} />);
  fireEvent.click(screen.getByRole('radio', { name: /Revive/i }));
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSubmitOverride.mockResolvedValue({ applied: { message: 'Kestrel is back on their feet.' } });
});

describe('kind + list', () => {
  it('Revive is the fifth and last kind', () => {
    render(<DmOverrideModal {...mkProps([GOBLIN, KESTREL])} />);
    const names = screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value);
    expect(names).toEqual(['attack', 'check', 'save', 'damage', 'revive']);
  });

  it('lists fallen player characters only (not living PCs, not dead monsters)', () => {
    openRevive([GOBLIN, DEAD_GOBLIN, KESTREL, LUKE, LIVING]);
    const opts = within(charSel()).getAllByRole('option').map((o) => o.textContent);
    expect(opts).toEqual(['— pick character —', 'Kestrel (max 34)', 'Luke (max 30)']);
  });

  it('has no Actor field; Actor is the revived character', () => {
    openRevive([GOBLIN, KESTREL]);
    expect(screen.queryByLabelText(/^Actor/)).not.toBeInTheDocument();
  });

  it('exactly one fallen is preselected; several are not', () => {
    openRevive([GOBLIN, KESTREL]);
    expect(charSel().value).toBe('pc-1');
    expect(hpIn().value).toBe('1');
  });

  it('several fallen: nothing preselected, no HP field value yet', () => {
    openRevive([GOBLIN, KESTREL, LUKE]);
    expect(charSel().value).toBe('');
    expect(hpIn().value).toBe('');
  });

  it('no one fallen: empty case with Refresh, and no Apply button', () => {
    const onRefresh = jest.fn();
    openRevive([GOBLIN, LIVING], { onRefresh });
    expect(screen.getByText('No character has fallen.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /^Revive/ })).not.toBeInTheDocument();
  });
});

describe('HP field', () => {
  it('defaults to the HP last seen alive, clamped to max; else 1', () => {
    openRevive([GOBLIN, KESTREL, LUKE], { lastAliveHp: { 'pc-1': 12, 'pc-2': 99 } });
    fireEvent.change(charSel(), { target: { value: 'pc-1' } });
    expect(hpIn().value).toBe('12');
    expect(screen.getByText(/Was 12 before they fell\./)).toBeInTheDocument();
    fireEvent.change(charSel(), { target: { value: 'pc-2' } });
    expect(hpIn().value).toBe('30'); // 99 clamped to max 30
  });

  it('unknown last HP: 1, and the hint says 1 to max', () => {
    openRevive([GOBLIN, KESTREL]);
    expect(hpIn().value).toBe('1');
    expect(screen.getByText(/1 to 34\./)).toBeInTheDocument();
  });

  it('states what a revive does (static hint)', () => {
    openRevive([GOBLIN, KESTREL]);
    expect(screen.getByText(/death saves are cleared\. Dodge and concentration are not restored\./)).toBeInTheDocument();
    expect(hpIn().getAttribute('aria-describedby')).toBeTruthy();
  });

  it('quick buttons set 1 / Half (rounded up) / Full without sending', () => {
    openRevive([GOBLIN, KESTREL]);
    fireEvent.click(screen.getByRole('button', { name: 'Full (34)' }));
    expect(hpIn().value).toBe('34');
    fireEvent.click(screen.getByRole('button', { name: 'Half (17)' }));
    expect(hpIn().value).toBe('17');
    fireEvent.click(screen.getByRole('button', { name: '1 HP' }));
    expect(hpIn().value).toBe('1');
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });

  it('Half rounds up on an odd max', () => {
    openRevive([GOBLIN, mk('pc-9', 'Odd', 0, 7, { is_alive: false })]);
    expect(screen.getByRole('button', { name: 'Half (4)' })).toBeInTheDocument();
  });
});

describe('apply', () => {
  it('Apply names the character and the HP, and updates with the field', () => {
    openRevive([GOBLIN, KESTREL], { lastAliveHp: { 'pc-1': 12 } });
    expect(applyBtn()).toHaveTextContent('Revive Kestrel at 12 HP');
    fireEvent.change(hpIn(), { target: { value: '20' } });
    expect(applyBtn()).toHaveTextContent('Revive Kestrel at 20 HP');
  });

  it('sends the damage override on the fallen PC: exact body', async () => {
    openRevive([GOBLIN, KESTREL], { lastAliveHp: { 'pc-1': 12 } });
    fireEvent.change(reasonIn(), { target: { value: '  Suzu rules the cleric prayed  ' } });
    await apply();
    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalledTimes(1));
    expect(mockSubmitOverride.mock.calls[0][0]).toBe('c1');
    expect(sent()).toEqual({
      kind: 'damage',
      actor_id: 'pc-1',
      target_id: 'pc-1',
      outcome: { damage_dealt: 0, target_new_hp: 12, raw_damage: 0 },
      reason: 'Suzu rules the cleric prayed',
    });
  });

  it('there is no second confirmation: pressing Apply sends with one dialog in the tree', async () => {
    openRevive([GOBLIN, KESTREL]);
    fireEvent.change(reasonIn(), { target: { value: 'r' } });
    await apply();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(mockSubmitOverride).toHaveBeenCalledTimes(1);
  });

  it('the reason is typed: Apply is disabled until it is filled', () => {
    openRevive([GOBLIN, KESTREL]);
    expect(applyBtn()).toBeDisabled();
    fireEvent.change(reasonIn(), { target: { value: 'x' } });
    expect(applyBtn()).not.toBeDisabled();
    expect(reasonIn()).toHaveAttribute('placeholder', 'Why are you reviving them?');
  });

  it.each([['0'], ['35'], [''], ['1.5'], ['-2']])('HP %j is refused and nothing is sent', async (v) => {
    openRevive([GOBLIN, KESTREL]);
    fireEvent.change(reasonIn(), { target: { value: 'r' } });
    fireEvent.change(hpIn(), { target: { value: v } });
    await settle();
    await apply();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Restore to HP/);
    expect(hpIn()).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(hpIn());
  });

  it('max is the character max: 34 sends, 35 refuses', async () => {
    openRevive([GOBLIN, KESTREL]);
    fireEvent.change(reasonIn(), { target: { value: 'r' } });
    fireEvent.change(hpIn(), { target: { value: '34' } });
    await apply();
    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalledTimes(1));
  });

  it('a living PC picked as a Damage target is not carried into Revive', () => {
    render(<DmOverrideModal {...mkProps([GOBLIN, LIVING, KESTREL, LUKE])} />);
    fireEvent.click(screen.getByRole('radio', { name: /Damage/i }));
    fireEvent.change(screen.getByLabelText(/^Target(?! new)/), { target: { value: 'pc-3' } });
    fireEvent.click(screen.getByRole('radio', { name: /Revive/i }));
    expect(charSel().value).toBe('');
  });

  it('a typed Restore HP does not survive leaving and re-entering Revive', () => {
    openRevive([GOBLIN, KESTREL]);
    fireEvent.change(hpIn(), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('radio', { name: /Check/i }));
    fireEvent.click(screen.getByRole('radio', { name: /Revive/i }));
    expect(hpIn().value).toBe('1');
  });

  it('switching kind away and back drops the chosen character', () => {
    openRevive([GOBLIN, KESTREL, LUKE]);
    fireEvent.change(charSel(), { target: { value: 'pc-2' } });
    fireEvent.click(screen.getByRole('radio', { name: /Damage/i }));
    fireEvent.click(screen.getByRole('radio', { name: /Revive/i }));
    expect(charSel().value).toBe('');
  });
});

describe('stale guard', () => {
  it('a poll shows the character alive before Apply: nothing is sent, message names them, focus on the select', async () => {
    const { rerender } = openRevive([GOBLIN, KESTREL]);
    fireEvent.change(reasonIn(), { target: { value: 'r' } });
    rerender(<DmOverrideModal {...mkProps([GOBLIN, { ...KESTREL, is_alive: true, hp_current: 9 }])} />);
    await settle();
    await apply();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Kestrel is already back on their feet. Nothing was sent.');
    expect(document.activeElement).toBe(charSel());
    expect(charSel()).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('refusals', () => {
  const fail = (reason: string, message?: string) =>
    mockSubmitOverride.mockRejectedValue({ body: { message, data: { reason } } });

  it('combat_not_active: the fight has ended copy; focus parks on the alert; draft stays', async () => {
    fail('combat_not_active');
    openRevive([GOBLIN, KESTREL]);
    fireEvent.change(reasonIn(), { target: { value: 'my draft' } });
    await settle();
    await apply();
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('The fight has ended, so no one can be revived in it.');
    await waitFor(() => expect(document.activeElement).toBe(a));
    expect(reasonIn().value).toBe('my draft');
    expect(hpIn().value).toBe('1');
  });

  it("target_down: \"{name} can't be revived.\" plus the engine message", async () => {
    fail('target_down', 'Not a player character.');
    openRevive([GOBLIN, KESTREL]);
    fireEvent.change(reasonIn(), { target: { value: 'r' } });
    await settle();
    await apply();
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent("Kestrel can't be revived. Not a player character.");
    await waitFor(() => expect(document.activeElement).toBe(a));
  });
});

describe('opened as Revive from elsewhere', () => {
  it('several fallen: focus lands on the Character select', async () => {
    render(<DmOverrideModal {...mkProps([GOBLIN, KESTREL, LUKE], { initialKind: 'revive' })} />);
    await settle();
    expect(screen.getByRole('radio', { name: /Revive/i })).toBeChecked();
    expect(document.activeElement).toBe(charSel());
  });

  it('one fallen: focus lands on the HP field with its text selected', async () => {
    const sel = jest.spyOn(HTMLInputElement.prototype, 'select');
    render(<DmOverrideModal {...mkProps([GOBLIN, KESTREL], { initialKind: 'revive' })} />);
    await settle();
    expect(document.activeElement).toBe(hpIn());
    expect(sel).toHaveBeenCalled();
    sel.mockRestore();
  });

  it('focus does not depend on a timer: it is on the HP field as soon as the field renders (WebKit race)', async () => {
    jest.useFakeTimers();
    try {
      render(<DmOverrideModal {...mkProps([GOBLIN, KESTREL], { initialKind: 'revive' })} />);
      await act(async () => {}); // flush effects and the renders they cause, but run NO timers
      expect(document.activeElement).toBe(hpIn());
    } finally {
      jest.useRealTimers();
    }
  });

  it('the dialog is titled for the act: Revive in Revive mode, DM Override otherwise', () => {
    const { rerender } = render(<DmOverrideModal {...mkProps([GOBLIN, KESTREL], { initialKind: 'revive' })} />);
    expect(screen.getByRole('dialog', { name: 'Revive' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Damage/i }));
    expect(screen.getByRole('dialog', { name: 'DM Override' })).toBeInTheDocument();
    rerender(<DmOverrideModal {...mkProps([GOBLIN, KESTREL])} />);
  });

  it('initialTargetId preselects that character', async () => {
    render(<DmOverrideModal {...mkProps([GOBLIN, KESTREL, LUKE], { initialKind: 'revive', initialTargetId: 'pc-2' })} />);
    await settle();
    expect(charSel().value).toBe('pc-2');
    expect(document.activeElement).toBe(hpIn());
  });

  it('without initialKind the dialog still opens on Attack', () => {
    render(<DmOverrideModal {...mkProps([GOBLIN, KESTREL])} />);
    expect(screen.getByRole('radio', { name: /Attack/i })).toBeChecked();
  });
});

describe('F-1: Damage on a target already at 0 HP', () => {
  const openDamage = (target: CombatParticipantState) => {
    render(<DmOverrideModal {...mkProps([GOBLIN, target])} />);
    fireEvent.click(screen.getByRole('radio', { name: /Damage/i }));
    fireEvent.change(screen.getByLabelText(/^Target(?! new)/), { target: { value: target.participant_id } });
    fireEvent.change(reasonIn(), { target: { value: 'r' } });
  };
  const downed = mk('pc-5', 'Kaelen', 0, 28); // alive, at 0 HP

  it('says so, names the target, focuses New HP, shows no confirm, sends nothing', async () => {
    openDamage(downed);
    await settle();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Apply override/i })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Kaelen is already at 0 HP. Nothing to apply.');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText(/Target new HP/i));
  });

  it('with damage to apply (e.g. death-save failure) the zero confirm still opens', async () => {
    openDamage(downed);
    fireEvent.change(screen.getByLabelText(/Damage dealt/i), { target: { value: '5' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Apply override/i })); });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});

describe('Restore to HP field is 44px tall like the quick buttons', () => {
  it('.reviveHp height is 44px and the field uses it', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../components/DmOverrideModal.module.css'), 'utf8');
    expect(css.match(/\.reviveHp\s*\{[^}]*\}/)?.[0] ?? '').toMatch(/height:\s*44px/);
    openRevive([GOBLIN, KESTREL]);
    expect(hpIn().className).toMatch(/reviveHp/);
  });
});

describe('kind radios are 44px', () => {
  it('.radioLabel min-height is 44px', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../components/DmOverrideModal.module.css'), 'utf8');
    const block = css.match(/\.radioLabel\s*\{[^}]*\}/)?.[0] ?? '';
    expect(block).toMatch(/min-height:\s*44px/);
  });
});
