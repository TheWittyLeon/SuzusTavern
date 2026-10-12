/**
 * NEKO-ENDTURN-DUPLICATE-BEAT-ON-RACE (Tavern half). The engine marks a turn-ending answer whose
 * advance was a no-op with `data.already_advanced: true` (end-turn, monster-turn, npc-action).
 * True: the end-turn "turn ends" beat is not drawn or narrated, and the fight is read again;
 * everything else in the answer (state, scene advance, outcome line) is still used.
 * False or absent: today's behaviour. (Kuro's caution: it means "this call's advance was a no-op",
 * not "this call was a duplicate" -- never drop the whole answer.)
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

describe('end-turn: already_advanced', () => {
  it.each([['absent', {}], ['false', { already_advanced: false }]])('%s: the beat is drawn and narrated, as today', async (_n, extra) => {
    mEndTurn.mockResolvedValue({ message: 'Velka ends the turn.', state: COMBAT_STATE_GOBLIN_TURN, ...extra });
    await mountOnPcTurn();
    await clickEndTurn();
    expect(await screen.findByText('Velka ends the turn.')).toBeInTheDocument();
    await waitFor(() => expect(endTurnBeats()).toBe(1));
  });

  it('true: no "turn ends" line and no end-turn narration, but the answer is still used and the fight is read again', async () => {
    mEndTurn.mockResolvedValue({
      message: 'Velka ends the turn.',
      state: COMBAT_STATE,
      already_advanced: true,
      outcome_line: OUTCOME,
    });
    await mountOnPcTurn();
    const before = mGetCombatState.mock.calls.length;
    await clickEndTurn();
    expect(await screen.findByText(OUTCOME)).toBeInTheDocument(); // the rest of the answer is not dropped
    expect(screen.queryByText('Velka ends the turn.')).not.toBeInTheDocument();
    expect(endTurnBeats()).toBe(0);
    expect(mGetCombatState.mock.calls.length).toBeGreaterThan(before); // no timer advanced: not the poll
  });
});

describe('monster-turn: already_advanced', () => {
  it('true: the fight is read again and the driver follows the held state, not the answer\'s stale one', async () => {
    mGetSession.mockResolvedValue({ ...SESSION_WITH_COMBAT, dm_username: 'alice' });
    let held: CombatState = COMBAT_STATE_GOBLIN_TURN;
    mGetCombatState.mockImplementation(async () => JSON.parse(JSON.stringify(held)));
    mMonsterTurn.mockImplementationOnce(async () => {
      held = COMBAT_STATE; // the refused call left the turn with the player
      return { message: '[MONSTER] Goblin attacks Velka for 3.', state: COMBAT_STATE_GOBLIN_TURN, already_advanced: true };
    });
    renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(mMonsterTurn).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 3; i += 1) await tick();
    expect(mMonsterTurn).toHaveBeenCalledTimes(1);
    // The answer's text is not dropped: a refused monster-turn call can be the one that attacked.
    expect(screen.getByText('[MONSTER] Goblin attacks Velka for 3.')).toBeInTheDocument();
  });
});
