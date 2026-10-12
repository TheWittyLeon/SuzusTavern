/**
 * Lane G QA (Miko), item 3 -- already_advanced on end-turn, monster-turn (and, in the panel suite, npc-action).
 * Fixtures and mocks are copied from the developer's suite on purpose: independent file, same seams.
 *
 * Contract under test: `already_advanced === true` (strictly) drops ONLY the end-turn "turn ends" beat and
 * re-reads the fight; false / absent / any non-`true` value is today's behaviour; the rest of the answer
 * (state fallback, scene_advance, outcome_line, monster-turn message) is never dropped; and the page must
 * never be left showing a turn that is not the server's.
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



const tick = async (ms = 4000) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const OUTCOME = 'The flight is over; the wolves lose the trail.';
const clickEndTurn = async () => {
  await waitFor(() => expect(screen.getByRole('button', { name: 'End turn' })).toBeInTheDocument());
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'End turn' })); });
};
async function mountOnPcTurn() {
  mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
  renderPlay(<PlayPage />);
  await screen.findByText('The Hollow Tide');
  await act(async () => { await Promise.resolve(); });
}
const endTurnBeats = () => mStream.mock.calls.filter((c) => c[0].message === 'I end my turn.').length;
const endTurnButton = () => screen.queryByRole('button', { name: 'End turn' });

/** Count combat-state reads that happen AFTER the answer under test was given. */
function armReadCounter(held: () => CombatState) {
  const counter = { armed: false, reads: 0 };
  mGetCombatState.mockImplementation(async () => {
    if (counter.armed) counter.reads += 1;
    return JSON.parse(JSON.stringify(held()));
  });
  return counter;
}

describe('end-turn: every value of the flag', () => {
  it.each([
    ['absent', {}],
    ['false', { already_advanced: false }],
    ['the string "true"', { already_advanced: 'true' }],
    ['the number 1', { already_advanced: 1 }],
    ['null', { already_advanced: null }],
  ])('%s: the beat is drawn, narrated once, and the fight is NOT re-read', async (_n, extra) => {
    let heldState: CombatState = COMBAT_STATE;
    const counter = armReadCounter(() => heldState);
    mEndTurn.mockImplementation(async () => {
      counter.armed = true;
      heldState = COMBAT_STATE_GOBLIN_TURN;
      return { message: 'Velka ends the turn.', state: COMBAT_STATE_GOBLIN_TURN, ...extra } as never;
    });
    await mountOnPcTurn();
    await clickEndTurn();
    expect(await screen.findByText('Velka ends the turn.')).toBeInTheDocument();
    await waitFor(() => expect(endTurnBeats()).toBe(1));
    expect(counter.reads).toBe(0);
  });

  it('true: exactly one re-read, and the drawn state is the RE-READ one, not the answer\'s', async () => {
    let heldState: CombatState = COMBAT_STATE;
    const counter = armReadCounter(() => heldState);
    mEndTurn.mockImplementation(async () => {
      counter.armed = true;
      heldState = COMBAT_STATE_GOBLIN_TURN; // the server: the other client already ended Velka's turn
      return { message: 'Velka ends the turn.', state: COMBAT_STATE, already_advanced: true } as never; // the answer: stale
    });
    await mountOnPcTurn();
    await clickEndTurn();
    await waitFor(() => expect(counter.reads).toBe(1));
    await waitFor(() => expect(endTurnButton()).not.toBeInTheDocument()); // not Velka's turn any more
    expect(screen.queryByText('Velka ends the turn.')).not.toBeInTheDocument();
    expect(endTurnBeats()).toBe(0);
  });
});

