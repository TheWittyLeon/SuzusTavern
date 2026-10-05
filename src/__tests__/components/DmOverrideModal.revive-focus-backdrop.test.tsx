/**
 * Revive dialog: one-shot focus-on-open (including nobody fallen), pins for the
 * focus effect's reset / tick / fallback arms, the backdrop (press must begin on
 * it; not within the arm window after open), and the small a11y/gesture items.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
const mockSubmitOverride = jest.fn();
jest.mock('../../lib/api/dnd', () => ({ setSessionPolicy: jest.fn(), npcAction: jest.fn(), postSessionEvent: jest.fn(), submitOverride: (...a: unknown[]) => mockSubmitOverride(...a) }));
import DmOverrideModal from '@/components/DmOverrideModal';
import DmNarrationPanel from '@/components/DmNarrationPanel';
import { OverrideHostFor } from '@/test-utils/OverrideHostFor';
import type { CombatParticipantState, CombatState } from '@/lib/api/types';
const mk = (id: string, name: string, hp: number, max: number, extra: Partial<CombatParticipantState> = {}): CombatParticipantState => ({
  participant_id: id, entity_id: id, name, is_pc: id.startsWith('pc'), initiative: 10, hp_current: hp, hp_max: max, ac: 12, conditions: [],
  is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false, ...extra });
const GOBLIN = mk('goblin-1', 'Goblin', 7, 7);
const K_DEAD = mk('pc-1', 'Kestrel', 0, 34, { is_alive: false });
const L_DEAD = mk('pc-2', 'Luke', 0, 30, { is_alive: false });
const settle = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const props = (participants: CombatParticipantState[], extra: Record<string, unknown> = {}) => ({ open: true, combatId: 'c1', participants, defaultActorId: 'goblin-1', onSuccess: jest.fn(), onClose: jest.fn(), ...extra });
const hpIn = () => screen.getByLabelText(/Restore to HP/i) as HTMLInputElement;
beforeEach(() => { jest.clearAllMocks(); });

test('PIN-M1: once focus has landed, a later commit does not take it back (DM typing in Reason, then a poll)', async () => {
  const p = props([GOBLIN, K_DEAD], { initialKind: 'revive' });
  const { rerender } = render(<DmOverrideModal {...p} />);
  await settle();
  expect(document.activeElement).toBe(screen.getByLabelText(/Restore to HP/i));
  const reason = screen.getByLabelText(/Reason/i) as HTMLTextAreaElement;
  reason.focus(); fireEvent.change(reason, { target: { value: 'typing' } });
  rerender(<DmOverrideModal {...p} participants={[GOBLIN, { ...K_DEAD }]} />); await settle();
  expect(document.activeElement).toBe(reason);
});

test('PIN-M4: reopening as Revive with nothing changed still moves focus in (two fallen, nothing picked)', async () => {
  const p = props([GOBLIN, K_DEAD, L_DEAD], { initialKind: 'revive' });
  const outside = document.createElement('button'); document.body.appendChild(outside);
  const { rerender } = render(<DmOverrideModal {...p} />);
  await settle();
  expect(document.activeElement).toBe(screen.getByLabelText(/^Character/));
  rerender(<DmOverrideModal {...p} open={false} />); await settle();
  outside.focus();
  rerender(<DmOverrideModal {...p} open />); await settle();
  expect(document.activeElement).toBe(screen.getByLabelText(/^Character/));
  outside.remove();
});

test('PIN-M6: Chromium shape — the opener HELD focus, then unmounts with the revive: focus goes to DM Override, not <body>', async () => {
  const st = (ps: CombatParticipantState[]): CombatState => ({ combat_id: 'c1', session_id: 's1', round: 1, state: 'active', turn_index: 0, active_participant_id: 'goblin-1', initiative: ps.map((x) => x.participant_id), participants: ps });
  const K_UP = mk('pc-1', 'Kestrel', 14, 34);
  mockSubmitOverride.mockResolvedValue({ applied: { message: 'Kestrel is revived.' }, state: st([GOBLIN, K_UP]) });
  function Host() {
    const [cs, setCs] = React.useState(st([GOBLIN, K_DEAD]));
    return <OverrideHostFor combatState={cs} onStateUpdate={(s: CombatState) => setCs(s)}><DmNarrationPanel combatId="c1" combatState={cs} sessionId="s1" dmUsername="dm" onMessage={jest.fn()} onStateUpdate={(s: CombatState) => setCs(s)} onStateRefresh={jest.fn()} /></OverrideHostFor>;
  }
  render(<Host />);
  const opener = screen.getByRole('button', { name: 'Revive…' });
  opener.focus(); fireEvent.click(opener); await settle();
  fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'up' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Revive Kestrel at/ })); });
  await settle();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open DM override modal' }));
});

test('PIN-M8: a typed Restore HP does not survive close and reopen', async () => {
  const p = props([GOBLIN, K_DEAD], { initialKind: 'revive', lastAliveHp: { 'pc-1': 12 } });
  const { rerender } = render(<DmOverrideModal {...p} />);
  await settle();
  fireEvent.change(screen.getByLabelText(/Restore to HP/i), { target: { value: '9' } });
  rerender(<DmOverrideModal {...p} open={false} />); await settle();
  rerender(<DmOverrideModal {...p} open />); await settle();
  expect((screen.getByLabelText(/Restore to HP/i) as HTMLInputElement).value).toBe('12');
});

describe('one-shot focus', () => {
  it('nobody fallen: the dialog itself takes focus, Escape closes, and a later fallen PC does not steal focus', async () => {
    const onClose = jest.fn();
    const p = props([GOBLIN], { initialKind: 'revive', onClose });
    const { rerender } = render(<DmOverrideModal {...p} />);
    await settle();
    const dlg = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dlg);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<DmOverrideModal {...p} participants={[GOBLIN, K_DEAD]} />);
    await settle();
    expect(document.activeElement).toBe(dlg);
  });

  it('switching Damage then Revive again does not pull focus into the HP field', async () => {
    render(<DmOverrideModal {...props([GOBLIN, K_DEAD], { initialKind: 'revive' })} />);
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: /Damage/i }));
    const revive = screen.getByRole('radio', { name: /Revive/i });
    revive.focus();
    fireEvent.click(revive);
    await settle();
    expect(document.activeElement).toBe(revive);
  });
});

describe('quick-set and field attributes', () => {
  it('a quick button refocuses the HP field (value set, no extra send)', () => {
    render(<DmOverrideModal {...props([GOBLIN, K_DEAD], { initialKind: 'revive' })} />);
    const full = screen.getByRole('button', { name: 'Set to full, 34 HP' });
    full.focus();
    fireEvent.click(full);
    expect(hpIn().value).toBe('34');
    expect(document.activeElement).toBe(hpIn());
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });

  it('the HP field asks for the numeric keypad', () => {
    render(<DmOverrideModal {...props([GOBLIN, K_DEAD], { initialKind: 'revive' })} />);
    expect(hpIn()).toHaveAttribute('inputmode', 'numeric');
  });

  it('several fallen, none picked: no "1 to 1." hint and no max=1', () => {
    render(<DmOverrideModal {...props([GOBLIN, K_DEAD, L_DEAD], { initialKind: 'revive' })} />);
    expect(screen.queryByText(/1 to 1\./)).not.toBeInTheDocument();
    expect(screen.getByText(/Pick a character first\./)).toBeInTheDocument();
    expect(hpIn()).not.toHaveAttribute('max');
  });

  it('the ceiling is min(hp_max, 999): a 1500 max offers Full (999) and max=999', () => {
    render(<DmOverrideModal {...props([GOBLIN, mk('pc-1', 'Titan', 0, 1500, { is_alive: false })], { initialKind: 'revive' })} />);
    expect(screen.getByRole('button', { name: 'Set to full, 999 HP' })).toBeInTheDocument();
    expect(hpIn()).toHaveAttribute('max', '999');
  });
});

describe('backdrop', () => {
  const dialogOpen = async (onClose = jest.fn(), armed = true) => {
    const utils = render(<DmOverrideModal {...props([GOBLIN, K_DEAD], { initialKind: 'revive', onClose })} />);
    if (armed) await settle(350);
    return { ...utils, backdrop: utils.container.firstChild as HTMLElement, onClose };
  };

  it('a click within the arm window after open is ignored (second click of an opener double-click)', async () => {
    const { backdrop, onClose } = await dialogOpen(jest.fn(), false);
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('a press that began in the HP field and was released on the backdrop keeps the dialog and the draft', async () => {
    const { backdrop, onClose } = await dialogOpen();
    fireEvent.change(hpIn(), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'my draft' } });
    fireEvent.pointerDown(hpIn());
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    expect(hpIn().value).toBe('9');
    expect((screen.getByLabelText(/Reason/i) as HTMLTextAreaElement).value).toBe('my draft');
  });

  it('a press and release on the backdrop, after the arm window, still closes', async () => {
    const { backdrop, onClose } = await dialogOpen();
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a click with no pointer-down on the backdrop does not close (stale press state is consumed)', async () => {
    const { backdrop, onClose } = await dialogOpen();
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('panel openers', () => {
  const st = (ps: CombatParticipantState[], state: CombatState['state'] = 'active'): CombatState => ({ combat_id: 'c1', session_id: 's1', round: 1, state, turn_index: 0, active_participant_id: 'goblin-1', initiative: ps.map((x) => x.participant_id), participants: ps });
  const panel = (cs: CombatState) => (
    <OverrideHostFor combatState={cs}><DmNarrationPanel combatId="c1" combatState={cs} sessionId="s1" dmUsername="dm" onMessage={jest.fn()} onStateUpdate={jest.fn()} onStateRefresh={jest.fn()} /></OverrideHostFor>
  );

  it('both openers announce a dialog', () => {
    render(panel(st([GOBLIN, K_DEAD])));
    expect(screen.getByRole('button', { name: 'Revive…' })).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.getByRole('button', { name: 'Open DM override modal' })).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('the visibility toggle comes before the conditional opener, so it does not move when the opener appears', () => {
    render(panel(st([GOBLIN, K_DEAD])));
    const toggle = screen.getByLabelText('Show my overrides to players');
    const opener = screen.getByRole('button', { name: 'Revive…' });
    expect(toggle.compareDocumentPosition(opener) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the visibility toggle is 44px tall', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../components/DmNarrationPanel.module.css'), 'utf8');
    expect(css.match(/\.visibilityToggle\s*\{[^}]*\}/)?.[0] ?? '').toMatch(/min-height:\s*44px/);
  });

  it('uses the engine rule for a live fight: not offered in between_turns (engine refuses it)', () => {
    render(panel(st([GOBLIN, K_DEAD], 'between_turns')));
    expect(screen.queryByRole('button', { name: 'Revive…' })).not.toBeInTheDocument();
  });

  it('a double-click on Revive… leaves exactly one dialog (the second click lands on the backdrop)', async () => {
    render(panel(st([GOBLIN, K_DEAD])));
    const opener = screen.getByRole('button', { name: 'Revive…' });
    fireEvent.click(opener);
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});
