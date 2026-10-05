/**
 * TPK-HOLD round-4 pins (Kage's round-2 candidates, landed, plus this round's). The real /play page, network module faked, poll 25ms. Each test names the mutant it kills:
 * the page handing the stage "a character is still standing", the confirm's error not outliving its attempt, the hold landing under an open dialog with a character standing,
 * a standing character's default HP clamped, a failed End not announced twice (the confirm owns its error; the generic chooser keeps its toast), a 200 that closes the confirm,
 * the standing-PC confirm words and End-session warning, and the DM panel's Resume… opener.
 */
import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { CombatParticipantState, CombatState, GroundingData, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 's1' }) }));
const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: (...a: unknown[]) => mockToast(...a) }) }));
let mockUser = 'dm_alice';
jest.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, username: mockUser, email: null } }) }));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../app/play/[sessionId]/format', () => ({ ...jest.requireActual('../../app/play/[sessionId]/format'), POLL_INTERVAL_MS: 25 }));
jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(), getSessionEvents: jest.fn(() => Promise.resolve([])), getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(), getGrounding: jest.fn(), getCombatState: jest.fn(), getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({})), getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
  endCombat: jest.fn(), submitOverride: jest.fn(), advanceScene: jest.fn(), rollSkillCheck: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), monsterTurn: jest.fn(() => new Promise(() => {})),
}));
jest.mock('../../lib/stream', () => ({ streamDmNarration: jest.fn() }));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';


const SESSION = (dm: string, mode: 'human' | 'ai', status: Session['status'] = 'active'): Session => ({
  session_id: 's1', channel: 'c', status, dm_username: dm, participant_usernames: ['dm_alice', 'leon', 'mira'],
  player_count: 3, active_combat_id: 'combat-1', dm_mode: mode, ai_assist_level: 'full',
});
const PARTY: Participant[] = [
  { username: 'dm_alice', is_dm: true, character: null },
  { username: 'leon', is_dm: false, character: { character_id: 'c1', name: 'Anomaly', char_class: 'Warlock', level: 1, current_hp: 0, max_hp: 9, ac: 12 } },
];
const GROUNDING: GroundingData = { scene_id: 'a', scene_name: 'The Flight', boxed_text: 'x', objective: 'y', transitions: [{ to: 'b', label: 'Press forward' }], checks: [], flags: {}, encounter_state: {}, encounter: null };
const pc = (over: Partial<CombatParticipantState> = {}): CombatParticipantState => ({
  participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 0, hp_max: 9, ac: 12,
  conditions: [], is_alive: false, can_be_targeted: false, is_active_turn: false, took_turn: false, ...over,
});
const pc2 = (over: Partial<CombatParticipantState> = {}): CombatParticipantState => pc({ participant_id: 'p2', entity_id: 'c2', name: 'Mira', hp_max: 20, ...over });
const goblin: CombatParticipantState = { participant_id: 'g1', entity_id: 'g', name: 'Goblin', is_pc: false, initiative: 8, hp_current: 7, hp_max: 7, ac: 13, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false };
const fightOf = (state: string, ps: CombatParticipantState[], active: string | null = null): CombatState => ({
  combat_id: 'combat-1', session_id: 's1', round: 2, state: state as CombatState['state'], turn_index: 0, active_participant_id: active, initiative: ps.map((p) => p.participant_id), participants: ps,
});
let served: CombatState;
const mock = <T extends (...a: never[]) => unknown>(f: unknown) => f as jest.MockedFunction<T>;
async function mount(opts: { user: string; dm: string; mode: 'human' | 'ai'; fight: CombatState; findText: RegExp; status?: Session['status'] }) {
  mockUser = opts.user; served = opts.fight;
  mock<typeof dnd.getSession>(dnd.getSession).mockResolvedValue(SESSION(opts.dm, opts.mode, opts.status));
  mock<typeof dnd.getParticipants>(dnd.getParticipants).mockResolvedValue(PARTY);
  mock<typeof dnd.getGrounding>(dnd.getGrounding).mockResolvedValue(GROUNDING);
  mock<typeof dnd.getCombatState>(dnd.getCombatState).mockImplementation(() => Promise.resolve(served));
  renderPlay(<PlayPage />);
  await screen.findByText(opts.findText);
}
const stage = () => document.querySelector('[data-region="sceneStage"]') as HTMLElement;
const tick = (ms = 120) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const stageButtons = () => Array.from(stage().querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());
const statusText = () => (stage().querySelector('[role="status"]')?.textContent ?? '').trim();

beforeEach(() => { jest.clearAllMocks(); });


