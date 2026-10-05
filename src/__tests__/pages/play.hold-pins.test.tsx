/**
 * TPK-HOLD consumer pins (Kage's candidate pins, landed). The real /play page with the network module faked and a 25ms poll. Each test names the mutant it kills or the defect it pins:
 * the monster driver in an unknown state, the party band's HP while held, the confirm's busy state, the board's held wiring, a cold load into a held fight taking focus, a held edge
 * moving focus nobody lost, an unread state being live-but-not-frozen, the locked verbs' names, a revive's focus on the real page, and the Reason box keeping focus when the hold lands.
 */
import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  session_id: 's1', channel: 'c', status, dm_username: dm, participant_usernames: ['dm_alice', 'leon'],
  player_count: 2, active_combat_id: 'combat-1', dm_mode: mode, ai_assist_level: 'full',
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

beforeEach(() => { jest.clearAllMocks(); });


const SPACE = { kind: 'square', width: 6, height: 4, cell_ft: 5, features: [] } as never;
const withBoard = (cs: CombatState): CombatState => ({ ...cs, space: SPACE, participants: cs.participants.map((p, i) => ({ ...p, at: [i, 0], movement_remaining: 30 })) } as CombatState);

describe('PIN-1 (A07): the monster driver does not run in a state this build does not know, even with a monster holding the turn', () => {
  it("an AI table's DM tab, state 'reaction_window', a living monster is active: no /monster-turn", async () => {
    const f = fightOf('reaction_window', [pc({ hp_current: 4, is_alive: true }), { ...goblin, is_active_turn: true }], 'g1');
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'ai', fight: f, findText: /In combat · use the action bar/ });
    await tick(200);
    expect((dnd as unknown as { monsterTurn: jest.Mock }).monsterTurn).not.toHaveBeenCalled();
  });
  it("control: the same seat in an 'active' fight does drive it", async () => {
    const f = fightOf('active', [pc({ hp_current: 4, is_alive: true }), { ...goblin, is_active_turn: true }], 'g1');
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'ai', fight: f, findText: /In combat · use the action bar/ });
    await waitFor(() => expect((dnd as unknown as { monsterTurn: jest.Mock }).monsterTurn).toHaveBeenCalled(), { timeout: 2000 });
  });
});

describe('PIN-2 (A16): the party band shows a HELD fight\'s own HP (a fallen character is down), not the roster\'s last-known HP', () => {
  it('the roster says 7/9, the held fight says 0/9 and dead: the band shows the fight', async () => {
    mockUser = 'leon'; served = fightOf('held', [pc(), goblin]);
    mock<typeof dnd.getSession>(dnd.getSession).mockResolvedValue(SESSION('dm_alice', 'human'));
    mock<typeof dnd.getParticipants>(dnd.getParticipants).mockResolvedValue([PARTY[0], { ...PARTY[1], character: { ...PARTY[1].character!, current_hp: 7 } }]);
    mock<typeof dnd.getGrounding>(dnd.getGrounding).mockResolvedValue(GROUNDING);
    mock<typeof dnd.getCombatState>(dnd.getCombatState).mockImplementation(() => Promise.resolve(served));
    renderPlay(<PlayPage />);
    await screen.findByText(/The DM decides what happens next/);
    const band = document.querySelector('[data-region="partyStrip"]') as HTMLElement;
    expect(band).not.toBeNull();
    expect(band.textContent).not.toMatch(/7\s*\/\s*9/);
  });
});

describe('PIN-3 (C06, C01): while /end is in flight the confirm is busy (its buttons cannot be pressed), and it is one request', () => {
  it('both buttons are disabled until the request settles', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc(), goblin]), findText: /^Every character has fallen\.$/ });
    let release!: (v: unknown) => void;
    mock<typeof dnd.endCombat>(dnd.endCombat).mockImplementation(() => new Promise((r) => { release = r; }) as never);
    fireEvent.click(within(stage()).getByRole('button', { name: 'End combat' }));
    const dlg = screen.getByRole('dialog', { name: 'End the fight?' });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'End the fight' })); });
    expect(within(dlg).getByRole('button', { name: 'Keep waiting' })).toBeDisabled();
    expect(within(dlg).getByRole('button', { name: /End the fight/ })).toBeDisabled();
    expect(dnd.endCombat).toHaveBeenCalledTimes(1);
    await act(async () => { release({ state: fightOf('ended', [pc(), goblin]), outcome: 'tpk' }); });
  });
});

