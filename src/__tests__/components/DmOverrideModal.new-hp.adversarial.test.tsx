/**
 * Miko-QA adversarial pass on TAV-DM-OVERRIDE-MODAL-DEFAULTS-NEW-HP-ZERO.
 * Land as src/__tests__/components/DmOverrideModal.new-hp.adversarial.test.tsx.
 *
 * Tests prefixed "FINDING:" assert the CORRECT behaviour and are RED at e574589
 * on purpose; they go green when the developer fixes the finding. Everything
 * else is green at e574589 and kills a mutant his 14 tests miss.
 *
 * Invariant under test: a POST carrying target_new_hp === 0 is only ever sent
 * after the DM clicked the confirm button for THAT zero.
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
    // clamp: shown value and sent value differ (documented, not asserted as a defect)
    ['1000', 999], ['99999999999999999999', 999],
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

  it('FINDING: a poll between "confirm opened" and "confirm clicked" must not change what is sent', async () => {
    const { rerender } = openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(dealtInput(), { target: { value: '20' } }); // untouched New HP derives 0
    await apply();
    expect(confirmDialog()).toBeInTheDocument(); // "drops Kaelen to 0 HP"
    // poll lands: Kaelen healed to 40. The dialog still says 0 ...
    rerender(<DmOverrideModal {...props([ACTOR, { ...KAELEN, hp_current: 40 }])} />);
    await act(async () => { fireEvent.click(confirmBtn()); });
    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalledTimes(1));
    // ... so what was confirmed (0) and what is sent must agree. At e574589 it sends 20.
    expect(sentHp()).toBe(0);
  });

  it('FINDING: if the poll invalidates the confirmed zero, the dialog must close (stale "drops X to 0 HP" copy)', async () => {
    const { rerender } = openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(dealtInput(), { target: { value: '20' } });
    await apply();
    rerender(<DmOverrideModal {...props([ACTOR, { ...KAELEN, hp_current: 40 }])} />);
    expect(hpInput().value).toBe('20');
    expect(confirmDialog()).not.toBeInTheDocument();
  });

  it('confirmed derived zero + target vanishes from the poll: the confirm path still posts 0 via the `?? 0` fallback (documented)', async () => {
    const { rerender } = openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(dealtInput(), { target: { value: '20' } });
    await apply();
    rerender(<DmOverrideModal {...props([ACTOR])} />);
    await act(async () => { fireEvent.click(confirmBtn()); });
    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalledTimes(1));
    expect(sentHp()).toBe(0);
  });

  it('target leaves the list entirely while selected: untouched field blanks and Apply refuses', async () => {
    const { rerender } = openDamage([ACTOR, KAELEN, LUKE], 'pc-1');
    rerender(<DmOverrideModal {...props([ACTOR, LUKE])} />);
    expect(hpInput().value).toBe('');
    await apply();
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });

  it('FINDING: target goes is_alive:false (select drops the option) -> select shows no target but a New HP and a stale target_id remain', async () => {
    const { rerender } = openDamage([ACTOR, KAELEN], 'pc-1');
    rerender(<DmOverrideModal {...props([ACTOR, { ...KAELEN, is_alive: false }])} />);
    // select no longer has a matching option => it displays the placeholder
    expect(targetSel().value).toBe('');
    // the number on screen must not belong to a creature the DM cannot see selected
    expect(hpInput().value).toBe('');
  });

  it('FINDING: choosing the target as ACTOR hides it from the Target select but keeps its New HP and target_id', async () => {
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

  it('FINDING: a form submit (Enter in a field / key-repeat on Apply) while the confirm is open must NOT send', async () => {
    await toConfirm();
    const form = hpInput().closest('form') as HTMLFormElement;
    await act(async () => { fireEvent.submit(form); });
    // The DM never clicked "Drop to 0 HP". At e574589 confirmZero doubles as "already confirmed" and this POSTs 0.
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

  it('PRE-EXISTING (also true on the non-zero path, browser-verified): after a failed send, focus must be inside the override dialog, not <body>', async () => {
    mockSubmitOverride.mockRejectedValue({ body: { data: { reason: 'target_not_found' } } });
    await toConfirmFocused();
    await act(async () => { fireEvent.click(confirmBtn()); });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: /DM Override/i })).toContainElement(document.activeElement as HTMLElement);
  });

  it('Escape on a form field while the confirm is up: the override Escape handler CAN fire (sibling render does not protect a keydown that starts behind the confirm)', async () => {
    openDamage([ACTOR, KAELEN], 'pc-1');
    fireEvent.change(hpInput(), { target: { value: '0' } });
    await apply(); // focus has not yet moved (timer 0 not flushed)
    fireEvent.keyDown(hpInput(), { key: 'Escape' });
    // documents current behaviour: override closes under the confirm. Real-browser reachability is
    // limited to the sub-tick before the confirm steals focus; see report.
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
