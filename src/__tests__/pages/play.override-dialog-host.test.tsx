/**
 * TPK-HOLD W3 — the override dialog has ONE mount (the host above the shell) and any number of openers. These pin what the lift
 * could get wrong: a second dialog, an opener shown to a seat that cannot override, a dialog that outlives its fight, a ruling that
 * never reaches the log, and focus that lands on <body> when the opener is gone.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockSubmitOverride = jest.fn();
jest.mock('../../lib/api/dnd', () => ({ submitOverride: (...a: unknown[]) => mockSubmitOverride(...a) }));

import { OverrideDialogHost, useOverrideDialog } from '@/app/play/[sessionId]/overrideDialog';
import type { CombatParticipantState, CombatState } from '@/lib/api/types';

const mk = (id: string, name: string, hp: number, max: number, extra: Partial<CombatParticipantState> = {}): CombatParticipantState => ({
  participant_id: id, entity_id: id, name, is_pc: id.startsWith('pc'), initiative: 10, hp_current: hp, hp_max: max, ac: 12,
  conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false, ...extra,
});
const GOBLIN = mk('goblin-1', 'Goblin', 7, 7);
const DEAD = mk('pc-1', 'Kestrel', 0, 34, { is_alive: false });
const fight = (ps: CombatParticipantState[], state: CombatState['state'] = 'active'): CombatState => ({
  combat_id: 'c1', session_id: 's1', round: 1, state, turn_index: 0, active_participant_id: 'goblin-1',
  initiative: ps.map((p) => p.participant_id), participants: ps,
});

/** Two openers in two places, as the panel and the stage are. Each is its own button. */
function Openers({ fallback }: { fallback?: () => HTMLElement | null }) {
  const d = useOverrideDialog();
  return (
    <>
      <button type="button" onClick={() => d?.open({ fallback })}>open A</button>
      <button type="button" onClick={() => d?.open({ kind: 'revive' })}>open B</button>
      <span>{d ? 'can override' : 'cannot override'}</span>
    </>
  );
}

const host = (over: Partial<React.ComponentProps<typeof OverrideDialogHost>> = {}, children: React.ReactNode = <Openers />) => (
  <OverrideDialogHost
    isHumanDM combatId="c1" combatState={fight([GOBLIN, DEAD])} dmUsername="dm" appendLog={jest.fn()}
    onStateUpdate={jest.fn()} onStateRefresh={jest.fn()} fallbackFocus={() => document.body} {...over}
  >
    {children}
  </OverrideDialogHost>
);

beforeEach(() => jest.clearAllMocks());

describe('one mount, many openers', () => {
  it('either opener opens the same single dialog; the second asks for Revive', () => {
    render(host());
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'open A' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /Attack/i })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Close override modal/i }));
    fireEvent.click(screen.getByRole('button', { name: 'open B' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /Revive/i })).toBeChecked();
  });

  it('a seat that cannot override gets no handle, and no dialog', () => {
    render(host({ isHumanDM: false }));
    expect(screen.getByText('cannot override')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'open A' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no handle while there is no live fight (none loaded, or ended)', () => {
    const { rerender } = render(host({ combatState: null }));
    expect(screen.getByText('cannot override')).toBeInTheDocument();
    rerender(host({ combatState: fight([GOBLIN, DEAD], 'ended') }));
    expect(screen.getByText('cannot override')).toBeInTheDocument();
  });

  it('the fight ending closes an open dialog, and the next fight does not reopen it', () => {
    const { rerender } = render(host());
    fireEvent.click(screen.getByRole('button', { name: 'open A' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    rerender(host({ combatState: fight([GOBLIN, DEAD], 'ended') }));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(host());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('a held fight: the dialog offers Revive only', () => {
  it('the generic opener (DM Override) opens on Revive with one kind', () => {
    render(host({ combatState: fight([GOBLIN, DEAD], 'held') }));
    fireEvent.click(screen.getByRole('button', { name: 'open A' }));
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /Revive/i })).toBeChecked();
    expect(screen.queryByLabelText('Actor')).toBeNull();
  });

  it('not held: all five kinds, opening on Attack (the control)', () => {
    render(host());
    fireEvent.click(screen.getByRole('button', { name: 'open A' }));
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });

  it('held with a character still standing (the engine\'s heal-resume): "Resume the fight", no kind radios, and the living character is listed with their HP', () => {
    render(host({ combatState: fight([GOBLIN, mk('pc-1', 'Kestrel', 5, 34)], 'held') }));
    fireEvent.click(screen.getByRole('button', { name: 'open A' }));
    expect(screen.getByRole('dialog', { name: 'Resume the fight' })).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByText(/No character has fallen\./)).toBeNull();
    expect((screen.getByLabelText(/HP after resuming/) as HTMLInputElement).value).toBe('5');
  });

  it('a fight that turns held under an open Attack dialog switches it to Revive', () => {
    const { rerender } = render(host());
    fireEvent.click(screen.getByRole('button', { name: 'open A' }));
    expect(screen.getByRole('radio', { name: /Attack/i })).toBeChecked();
    rerender(host({ combatState: fight([GOBLIN, DEAD], 'held') }));
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /Revive/i })).toBeChecked();
  });
});

