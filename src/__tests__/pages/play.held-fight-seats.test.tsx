/**
 * TPK-HOLD, seat by seat, on the real /play page (real SceneStage, host and dialog; only the network module is faked; the poll runs at 25ms). Written by Miko-QA as a
 * break-it pass; each describe names the question it asks:
 *   P1 the held End combat is one request, exactly tpk, no chooser; P2 who gets buttons; P3 an unknown state is live AND frozen; P4 focus is never <body> when the hold
 *   arrives, lifts or the dialog is open; P5 Revive... returns focus on Escape; P6 no player verb fires while held; P9 the poll keeps running while held (a hold is lifted or
 *   ended by someone else and every seat must see it); P10 the described action bar swallows every verb; P11 the fight ending under an open dialog.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { CombatParticipantState, CombatState, GroundingData, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 's1' }) }));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
let mockUser = 'dm_alice';
jest.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, username: mockUser, email: null } }) }));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../app/play/[sessionId]/format', () => ({ ...jest.requireActual('../../app/play/[sessionId]/format'), POLL_INTERVAL_MS: 25 }));
jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
  endCombat: jest.fn(),
  submitOverride: jest.fn(),
  advanceScene: jest.fn(),
  rollSkillCheck: jest.fn(),
  attack: jest.fn(),
  endTurn: jest.fn(),
}));
jest.mock('../../lib/stream', () => ({ streamDmNarration: jest.fn() }));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const SESSION = (dm: string, mode: 'human' | 'ai'): Session => ({
  session_id: 's1', channel: 'c', status: 'active', dm_username: dm, participant_usernames: ['dm_alice', 'leon'],
  player_count: 2, active_combat_id: 'combat-1', dm_mode: mode, ai_assist_level: 'full',
});
const PARTY: Participant[] = [
  { username: 'dm_alice', is_dm: true, character: null },
  { username: 'leon', is_dm: false, character: { character_id: 'c1', name: 'Anomaly', char_class: 'Warlock', level: 1, current_hp: 0, max_hp: 9, ac: 12 } },
];
const GROUNDING: GroundingData = {
  scene_id: 'a', scene_name: 'The Flight', boxed_text: 'x', objective: 'y',
  transitions: [{ to: 'b', label: 'Press forward' }], checks: [{ skill: 'Perception', dc: 10, state: 'available' } as never],
  flags: {}, encounter_state: {}, encounter: null,
};
const pc = (over: Partial<CombatParticipantState> = {}): CombatParticipantState => ({
  participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 0, hp_max: 9, ac: 12,
  conditions: [], is_alive: false, can_be_targeted: false, is_active_turn: false, took_turn: false, ...over,
});
const pc2 = pc({ participant_id: 'p2', entity_id: 'c2', name: 'Bram', hp_current: 6, is_alive: true, can_be_targeted: true });
const goblin: CombatParticipantState = {
  participant_id: 'g1', entity_id: 'g', name: 'Goblin', is_pc: false, initiative: 8, hp_current: 7, hp_max: 7, ac: 13,
  conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false,
};
const heldFight = (state: string = 'held'): CombatState => ({
  combat_id: 'combat-1', session_id: 's1', round: 2, state: state as CombatState['state'], turn_index: 0, active_participant_id: null,
  initiative: ['p1', 'g1'], participants: [pc(), goblin],
});
const liveFight = (): CombatState => ({
  combat_id: 'combat-1', session_id: 's1', round: 2, state: 'active', turn_index: 1, active_participant_id: 'g1',
  initiative: ['p1', 'p2', 'g1'], participants: [pc(), pc2, { ...goblin, is_active_turn: true }],
});

let served: CombatState;
const mock = <T extends (...a: never[]) => unknown>(f: unknown) => f as jest.MockedFunction<T>;
async function mount(opts: { user: string; dm: string; mode: 'human' | 'ai'; fight: CombatState; findText: RegExp }) {
  mockUser = opts.user;
  served = opts.fight;
  mock<typeof dnd.getSession>(dnd.getSession).mockResolvedValue(SESSION(opts.dm, opts.mode));
  mock<typeof dnd.getParticipants>(dnd.getParticipants).mockResolvedValue(PARTY);
  mock<typeof dnd.getGrounding>(dnd.getGrounding).mockResolvedValue(GROUNDING);
  mock<typeof dnd.getCombatState>(dnd.getCombatState).mockImplementation(() => Promise.resolve(served));
  renderPlay(<PlayPage />);
  await screen.findByText(opts.findText);
}
const stage = () => document.querySelector('[data-region="sceneStage"]') as HTMLElement;
/** Press the strip's End combat, then the confirm's End combat (the held End asks first). */
const pressEnd = async () => {
  fireEvent.click(within(stage()).getByRole('button', { name: 'End combat' }));
  const go = within(screen.getByRole('dialog', { name: 'End the fight?' })).getByRole('button', { name: 'End the fight' });
  await act(async () => { fireEvent.click(go); });
};

