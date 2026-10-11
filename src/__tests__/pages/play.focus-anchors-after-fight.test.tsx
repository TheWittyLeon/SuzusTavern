/**
 * TAV-COMBAT-VERB-GUARD-DEAD-AFTER-FIRST-FIGHT, the two focus gates in useFocusAnchors.ts (the fix
 * passes `combatIsActive ? combatId : null`; the page-level guard test above never reached them, so
 * reverting that one argument left every suite green).
 *
 * Both gates read "is a fight live NOW" from the hook's `combatId` argument:
 *   - the rising-edge toast "This scene can turn into a fight" (suppressed while a fight is live);
 *   - the falling-edge focus rescue when "Stand and fight" unmounts under a focused user.
 * After a fight has ended, `combatId` is still set on the page. Outside combat both must behave
 * exactly as they do on a page that never fought.
 *
 * Harness copied from play.combat-verb-guard-after-fight.test.tsx.
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
const mAdvanceScene = dnd.advanceScene as jest.MockedFunction<typeof dnd.advanceScene>;
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


const SCENE_QUIET: GroundingData = {
  scene_id: 'everfree_clearing',
  scene_name: 'The Clearing',
  boxed_text: 'The wolf is down. The wood is quiet.',
  objective: 'Move on.',
  transitions: [{ to: 'everfree_flight', label: 'Press deeper into the wood' }],
  checks: [],
  flags: {},
  encounter_state: {},
};

const TOAST = /This scene can turn into a fight/;

async function walkIntoTheEncounterScene() {
  renderPlay(<PlayPage />);
  const exit = await screen.findByRole('button', { name: /Press deeper into the wood/i });
  mGetGrounding.mockResolvedValue(GROUNDING_UNSTARTED_ENCOUNTER);
  mAdvanceScene.mockResolvedValue({ from_scene: 'everfree_clearing', to_scene: 'everfree_flight', completed: false });
  await act(async () => {
    fireEvent.click(exit);
  });
  await screen.findByRole('button', { name: /stand and fight/i });
}

describe('useFocusAnchors gates follow the live fight (page level)', () => {
  it('positive control: on a page that never fought, walking into an encounter scene toasts', async () => {
    mGetSession.mockResolvedValue({ ...SESSION, active_combat_id: null });
    mGetGrounding.mockResolvedValue(SCENE_QUIET);
    await walkIntoTheEncounterScene();
    expect(mockToast.mock.calls.some(([t]) => TOAST.test(t.message))).toBe(true);
  });

  it('after the first fight has ended, walking into a scene with an encounter toasts the same', async () => {
    mGetSession.mockResolvedValue({ ...SESSION, active_combat_id: 'combat-1' });
    mGetCombatState.mockResolvedValue(fight('combat-1', 'ended'));
    mGetGrounding.mockResolvedValue(SCENE_QUIET);
    await walkIntoTheEncounterScene();
    expect(mockToast.mock.calls.some(([t]) => TOAST.test(t.message))).toBe(true);
  });

  it('after the first fight has ended, a focused "Stand and fight" that unmounts hands focus to the scene, not <body>', async () => {
    mGetSession.mockResolvedValue({ ...SESSION, active_combat_id: 'combat-1' });
    mGetCombatState.mockImplementation(async (id: string) =>
      id === 'combat-2' ? fight('combat-2', 'active') : fight('combat-1', 'ended'),
    );
    mCombatFromScene.mockResolvedValue({
      combat_id: 'combat-2', round: 1, terrain: {}, encounter_id: 'enc_timberwolf',
      monsters: [{ participant_id: 'w1', name: 'Timberwolf', hp: 19, from_ref: 'dnd5e:monster:mlp-timberwolf' }],
    });
    mRollInitiative.mockResolvedValue({ state: fight('combat-2', 'active') } as never);
    mGetGrounding.mockResolvedValue(GROUNDING_UNSTARTED_ENCOUNTER);
    renderPlay(<PlayPage />);
    const btn = await screen.findByRole('button', { name: /stand and fight/i });
    btn.focus();
    expect(document.activeElement).toBe(btn);
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /stand and fight/i })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });
});