describe('PIN-4 (A15): with a map, a held fight\'s status is painted, not clipped under the map\'s rest line', () => {
  it('held + a board: no "In combat · round" rest line, and the status node is not the clipped one', async () => {
    await mount({ user: 'leon', dm: 'dm_alice', mode: 'human', fight: withBoard(fightOf('held', [pc(), goblin])), findText: /The DM decides what happens next/ });
    await tick(120);
    const st = stage().querySelector('[role="status"]') as HTMLElement;
    expect(stage().querySelector('[data-stage-line]')).toBeNull();
    expect(st.className).not.toMatch(/noteClipped/);
  });
});

describe('PIN-5 (DEFECT at the tip): a page that LOADS into a held fight does not take focus', () => {
  // In a browser the stage is on screen one request before the fight's state arrives; here the first state read is held back to model that.
  it.each([['leon', /The DM decides what happens next/], ['dm_alice', /^Every character has fallen\.$/]] as const)('%s: focus stays on <body> after the state arrives', async (user, text) => {
    mockUser = user; served = fightOf('held', [pc(), goblin]);
    mock<typeof dnd.getSession>(dnd.getSession).mockResolvedValue(SESSION('dm_alice', 'human'));
    mock<typeof dnd.getParticipants>(dnd.getParticipants).mockResolvedValue(PARTY);
    mock<typeof dnd.getGrounding>(dnd.getGrounding).mockResolvedValue(GROUNDING);
    mock<typeof dnd.getCombatState>(dnd.getCombatState).mockImplementation(() => new Promise((r) => setTimeout(() => r(served), 80)) as never);
    renderPlay(<PlayPage />);
    await screen.findByRole('textbox');
    expect(document.activeElement).toBe(document.body); // nothing has focus while the stage waits for the state
    await screen.findByText(text, undefined, { timeout: 3000 });
    await tick(120);
    expect(document.activeElement).toBe(document.body);
  });
});

describe('PIN-6 (DEFECT at the tip): a held edge leaves alone a focus that rests on <body>', () => {
  it('a player with nothing focused: the hold arrives, then lifts; focus is not moved', async () => {
    const live = () => fightOf('active', [pc({ hp_current: 4, is_alive: true, can_be_targeted: true }), { ...goblin, is_active_turn: true }], 'g1');
    await mount({ user: 'leon', dm: 'dm_alice', mode: 'human', fight: live(), findText: /In combat · use the action bar/ });
    await tick(60); (document.activeElement as HTMLElement | null)?.blur?.();
    served = fightOf('held', [pc(), goblin]);
    await waitFor(() => expect(stage().textContent).toMatch(/Every character has fallen/), { timeout: 2000 });
    await tick(60);
    expect(document.activeElement).toBe(document.body);
    served = live();
    await waitFor(() => expect(stage().textContent).toMatch(/In combat · use the action bar/), { timeout: 2000 });
    await tick(60);
    expect(document.activeElement).toBe(document.body);
  });
});

describe('PIN-7 (DEFECT at the tip): a bound combat whose state has not been read is live for the scene gate and the rebind lock', () => {
  it('the state read never resolves: no Move on, no check, the rebind button locked', async () => {
    mockUser = 'leon';
    mock<typeof dnd.getSession>(dnd.getSession).mockResolvedValue(SESSION('dm_alice', 'ai'));
    mock<typeof dnd.getParticipants>(dnd.getParticipants).mockResolvedValue(PARTY);
    mock<typeof dnd.getGrounding>(dnd.getGrounding).mockResolvedValue({ ...GROUNDING, checks: [{ skill: 'Perception', dc: 10, state: 'available' } as never] });
    mock<typeof dnd.getCombatState>(dnd.getCombatState).mockImplementation(() => new Promise(() => {}) as never);
    renderPlay(<PlayPage />);
    await screen.findByRole('textbox');
    await tick(200);
    expect(screen.queryByText('Press forward')).toBeNull();
    expect(screen.queryByRole('button', { name: /perception/i })).toBeNull();
    const rebind = screen.getAllByRole('button').find((b) => /switch characters|change your character/i.test(b.getAttribute('aria-label') ?? ''))!;
    expect(rebind).toBeDisabled();
  });
});

describe('PIN-8 (sibling of F5): a held verb\'s accessible name does not say "not your turn"', () => {
  it('the four verbs', async () => {
    await mount({ user: 'leon', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc(), goblin]), findText: /The DM decides what happens next/ });
    const rail = await screen.findByRole('group', { name: /your character.s actions/i });
    const names = within(rail).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
    for (const n of names) expect(n).not.toMatch(/not your turn/i);
    expect(names.filter((n) => /\(fight on hold\)/.test(n))).toHaveLength(4);
  });
});

