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