beforeEach(() => { jest.clearAllMocks(); });

describe('P1 the held End combat: one request, exactly {username, outcome: tpk}, no chooser, the party-has-fallen line', () => {
  it('a double press sends ONE /end whose body is {username, outcome:"tpk"} and nothing else', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: heldFight(), findText: /^Every character has fallen\.$/ });
    let release!: (v: unknown) => void;
    mock<typeof dnd.endCombat>(dnd.endCombat).mockImplementation(() => new Promise((r) => { release = r; }) as never);
    fireEvent.click(within(stage()).getByRole('button', { name: 'End combat' }));
    expect(dnd.endCombat).not.toHaveBeenCalled();
    const go = within(screen.getByRole('dialog', { name: 'End the fight?' })).getByRole('button', { name: 'End the fight' });
    fireEvent.click(go);
    fireEvent.click(go);
    fireEvent.keyDown(go, { key: 'Enter' });
    expect(dnd.endCombat).toHaveBeenCalledTimes(1);
    expect(dnd.endCombat).toHaveBeenCalledWith('combat-1', { username: 'dm_alice', outcome: 'tpk' });
    expect(within(stage()).queryByText(/How does this fight end/)).toBeNull();
    await act(async () => { release({ state: { ...heldFight('ended') }, outcome: 'tpk' }); });
    // The log line is the outcome map's sentence (the engine sent no message of its own here).
    expect(await screen.findByText('Combat ended. The party has fallen.')).toBeInTheDocument();
    expect(screen.queryByText(/Tpk/)).toBeNull();
  });

  it("the engine's own message wins when it sent one", async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: heldFight(), findText: /^Every character has fallen\.$/ });
    mock<typeof dnd.endCombat>(dnd.endCombat).mockResolvedValue({ state: heldFight('ended'), outcome: 'tpk', message: 'Combat ended. The party has fallen. (engine)' } as never);
    await pressEnd();
    expect(await screen.findByText('Combat ended. The party has fallen. (engine)')).toBeInTheDocument();
  });

  it('a failed /end keeps the confirm open with the error, retryable; the retry sends again and the fight ends', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: heldFight(), findText: /^Every character has fallen\.$/ });
    mock<typeof dnd.endCombat>(dnd.endCombat).mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    await pressEnd();
    await waitFor(() => expect(dnd.endCombat).toHaveBeenCalledTimes(1));
    // The request failed with the fight still held: the confirm stays, says so, and its button is live again.
    const dlg = await screen.findByRole('dialog', { name: 'End the fight?' });
    await waitFor(() => expect(within(dlg).getByRole('alert')).toHaveTextContent('Could not end the fight. Try again.'));
    const go = within(dlg).getByRole('button', { name: 'End the fight' });
    expect(go).toBeEnabled();
    expect(within(stage()).getByText(/^Every character has fallen\.$/)).toBeInTheDocument();
    mock<typeof dnd.endCombat>(dnd.endCombat).mockResolvedValue({ state: heldFight('ended'), outcome: 'tpk' } as never);
    await act(async () => { fireEvent.click(go); });
    expect(dnd.endCombat).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'End the fight?' })).toBeNull());
    expect(await screen.findByText('Combat ended. The party has fallen.')).toBeInTheDocument();
  });
});