describe('CP-1 (P03): the PAGE hands the stage "a character is still standing" (a held fight with a living PC)', () => {
  it('the DM: the standing line, Resume… (not Revive…), then End combat', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc({ hp_current: 5, is_alive: true, can_be_targeted: true }), goblin]), findText: /A character is still standing/ });
    expect(statusText()).toBe('The fight is on hold. A character is still standing.');
    expect(stageButtons()).toEqual(['Resume…', 'End combat']);
  });
  it('a living MONSTER is not a character standing: everyone fallen still reads Revive…', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc(), goblin]), findText: /^Every character has fallen\.$/ });
    expect(stageButtons()).toEqual(['Revive…', 'End combat']);
  });
});

describe('CP-2 (S10, S09): the confirm\'s error does not outlive the attempt it was about', () => {
  it('failed, cancelled, reopened: no error; failed, retried: no error while the retry is in flight', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc(), goblin]), findText: /^Every character has fallen\.$/ });
    mock<typeof dnd.endCombat>(dnd.endCombat).mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    fireEvent.click(within(stage()).getByRole('button', { name: 'End combat' }));
    let dlg = await screen.findByRole('dialog', { name: 'End the fight?' });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'End the fight' })); });
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'End the fight?' })).getByRole('alert')).toBeInTheDocument());
    fireEvent.click(within(screen.getByRole('dialog', { name: 'End the fight?' })).getByRole('button', { name: 'Keep waiting' }));
    await tick(30);
    fireEvent.click(within(stage()).getByRole('button', { name: 'End combat' }));
    dlg = await screen.findByRole('dialog', { name: 'End the fight?' });
    expect(within(dlg).queryByRole('alert')).toBeNull(); // S10
    // fail again, then retry with a request that stays in flight: the old error is gone while it runs
    mock<typeof dnd.endCombat>(dnd.endCombat).mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'End the fight' })); });
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'End the fight?' })).getByRole('alert')).toBeInTheDocument());
    mock<typeof dnd.endCombat>(dnd.endCombat).mockImplementation(() => new Promise(() => {}) as never);
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'End the fight?' })).getByRole('button', { name: 'End the fight' })); });
    expect(within(screen.getByRole('dialog', { name: 'End the fight?' })).queryByRole('alert')).toBeNull(); // S09
  });
});

describe('CP-3 (D14): the hold lands under an open override dialog while a character is still standing (no Revive radio to take focus)', () => {
  it('focus stays in the dialog (the Character select), never <body>', async () => {
    const live = fightOf('active', [pc({ hp_current: 4, is_alive: true, can_be_targeted: true }), pc2({ hp_current: 12, is_alive: true, can_be_targeted: true }), { ...goblin, is_active_turn: true }], 'g1');
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: live, findText: /In combat · use the action bar/ });
    fireEvent.click(await screen.findByRole('button', { name: /Open DM override modal/i }));
    await tick(40);
    const radio = screen.getByRole('radio', { name: /Attack/i });
    act(() => radio.focus());
    // another tab's override: the fight is held, and (the stale-save race) Mira is still standing
    served = fightOf('held', [pc(), pc2({ hp_current: 12, is_alive: true, can_be_targeted: true }), goblin]);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Resume the fight' })).toBeInTheDocument(), { timeout: 2000 });
    await tick(60);
    const dlg = screen.getByRole('dialog', { name: 'Resume the fight' });
    expect(document.activeElement).not.toBe(document.body);
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect((document.activeElement as HTMLElement).tagName).toBe('SELECT');
  });
});

describe('CP-4 (D05): a standing character\'s default HP is clamped to what can be sent', () => {
  it('standing at 0 HP (dying): the default is 1, never 0 (the engine refuses 0)', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc({ hp_current: 0, is_alive: true }), goblin]), findText: /A character is still standing/ });
    fireEvent.click(within(stage()).getByRole('button', { name: /Resume/ }));
    await tick(40);
    expect((document.querySelector('input[id$="-revive-hp"]') as HTMLInputElement).value).toBe('1');
  });
});

