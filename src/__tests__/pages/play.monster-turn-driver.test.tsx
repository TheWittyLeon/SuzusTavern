/**
 * A9d-2 gate 8 (Kage F3 re-verify IMPORTANT-A + S7; Backlog TAV-MONSTER-TURN-AUTODRIVER-UNBOUNDED).
 *
 * The AI-auto monster-turn driver (useCombatActions) used to `.catch(() => null)` the engine's refusal and re-POST on
 * every 4s poll: a persistent fault was a silent stall (a 500 + a WARNING every 4s per DM tab) and a non-DM tab POSTed
 * and got a 404 every poll. Now: only the session's DM drives; a refusal with a reason is shown ONCE (the action bar's
 * refused-action line, through engineErrorMessage + COMBAT_REFUSAL_REASON_MAP) and the driver stops asking about that
 * turn; any stuck engine is capped per TURN, not per effect run; a new turn is a fresh start.
 */

import React from 'react';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { CombatState, GroundingData, NarrationEvent, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// `roles` is the viewer's own: an admin who is not the DM must still not drive (A9d-2 fix round 3).
const mockAuth: { roles: string[] | undefined } = { roles: undefined };
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', email: null, roles: mockAuth.roles } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

// Full dnd mock — includes all new ADV-7/8 exports.
jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  combatFromScene: jest.fn(),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  rollInitiative: jest.fn(),
  monsterTurn: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  rollDeathSave: jest.fn(),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  // B2-4: rebind support
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'alice', role: 'player', character_id: 1 })),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  // DDX-22 Phase 3: JournalPane is now unconditionally mounted on the play
  // page (only its CSS visibility/inert state is gated by journalVisible —
  // see page.tsx's <aside id="play-pane-journal">), so every render of this
  // page fires a getSessionNotes() GET regardless of whether the journal is
  // ever opened. Default to "no note yet" so this suite stays hermetic.
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
}));

import * as dnd from '@/lib/api/dnd';
import * as stream from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';

// ── Typed mock handles ────────────────────────────────────────────────────────
const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetCombatState = dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>;
const mCombatFromScene = dnd.combatFromScene as jest.MockedFunction<typeof dnd.combatFromScene>;
const mRollInitiative = dnd.rollInitiative as jest.MockedFunction<typeof dnd.rollInitiative>;
const mMonsterTurn = dnd.monsterTurn as jest.MockedFunction<typeof dnd.monsterTurn>;
const mAttack = dnd.attack as jest.MockedFunction<typeof dnd.attack>;
const mEndTurn = dnd.endTurn as jest.MockedFunction<typeof dnd.endTurn>;
const mEndCombat = dnd.endCombat as jest.MockedFunction<typeof dnd.endCombat>;
const mAdvanceScene = dnd.advanceScene as jest.MockedFunction<typeof dnd.advanceScene>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['alice'],
  player_count: 1,
  active_combat_id: null,
  dm_mode: 'ai',
  visibility: 'public',
  content_rating: 'sfw',
};

const SESSION_WITH_COMBAT: Session = {
  ...SESSION,
  active_combat_id: 'combat-42',
};

const PARTY: Participant[] = [
  {
    username: 'alice',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Velka',
      char_class: 'Rogue',
      level: 1,
      current_hp: 8,
      max_hp: 10,
      ac: 14,
    },
  },
];

