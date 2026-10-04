/**
 * B8c-3 M3 (Sora's brief 3, 3a, 8) — THE MOVE, on the real page. The Move toggle in the action bar arms the board; the map's own commit calls `useBoard`'s `onMove`; the POST is
 * `{ participant_id, from, to }` and nothing else.
 *   one POST for two synchronous activations (the shared latch); `from` is the DRAWN `at` (a token the poll moved while armed sends the new square); a 409 applies the state and sends nothing more,
 *   focus stays on the square the user was on, Move stays armed; a move calls no narration; the mover's one row at the 200 and none when the turn passes; each refusal's copy in the bar's alert and
 *   its focus rule; Move absent with a null budget, disabled at 0 ft, and any other verb disarms it.
 * Mutations seen red (each one line): the latch removed -> two POSTs; `from` read from a ref taken at arm time -> the moved-token case; a retry on 409 -> a second POST; the move routed through
 * `onCombatAction` -> the narration pin; the mover's square not accounted for -> a second row at the boundary; focus following every change of `at` (map) -> the 409 focus pin.
 */
import React from 'react';
import { act, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { CombatSpace, CombatState, GroundingData, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 's1' }) }));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }) }));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  getCatalog: jest.fn(() => Promise.resolve({ items: [] })),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
  moveToken: jest.fn(),
  dodge: jest.fn(),
}));
jest.mock('../../lib/stream', () => ({ streamDmNarration: jest.fn(async function* () { yield { kind: 'done' }; }) }));
// The poll is every 4s; shortened so "the poll moved the token while Move was armed" lands inside a test. Nothing else reads it.
jest.mock('../../app/play/[sessionId]/format', () => ({ ...jest.requireActual('../../app/play/[sessionId]/format'), POLL_INTERVAL_MS: 80 }));

import * as dnd from '@/lib/api/dnd';
import { streamDmNarration } from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';
import { LAYOUT_ROWS_BY_ID } from '@/app/play/[sessionId]/presets';

const SPACE: CombatSpace = { kind: 'square', width: 13, height: 7, cell: { value: 5, unit: 'ft' }, blocked: [[5, 2]], features: [] };
const SESSION: Session = { session_id: 's1', channel: 'c', name: 'Test Table', status: 'active', dm_username: 'suzu', participant_usernames: ['leon'], player_count: 1, active_combat_id: null, dm_mode: 'ai', ai_assist_level: 'off' };
const PARTY: Participant[] = [{ username: 'leon', is_dm: false, character: { character_id: 'c1', name: 'Anomaly', char_class: 'Ranger', level: 1, current_hp: 10, max_hp: 10, ac: 13 } }];
const GROUNDING: GroundingData = { scene_id: 'e', scene_name: 'Flight', boxed_text: 'x', transitions: [], checks: [], flags: {}, encounter_state: {}, encounter: { kind: 'combat', trigger: 'manual' } };

/** The fight as the engine serves it. `pc` / `foe` override the two participants; `turn` is whose turn. */
function combat(o: { pc?: object; foe?: object; turn?: 'p1' | 'w1'; round?: number; space?: unknown } = {}): CombatState {
  const turn = o.turn ?? 'p1';
  return {
    combat_id: 'combat-flight', session_id: 's1', round: o.round ?? 1, state: 'active', turn_index: 0, active_participant_id: turn, initiative: ['p1', 'w1'], space: o.space === undefined ? SPACE : o.space,
    participants: [
      { participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 10, hp_max: 10, ac: 13, conditions: [], is_alive: true, can_be_targeted: false, is_active_turn: turn === 'p1', took_turn: false, at: [1, 3], movement_remaining: 30, ...o.pc },
      { participant_id: 'w1', entity_id: 'g1', name: 'Timberwolf', is_pc: false, initiative: 9, hp_current: 19, hp_max: 19, ac: 13, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: turn === 'w1', took_turn: false, at: [9, 3], movement_remaining: 30, ...o.foe },
    ],
  } as unknown as CombatState;
}
const refusal = (status: number, reason: string, state?: CombatState) => Object.assign(new Error(reason), { status, code: undefined, body: { success: false, message: reason, data: state ? { reason, state } : { reason } } });
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

// The real page renders slowly under a whole-suite run (jsdom, a map, polls every 80 ms): every waitFor gets room, so a loaded machine is not a failure.
configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
  (dnd.getGrounding as jest.Mock).mockResolvedValue(GROUNDING);
  (dnd.getSession as jest.Mock).mockResolvedValue({ ...SESSION, active_combat_id: 'combat-flight' });
});