describe('R4-1 (Iro MINOR-6): a failed End is announced once: the confirm owns its error, the generic chooser keeps its toast', () => {
  const failure = () => mock<typeof dnd.endCombat>(dnd.endCombat).mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
  it('the held confirm: the in-dialog alert, and NO toast', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc(), goblin]), findText: /^Every character has fallen\.$/ });
    failure();
    fireEvent.click(within(stage()).getByRole('button', { name: 'End combat' }));
    const dlg = await screen.findByRole('dialog', { name: 'End the fight?' });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'End the fight' })); });
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'End the fight?' })).getByRole('alert')).toHaveTextContent('Could not end the fight. Try again.'));
    expect(mockToast).not.toHaveBeenCalled();
  });
  it('control, the generic chooser on a running fight: its toast "Could not end combat." is unchanged', async () => {
    const live = fightOf('active', [pc({ hp_current: 4, is_alive: true, can_be_targeted: true }), { ...goblin, hp_current: 0, is_alive: false, is_active_turn: false }], 'p1');
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: live, findText: /In combat · use the action bar/ });
    failure();
    fireEvent.click(within(stage()).getByRole('button', { name: /End combat — choose outcome/ }));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Retreat/ })); });
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Could not end combat.' })));
  });
  it('after the failure focus is on Keep waiting (the dialog box does nothing on Enter)', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc(), goblin]), findText: /^Every character has fallen\.$/ });
    failure();
    fireEvent.click(within(stage()).getByRole('button', { name: 'End combat' }));
    const dlg = await screen.findByRole('dialog', { name: 'End the fight?' });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'End the fight' })); });
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'End the fight?' })).getByRole('alert')).toBeInTheDocument());
    expect(document.activeElement).toBe(within(screen.getByRole('dialog', { name: 'End the fight?' })).getByRole('button', { name: 'Keep waiting' }));
  });
});

describe('R4-2 (Tora MINOR-A): a 200 whose answer carries no state closes the confirm, and a second press cannot send a second /end', () => {
  it('endCombat resolves with no `state`: the confirm is closed, exactly one request', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc(), goblin]), findText: /^Every character has fallen\.$/ });
    mock<typeof dnd.endCombat>(dnd.endCombat).mockResolvedValue({ outcome: 'tpk', message: 'Combat ended. The party has fallen.' } as never);
    fireEvent.click(within(stage()).getByRole('button', { name: 'End combat' }));
    const dlg = await screen.findByRole('dialog', { name: 'End the fight?' });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'End the fight' })); });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'End the fight?' })).toBeNull());
    expect(dnd.endCombat).toHaveBeenCalledTimes(1);
  });
});

describe('R4-3 (Kage N-2): the confirm and the End-session warning do not say everyone has fallen when a character is standing', () => {
  const standingFight = () => fightOf('held', [pc({ hp_current: 5, is_alive: true, can_be_targeted: true }), goblin]);
  const open = async () => fireEvent.click(within(stage()).getByRole('button', { name: 'End combat' }));
  it('the human DM: the standing words, with the pointer to Keep waiting then Resume', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: standingFight(), findText: /A character is still standing/ });
    await open();
    expect(await screen.findByRole('dialog', { name: 'End the fight?' })).toHaveTextContent("A character is still standing. Ending the fight now records a total party wipe and can't be undone. To play on, choose Keep waiting, then use Resume.");
  });
  it('the host at a Suzu-DM table (no Resume seat): the same without the pointer', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'ai', fight: standingFight(), findText: /The fight is on hold\. You can end the fight\./ });
    await open();
    const dlg = await screen.findByRole('dialog', { name: 'End the fight?' });
    expect(dlg).toHaveTextContent("A character is still standing. Ending the fight now records a total party wipe and can't be undone.");
    expect(dlg).not.toHaveTextContent(/Resume/);
  });
  it('control: all fallen keeps its words', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc(), goblin]), findText: /^Every character has fallen\.$/ });
    await open();
    expect(await screen.findByRole('dialog', { name: 'End the fight?' })).toHaveTextContent("Every character has fallen. Ending it now records a total party wipe and can't be undone.");
  });
  it('End session while a character is standing: "A fight is on hold with a character still standing."', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: standingFight(), findText: /A character is still standing/ });
    fireEvent.click(await screen.findByRole('button', { name: /^End session$/i }));
    const dlg = await screen.findByRole('dialog', { name: /End this session/i });
    expect(dlg).toHaveTextContent("A fight is on hold with a character still standing. Ending the session leaves the fight unresolved, and its characters can't be deleted until the fight ends.");
    expect(dlg).not.toHaveTextContent(/every character has fallen/i);
    expect(dlg).toHaveTextContent('This ends the table for everyone at it.');
  });
});

describe('R4-4 (Aoi addendum 3, 2): the DM panel\'s opener reads Resume… when a character is standing (and is offered even if nobody has fallen)', () => {
  const panel = () => document.querySelector('[aria-label="DM monster control"]') as HTMLElement;
  it('a held fight with a standing character and nobody fallen: Resume… on the panel', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc({ hp_current: 5, is_alive: true, can_be_targeted: true }), goblin]), findText: /A character is still standing/ });
    await waitFor(() => expect(within(panel()).getByRole('button', { name: 'Resume…' })).toBeInTheDocument());
    expect(within(panel()).queryByRole('button', { name: 'Revive…' })).toBeNull();
  });
  it('all fallen: it stays Revive…', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc(), goblin]), findText: /^Every character has fallen\.$/ });
    await waitFor(() => expect(within(panel()).getByRole('button', { name: 'Revive…' })).toBeInTheDocument());
  });
});