describe('PIN-9 (F08): on the real page, a revive from the strip puts focus on the scene head when its opener has gone', () => {
  it('held -> Revive… -> applied -> the fight runs again: the scene head, never <body>', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc(), goblin]), findText: /^Every character has fallen\.$/ });
    const resumed = fightOf('active', [pc({ hp_current: 4, is_alive: true, can_be_targeted: true, is_active_turn: true }), goblin], 'p1');
    mock<typeof dnd.submitOverride>(dnd.submitOverride).mockImplementation(async () => { served = resumed; return { applied: { message: 'Anomaly is revived (DM override). 4/9 HP. The fight goes on.' }, state: resumed, event_seq: 9 } as never; });
    const revive = within(stage()).getByRole('button', { name: 'Revive…' });
    revive.focus(); fireEvent.click(revive);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: 'prayer' } });
    await act(async () => { fireEvent.click(dialog.querySelector('button[type="submit"]') as HTMLElement); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await tick(80);
    expect(within(stage()).queryByRole('button', { name: 'Revive…' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('group', { name: /^Scene:/ }));
  });
});

describe('PIN-10 (F06): the hold arrives while the DM is typing a Reason: focus stays in the Reason box', () => {
  it('the kinds shrink to Revive; the caret is not moved to the radio', async () => {
    const liveF = fightOf('active', [pc({ hp_current: 4, is_alive: true, can_be_targeted: true }), { ...goblin, is_active_turn: true }], 'g1');
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: liveF, findText: /In combat · use the action bar/ });
    fireEvent.click(await screen.findByRole('button', { name: /Open DM override modal/i }));
    const dialog = await screen.findByRole('dialog');
    const reason = within(dialog).getByLabelText(/Reason/i) as HTMLTextAreaElement;
    reason.focus(); fireEvent.change(reason, { target: { value: 'half a sentence' } });
    served = fightOf('held', [pc(), goblin]);
    await waitFor(() => expect(within(dialog).getAllByRole('radio')).toHaveLength(1), { timeout: 2000 });
    await tick(60);
    expect(document.activeElement).toBe(reason);
    expect(reason.value).toBe('half a sentence');
  });
});

describe('PIN-11 (Tora M-8): the End-session confirm\'s words are read once, when it opens', () => {
  const liveF = () => fightOf('active', [pc({ hp_current: 4, is_alive: true, can_be_targeted: true }), { ...goblin, is_active_turn: true }], 'g1');
  it('a hold that lands under the open confirm does not grow its body (a tap in flight would confirm unread words)', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: liveF(), findText: /In combat · use the action bar/ });
    fireEvent.click(await screen.findByRole('button', { name: /^End session$/i }));
    const dialog = await screen.findByRole('dialog', { name: /End this session/i });
    expect(dialog).not.toHaveTextContent(/waiting for your ruling/);
    served = fightOf('held', [pc(), goblin]);
    await waitFor(() => expect(stage().textContent).toMatch(/Every character has fallen/), { timeout: 2000 });
    await tick(60);
    expect(screen.getByRole('dialog', { name: /End this session/i })).not.toHaveTextContent(/waiting for your ruling/);
  });
  it('control: closed and reopened under the hold, it names the held fight', async () => {
    await mount({ user: 'dm_alice', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc(), goblin]), findText: /^Every character has fallen\.$/ });
    fireEvent.click(await screen.findByRole('button', { name: /^End session$/i }));
    expect(await screen.findByRole('dialog', { name: /End this session/i })).toHaveTextContent(/waiting for your ruling/);
  });
});

describe('PIN-12 (Tora M-7): the page hands the turn line the hold', () => {
  it('a held fight: the turn-status tenant carries the aria-hidden held note; a running fight has no such span', async () => {
    await mount({ user: 'leon', dm: 'dm_alice', mode: 'human', fight: fightOf('held', [pc(), goblin]), findText: /The DM decides what happens next/ });
    const line = document.querySelector('[data-tenant="turnStatus"]') as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.querySelector('span[aria-hidden="true"]')).toHaveTextContent('The fight is on hold.');
    expect(line).toHaveAttribute('role', 'status');
    served = fightOf('active', [pc({ hp_current: 4, is_alive: true, can_be_targeted: true }), { ...goblin, is_active_turn: true }], 'g1');
    await waitFor(() => expect(stage().textContent).toMatch(/In combat · use the action bar/), { timeout: 2000 });
    expect((document.querySelector('[data-tenant="turnStatus"]') as HTMLElement).querySelector('span[aria-hidden="true"]')).toBeNull();
  });
});