/** A full CombatState fixture — active combat, Velka's turn, one live goblin. */
const COMBAT_STATE: CombatState = {
  combat_id: 'combat-42',
  session_id: 's1',
  round: 1,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'p_velka',
  initiative: ['p_velka', 'p_gob1'],
  participants: [
    {
      participant_id: 'p_velka',
      // entity_id matches the PARTY fixture's character_id so isPlayerTurn works correctly.
      entity_id: 'c1',
      name: 'Velka',
      is_pc: true,
      initiative: 18,
      hp_current: 8,
      hp_max: 10,
      ac: 14,
      conditions: [],
      is_alive: true,
      can_be_targeted: true,
      is_active_turn: true,
      took_turn: false,
      death_saves: { successes: 0, failures: 0, is_downed: false, is_dying: false, is_stable: false, is_dead: false },
    },
    {
      participant_id: 'p_gob1',
      entity_id: 'goblin',
      name: 'Goblin',
      is_pc: false,
      initiative: 12,
      hp_current: 7,
      hp_max: 7,
      ac: 13,
      conditions: [],
      is_alive: true,
      can_be_targeted: true,
      is_active_turn: false,
      took_turn: false,
    },
  ],
  terrain: { lighting: 'dim', cover: '', hazards: [] },
  encounter_id: 'cave_mouth_guards',
  scene_id: 'cave_mouth',
  last_action: null,
  scene_advance: null,
};

/** CombatState with goblin dead and combat ended (ADV-8 scenario). */
const COMBAT_STATE_ENDED: CombatState = {
  ...COMBAT_STATE,
  state: 'ended',
  active_participant_id: null,
  participants: [
    { ...COMBAT_STATE.participants[0], is_active_turn: false },
    {
      ...COMBAT_STATE.participants[1],
      hp_current: 0,
      is_alive: false,
      can_be_targeted: false,
      is_active_turn: false,
    },
  ],
};

/** CombatState where it's NOT Velka's turn. */
const COMBAT_STATE_GOBLIN_TURN: CombatState = {
  ...COMBAT_STATE,
  active_participant_id: 'p_gob1',
  participants: [
    { ...COMBAT_STATE.participants[0], is_active_turn: false },
    { ...COMBAT_STATE.participants[1], is_active_turn: true },
  ],
};

const FROM_SCENE_RESULT = {
  combat_id: 'combat-42',
  round: 1,
  monsters: [
    { participant_id: 'p_gob1', name: 'Goblin', hp: 7, from_ref: 'dnd5e:monster:goblin' },
  ],
  terrain: { lighting: 'dim' },
  encounter_id: 'cave_mouth_guards',
};

const GROUNDING_NO_TRANSITION: GroundingData = {
  scene_id: 'cave_mouth',
  scene_name: 'Cave Mouth',
  transitions: [],
};

function streamOnce(events: NarrationEvent[]) {
  mStream.mockImplementation(async function* () {
    for (const e of events) yield e;
  });
}

function apiError(status: number, message: string, data?: unknown): Error & { status: number; body?: unknown } {
  const err = new Error(message) as Error & { status: number; body?: unknown };
  err.status = status;
  if (data !== undefined) err.body = data;
  return err;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetGrounding.mockResolvedValue(GROUNDING_NO_TRANSITION);
  mGetCombatState.mockResolvedValue(COMBAT_STATE);
  mCombatFromScene.mockResolvedValue(FROM_SCENE_RESULT);
  mRollInitiative.mockResolvedValue({ message: 'Initiative rolled.' });
  mMonsterTurn.mockResolvedValue({ message: 'Goblin attacks.', state: COMBAT_STATE });
  mAttack.mockResolvedValue({ message: '[ATTACK] Velka hits Goblin for 6.', state: COMBAT_STATE });
  mEndTurn.mockResolvedValue({ message: 'Turn ended.', state: COMBAT_STATE });
  mEndCombat.mockResolvedValue({ state: COMBAT_STATE_ENDED, outcome: 'unresolved', xp_earned: 0, defeated: [], scene_advance: null });
  mAdvanceScene.mockResolvedValue({ from_scene: 'cave_mouth', to_scene: 'tunnel', flags_set: [], visited_scenes_count: 2, ends_adventure: false });
  streamOnce([{ kind: 'chunk', text: 'The scene unfolds.' }, { kind: 'done' }]);
});

afterEach(() => {
  jest.useRealTimers();
  mockAuth.roles = undefined;
});


const REFUSAL_COPY = /stat block couldn't be loaded, so its turn didn't run/i;
const REFUSAL_BODY = (state: CombatState) => ({
  success: false,
  message: "[Combat] Can't run Goblin's turn: its stat block is unavailable. Try again, or act for it manually.",
  data: { reason: 'monster_statblock_unresolved', state },
});