describe('P2 who gets buttons', () => {
  it('a player (not the DM) sees the waiting line and NO button in the stage', async () => {
    await mount({ user: 'leon', dm: 'dm_alice', mode: 'human', fight: heldFight(), findText: /The DM decides what happens next/ });
    expect(within(stage()).queryByRole('button', { name: /End combat|Revive/ })).toBeNull();
  });

  it('an AI-DM table, the session host: the DM line and End combat (it asks, then sends tpk), and NO Revive…', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'ai', fight: heldFight(), findText: /^Every character has fallen\. You can end the fight\.$/ });
    expect(within(stage()).queryByRole('button', { name: /Revive|Resume/ })).toBeNull();
    mock<typeof dnd.endCombat>(dnd.endCombat).mockResolvedValue({ state: heldFight('ended'), outcome: 'tpk' } as never);
    await pressEnd();
    expect(dnd.endCombat).toHaveBeenCalledTimes(1);
    expect(dnd.endCombat).toHaveBeenCalledWith('combat-1', { username: 'dm_alice', outcome: 'tpk' });
  });

  it('an AI-DM table, a player who is not the host: the waiting line and no strip buttons', async () => {
    await mount({ user: 'leon', dm: 'dm_alice', mode: 'ai', fight: heldFight(), findText: /^Every character has fallen\. The host can end the fight\.$/ });
    expect(within(stage()).queryByRole('button', { name: /End combat|Revive|Resume/ })).toBeNull();
  });
});

describe('P3 fail closed: a state this build has never heard of is live AND frozen', () => {
  it("'frozen' (unknown) as a PLAYER: verbs locked, no Move on, no check", async () => {
    await mount({ user: 'leon', dm: 'dm_alice', mode: 'human', fight: heldFight('frozen'), findText: /In combat · use the action bar/ });
    const rail = await screen.findByRole('group', { name: /your character.s actions/i });
    for (const name of [/^attack/i, /^dodge/i, /^dash/i, /end turn/i]) expect(within(rail).getByRole('button', { name })).toBeDisabled();
    expect(screen.queryByText('Press forward')).toBeNull();
    expect(screen.queryByText(/perception/i)).toBeNull();
  });

  it("undefined state (an older proxy dropping the key) is also frozen", async () => {
    const f = heldFight(); delete (f as Partial<CombatState>).state;
    await mount({ user: 'leon', dm: 'dm_alice', mode: 'human', fight: f, findText: /In combat · use the action bar/ });
    const rail = await screen.findByRole('group', { name: /your character.s actions/i });
    expect(within(rail).getByRole('button', { name: /^attack/i })).toBeDisabled();
    expect(screen.queryByText('Press forward')).toBeNull();
  });

  it("'frozen' as the DM: the DM is not stranded — the generic End combat chooser is still there", async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: heldFight('frozen'), findText: /In combat · use the action bar/ });
    expect(within(stage()).getByRole('button', { name: /End combat/ })).toBeEnabled();
  });
});

describe('P4 focus never lands on <body>', () => {
  it("another tab revives while the DM has focus on the strip's End combat: the held buttons unmount and focus goes to the scene head, not <body>", async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: heldFight(), findText: /^Every character has fallen\.$/ });
    const end = within(stage()).getByRole('button', { name: 'End combat' });
    end.focus();
    expect(document.activeElement).toBe(end);
    served = liveFight();
    await waitFor(() => expect(within(stage()).queryByText(/^Every character has fallen\.$/)).toBeNull(), { timeout: 2000 });
    // The held End unmounted and the generic one mounted: the scene head holds focus.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('group', { name: /^Scene:/ })), { timeout: 1000 });
  });

  it("an override dialog is open on Attack and another tab holds the fight: focus moves to the dialog's Revive radio, not behind the modal", async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: liveFight(), findText: /In combat · use the action bar/ });
    fireEvent.click(await screen.findByRole('button', { name: /Open DM override modal/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(document.activeElement).toBe(within(dialog).getByRole('radio', { name: /Attack/i }));
    // The stage's rescue must not even TRY: focus never visits the scene head behind the modal (it would flash there before the dialog took it back).
    let visitedSceneHead = false;
    screen.getByRole('group', { name: /^Scene:/ }).addEventListener('focus', () => { visitedSceneHead = true; });
    served = heldFight();
    await waitFor(() => expect(within(dialog).getAllByRole('radio')).toHaveLength(1), { timeout: 2000 });
    expect(visitedSceneHead).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(within(dialog).getByRole('radio', { name: /Revive/i }));
  });
});

