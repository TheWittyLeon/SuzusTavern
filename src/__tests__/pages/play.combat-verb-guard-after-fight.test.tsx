/**
 * TAV-COMBAT-VERB-GUARD-DEAD-AFTER-FIRST-FIGHT — the combat-verb guard follows whether a fight is
 * live NOW, not whether one ever started in this page load (`combatId` is set at mount and by
 * beginEncounter and never cleared; `combatIsActive` also reads the fight's state).
 *
 * Companion to play.combat-verb-guard.test.tsx, whose harness this copies.
 * Original header follows.
 *
 * TAV-COMBAT-VERB-NO-MECHANICS — play-page wiring for the combat-verb guard.
 *
 * The unit-level matcher lives in dnd-combat-intent.test.ts. This suite pins
 * the three things only the page can get wrong:
 *
 *   1. the turn is WITHHELD — narrate() is never called, so the fabricated
 *      prose is never generated (the only point it can be stopped, since
 *      DM-STREAM reveals tokens as they arrive);
 *   2. the guard is GATED on an authored combat encounter that has never
 *      started — a resolved encounter, a non-combat encounter, and a live
 *      combat all fall through to normal narration;
 *   3. it runs BEFORE the movement fast-path, so an attack declaration that
 *      happens to contain a movement phrase does not advance the scene past
 *      a live threat.
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
  useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(() => Promise.resolve(null)),
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
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  resolveCheck: jest.fn(),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() =>
    Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' }),
  ),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
}));

import * as dnd from '@/lib/api/dnd';
import * as stream from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mCombatFromScene = dnd.combatFromScene as jest.MockedFunction<typeof dnd.combatFromScene>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;

const SESSION: Session = {
  session_id: 's1',
  channel: 'mlp_everfree_leon',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['leon'],
  player_count: 1,
  active_combat_id: null,
  dm_mode: 'ai',
  ai_assist_level: 'full',
};

const PARTY: Participant[] = [
  {
    username: 'leon',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Anomaly',
      char_class: 'Warlock',
      level: 1,
      current_hp: 9,
      max_hp: 9,
      ac: 12,
    },
  },
];

/** The filed repro's scene: an authored combat encounter that has never been
 *  started (no `encounter_state` entry), one authored exit. */
const GROUNDING_UNSTARTED_ENCOUNTER: GroundingData = {
  scene_id: 'everfree_flight',
  scene_name: 'The Flight',
  boxed_text: 'Something is pacing you through the trees.',
  objective: 'Get clear, or turn and face it.',
  transitions: [{ to: 'everfree_zecoras_hut', label: 'Press forward — smoke to the southeast' }],
  checks: [],
  flags: {},
  encounter_state: {},
  encounter: {
    id: 'enc_timberwolf',
    kind: 'combat',
    monsters_resolved: [{ id: 'mlp-timberwolf-juvenile', name: 'Timberwolf (juvenile)' }],
  },
};

function streamOnce(events: NarrationEvent[]) {
  mStream.mockImplementation(async function* () {
    for (const e of events) yield e;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  streamOnce([{ kind: 'chunk', text: 'Suzu narrates.' }, { kind: 'done' }]);
});

async function sendMessage(text: string) {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
}


const mGetCombatState = dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>;
const mRollInitiative = dnd.rollInitiative as jest.MockedFunction<typeof dnd.rollInitiative>;

function fight(id: string, state: CombatState['state']): CombatState {
  return {
    combat_id: id,
    session_id: 's1',
    round: 1,
    state,
    turn_index: 0,
    active_participant_id: 'p1',
    initiative: ['p1'],
    participants: [
      {
        participant_id: 'p1',
        entity_id: 'c1',
        name: 'Anomaly',
        is_pc: true,
        initiative: 15,
        hp_current: 9,
        hp_max: 9,
        ac: 12,
        conditions: [],
        is_alive: true,
        can_be_targeted: false,
        is_active_turn: true,
        took_turn: false,
      },
    ],
  };
}

describe('TAV-COMBAT-VERB-GUARD-DEAD-AFTER-FIRST-FIGHT', () => {
  beforeEach(() => {
    // A page whose first fight is over: the session still names it, its state reads ended, and
    // the current scene holds a second authored encounter that has never started.
    mGetSession.mockResolvedValue({ ...SESSION, active_combat_id: 'combat-1' });
    mGetGrounding.mockResolvedValue(GROUNDING_UNSTARTED_ENCOUNTER);
    mGetCombatState.mockResolvedValue(fight('combat-1', 'ended'));
  });

  it('a typed combat verb after the first fight has ended hits the guard again', async () => {
    renderPlay(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I attack the timberwolf');

    expect(mStream).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/nothing you do lands until initiative is rolled/i),
    ).toBeInTheDocument();
  });

  it('a second fight in the same page load still starts, and its typed turns narrate', async () => {
    mCombatFromScene.mockResolvedValue({
      combat_id: 'combat-2',
      round: 1,
      monsters: [{ participant_id: 'w1', name: 'Timberwolf', hp: 19, from_ref: 'dnd5e:monster:mlp-timberwolf' }],
      terrain: {},
      encounter_id: 'enc_timberwolf',
    });
    mGetCombatState.mockImplementation(async (id: string) =>
      id === 'combat-2' ? fight('combat-2', 'active') : fight('combat-1', 'ended'),
    );
    mRollInitiative.mockResolvedValue({ state: fight('combat-2', 'active') } as never);
    renderPlay(<PlayPage />);
    const btn = await screen.findByRole('button', { name: /stand and fight/i });

    await act(async () => {
      fireEvent.click(btn);
    });
    expect(mCombatFromScene).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /stand and fight/i })).not.toBeInTheDocument(),
    );

    // Fight 2 is live, so the guard stands down. (Beginning a fight narrates once of its own.)
    await waitFor(() => expect(mStream).toHaveBeenCalled());
    mStream.mockClear();
    await sendMessage('I attack the timberwolf');
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].message).toBe('I attack the timberwolf');
  });
});
