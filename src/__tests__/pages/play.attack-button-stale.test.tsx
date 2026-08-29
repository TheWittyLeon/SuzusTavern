/**
 * TAV-ATTACK-BUTTON-STALE (P3, overnight 2026-08-29) — fix pins.
 *
 * The attack button stayed enabled after the PC's action was spent this turn,
 * so the click round-tripped into the engine's 400 no_action_remaining. The
 * spent-action state already exists server-side (DDX-06 per-turn action
 * economy — `action_available` on every combat-state participant entry); the
 * fix makes the UI read it, inventing no new server state.
 *
 *   old: action_available:false on the viewer's own active-turn PC → Attack
 *        enabled → click → 400 no_action_remaining
 *   new: action_available:false → Attack disabled-visible, labeled
 *        'Attack (action already spent this turn)'; absent/true keeps the
 *        pre-fix enabled behavior (back-compat with older payloads)
 *
 * Fixtures/mocks modeled on combat-ui-adv78.test.tsx (same page-level seam).
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { CombatState, GroundingData, Participant, Session } from '@/lib/api/types';

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
  bindCharacter: jest.fn(() =>
    Promise.resolve({ campaign_id: 's1', username: 'alice', role: 'player', character_id: 1 }),
  ),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() =>
    Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' }),
  ),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' };
  }),
}));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetCombatState = dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>;

const SESSION_WITH_COMBAT: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['alice'],
  player_count: 1,
  active_combat_id: 'combat-42',
  dm_mode: 'ai',
  visibility: 'public',
  content_rating: 'sfw',
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

const GROUNDING: GroundingData = {
  scene_id: 'cave_mouth',
  scene_name: 'Cave Mouth',
  transitions: [],
};

/** Active combat, Velka's turn, one live goblin. `actionAvailable` drives the
 *  wire's per-turn economy field on Velka's entry; `undefined` OMITS it (an
 *  older engine payload). */
function combatState(actionAvailable: boolean | undefined): CombatState {
  return {
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
        ...(actionAvailable === undefined ? {} : { action_available: actionAvailable }),
        death_saves: {
          successes: 0,
          failures: 0,
          is_downed: false,
          is_dying: false,
          is_stable: false,
          is_dead: false,
        },
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
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetGrounding.mockResolvedValue(GROUNDING);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('TAV-ATTACK-BUTTON-STALE — attack disables once the action is spent', () => {
  it('action_available:false on my active-turn PC → Attack disabled with the spent-action reason', async () => {
    mGetCombatState.mockResolvedValue(combatState(false));
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() => {
      const btn = screen.getByRole('button', {
        name: 'Attack (action already spent this turn)',
      });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('aria-disabled', 'true');
    });
  });

  it('action_available:true → Attack enabled (positive control: the disable really keys off the wire field)', async () => {
    mGetCombatState.mockResolvedValue(combatState(true));
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: 'Attack' });
      expect(btn).toBeEnabled();
    });
  });

  it('field absent (older payload) → Attack stays enabled — back-compat, never wrongly locked', async () => {
    mGetCombatState.mockResolvedValue(combatState(undefined));
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: 'Attack' });
      expect(btn).toBeEnabled();
    });
  });
});