const asDm = (): Session => ({ ...SESSION_WITH_COMBAT, dm_username: 'alice' });
const tick = async (ms = 4000) => { await act(async () => { jest.advanceTimersByTime(ms); }); };

// A fresh object per poll, like the wire: the same reference would never re-render, so never re-arm the driver.
let polled: CombatState = COMBAT_STATE_GOBLIN_TURN;

async function mountOnMonsterTurn(session: Session = asDm()) {
  mGetSession.mockResolvedValue(session);
  polled = COMBAT_STATE_GOBLIN_TURN;
  mGetCombatState.mockImplementation(async () => JSON.parse(JSON.stringify(polled)));
  renderPlay(<PlayPage />);
  await screen.findByText('The Hollow Tide');
  await act(async () => { await Promise.resolve(); });
}

describe('the AI-auto monster-turn driver: a refusal is shown once and the turn is not asked about again', () => {
  // A9d-2 N2 (Kage I-1) — named exception: this case pinned ONE attempt ("the turn is not asked about again"). The engine's FAULT class
  // covers a transient content read and the refusal writes nothing, so asking again is safe: it is asked on each following poll up to
  // the per-turn cap (3), and the line is said at once and ONCE. What pins the invariant now: this case (3 POSTs, one line, then
  // silence), the eight failure-class rows below, and the engineReasons class table's own unit cases.
  it('monster_statblock_unresolved (HTTP 500): curated copy in the action bar at once, ONE line, the turn asked about 3 times and no more', async () => {
    mMonsterTurn.mockRejectedValue(apiError(500, 'Internal server error', REFUSAL_BODY(COMBAT_STATE_GOBLIN_TURN)));
    await mountOnMonsterTurn();
    await waitFor(() => expect(screen.getByText(REFUSAL_COPY)).toBeInTheDocument());
    expect(mMonsterTurn).toHaveBeenCalledTimes(1); // said at once, on the first refusal
    expect(screen.getAllByText(REFUSAL_COPY)).toHaveLength(1);
    // The engine's own text is never shown (a 5xx body message is not player copy).
    expect(screen.queryByText(/act for it manually/i)).not.toBeInTheDocument();
    for (let i = 0; i < 8; i += 1) await tick();
    expect(mMonsterTurn).toHaveBeenCalledTimes(3);
    expect(screen.getAllByText(REFUSAL_COPY)).toHaveLength(1);
  });

  it('a retry that succeeds takes the refusal line back (a reasoned refusal is said at once, and is not left standing once it is false)', async () => {
    mMonsterTurn
      .mockRejectedValueOnce(apiError(500, 'Internal server error', REFUSAL_BODY(COMBAT_STATE_GOBLIN_TURN)))
      .mockResolvedValue({ message: '[MONSTER] Goblin attacks Velka for 3.', state: COMBAT_STATE });
    await mountOnMonsterTurn();
    await waitFor(() => expect(screen.getByText(REFUSAL_COPY)).toBeInTheDocument());
    await tick();
    await waitFor(() => expect(mMonsterTurn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(REFUSAL_COPY)).not.toBeInTheDocument());
  });

  // A9d-2 N2 — named exception: the refusal was a single attempt here; it is three now (see above), so the turn is exhausted first.
  it('a NEW turn (the next round, same monster) is a fresh start: the driver asks again, and the old refusal line is cleared', async () => {
    mMonsterTurn.mockRejectedValue(apiError(500, 'Internal server error', REFUSAL_BODY(COMBAT_STATE_GOBLIN_TURN)));
    await mountOnMonsterTurn();
    await waitFor(() => expect(screen.getByText(REFUSAL_COPY)).toBeInTheDocument());
    for (let i = 0; i < 6; i += 1) await tick();
    expect(mMonsterTurn).toHaveBeenCalledTimes(3);
    // Round 2, the goblin again: a different turn key.
    mMonsterTurn.mockReset();
    mMonsterTurn.mockResolvedValue({ message: '[MONSTER] Goblin attacks Velka for 3.' }); // frozen: no state back
    polled = { ...COMBAT_STATE_GOBLIN_TURN, round: 2 };
    await tick();
    await waitFor(() => expect(mMonsterTurn).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(REFUSAL_COPY)).not.toBeInTheDocument();
  });
});