describe('end-turn already_advanced: the refused call itself changed the fight', () => {
  it('it ENDED the fight: the re-read shows it (End turn gone), grounding is refreshed, the answer\'s outcome line is still played', async () => {
    const groundingBefore = () => mGetGrounding.mock.calls.length;
    let heldState: CombatState = COMBAT_STATE;
    armReadCounter(() => heldState);
    mEndTurn.mockImplementation(async () => {
      heldState = COMBAT_STATE_ENDED;
      return { message: 'Velka ends the turn.', state: COMBAT_STATE, already_advanced: true, outcome_line: OUTCOME } as never;
    });
    await mountOnPcTurn();
    const g0 = groundingBefore();
    await clickEndTurn();
    expect(await screen.findByText(OUTCOME)).toBeInTheDocument();
    await waitFor(() => expect(endTurnButton()).not.toBeInTheDocument());
    await waitFor(() => expect(mGetGrounding.mock.calls.length).toBeGreaterThan(g0)); // isFightEnded(newState) saw the RE-READ state
    expect(endTurnBeats()).toBe(0);
  });

  it('it ENDED the fight and the answer carries scene_advance: the scene advance is still narrated, the end-turn beat still is not', async () => {
    let heldState: CombatState = COMBAT_STATE;
    armReadCounter(() => heldState);
    mEndTurn.mockImplementation(async () => {
      heldState = COMBAT_STATE_ENDED;
      return {
        message: 'Velka ends the turn.', state: COMBAT_STATE_ENDED, already_advanced: true,
        scene_advance: { from_scene: 'cave_mouth', to_scene: 'tunnel', outcome: 'victory' },
      } as never;
    });
    await mountOnPcTurn();
    await clickEndTurn();
    await waitFor(() => expect(mStream.mock.calls.some((c) => c[0].message === 'The scene changes.')).toBe(true));
    expect(endTurnBeats()).toBe(0);
    expect(screen.queryByText('Velka ends the turn.')).not.toBeInTheDocument();
  });

  it('it MOVED the turn on to a monster: the page does not keep offering End turn from the answer\'s stale state', async () => {
    let heldState: CombatState = COMBAT_STATE;
    armReadCounter(() => heldState);
    mEndTurn.mockImplementation(async () => {
      heldState = COMBAT_STATE_GOBLIN_TURN;
      return { message: 'x', state: COMBAT_STATE, already_advanced: true } as never;
    });
    await mountOnPcTurn();
    await clickEndTurn();
    await waitFor(() => expect(endTurnButton()).not.toBeInTheDocument());
  });

  it('the re-read FAILS: the answer\'s own state is used (no crash, no beat, the poll will correct it)', async () => {
    mGetCombatState.mockImplementation(async () => { throw new Error('boom'); });
    mEndTurn.mockResolvedValue({ message: 'Velka ends the turn.', state: COMBAT_STATE_GOBLIN_TURN, already_advanced: true, outcome_line: OUTCOME } as never);
    await mountOnPcTurn();
    mGetCombatState.mockImplementation(async () => { throw new Error('boom'); });
    await clickEndTurn();
    expect(await screen.findByText(OUTCOME)).toBeInTheDocument();
    expect(screen.queryByText('Velka ends the turn.')).not.toBeInTheDocument();
    await waitFor(() => expect(endTurnButton()).not.toBeInTheDocument()); // the answer's (goblin-turn) state was applied
  });

  it('the re-read answers null: the answer\'s state is used', async () => {
    mEndTurn.mockResolvedValue({ message: 'm', state: COMBAT_STATE_GOBLIN_TURN, already_advanced: true } as never);
    await mountOnPcTurn();
    mGetCombatState.mockResolvedValue(null as never);
    await clickEndTurn();
    await waitFor(() => expect(endTurnButton()).not.toBeInTheDocument());
  });

  it('no state anywhere (answer has none, re-read fails): nothing is applied, nothing throws, the beat is still skipped', async () => {
    mEndTurn.mockResolvedValue({ message: 'm', already_advanced: true } as never);
    await mountOnPcTurn();
    mGetCombatState.mockImplementation(async () => { throw new Error('boom'); });
    await clickEndTurn();
    await tick(0);
    expect(endTurnBeats()).toBe(0);
    // a throw inside the branch lands in the refusal banner (role=alert), never in a toast: absent means it did not throw
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // nothing failed: no error toast. The only notice is the info line that says the turn had already ended.
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith({ tone: 'info', message: 'That turn had already ended.' });
  });

  it('a normal end-turn (no flag) says nothing extra', async () => {
    mEndTurn.mockResolvedValue({ message: 'm', state: COMBAT_STATE_GOBLIN_TURN } as never);
    await mountOnPcTurn();
    await clickEndTurn();
    await tick(0);
    expect(mockToast).not.toHaveBeenCalled();
  });
});