async function load(state: CombatState = combat()) {
  (dnd.getCombatState as jest.Mock).mockResolvedValue(state);
  const { container } = renderPlay(<PlayPage />);
  await screen.findByText('Test Table');
  await screen.findByText(/In combat · use the action bar/);
  await waitFor(() => expect(screen.queryAllByRole('gridcell').length).toBeGreaterThan(0));
  return container;
}
const moveBtn = () => screen.getByRole('button', { name: 'Move' });
const cellOf = (row: number, col: number) => screen.getByRole('gridcell', { name: new RegExp(`^Row ${row}, column ${col}\\.`) });
/** The engine's answer to a move AND what every poll says from then on (the world moved: a poll must not hand back the old square). */
const landed = (state: CombatState) => { (dnd.getCombatState as jest.Mock).mockResolvedValue(state); return { message: 'x', state }; };
const stop = () => document.activeElement as HTMLElement;
const key = (k: string) => fireEvent.keyDown(document.activeElement as HTMLElement, { key: k });
const alertText = () => document.querySelector('[data-region="actionBar"] [role="alert"]')?.textContent ?? '';
const logText = () => document.querySelector('[data-region="storyLog"]')?.textContent ?? '';
const rows = (name: string) => (logText().match(new RegExp(`${name} moves\\.`, 'g')) ?? []).length;

/** Arm Move, arrow one square right of the token and commit it with Enter: the legal one-square move [1,3] -> [2,3]. */
async function armAndStep() {
  fireEvent.click(moveBtn());
  await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('gridcell'));
  key('ArrowRight');
}

