/**
 * DmOverrideModal while the fight is HELD with a character still standing (the engine's heal-resume: ENG routes/combat.py, while held an override that leaves any PC above 0 HP is
 * accepted). Aoi's addendum 2: the dialog lists EVERY player character, the title says "Resume the fight", there are no kind radios, a living pick's HP field reads "HP after
 * resuming" and defaults to their CURRENT HP, and Apply reads "Resume with {name} at {N} HP". The wire is the same damage override a revive sends. The stale guard becomes "the
 * fight is no longer held": send nothing.
 */
import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
const mockSubmitOverride = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('../../lib/api/dnd', () => ({ submitOverride: (...args: Parameters<AnyFn>) => mockSubmitOverride(...args) }));

import DmOverrideModal from '@/components/DmOverrideModal';
import type { CombatParticipantState } from '@/lib/api/types';

const mk = (id: string, name: string, hp: number, max: number, extra: Partial<CombatParticipantState> = {}): CombatParticipantState => ({
  participant_id: id, entity_id: id, name, is_pc: id.startsWith('pc'), initiative: 10, hp_current: hp, hp_max: max, ac: 12,
  conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false, ...extra,
});
const GOBLIN = mk('goblin-1', 'Goblin', 7, 7);
const KESTREL = mk('pc-1', 'Kestrel', 0, 34, { is_alive: false });
const DALEN = mk('pc-2', 'Dalen', 12, 34);
const SOLO = mk('pc-3', 'Sola', 3, 20);