describe('the AI-auto monster-turn driver is DM-gated (Kage S7)', () => {
  it('a player tab at an AI-auto table never POSTs /monster-turn, however many polls go by', async () => {
    await mountOnMonsterTurn({ ...SESSION_WITH_COMBAT, dm_username: 'suzu' }); // alice is a player here
    for (let i = 0; i < 5; i += 1) await tick();
    expect(mMonsterTurn).not.toHaveBeenCalled();
  });

  it('control: the same table, alice as the DM, does drive', async () => {
    mMonsterTurn.mockResolvedValue({ message: '[MONSTER] Goblin attacks Velka for 3.', state: COMBAT_STATE });
    await mountOnMonsterTurn(asDm());
    await waitFor(() => expect(mMonsterTurn).toHaveBeenCalledTimes(1));
  });
});

describe('the AI-auto monster-turn driver is capped per TURN (TAV-MONSTER-TURN-AUTODRIVER-UNBOUNDED)', () => {
  it('a frozen engine (200 OK, the turn never advances) is asked 3 times for that turn, not once per poll forever', async () => {
    mMonsterTurn.mockResolvedValue({ message: 'The monster acts.' }); // no `state`: what the harness stub does, and a stuck engine
    await mountOnMonsterTurn();
    for (let i = 0; i < 12; i += 1) await tick();
    expect(mMonsterTurn).toHaveBeenCalledTimes(3);
  });

  it('a transient failure (network) is retried and NOT shown while it heals; a turn that never heals is said once, after the cap', async () => {
    const net = Object.assign(new Error('network'), { status: 0, code: 'network' });
    mMonsterTurn.mockRejectedValueOnce(net).mockResolvedValue({ message: '[MONSTER] Goblin attacks Velka for 3.', state: COMBAT_STATE });
    await mountOnMonsterTurn();
    await waitFor(() => expect(mMonsterTurn).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/couldn't be run/i)).not.toBeInTheDocument();
    await tick(); // the second attempt heals it
    await waitFor(() => expect(mMonsterTurn).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/couldn't be run/i)).not.toBeInTheDocument();
  });

  it('never heals: three failures, then ONE generic line, then silence', async () => {
    const net = Object.assign(new Error('network'), { status: 0, code: 'network' });
    mMonsterTurn.mockRejectedValue(net);
    await mountOnMonsterTurn();
    for (let i = 0; i < 10; i += 1) await tick();
    expect(mMonsterTurn).toHaveBeenCalledTimes(3);
    expect(screen.getAllByText(/couldn't be run/i)).toHaveLength(1);
  });
});


// ── A9d-2 N2 (Kage I-1): the failure class is a TABLE beside the vocabulary, not membership of the copy map ───────────────────────
// Eight rows, as Kage's probe table listed them. `shown` = the line in the action bar; `posts` = POSTs to /monster-turn for ONE turn
// across many polls; `atOnce` = said on the first failure (a reasoned one) rather than when the cap runs out (a reasonless one).
describe('the monster-turn driver: every failure that is not a stale-turn answer is retried to the cap and said once; a stale one is taken and silent', () => {
  const reasoned = (status: number, reason: string, state: CombatState = COMBAT_STATE_GOBLIN_TURN) =>
    apiError(status, 'x', { success: false, error: 'engine text that must never show', data: { reason, state } });

  const faultRows: Array<[string, () => Error, RegExp, boolean]> = [
    ['db_unavailable (500, with a reason)', () => reasoned(500, 'db_unavailable'), /game database is unavailable/i, true],
    ['error (500, with a reason)', () => reasoned(500, 'error'), /Something went wrong resolving that action/i, true],
    ['upstream_non_json (the BFF, with a reason)', () => apiError(502, 'x', { success: false, reason: 'upstream_non_json' }), /sent back something unexpected/i, true],
    ['a reasonless 500 (the engine route\'s real exception path)', () => apiError(500, 'Internal server error'), /couldn't be run/i, false],
    ['a NekoNova 503', () => apiError(503, 'Service unavailable'), /couldn't be run/i, false],
    ['a dropped connection (no status, a transport code)', () => Object.assign(new Error('network'), { status: 0, code: 'network' }), /couldn't be run/i, false],
  ];
  it.each(faultRows)('%s: asked 3 times, said once (%s at once: %s)', async (_name, make, copy, atOnce) => {
    mMonsterTurn.mockRejectedValue(make());
    await mountOnMonsterTurn();
    await waitFor(() => expect(mMonsterTurn).toHaveBeenCalledTimes(1));
    if (atOnce) await waitFor(() => expect(screen.getByText(copy)).toBeInTheDocument());
    else expect(screen.queryByText(copy)).not.toBeInTheDocument(); // silent while it may heal
    for (let i = 0; i < 10; i += 1) await tick();
    expect(mMonsterTurn).toHaveBeenCalledTimes(3);
    expect(screen.getAllByText(copy)).toHaveLength(1);
    expect(screen.queryByText(/engine text that must never show/i)).not.toBeInTheDocument();
  });

  const staleRows: Array<[string, () => Error]> = [
    ['not_a_monsters_turn (400): the turn moved on', () => reasoned(400, 'not_a_monsters_turn', COMBAT_STATE)],
    ['no_active_turn (400)', () => reasoned(400, 'no_active_turn', COMBAT_STATE)],
    ['combat_over (400)', () => reasoned(400, 'combat_over', COMBAT_STATE_ENDED)],
    ['not_found (404): the combat is gone', () => apiError(404, 'not found', { success: false, data: { reason: 'not_found' } })],
    ['a 404 with no body at all', () => apiError(404, 'Not Found')],
  ];
  it.each(staleRows)('%s: asked ONCE, nothing said, not asked again', async (_name, make) => {
    mMonsterTurn.mockRejectedValue(make());
    await mountOnMonsterTurn();
    await waitFor(() => expect(mMonsterTurn).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 6; i += 1) await tick();
    expect(mMonsterTurn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/not a monster's turn|Combat not found|Combat has ended|couldn't be run|No one has the active turn/i)).not.toBeInTheDocument();
  });

  it('a stale answer\'s body carries the CURRENT state, and the page takes it (the turn marker becomes the truth)', async () => {
    mMonsterTurn.mockRejectedValue(reasoned(400, 'not_a_monsters_turn', { ...COMBAT_STATE, round: 9 }));
    await mountOnMonsterTurn();
    await waitFor(() => expect(mMonsterTurn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText(/round 9/i).length).toBeGreaterThan(0));
  });

  it('a 200 that never advances the turn: asked 3 times, then it SPEAKS once (the silent stall IMPORTANT-A was filed against)', async () => {
    mMonsterTurn.mockResolvedValue({ message: 'The monster acts.' });
    await mountOnMonsterTurn();
    for (let i = 0; i < 12; i += 1) await tick();
    expect(mMonsterTurn).toHaveBeenCalledTimes(3);
    expect(screen.getAllByText(/couldn't be run/i)).toHaveLength(1);
  });

  it('a 200 that hands back the SAME monster\'s turn (state present, nothing advanced): asked 3 times in one run, then it speaks once', async () => {
    mMonsterTurn.mockResolvedValue({ message: 'The monster acts.', state: COMBAT_STATE_GOBLIN_TURN });
    await mountOnMonsterTurn();
    await waitFor(() => expect(screen.getAllByText(/couldn't be run/i)).toHaveLength(1));
    for (let i = 0; i < 6; i += 1) await tick();
    expect(mMonsterTurn).toHaveBeenCalledTimes(3);
    expect(screen.getAllByText(/couldn't be run/i)).toHaveLength(1);
  });

  it('a CURATED reason that is not in the class table is a fault, not a terminal refusal: it is asked 3 times (the class is not membership of the copy map)', async () => {
    // `target_down` has player-facing copy in COMBAT_REFUSAL_REASON_MAP and no row in MONSTER_TURN_REASON_CLASS.
    mMonsterTurn.mockRejectedValue(reasoned(400, 'target_down'));
    await mountOnMonsterTurn();
    for (let i = 0; i < 10; i += 1) await tick();
    expect(mMonsterTurn).toHaveBeenCalledTimes(3);
  });
});

describe('the monster-turn driver\'s line is its own (Kage S4): a new monster turn never clears a PLAYER\'s refusal that replaced it', () => {
  it('the DM\'s own Attack is refused, then the next monster turn begins: the player\'s line stays', async () => {
    mMonsterTurn.mockRejectedValueOnce(apiError(500, 'Internal server error', REFUSAL_BODY(COMBAT_STATE_GOBLIN_TURN)));
    await mountOnMonsterTurn();
    await waitFor(() => expect(screen.getByText(REFUSAL_COPY)).toBeInTheDocument());
    // The poll hands the table to alice (Velka): her own Attack is refused, which replaces the line.
    polled = COMBAT_STATE;
    await tick();
    mAttack.mockRejectedValue(apiError(400, '[Combat] Velka has already used their action this turn.', { success: false, data: { reason: 'no_action_remaining', state: COMBAT_STATE } }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Attack/i }).length).toBeGreaterThan(0));
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /Attack/i })[0]); });
    const target = await screen.findAllByRole('menuitem');
    await act(async () => { fireEvent.click(target[0]); });
    await waitFor(() => expect(screen.queryByText(REFUSAL_COPY)).not.toBeInTheDocument());
    const playerLine = await waitFor(() => {
      const alerts = screen.getAllByRole('alert').filter((a) => (a.textContent ?? '').trim() !== '');
      expect(alerts.length).toBeGreaterThan(0);
      return alerts[0].textContent;
    });
    // The next monster turn (round 2): the driver starts a fresh ledger and must take back only ITS OWN line, which is gone already.
    mMonsterTurn.mockResolvedValue({ message: '[MONSTER] Goblin attacks Velka for 3.' });
    polled = { ...COMBAT_STATE_GOBLIN_TURN, round: 2 };
    await tick();
    await waitFor(() => expect(mMonsterTurn).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole('alert').some((a) => (a.textContent ?? '').trim() === playerLine)).toBe(true);
  });
});

// ── A9d-2 fix round 3: the election is the DM's tab and nothing else; an admin who is not the DM never drives ─────────
describe('the monster-turn driver: an admin who is not the DM does not drive, at any table', () => {
  const table = (dm: string, participants: string[]): Session => ({ ...SESSION_WITH_COMBAT, dm_username: dm, participant_usernames: participants });

  it.each([
    ['a table whose DM is seated', 'bob', ['alice', 'bob']],
    ['the same, the DM seated in another case', 'Bob', ['alice', 'bob']],
    ['a Twitch-created table (dm_username is a broadcaster login nobody at it has)', 'thewittyleon', ['alice']],
    ['an old `suzu` row', 'suzu', ['alice']],
  ])('an admin viewing %s: nothing drives (a Tavern cannot tell these apart on the wire, so none of them elects an admin)', async (_n, dm, participants) => {
    mockAuth.roles = ['user', 'admin'];
    await mountOnMonsterTurn(table(dm, participants));
    for (let i = 0; i < 4; i += 1) await tick();
    expect(mMonsterTurn).not.toHaveBeenCalled();
  });

  it('control: an admin who IS the DM drives', async () => {
    mockAuth.roles = ['admin'];
    mMonsterTurn.mockResolvedValue({ message: '[MONSTER] Goblin attacks Velka for 3.', state: COMBAT_STATE });
    await mountOnMonsterTurn(table('Alice', ['bob']));
    await waitFor(() => expect(mMonsterTurn).toHaveBeenCalledTimes(1));
  });
});