describe('a refused combat_not_active: the engine\'s own sentence when the refusal says the fight is held', () => {
  const HELD_SENTENCE = 'The fight is waiting for the DM: revive a character or end the combat.';
  const refusal = (stateObj: unknown, message = HELD_SENTENCE) =>
    Object.assign(new Error('refused'), { status: 400, body: { success: false, message, data: { reason: 'combat_not_active', state: stateObj, message } } });
  const send = async (kindRadio: RegExp | null) => {
    if (kindRadio) fireEvent.click(screen.getByRole('radio', { name: kindRadio }));
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'because' } });
    await act(async () => { fireEvent.click(document.querySelector('button[type="submit"]') as HTMLElement); });
  };

  it('a non-revive refused with a HELD state shows the engine\'s sentence, not "Combat is not active."', async () => {
    mockSubmitOverride.mockRejectedValue(refusal(fight([GOBLIN, DEAD], 'held')));
    render(host());
    fireEvent.click(screen.getByRole('button', { name: 'open A' }));
    await send(/Check/i);
    expect((await screen.findByRole('alert')).textContent).toBe(HELD_SENTENCE);
  });

  it('the ENGINE\'s sentence wins over the fallback: a different sentence is shown verbatim (the fixture\'s sentence used to equal the fallback, so a mutant that always showed the fallback passed)', async () => {
    const ENGINE = 'The fight is on hold: resume it with a living character or end it.';
    mockSubmitOverride.mockRejectedValue(refusal(fight([GOBLIN, DEAD], 'held'), ENGINE));
    render(host());
    fireEvent.click(screen.getByRole('button', { name: 'open A' }));
    await send(/Check/i);
    expect((await screen.findByRole('alert')).textContent).toBe(ENGINE);
  });

  it('a revive refused with a HELD state shows it too, not "The fight has ended"', async () => {
    mockSubmitOverride.mockRejectedValue(refusal(fight([GOBLIN, DEAD], 'held')));
    render(host());
    fireEvent.click(screen.getByRole('button', { name: 'open B' }));
    await send(null);
    expect((await screen.findByRole('alert')).textContent).toBe(HELD_SENTENCE);
  });

  it('the fallback sentence is used when a held refusal carries no message', async () => {
    mockSubmitOverride.mockRejectedValue(Object.assign(new Error('refused'), { status: 400, body: { data: { reason: 'combat_not_active', state: fight([GOBLIN, DEAD], 'held') } } }));
    render(host());
    fireEvent.click(screen.getByRole('button', { name: 'open B' }));
    await send(null);
    expect((await screen.findByRole('alert')).textContent).toBe(HELD_SENTENCE);
  });

  it('controls: a refusal whose state is ended, or carries none, keeps the static copy (a revive: the fight has ended)', async () => {
    mockSubmitOverride.mockRejectedValue(refusal(fight([GOBLIN, DEAD], 'ended'), 'Combat is not active.'));
    const { unmount } = render(host());
    fireEvent.click(screen.getByRole('button', { name: 'open B' }));
    await send(null);
    expect((await screen.findByRole('alert')).textContent).toBe('The fight has ended, so no one can be revived in it.');
    unmount();
    mockSubmitOverride.mockRejectedValue(Object.assign(new Error('refused'), { status: 400, body: { data: { reason: 'combat_not_active' } } }));
    render(host());
    fireEvent.click(screen.getByRole('button', { name: 'open B' }));
    await send(null);
    expect((await screen.findByRole('alert')).textContent).toBe('The fight has ended, so no one can be revived in it.');
  });
});