describe('the Move control in the action bar', () => {
  it('is a toggle with a FIXED name and aria-pressed, between Dash and End turn; pressing it arms the board and focus enters at the token', async () => {
    await load();
    expect(moveBtn()).toHaveAttribute('aria-pressed', 'false');
    const names = within(document.querySelector('[data-region="actionBar"]') as HTMLElement).getAllByRole('button').map((b) => b.textContent?.trim());
    expect(names.slice(0, 5)).toEqual(['Attack', 'Dodge', 'Dash', 'Move', 'End turn']);
    fireEvent.click(moveBtn());
    await waitFor(() => expect(moveBtn()).toHaveAttribute('aria-pressed', 'true'));
    expect(moveBtn()).toHaveAccessibleName('Move');
    await waitFor(() => expect(stop()).toBe(cellOf(4, 2))); // the token is [1,3]: row 4, column 2
    fireEvent.click(moveBtn());
    await waitFor(() => expect(moveBtn()).toHaveAttribute('aria-pressed', 'false'));
  });

  it('is ABSENT with a null budget, with no square, off a board (no `space` key, `space: null`), and on an observer\'s seat for a monster\'s turn it is disabled', async () => {
    await load(combat({ pc: { movement_remaining: null } }));
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull();
  });

  it('is DISABLED at 0 ft and on a monster\'s turn (native disabled, like every other verb)', async () => {
    await load(combat({ pc: { movement_remaining: 0 } }));
    expect(moveBtn()).toBeDisabled();
  });

  it('with the flag off (no `space` key) there is no Move and the bar has the four verbs it always had', async () => {
    (dnd.getCombatState as jest.Mock).mockResolvedValue((() => { const c = combat(); delete (c as { space?: unknown }).space; return c; })());
    renderPlay(<PlayPage />);
    await screen.findByText(/In combat · use the action bar/);
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull();
    expect(within(document.querySelector('[data-region="actionBar"]') as HTMLElement).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Attack', 'Dodge', 'Dash', 'End turn']);
  });

  it('any OTHER verb disarms Move (a verb in flight is not a move in flight)', async () => {
    const hold = deferred<{ message: string }>();
    (dnd.dodge as jest.Mock).mockReturnValue(hold.promise);
    await load();
    fireEvent.click(moveBtn());
    await waitFor(() => expect(moveBtn()).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Dodge' }));
    await waitFor(() => expect(moveBtn()).toHaveAttribute('aria-pressed', 'false'));
    hold.resolve({ message: 'ok' });
  });
});

describe('the move itself', () => {
  it('ONE POST for two activations in one tick, with the body { participant_id, from: the drawn at, to } and nothing else', async () => {
    const hold = deferred<{ message: string; state: CombatState }>();
    (dnd.moveToken as jest.Mock).mockReturnValue(hold.promise);
    await load();
    await armAndStep();
    act(() => { const el = document.activeElement as HTMLElement; for (let i = 0; i < 2; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(dnd.moveToken).toHaveBeenCalledTimes(1);
    const [combatId, body] = (dnd.moveToken as jest.Mock).mock.calls[0];
    expect(combatId).toBe('combat-flight');
    expect(body).toEqual({ participant_id: 'p1', from: [1, 3], to: [2, 3] });
    expect(Object.keys(body).sort()).toEqual(['from', 'participant_id', 'to']);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-busy', 'true'); // the pending look: nothing is drawn until the server answers
    expect(cellOf(4, 2)).toHaveAccessibleName(/Anomaly/);
    hold.resolve(landed(combat({ pc: { at: [2, 3], movement_remaining: 25 } })));
    await waitFor(() => expect(screen.getByRole('grid')).not.toHaveAttribute('aria-busy', 'true'));
  });

  it('the 200: the token is drawn at the new square, focus is on it, Move stays armed with feet left, ONE row for the move, and NO narration beat', async () => {
    await load(); // load() serves the PRE-move world to the poll: the engine's answer (and the world every later poll sees) is set AFTER it, or a poll would hand the old square back (Kage)
    (dnd.moveToken as jest.Mock).mockResolvedValue({ ...landed(combat({ pc: { at: [2, 3], movement_remaining: 25 } })), message: '[Combat] Anomaly moves 5 ft.' });
    fireEvent.click(moveBtn());
    await waitFor(() => expect(stop()).toBe(cellOf(4, 2)));
    fireEvent.click(cellOf(4, 3)); // a click that moves no focus (jsdom): DOM focus stays on the token's OLD square until the landing's movedSeq takes it to the new one
    await waitFor(() => expect(cellOf(4, 3)).toHaveAccessibleName(/Anomaly/));
    await waitFor(() => expect(stop()).toBe(cellOf(4, 3)));
    expect(moveBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(rows('Anomaly')).toBe(1);
    expect(logText()).not.toContain('[Combat]'); // the engine's own line is not a second row
    expect(streamDmNarration).not.toHaveBeenCalled();
    expect(dnd.moveToken).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 400)); // several polls later the world is still the landed one (a poll answering the old square would have put the token back)
    expect(cellOf(4, 3)).toHaveAccessibleName(/Anomaly/);
  });

  it('`from` is the DRAWN at, not the square Move was armed on: a poll that moved the token while armed sends the new square', async () => {
    (dnd.moveToken as jest.Mock).mockImplementation(async () => landed(combat({ pc: { at: [5, 5], movement_remaining: 25 } })));
    await load();
    fireEvent.click(moveBtn());
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('gridcell'));
    (dnd.getCombatState as jest.Mock).mockResolvedValue(combat({ pc: { at: [4, 4], movement_remaining: 30 } })); // redrawn by a poll
    await waitFor(() => expect(cellOf(5, 5)).toHaveAccessibleName(/Anomaly/));
    // the user\'s square is where focus is (the arming square: [1,3], now one with nothing on it); choose a legal neighbour of the NEW token by hover-free click
    fireEvent.click(cellOf(5, 6));
    await waitFor(() => expect(dnd.moveToken).toHaveBeenCalled());
    expect((dnd.moveToken as jest.Mock).mock.calls[0][1]).toEqual({ participant_id: 'p1', from: [4, 4], to: [5, 4] });
  });

  it('the mover\'s row is written once at the 200 and NOT again when the turn passes (the square is accounted for); a creature that moved meanwhile still gets its own row', async () => {
    (dnd.moveToken as jest.Mock).mockImplementation(async () => landed(combat({ pc: { at: [2, 3], movement_remaining: 25 } })));
    await load();
    await armAndStep();
    key('Enter');
    await waitFor(() => expect(rows('Anomaly')).toBe(1));
    (dnd.getCombatState as jest.Mock).mockResolvedValue(combat({ turn: 'w1', round: 1, pc: { at: [2, 3], movement_remaining: 25 }, foe: { at: [8, 3] } }));
    await waitFor(() => expect(rows('Timberwolf')).toBe(1));
    expect(rows('Anomaly')).toBe(1);
  });
});

describe('refusals: the copy in the action bar\'s alert, never re-sent, and where focus and Move end up', () => {
  const refuse = async (status: number, reason: string, state?: CombatState) => {
    await load();
    // the refusal's `state` is what every later poll says too (the engine's world IS that state); set when the refusal is served, after load() served the pre-move one
    (dnd.moveToken as jest.Mock).mockImplementation(async () => { if (state) (dnd.getCombatState as jest.Mock).mockResolvedValue(state); throw refusal(status, reason, state); });
    await armAndStep();
    const before = stop();
    key('Enter');
    await waitFor(() => expect(alertText()).not.toBe(''));
    return before;
  };

  it('409 position_changed: the state is applied (the token redrawn), focus STAYS on the square the user was on, Move is still armed, and nothing is re-sent', async () => {
    const before = await refuse(409, 'position_changed', combat({ pc: { at: [3, 3], movement_remaining: 30 } }));
    expect(alertText()).toBe("The board moved on — that spot is out of date. Have another look.");
    await waitFor(() => expect(cellOf(4, 4)).toHaveAccessibleName(/Anomaly/));
    expect(stop()).toBe(before);
    expect(moveBtn()).toHaveAttribute('aria-pressed', 'true');
    await new Promise((r) => setTimeout(r, 400)); // several polls
    expect(dnd.moveToken).toHaveBeenCalledTimes(1);
  });

  it('400 invalid_destination: still armed, focus where it was', async () => {
    const before = await refuse(400, 'invalid_destination', combat());
    expect(alertText()).toBe("You can't move there — it's blocked or occupied.");
    expect(stop()).toBe(before);
    expect(moveBtn()).toHaveAttribute('aria-pressed', 'true');
  });

  it('a network failure (no reason): the generic copy, still armed, nothing re-sent', async () => {
    (dnd.moveToken as jest.Mock).mockRejectedValue(Object.assign(new Error('network'), { status: 0, code: 'network', body: null }));
    await load();
    await armAndStep();
    key('Enter');
    await waitFor(() => expect(alertText()).toBe("That move didn't go through."));
    expect(moveBtn()).toHaveAttribute('aria-pressed', 'true');
    expect(dnd.moveToken).toHaveBeenCalledTimes(1);
  });

  it('400 no_movement_remaining: Move disarms and focus goes to the Move button (or the bar\'s container when it is disabled), never <body>', async () => {
    await refuse(400, 'no_movement_remaining', combat({ pc: { movement_remaining: 0 } }));
    await waitFor(() => expect(moveBtn()).toHaveAttribute('aria-pressed', 'false'));
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-region="actionBar"]')));
  });

  it('400 not_your_turn: disarmed, the turn is the monster\'s, focus in the action bar', async () => {
    await refuse(400, 'not_your_turn', combat({ turn: 'w1' }));
    await waitFor(() => expect(moveBtn()).toBeDisabled());
    expect(document.activeElement).not.toBe(document.body);
  });

  const noSpace = () => { const c = combat(); delete (c as { space?: unknown }).space; return c; };

  it('404 positioning_disabled (no state): the copy, disarmed, the state is re-read so the page learns the board is gone; focus was in the grid that left, so it goes to the scene head (the existing grid rescue), never <body>', async () => {
    (dnd.moveToken as jest.Mock).mockRejectedValue(refusal(404, 'positioning_disabled'));
    await load();
    await armAndStep();
    (dnd.getCombatState as jest.Mock).mockResolvedValue(noSpace()); // the next read has no `space` key
    key('Enter');
    await waitFor(() => expect(alertText()).toBe("The battle map isn't available here."));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Move' })).toBeNull());
    expect(screen.queryByRole('grid')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-focus-fallback]')));
  });

  it('the board goes away (a poll) while focus is ON the Move button: the button\'s own unmount sends focus to the action bar\'s container, never <body>', async () => {
    await load();
    act(() => moveBtn().focus());
    expect(document.activeElement).toBe(moveBtn());
    (dnd.getCombatState as jest.Mock).mockResolvedValue(noSpace());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Move' })).toBeNull());
    expect(document.activeElement).toBe(document.querySelector('[data-region="actionBar"]'));
  });

  it('a poll that removes the board while focus is in the COMPOSER leaves focus where it is (the rescue never steals)', async () => {
    await load();
    const box = screen.getByRole('textbox');
    act(() => box.focus());
    (dnd.getCombatState as jest.Mock).mockResolvedValue(noSpace());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Move' })).toBeNull());
    expect(document.activeElement).toBe(box);
  });
});

describe('Escape and the focus rules around Move', () => {
  it('Escape returns focus to the Move button, unpressed; in flight it closes nothing', async () => {
    const hold = deferred<{ message: string; state: CombatState }>();
    (dnd.moveToken as jest.Mock).mockReturnValue(hold.promise);
    await load();
    await armAndStep();
    key('Enter');
    key('Escape'); // in flight
    expect(moveBtn()).toHaveAttribute('aria-pressed', 'true');
    hold.resolve(landed(combat({ pc: { at: [2, 3], movement_remaining: 25 } })));
    await waitFor(() => expect(screen.getByRole('grid')).not.toHaveAttribute('aria-busy', 'true'));
    key('Escape');
    await waitFor(() => expect(moveBtn()).toHaveAttribute('aria-pressed', 'false'));
    expect(document.activeElement).toBe(moveBtn());
  });

  it('the last feet spent: Move disarms and focus goes to the bar\'s container (the Move button is disabled), never <body>', async () => {
    (dnd.moveToken as jest.Mock).mockImplementation(async () => landed(combat({ pc: { at: [2, 3], movement_remaining: 0 } })));
    await load(combat({ pc: { movement_remaining: 5 } }));
    await armAndStep();
    key('Enter');
    await waitFor(() => expect(moveBtn()).toBeDisabled());
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-region="actionBar"]')));
  });
});

describe('an observer never moves', () => {
  it('on a monster\'s turn the Move button is disabled and a click on a reach square sends nothing', async () => {
    await load(combat({ turn: 'w1' }));
    expect(moveBtn()).toBeDisabled();
    fireEvent.click(cellOf(4, 9));
    fireEvent.click(cellOf(4, 8));
    expect(dnd.moveToken).not.toHaveBeenCalled();
  });
});

describe('a move in flight', () => {
  it('disables the Move button (native disabled, still pressed) until the answer, then it is enabled again with feet left', async () => {
    const hold = deferred<{ message: string; state: CombatState }>();
    (dnd.moveToken as jest.Mock).mockReturnValue(hold.promise);
    await load();
    await armAndStep();
    key('Enter');
    await waitFor(() => expect(moveBtn()).toBeDisabled());
    expect(moveBtn()).toHaveAttribute('aria-pressed', 'true');
    hold.resolve(landed(combat({ pc: { at: [2, 3], movement_remaining: 25 } })));
    await waitFor(() => expect(moveBtn()).toBeEnabled());
  });
});

describe('a disarm moves focus only while focus is in the grid', () => {
  it('a refusal that ends Move, arriving after the user went to the composer, leaves focus in the composer', async () => {
    const hold = deferred<{ message: string; state: CombatState }>();
    (dnd.moveToken as jest.Mock).mockReturnValue(hold.promise);
    await load();
    await armAndStep();
    key('Enter'); // in flight
    const box = screen.getByRole('textbox');
    act(() => box.focus());
    hold.reject(refusal(400, 'no_movement_remaining', combat({ pc: { movement_remaining: 0 } })));
    await waitFor(() => expect(moveBtn()).toBeDisabled());
    expect(document.activeElement).toBe(box);
  });
});

describe('the phone row', () => {
  const real = window.matchMedia;
  const phoneStage = LAYOUT_ROWS_BY_ID.phone.regions.sceneStage as { combat?: { area: string; variant?: string } };
  const had = phoneStage.combat;
  afterEach(() => { window.matchMedia = real; if (had) phoneStage.combat = had; else delete phoneStage.combat; });
  it('has no Move even when its stage HAS a body (the row opts in, the stage does not decide): the board is drawn and the bar has no Move', async () => {
    const { PLAY_PHONE_QUERY } = jest.requireActual('../../lib/breakpoints') as { PLAY_PHONE_QUERY: string };
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({ matches: query === PLAY_PHONE_QUERY, media: query, onchange: null, addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() }));
    phoneStage.combat = { area: 'sceneStage', variant: 'hero' }; // what P1 will do to the phone row: the control is that the board shows up
    (dnd.getCombatState as jest.Mock).mockResolvedValue(combat());
    renderPlay(<PlayPage />);
    await screen.findByText('Test Table');
    await screen.findByText(/In combat/);
    await waitFor(() => expect(screen.queryAllByRole('gridcell').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dodge' })).toBeInTheDocument();
  });
});