describe('monster-turn: every value of the flag', () => {
  const driveAsDm = () => mGetSession.mockResolvedValue({ ...SESSION_WITH_COMBAT, dm_username: 'alice' });
  const mount = async () => {
    driveAsDm();
    renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(mMonsterTurn).toHaveBeenCalled());
  };

  it.each([
    ['absent', {}],
    ['false', { already_advanced: false }],
    ['the string "true"', { already_advanced: 'true' }],
    ['the number 1', { already_advanced: 1 }],
  ])('%s: no re-read; the driver follows the ANSWER\'s state and the message line shows', async (_n, extra) => {
    const held = { s: COMBAT_STATE_GOBLIN_TURN };
    const counter = armReadCounter(() => held.s);
    mMonsterTurn.mockImplementationOnce(async () => {
      counter.armed = true;
      held.s = COMBAT_STATE; // the server agrees with the answer: it is the player's turn now
      return { message: '[MONSTER] Goblin swings.', state: COMBAT_STATE, ...extra } as never; // hands the turn to the player
    });
    await mount();
    expect(await screen.findByText('[MONSTER] Goblin swings.')).toBeInTheDocument();
    expect(counter.reads).toBe(0); // sampled BEFORE any timer: the 4 s combat poll also reads the fight
    for (let i = 0; i < 3; i += 1) await tick();
    expect(mMonsterTurn).toHaveBeenCalledTimes(1); // the answer said "player's turn": the driver stops
  });

  it('true + the refused call ENDED the fight: the driver stops, no further monster-turn call, the message line stays', async () => {
    const held = { s: COMBAT_STATE_GOBLIN_TURN };
    const counter = armReadCounter(() => held.s);
    mMonsterTurn.mockImplementationOnce(async () => {
      counter.armed = true;
      held.s = COMBAT_STATE_ENDED;
      return { message: '[MONSTER] The last goblin falls.', state: COMBAT_STATE_GOBLIN_TURN, already_advanced: true } as never;
    });
    await mount();
    expect(await screen.findByText('[MONSTER] The last goblin falls.')).toBeInTheDocument();
    expect(counter.reads).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 3; i += 1) await tick();
    expect(mMonsterTurn).toHaveBeenCalledTimes(1);
    expect(screen.getByText('[MONSTER] The last goblin falls.')).toBeInTheDocument();
    expect(endTurnButton()).not.toBeInTheDocument();
  });

  it('true + the re-read FAILS: the driver falls back to the answer\'s state (no crash, one call)', async () => {
    mGetCombatState.mockImplementation(async () => COMBAT_STATE_GOBLIN_TURN);
    mMonsterTurn.mockImplementationOnce(async () => {
      mGetCombatState.mockImplementation(async () => { throw new Error('boom'); });
      return { message: '[MONSTER] ok', state: COMBAT_STATE, already_advanced: true } as never;
    });
    await mount();
    for (let i = 0; i < 3; i += 1) await tick();
    expect(mMonsterTurn).toHaveBeenCalledTimes(1);
    expect(screen.getByText('[MONSTER] ok')).toBeInTheDocument();
  });

  it('true + the re-read FAILS: the ANSWER\'s state is applied (the page offers End turn on the player\'s turn)', async () => {
    mGetCombatState.mockImplementation(async () => COMBAT_STATE_GOBLIN_TURN);
    mMonsterTurn.mockImplementationOnce(async () => {
      mGetCombatState.mockImplementation(async () => { throw new Error('boom'); });
      return { message: '[MONSTER] ok', state: COMBAT_STATE, already_advanced: true } as never;
    });
    await mount();
    await waitFor(() => expect(endTurnButton()).toBeInTheDocument());
    expect(mMonsterTurn).toHaveBeenCalledTimes(1);
  });

  it('true + the answer carries scene_advance: the scene advance is still narrated', async () => {
    const held = { s: COMBAT_STATE_GOBLIN_TURN };
    armReadCounter(() => held.s);
    mMonsterTurn.mockImplementationOnce(async () => {
      held.s = COMBAT_STATE_ENDED;
      return {
        message: '[MONSTER] The last goblin falls.', state: COMBAT_STATE_ENDED, already_advanced: true,
        scene_advance: { from_scene: 'cave_mouth', to_scene: 'tunnel', outcome: 'victory' },
      } as never;
    });
    await mount();
    await waitFor(() => expect(mStream.mock.calls.some((c) => c[0].message === 'The scene changes.')).toBe(true));
  });

  it('true + the answer carries outcome_line: the line is still played', async () => {
    const held = { s: COMBAT_STATE_GOBLIN_TURN };
    armReadCounter(() => held.s);
    mMonsterTurn.mockImplementationOnce(async () => {
      held.s = COMBAT_STATE_ENDED;
      return { message: '[MONSTER] The last goblin falls.', state: COMBAT_STATE_ENDED, already_advanced: true, outcome_line: OUTCOME } as never;
    });
    await mount();
    expect(await screen.findByText(OUTCOME)).toBeInTheDocument();
  });

  it('true + a DISCRIMINATING pair: answer says "player\'s turn", re-read says "still the goblin\'s" -> the driver acts on the re-read', async () => {
    // The answer (COMBAT_STATE) would stop the driver. The held state (goblin's turn) must keep it going: a second call.
    const held = { s: COMBAT_STATE_GOBLIN_TURN };
    armReadCounter(() => held.s);
    mMonsterTurn
      .mockImplementationOnce(async () => ({ message: '[MONSTER] first', state: COMBAT_STATE, already_advanced: true } as never))
      .mockImplementation(async () => {
        held.s = COMBAT_STATE;
        return { message: '[MONSTER] second', state: COMBAT_STATE } as never;
      });
    await mount();
    await waitFor(() => expect(mMonsterTurn.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText('[MONSTER] first')).toBeInTheDocument();
  });
});
