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

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', email: null } }),
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
const mRollDeathSave = dnd.rollDeathSave as jest.MockedFunction<typeof dnd.rollDeathSave>;
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

const GROUNDING_WITH_TRANSITION: GroundingData = {
  scene_id: 'cave_mouth',
  scene_name: 'Cave Mouth',
  boxed_text: 'A dark cave mouth looms before you.',
  transitions: [{ to: 'tunnel', label: 'Enter the tunnel' }],
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
  it('monster_statblock_unresolved (HTTP 500): curated copy in the action bar, ONE POST across many polls', async () => {
    mMonsterTurn.mockRejectedValue(apiError(500, 'Internal server error', REFUSAL_BODY(COMBAT_STATE_GOBLIN_TURN)));
    await mountOnMonsterTurn();
    await waitFor(() => expect(screen.getByText(REFUSAL_COPY)).toBeInTheDocument());
    expect(screen.getAllByText(REFUSAL_COPY)).toHaveLength(1);
    // The engine's own text is never shown (a 5xx body message is not player copy).
    expect(screen.queryByText(/act for it manually/i)).not.toBeInTheDocument();
    for (let i = 0; i < 6; i += 1) await tick();
    expect(mMonsterTurn).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(REFUSAL_COPY)).toHaveLength(1);
  });

  it('a NEW turn (the next round, same monster) is a fresh start: the driver asks again, and the old refusal line is cleared', async () => {
    mMonsterTurn.mockRejectedValueOnce(apiError(500, 'Internal server error', REFUSAL_BODY(COMBAT_STATE_GOBLIN_TURN)));
    await mountOnMonsterTurn();
    await waitFor(() => expect(screen.getByText(REFUSAL_COPY)).toBeInTheDocument());
    expect(mMonsterTurn).toHaveBeenCalledTimes(1);
    // Round 2, the goblin again: a different turn key.
    mMonsterTurn.mockResolvedValue({ message: '[MONSTER] Goblin attacks Velka for 3.' }); // frozen: no state back
    polled = { ...COMBAT_STATE_GOBLIN_TURN, round: 2 };
    await tick();
    await waitFor(() => expect(mMonsterTurn).toHaveBeenCalledTimes(2));
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
