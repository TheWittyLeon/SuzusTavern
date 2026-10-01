/**
 * A9d F3 — "Previously on..." steps aside in combat (TAV-COMBAT-LOG-FLOOR-200), on the REAL page.
 *
 * The strip is ~63px of a combat log that is already short. It stays MOUNTED (a remount refetches
 * the digest and forgets a dismissal), so the only legal mechanism is `hidden` on the strip, with
 * the aria-live wrapper left alone. The story stack's out-of-flow rule (Play.module.css) then
 * keeps the wrapper from paying a flex gap; that half is CSS-pinned in play-css.test.ts and
 * measured by the harness check `h`.
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { CombatState, GroundingData, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

// DURABLE_GENERATION_ENABLED true for the whole file so the durable-retry
// row's own gate is open — matches play.ddx20-durable-turn.test.tsx's
// precedent for testing this region at all (it is `false` in src/lib/
// config.ts today, i.e. the wrapper never mounts in production yet; that is
// a deliberate rollout gate per that file's own docstring, not the mounting
// defect this suite is pinning).
jest.mock('../../lib/config', () => ({
  DURABLE_GENERATION_ENABLED: true,
  OAUTH_ENABLED: false,
  CODEX_ENABLED: false,
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
  monsterTurn: jest.fn(() => Promise.resolve(null)),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  rollDeathSave: jest.fn(),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'alice', role: 'player', character_id: 1 })),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
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

const GROUNDING_NO_TRANSITION: GroundingData = {
  scene_id: 'cave_mouth',
  scene_name: 'Cave Mouth',
  transitions: [],
};

/** Alive, in combat, my turn — the "nothing special" baseline. */
const COMBAT_STATE_ALIVE: CombatState = {
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

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetGrounding.mockResolvedValue(GROUNDING_NO_TRANSITION);
});


const HISTORY = [{ event_type: 'scene_advance', description: 'You crossed the underground river.' }];

describe('the recap strip steps aside while combat is active (A9d F3)', () => {
  beforeEach(() => {
    (dnd.getSessionEvents as jest.Mock).mockResolvedValue(HISTORY);
  });

  it('exploring: the strip is visible', async () => {
    mGetCombatState.mockResolvedValue({ ...COMBAT_STATE_ALIVE, state: 'ended' });
    renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    expect(await screen.findByRole('button', { name: /previously on/i })).toBeVisible();
  });

  it('combat: the strip is `hidden` but its live wrapper and the strip itself stay mounted', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_ALIVE);
    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await screen.findAllByRole('button', { name: /Attack/i });
    const wrapper = container.querySelector('[data-tenant="sessionRecap"]') as HTMLElement;
    expect(wrapper).toHaveAttribute('aria-live', 'polite');
    // the digest fetch is async: wait for the strip to exist, then assert it is the hidden one
    await waitFor(() => expect(wrapper.querySelector('section')).not.toBeNull());
    expect(wrapper.querySelector('section')).toHaveAttribute('hidden');
    expect(screen.queryByRole('button', { name: /previously on/i })).toBeNull();
  });
});
