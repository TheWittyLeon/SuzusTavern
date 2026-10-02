/**
 * DmOverrideModal damage kind: New HP safety under hostile input and polling.
 *
 * Invariant: a POST carrying target_new_hp === 0 is only ever sent after the DM
 * pressed the confirm button for THAT zero. Also pins the wire matrix for typed
 * values, target HP edge values, participant polls under an open dialog, reopen
 * resets, confirm focus/Tab trap, and double-submit handling.
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

const mk = (id: string, name: string, hp_current: number, hp_max: number, extra: Partial<CombatParticipantState> = {}): CombatParticipantState => ({
  participant_id: id, entity_id: id, name, is_pc: id.startsWith('pc'), initiative: 10,
  hp_current, hp_max, ac: 12, conditions: [], is_alive: true, can_be_targeted: true,
  is_active_turn: false, took_turn: false, ...extra,
});
const ACTOR = mk('goblin-1', 'Goblin', 7, 7);
const KAELEN = mk('pc-1', 'Kaelen', 20, 28);
const LUKE = mk('pc-2', 'Luke', 9, 30);

const onClose = jest.fn();
const onSuccess = jest.fn();
const props = (participants: CombatParticipantState[]) => ({
  open: true, combatId: 'c1', participants, defaultActorId: 'goblin-1', onSuccess, onClose,
});

const targetSel = () => screen.getByLabelText(/^Target(?! new)/) as HTMLSelectElement;
const hpInput = () => screen.getByLabelText(/Target new HP/i) as HTMLInputElement;
const dealtInput = () => screen.getByLabelText(/Damage dealt/i) as HTMLInputElement;
const applyBtn = () => screen.getByRole('button', { name: /Apply override|Applying|Submitting/i });

function openDamage(participants: CombatParticipantState[], targetId?: string) {
  const utils = render(<DmOverrideModal {...props(participants)} />);
  fireEvent.click(screen.getByRole('radio', { name: /Damage/i }));
  if (targetId) fireEvent.change(targetSel(), { target: { value: targetId } });
  fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'ruling' } });
  return utils;
}
const apply = async () => act(async () => { fireEvent.click(applyBtn()); });
const confirmDialog = () => screen.queryByRole('alertdialog');
const confirmBtn = () => within(screen.getByRole('alertdialog')).getByRole('button', { name: /Drop to 0 HP/i });
const sentHp = (i = 0) => (mockSubmitOverride.mock.calls[i][1] as { outcome: { target_new_hp: number } }).outcome.target_new_hp;

beforeEach(() => {
  jest.clearAllMocks();
  mockSubmitOverride.mockResolvedValue({ applied: { message: 'ok' } });
});

// ---------------------------------------------------------------------------
describe('wire matrix: what a hand-typed New HP puts on the wire', () => {
  // [typed, expected]: 'confirm' = no POST, alertdialog shown; 'refuse' = no POST, no dialog, alert;
  // number = POSTed straight away with that target_new_hp.
  const cases: Array<[string, 'confirm' | 'refuse' | number]> = [
    ['0', 'confirm'], ['00', 'confirm'], ['0000', 'confirm'],
    ['-0', 'refuse'], ['0.0', 'refuse'], ['1e1', 'refuse'], ['-5', 'refuse'], ['3.7', 'refuse'],
    ['1e0', 'refuse'], ['0e0', 'refuse'], ['.0', 'refuse'], ['+0', 'refuse'], ['0x0', 'refuse'],
    ['Infinity', 'refuse'], ['NaN', 'refuse'], ['', 'refuse'],
    ['7', 7], ['007', 7], ['999', 999],
    // above 999: refused, never clamped (what the DM sees is what is sent) -- ruling 5
    ['1000', 'refuse'], ['99999999999999999999', 'refuse'],
  ];
  it.each(cases)('typed %j', async (typed, expected) => {
    openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(hpInput(), { target: { value: typed } });
    await apply();
    if (expected === 'confirm') {
      expect(mockSubmitOverride).not.toHaveBeenCalled();
      expect(confirmDialog()).toBeInTheDocument();
    } else if (expected === 'refuse') {
      expect(mockSubmitOverride).not.toHaveBeenCalled();
      expect(confirmDialog()).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(/New HP/i);
    } else {
      await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalledTimes(1));
      expect(sentHp()).toBe(expected);
      expect(confirmDialog()).not.toBeInTheDocument();
    }
  });

  it('whitespace-padded entry never reaches the handler as a zero (number input sanitises it)', async () => {
    openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(hpInput(), { target: { value: ' 0 ' } });
    await apply();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });

  it('every POST whose target_new_hp is 0 was preceded by a confirm click (sweep)', async () => {
    for (const typed of ['0', '00', ' 0', '0 ', '-0', '0.0', '0e0', '']) {
      mockSubmitOverride.mockClear();
      const { unmount } = openDamage([ACTOR, KAELEN], 'pc-1');
      fireEvent.change(hpInput(), { target: { value: typed } });
      await apply();
      // no confirm click => no POST at all, whatever was typed
      expect(mockSubmitOverride).not.toHaveBeenCalled();
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
describe('target HP edge values', () => {
  const run = async (target: CombatParticipantState) => {
    openDamage([ACTOR, target], target.participant_id);
  };
  it('hp_current 0 (already down): prefill 0, Apply asks for confirm', async () => {
    await run(mk('pc-9', 'Downed', 0, 10));
    expect(hpInput().value).toBe('0');
    await apply();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
    expect(confirmDialog()).toBeInTheDocument();
  });
  it('negative hp_current floors to 0 and asks for confirm', async () => {
    await run(mk('pc-9', 'Weird', -3, 10));
    expect(hpInput().value).toBe('0');
    await apply();
    expect(confirmDialog()).toBeInTheDocument();
  });
  it.each([
    ['null', null, ''], ['undefined', undefined, ''], ['NaN', NaN, ''], ['Infinity', Infinity, ''],
    ['fraction', 7.5, '7.5'], ['numeric string (wire drift)', '12', ''],
  ])('hp_current %s: Apply refuses, nothing POSTed', async (_n, v, shown) => {
    await run(mk('pc-9', 'Odd', 5, 10, { hp_current: v as unknown as number }));
    expect(hpInput().value).toBe(shown); // a fraction is displayed but still refused
    await apply();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
    expect(confirmDialog()).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/New HP/i);
  });
  it('hp_current > hp_max is not clamped to max (prefill follows current)', async () => {
    await run(mk('pc-9', 'Temp', 40, 30));
    expect(hpInput().value).toBe('40');
    await apply();
    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalledTimes(1));
    expect(sentHp()).toBe(40);
  });
  it('fractional hp_current minus damage never produces a decimal on the wire', async () => {
    await run(mk('pc-9', 'Frac', 7.5, 10));
    fireEvent.change(dealtInput(), { target: { value: '2' } });
    await apply();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });
  it('damage dealt is clamped to a non-negative integer, so New HP cannot exceed current via negative damage', () => {
    openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(dealtInput(), { target: { value: '-5' } });
    expect(hpInput().value).toBe('20');
    fireEvent.change(dealtInput(), { target: { value: '2.9' } });
    expect(hpInput().value).toBe('18');
  });
});

// ---------------------------------------------------------------------------
describe('polling: participants change underneath an open dialog', () => {
  it('untouched field follows hp_current; a typed value stands', () => {
    const { rerender } = openDamage([ACTOR, KAELEN], 'pc-1');
    rerender(<DmOverrideModal {...props([ACTOR, { ...KAELEN, hp_current: 12 }])} />);
    expect(hpInput().value).toBe('12');
    fireEvent.change(hpInput(), { target: { value: '4' } });
    rerender(<DmOverrideModal {...props([ACTOR, { ...KAELEN, hp_current: 30 }])} />);
    expect(hpInput().value).toBe('4');
  });

  it('a poll does NOT reset the form (reason / kind / target kept)', () => {
    const { rerender } = openDamage([ACTOR, KAELEN], 'pc-1');
    rerender(<DmOverrideModal {...props([ACTOR, { ...KAELEN, hp_hp: 1 } as CombatParticipantState])} />);
    expect((screen.getByLabelText(/Reason/i) as HTMLTextAreaElement).value).toBe('ruling');
    expect(targetSel().value).toBe('pc-1');
  });

  it('a poll between "confirm opened" and the click: the confirm closes, nothing is sent, re-Apply sends the new number (rulings 2/3; replaces the old "must still send 0" assertion)', async () => {
    const { rerender } = openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(dealtInput(), { target: { value: '20' } }); // untouched New HP derives 0
    await apply();
    expect(confirmDialog()).toBeInTheDocument();
    rerender(<DmOverrideModal {...props([ACTOR, { ...KAELEN, hp_current: 40 }])} />);
    expect(confirmDialog()).not.toBeInTheDocument();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
    await apply();
    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalledTimes(1));
    expect(sentHp()).toBe(20);
  });

  it('a poll that moves the resolved value off 0 closes the confirm', async () => {
    const { rerender } = openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(dealtInput(), { target: { value: '20' } });
    await apply();
    rerender(<DmOverrideModal {...props([ACTOR, { ...KAELEN, hp_current: 40 }])} />);
    expect(hpInput().value).toBe('20');
    expect(confirmDialog()).not.toBeInTheDocument();
  });

  it('confirm open + target vanishes from the poll: confirm closes, nothing is posted, Apply refuses (ruling 3: no `?? 0` fallback)', async () => {
    const { rerender } = openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(dealtInput(), { target: { value: '20' } });
    await apply();
    rerender(<DmOverrideModal {...props([ACTOR])} />);
    expect(confirmDialog()).not.toBeInTheDocument();
    await apply();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('target leaves the list entirely while selected: untouched field blanks and Apply refuses', async () => {
    const { rerender } = openDamage([ACTOR, KAELEN, LUKE], 'pc-1');
    rerender(<DmOverrideModal {...props([ACTOR, LUKE])} />);
    expect(hpInput().value).toBe('');
    await apply();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });

  it('target goes is_alive:false: select and New HP both clear', async () => {
    const { rerender } = openDamage([ACTOR, KAELEN], 'pc-1');
    rerender(<DmOverrideModal {...props([ACTOR, { ...KAELEN, is_alive: false }])} />);
    // select no longer has a matching option => it displays the placeholder
    expect(targetSel().value).toBe('');
    // the number on screen must not belong to a creature the DM cannot see selected
    expect(hpInput().value).toBe('');
  });

  it('choosing the target as ACTOR clears the target and its New HP', async () => {
    openDamage([ACTOR, KAELEN, LUKE], 'pc-1');
    fireEvent.change(screen.getByLabelText(/^Actor/), { target: { value: 'pc-1' } });
    expect(targetSel().value).toBe('');
    expect(hpInput().value).toBe('');
  });
});

// ---------------------------------------------------------------------------
describe('reopen resets (the effect, not the initial state)', () => {
  it('open, type New HP, close, reopen with a different default actor: New HP / target / confirm are reset', () => {
    const { rerender } = openDamage([ACTOR, KAELEN, LUKE], 'pc-1');
    fireEvent.change(hpInput(), { target: { value: '3' } });
    rerender(<DmOverrideModal {...props([ACTOR, KAELEN, LUKE])} open={false} />);
    rerender(<DmOverrideModal {...props([ACTOR, KAELEN, LUKE])} defaultActorId="pc-2" />);
    fireEvent.click(screen.getByRole('radio', { name: /Damage/i }));
    expect(targetSel().value).toBe('');
    expect(hpInput().value).toBe('');
    fireEvent.change(targetSel(), { target: { value: 'pc-1' } });
    expect(hpInput().value).toBe('20'); // not the stale '3'
  });

  it('closing with the confirm open, then reopening, must not show the confirm', async () => {
    const { rerender } = openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(hpInput(), { target: { value: '0' } });
    await apply();
    expect(confirmDialog()).toBeInTheDocument();
    rerender(<DmOverrideModal {...props([ACTOR, KAELEN])} open={false} />);
    expect(confirmDialog()).not.toBeInTheDocument();
    rerender(<DmOverrideModal {...props([ACTOR, KAELEN])} />);
    expect(confirmDialog()).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('double submit / re-entry', () => {
  async function toConfirm() {
    openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(hpInput(), { target: { value: '0' } });
    await apply();
    expect(confirmDialog()).toBeInTheDocument();
  }

  it('a form submit (Enter / key-repeat) while the confirm is open does not send', async () => {
    await toConfirm();
    const form = hpInput().closest('form') as HTMLFormElement;
    await act(async () => { fireEvent.submit(form); });
    // The DM never pressed "Drop to 0 HP".
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });

  it('clicking the confirm button twice in separate events posts once (the dialog unmounts between them)', async () => {
    mockSubmitOverride.mockReturnValue(new Promise(() => {})); // never resolves
    await toConfirm();
    const btn = confirmBtn();
    await act(async () => { fireEvent.click(btn); });
    await act(async () => { fireEvent.click(btn); });
    expect(mockSubmitOverride).toHaveBeenCalledTimes(1);
    expect(confirmDialog()).not.toBeInTheDocument();
    expect(applyBtn()).toBeDisabled();
  });

  it('submit while a request is in flight does not post again', async () => {
    mockSubmitOverride.mockReturnValue(new Promise(() => {}));
    openDamage([ACTOR, KAELEN], 'pc-1');
    await apply();
    const form = hpInput().closest('form') as HTMLFormElement;
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(mockSubmitOverride).toHaveBeenCalledTimes(1);
  });

  it('a failed confirmed send leaves the form editable with the error shown and the confirm gone', async () => {
    mockSubmitOverride.mockRejectedValue({ body: { data: { reason: 'target_not_found' } } });
    await toConfirm();
    await act(async () => { fireEvent.click(confirmBtn()); });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/target not found/i));
    expect(confirmDialog()).not.toBeInTheDocument();
    expect(hpInput()).toBeEnabled();
    // second attempt must re-ask, not send straight through
    await apply();
    expect(mockSubmitOverride).toHaveBeenCalledTimes(1);
    expect(confirmDialog()).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('keyboard / focus around the confirm', () => {
  async function toConfirmFocused() {
    openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(hpInput(), { target: { value: '0' } });
    act(() => applyBtn().focus());
    await apply();
    await waitFor(() => expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^Cancel$/ })).toHaveFocus());
  }

  it('confirm opens with focus on its Cancel button', async () => { await toConfirmFocused(); });

  it('Cancel returns focus to Apply override', async () => {
    await toConfirmFocused();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^Cancel$/ }));
    expect(applyBtn()).toHaveFocus();
  });

  it('Escape on the confirm returns focus to Apply override and keeps the override open', async () => {
    await toConfirmFocused();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(applyBtn()).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking the confirm backdrop cancels only the confirm', async () => {
    await toConfirmFocused();
    fireEvent.click(screen.getByRole('alertdialog').parentElement as HTMLElement);
    expect(confirmDialog()).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });

  it('Tab on the confirm cycles inside it (trap), does not leak to the override trap', async () => {
    await toConfirmFocused();
    const dlg = screen.getByRole('alertdialog');
    const cancel = within(dlg).getByRole('button', { name: /^Cancel$/ });
    const ok = within(dlg).getByRole('button', { name: /Drop to 0 HP/i });
    ok.focus();
    fireEvent.keyDown(ok, { key: 'Tab' });
    expect(cancel).toHaveFocus();
  });

  it('after a failed confirmed send, focus is inside the override dialog, not <body>', async () => {
    mockSubmitOverride.mockRejectedValue({ body: { data: { reason: 'target_not_found' } } });
    await toConfirmFocused();
    await act(async () => { fireEvent.click(confirmBtn()); });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: /DM Override/i })).toContainElement(document.activeElement as HTMLElement);
  });
});

describe('stale-confirm close, no-target refusal, repeated failure focus', () => {
  it('after a poll closed the confirm, the value returning to 0 does not re-open it without Apply', async () => {
    const { rerender } = openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(dealtInput(), { target: { value: '20' } }); // derived 0
    await apply();
    expect(confirmDialog()).toBeInTheDocument();
    rerender(<DmOverrideModal {...props([ACTOR, { ...KAELEN, hp_current: 40 }])} />);
    expect(confirmDialog()).not.toBeInTheDocument();
    rerender(<DmOverrideModal {...props([ACTOR, { ...KAELEN, hp_current: 20 }])} />);
    expect(hpInput().value).toBe('0');
    expect(confirmDialog()).not.toBeInTheDocument();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });

  it('a typed New HP with no target refuses and never posts target_id: null', async () => {
    openDamage([ACTOR, KAELEN]);
    fireEvent.change(hpInput(), { target: { value: '5' } });
    await apply();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Target is required/i);
  });

  it('the same send failing twice moves focus to the error both times', async () => {
    mockSubmitOverride.mockRejectedValue({ body: { message: 'nope' } });
    openDamage([ACTOR, KAELEN], 'pc-1');
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    await apply();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')));
    act(() => (screen.getByLabelText(/Reason/i) as HTMLElement).focus());
    expect(document.activeElement).not.toBe(screen.getByRole('alert'));
    await apply();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')));
    expect(mockSubmitOverride).toHaveBeenCalledTimes(2);
  });

  it('a synchronous client throw (clear + refuse in one batch) still re-focuses the error on the repeat', async () => {
    mockSubmitOverride.mockImplementation(() => { throw { body: { message: 'nope' } }; });
    openDamage([ACTOR, KAELEN], 'pc-1');
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    await apply();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')));
    act(() => (screen.getByLabelText(/Reason/i) as HTMLElement).focus());
    await apply();
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(document.activeElement).toBe(screen.getByRole('alert'));
  });
});

describe('poll notices: focus, clearing, open gate, field wiring', () => {
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const dead = (p: CombatParticipantState) => ({ ...p, is_alive: false });

  it('a notice after a failed send keeps focus inside the dialog (the alert node is not remounted)', async () => {
    mockSubmitOverride.mockRejectedValue({ body: { message: "Target 'pc-1' is already down.", data: { reason: 'target_down' } } });
    const { rerender } = openDamage([ACTOR, KAELEN, LUKE], 'pc-1');
    await settle();
    await apply();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')));
    rerender(<DmOverrideModal {...props([ACTOR, dead(KAELEN), LUKE])} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Kaelen is no longer a valid target/);
    const dlg = screen.getByRole('dialog', { name: /DM Override/i });
    expect(dlg).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(screen.getByRole('alert'));
  });

  it('picking a target clears "Target is required"', async () => {
    openDamage([ACTOR, KAELEN]);
    await apply();
    expect(screen.getByRole('alert')).toHaveTextContent(/Target is required/);
    fireEvent.change(targetSel(), { target: { value: 'pc-1' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(targetSel()).not.toHaveAttribute('aria-invalid');
  });

  it('picking a target clears the "no longer a valid target" notice', () => {
    const { rerender } = openDamage([ACTOR, KAELEN, LUKE], 'pc-1');
    rerender(<DmOverrideModal {...props([ACTOR, dead(KAELEN), LUKE])} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/no longer a valid target/);
    fireEvent.change(targetSel(), { target: { value: 'pc-2' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('the cleared-target notice is a form notice: no input marked invalid, Reason not described', () => {
    const { rerender } = openDamage([ACTOR, KAELEN, LUKE], 'pc-1');
    rerender(<DmOverrideModal {...props([ACTOR, dead(KAELEN), LUKE])} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/no longer a valid target/);
    for (const el of [targetSel(), hpInput(), screen.getByLabelText(/Reason/i)]) {
      expect(el).not.toHaveAttribute('aria-invalid');
    }
    expect(screen.getByLabelText(/Reason/i)).not.toHaveAttribute('aria-describedby');
    expect(targetSel()).not.toHaveAttribute('aria-describedby');
  });

  it.each(['Check', 'Save'])('the cleared-target notice does not fire for %s kind', (k) => {
    const { rerender } = openDamage([ACTOR, KAELEN, LUKE], 'pc-1');
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(k, 'i') }));
    rerender(<DmOverrideModal {...props([ACTOR, dead(KAELEN), LUKE])} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a target dying while the modal is closed leaves no notice for the next open', async () => {
    const { rerender } = openDamage([ACTOR, KAELEN, LUKE], 'pc-1');
    rerender(<DmOverrideModal {...{ ...props([ACTOR, KAELEN, LUKE]), open: false }} />);
    rerender(<DmOverrideModal {...{ ...props([ACTOR, dead(KAELEN), LUKE]), open: false }} />);
    // The open effect clears errors after the first commit, so watch the DOM
    // for an alert node being inserted at all, not just its final state.
    const inserted: string[] = [];
    const mo = new MutationObserver(() => {});
    mo.observe(document.body, { childList: true, subtree: true });
    rerender(<DmOverrideModal {...props([ACTOR, dead(KAELEN), LUKE])} />);
    // (An inserted alert that the open effect then removes is no longer inside
    // the added subtree, but shows up as a removed node with its text intact.)
    for (const r of mo.takeRecords()) {
      for (const n of [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)]) {
        if (n instanceof HTMLElement) {
          const a = n.matches('[role="alert"]') ? n : n.querySelector('[role="alert"]');
          if (a) inserted.push(a.textContent ?? '');
        }
      }
    }
    mo.disconnect();
    expect(inserted).toEqual([]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a stale-confirm close while the modal is closed leaves no notice for the next open', async () => {
    const { rerender } = openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(dealtInput(), { target: { value: '20' } }); // derived 0
    await apply();
    expect(confirmDialog()).toBeInTheDocument();
    rerender(<DmOverrideModal {...{ ...props([ACTOR, KAELEN]), open: false }} />);
    rerender(<DmOverrideModal {...{ ...props([ACTOR, { ...KAELEN, hp_current: 40 }]), open: false }} />);
    const seen: string[] = [];
    const mo = new MutationObserver(() => {});
    mo.observe(document.body, { childList: true, subtree: true });
    rerender(<DmOverrideModal {...props([ACTOR, { ...KAELEN, hp_current: 40 }])} />);
    for (const r of mo.takeRecords()) {
      for (const n of [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)]) {
        if (n instanceof HTMLElement) {
          const a = n.matches('[role="alert"]') ? n : n.querySelector('[role="alert"]');
          if (a) seen.push(a.textContent ?? '');
        }
      }
    }
    mo.disconnect();
    expect(seen).toEqual([]);
  });
});