describe('a successful override', () => {
  it('writes the amber ruling row, hands the new state up, and closes', async () => {
    const after = fight([GOBLIN, mk('pc-1', 'Kestrel', 14, 34)]);
    mockSubmitOverride.mockResolvedValue({ applied: { message: 'Kestrel is revived.' }, state: after });
    const appendLog = jest.fn();
    const onStateUpdate = jest.fn();
    render(host({ appendLog, onStateUpdate }));
    fireEvent.click(screen.getByRole('button', { name: 'open B' }));
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'prayer' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Revive Kestrel/ })); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(appendLog).toHaveBeenCalledWith({ who: 'DM (dm)', kind: 'dm_override', text: 'DM ruled: Kestrel is revived.' });
    expect(onStateUpdate).toHaveBeenCalledWith(after);
  });
});

describe('focus after close, with the opener gone', () => {
  // The opener exists only while someone has fallen, as the panel's and the held strip's Revive… do: the success unmounts it.
  function Harness({ ownFallback }: { ownFallback: HTMLElement | null }) {
    const [cs, setCs] = React.useState(fight([GOBLIN, DEAD]));
    const someoneFell = cs.participants.some((p) => p.is_pc && !p.is_alive);
    return host({ combatState: cs, onStateUpdate: setCs, fallbackFocus: () => sceneHead }, someoneFell ? <Openers fallback={ownFallback ? () => ownFallback : undefined} /> : <span>nobody fallen</span>);
  }
  let sceneHead: HTMLElement;
  let own: HTMLElement;
  beforeEach(() => {
    sceneHead = document.createElement('div'); sceneHead.tabIndex = -1; document.body.appendChild(sceneHead);
    own = document.createElement('button'); document.body.appendChild(own);
    mockSubmitOverride.mockResolvedValue({ applied: { message: 'ok' }, state: fight([GOBLIN, mk('pc-1', 'Kestrel', 14, 34)]) });
  });
  afterEach(() => { sceneHead.remove(); own.remove(); });

  const reviveFrom = async (name: string) => {
    const opener = screen.getByRole('button', { name });
    opener.focus(); fireEvent.click(opener);
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'x' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Revive Kestrel/ })); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('nobody fallen')).toBeInTheDocument(); // the opener really is gone
  };

  it('an opener with no fallback of its own lands on the host\'s: the scene head', async () => {
    render(<Harness ownFallback={own} />);
    await reviveFrom('open B');
    // open B passes no fallback of its own; the host's (the scene head) is used
    expect(document.activeElement).toBe(sceneHead);
  });

  it('an opener that named a fallback gets it', async () => {
    render(<Harness ownFallback={own} />);
    const opener = screen.getByRole('button', { name: 'open A' });
    opener.focus(); fireEvent.click(opener);
    fireEvent.click(screen.getByRole('radio', { name: /Revive/i }));
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'x' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Revive Kestrel/ })); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(own);
  });

  it('never <body>', async () => {
    render(<Harness ownFallback={null} />);
    await reviveFrom('open B');
    expect(document.activeElement).not.toBe(document.body);
  });
});