describe('P5 the strip\'s Revive… opens Revive-only and returns focus to itself on Escape', () => {
  it('opens one radio; Escape puts focus back on the strip\'s Revive…', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: heldFight(), findText: /^Every character has fallen\.$/ });
    const revive = within(stage()).getByRole('button', { name: 'Revive…' });
    revive.focus();
    fireEvent.click(revive);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('radio')).toHaveLength(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(within(stage()).getByRole('button', { name: 'Revive…' }));
  });
});

describe('P6 no player verb fires while held, by any route the page owns', () => {
  it('the composer\'s typed attack goes to narration, not to the combat verb', async () => {
    await mount({ user: 'leon', dm: 'dm_alice', mode: 'human', fight: heldFight(), findText: /The DM decides what happens next/ });
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: 'I attack the goblin' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 60));
    expect(dnd.attack).not.toHaveBeenCalled();
    expect(dnd.endTurn).not.toHaveBeenCalled();
    expect(dnd.advanceScene).not.toHaveBeenCalled();
  });

  it('typing a movement phrase does not advance the scene while held', async () => {
    await mount({ user: 'leon', dm: 'dm_alice', mode: 'human', fight: heldFight(), findText: /The DM decides what happens next/ });
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: 'I press forward' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 60));
    expect(dnd.advanceScene).not.toHaveBeenCalled();
  });
});

describe('P9 the poll keeps running while held (a hold is lifted or ended by someone else, and every seat must see it)', () => {
  it('a PLAYER sees the waiting line go when the DM revives (poll -> active), and sees the verbs come back on their turn', async () => {
    await mount({ user: 'leon', dm: 'dm_alice', mode: 'human', fight: heldFight(), findText: /The DM decides what happens next/ });
    served = { ...liveFight(), active_participant_id: 'p2', participants: [pc({ is_alive: true, hp_current: 4, can_be_targeted: true, is_active_turn: true }), pc2, goblin] };
    await waitFor(() => expect(screen.queryByText(/The DM decides what happens next/)).toBeNull(), { timeout: 2000 });
    expect(screen.getByText(/In combat · use the action bar/)).toBeInTheDocument();
  });

  it('a PLAYER sees the fight END (poll -> ended) after a held End combat, and Move on comes back', async () => {
    await mount({ user: 'leon', dm: 'dm_alice', mode: 'human', fight: heldFight(), findText: /The DM decides what happens next/ });
    served = heldFight('ended');
    await waitFor(() => expect(screen.queryByText(/The DM decides what happens next/)).toBeNull(), { timeout: 2000 });
    expect(await screen.findByText('Press forward')).toBeInTheDocument();
  });
});

import ActionBar from '@/app/play/[sessionId]/regions/ActionBar';
describe('P10 the DESCRIBED action bar (aria-disabled, not native disabled) swallows every verb while held, by mouse, keyboard and touch', () => {
  const targets = [{ participant_id: 'g1', name: 'Goblin' }] as never;
  const bar = (onAction: jest.Mock) => (
    <ActionBar targets={targets} onAction={onAction} busy={false} isPlayerTurn={false} held turnLine={null} />
  );
  it.each([/^attack/i, /^dodge/i, /^dash/i, /end turn/i])('%s: click, Enter, Space and a touch tap fire nothing', (name) => {
    const onAction = jest.fn();
    render(bar(onAction));
    const btn = screen.getByRole('button', { name });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: 'Enter' }); fireEvent.keyUp(btn, { key: 'Enter' });
    fireEvent.keyDown(btn, { key: ' ' }); fireEvent.keyUp(btn, { key: ' ' });
    fireEvent.pointerDown(btn, { pointerType: 'touch' }); fireEvent.pointerUp(btn, { pointerType: 'touch' }); fireEvent.click(btn);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('the reason it reads is the held words, and is not a live region', () => {
    render(bar(jest.fn()));
    expect(screen.getAllByText('The fight is on hold.').length).toBeGreaterThan(0);
    for (const el of screen.getAllByText('The fight is on hold.')) expect(el).not.toHaveAttribute('aria-live');
  });
});

describe('P11 the fight ends under an open override dialog', () => {
  it('the dialog goes with it and focus is not left on <body>', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: liveFight(), findText: /In combat · use the action bar/ });
    fireEvent.click(await screen.findByRole('button', { name: /Open DM override modal/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    served = { ...liveFight(), state: 'ended' };
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 2000 });
    await waitFor(() => expect(document.activeElement).not.toBe(document.body), { timeout: 1000 });
  });
});