const props = (participants: CombatParticipantState[], extra: Record<string, unknown> = {}) => ({
  open: true, combatId: 'c1', participants, defaultActorId: 'goblin-1', held: true, onSuccess: jest.fn(), onClose: jest.fn(), ...extra,
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const sel = () => screen.getByLabelText(/^Character/) as HTMLSelectElement;
const hp = () => screen.getByLabelText(/HP after resuming|Restore to HP/) as HTMLInputElement;
const reason = () => screen.getByLabelText(/Reason/i) as HTMLTextAreaElement;
const submit = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
const sentBody = () => mockSubmitOverride.mock.calls[0][1] as Record<string, unknown>;

beforeEach(() => {
  jest.clearAllMocks();
  mockSubmitOverride.mockResolvedValue({ applied: { message: 'The fight resumes.' } });
});

describe('held with a character standing', () => {
  it('the title, no kind radios, and every player character listed: the fallen as fallen, the living with their HP', () => {
    render(<DmOverrideModal {...props([GOBLIN, KESTREL, DALEN])} />);
    expect(screen.getByRole('dialog', { name: 'Resume the fight' })).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(within(sel()).getAllByRole('option').map((o) => o.textContent)).toEqual(['— pick character —', 'Kestrel (fallen, max 34)', 'Dalen (12 of 34 HP)']);
  });

  it('monsters are never listed (the engine takes PC targets only)', () => {
    render(<DmOverrideModal {...props([GOBLIN, DALEN])} />);
    expect(within(sel()).queryByRole('option', { name: /Goblin/ })).toBeNull();
  });

  it('the one standing character is preselected, the HP field reads "HP after resuming" and defaults to their CURRENT HP, with the unchanged-HP hint', async () => {
    render(<DmOverrideModal {...props([GOBLIN, SOLO])} />);
    await settle();
    expect(sel().value).toBe('pc-3');
    expect(hp().value).toBe('3');
    expect(screen.getByText('Set to their current HP to change nothing. Any other number changes their HP.')).toBeInTheDocument();
    expect(reason()).toHaveAttribute('placeholder', 'Why is the fight resuming?');
    expect(submit()).toHaveTextContent('Resume with Sola at 3 HP');
  });

  it('with several listed there is a choice: the Character select takes focus, and picking a living one fills their HP', async () => {
    render(<DmOverrideModal {...props([GOBLIN, KESTREL, DALEN], { initialKind: 'revive' })} />);
    await settle();
    expect(sel()).toHaveFocus();
    fireEvent.change(sel(), { target: { value: 'pc-2' } });
    expect(hp().value).toBe('12');
    expect(submit()).toHaveTextContent('Resume with Dalen at 12 HP');
  });

  it('Apply sends the same damage override a revive does, with the typed HP and the reason, once; the busy label is "Resuming…"', async () => {
    render(<DmOverrideModal {...props([GOBLIN, DALEN])} />);
    await settle();
    fireEvent.change(sel(), { target: { value: 'pc-2' } });
    fireEvent.change(hp(), { target: { value: '20' } });
    fireEvent.change(reason(), { target: { value: 'The cleric healed him.' } });
    let release!: (v: unknown) => void;
    mockSubmitOverride.mockImplementation(() => new Promise((r) => { release = r; }));
    await act(async () => { fireEvent.click(submit()); });
    expect(submit()).toHaveAttribute('aria-label', 'Resuming…');
    expect(submit()).toHaveTextContent('Resuming…');
    expect(mockSubmitOverride).toHaveBeenCalledTimes(1);
    expect(sentBody()).toEqual({ kind: 'damage', actor_id: 'pc-2', target_id: 'pc-2', outcome: { damage_dealt: 0, target_new_hp: 20, raw_damage: 0 }, reason: 'The cleric healed him.' });
    await act(async () => { release({ applied: { message: 'ok' } }); });
  });

  it('a fallen pick in the same list still reads as a revive (its own label)', async () => {
    render(<DmOverrideModal {...props([GOBLIN, KESTREL, DALEN])} />);
    await settle();
    fireEvent.change(sel(), { target: { value: 'pc-1' } });
    expect(screen.getByLabelText('Restore to HP *')).toBeInTheDocument();
    expect(submit()).toHaveTextContent('Revive Kestrel at 1 HP');
  });

  it('the reason is required, as for every override', async () => {
    render(<DmOverrideModal {...props([GOBLIN, SOLO])} />);
    await settle();
    expect(submit()).toBeDisabled();
  });

  it('HP 0 is refused (a resume leaves a character above 0)', async () => {
    render(<DmOverrideModal {...props([GOBLIN, SOLO])} />);
    await settle();
    fireEvent.change(hp(), { target: { value: '0' } });
    fireEvent.change(reason(), { target: { value: 'x' } });
    await act(async () => { fireEvent.click(submit()); });
    expect(screen.getByRole('alert')).toHaveTextContent(/between 1 and 20/);
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });
});

describe('the stale guard: the fight is no longer held, send nothing', () => {
  it('a living pick whose fight went on under the open dialog: "The fight is already going again. Nothing was sent."', async () => {
    const { rerender } = render(<DmOverrideModal {...props([GOBLIN, SOLO])} />);
    await settle();
    fireEvent.change(reason(), { target: { value: 'x' } });
    rerender(<DmOverrideModal {...props([GOBLIN, SOLO], { held: false })} />);
    await act(async () => { fireEvent.click(submit()); });
    expect(screen.getByRole('alert')).toHaveTextContent('The fight is already going again. Nothing was sent.');
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });

  it('control: still held, the same pick goes out', async () => {
    render(<DmOverrideModal {...props([GOBLIN, SOLO])} />);
    await settle();
    fireEvent.change(reason(), { target: { value: 'x' } });
    await act(async () => { fireEvent.click(submit()); });
    expect(mockSubmitOverride).toHaveBeenCalledTimes(1);
  });

  it('never held at all (an ordinary revive whose character a poll shows alive): the revive\'s own words', async () => {
    const { rerender } = render(<DmOverrideModal {...props([GOBLIN, KESTREL], { held: false, initialKind: 'revive', initialTargetId: 'pc-1' })} />);
    await settle();
    fireEvent.change(reason(), { target: { value: 'x' } });
    rerender(<DmOverrideModal {...props([GOBLIN, { ...KESTREL, is_alive: true, hp_current: 5 }], { held: false, initialKind: 'revive', initialTargetId: 'pc-1' })} />);
    await act(async () => { fireEvent.click(submit()); });
    expect(screen.getByRole('alert')).toHaveTextContent('Kestrel is already back on their feet. Nothing was sent.');
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });
});

describe('the hold landing under an open dialog (no stale "no longer a valid target" beside the preselected character)', () => {
  it('an Attack dialog targeting the character who just fell: switched to Revive, that character preselected, no notice', async () => {
    const live = [GOBLIN, mk('pc-1', 'Kestrel', 4, 34)];
    const { rerender } = render(<DmOverrideModal {...props(live, { held: false })} />);
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: /Attack/i }));
    fireEvent.change(screen.getByLabelText(/^Target/), { target: { value: 'pc-1' } });
    rerender(<DmOverrideModal {...props([GOBLIN, KESTREL], { held: true })} />);
    await settle();
    expect(sel().value).toBe('pc-1');
    expect(screen.queryByText(/no longer a valid target/)).toBeNull();
  });
});
