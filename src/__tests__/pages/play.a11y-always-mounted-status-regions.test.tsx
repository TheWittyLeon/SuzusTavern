/**
 * TAV-PLAY-SHELL step 0 (plan §5 "Accessibility invariants currently
 * encoded only in comments", A2) — pins the "permanently mounted, only
 * CHILDREN toggle" pattern the file's own comments claim for the dead-PC
 * status row and the durable-retry row, so an extraction (steps 2/3+) that
 * accidentally moves the mounting condition from the children to the
 * wrapper breaks a test instead of silently regressing an announcement.
 * Precedent for the always-mounted pattern being load-bearing:
 * .xCardBanner/.durableRetryRow's own `:empty` CSS rules
 * (Play.module.css:238, 922) exist specifically so the wrapper can go
 * empty without `display:none`, which would pull it out of the a11y tree.
 *
 * Fixtures copied from src/__tests__/pages/combat-ui-adv78.test.tsx (the
 * dead-PC notice's own origin, "Kage-CR dropped spec item" describe block)
 * rather than imported — test files in this repo are self-contained.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
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

/** My PC (Velka) has died; goblin's turn — mirrors combat-ui-adv78's own fixture. */
const COMBAT_STATE_MY_PC_DEAD: CombatState = {
  ...COMBAT_STATE_ALIVE,
  active_participant_id: 'p_gob1',
  participants: [
    {
      ...COMBAT_STATE_ALIVE.participants[0],
      hp_current: 0,
      is_alive: false,
      is_active_turn: false,
      can_be_targeted: false,
      death_saves: { successes: 0, failures: 3, is_downed: false, is_dying: false, is_stable: false, is_dead: true },
    },
    { ...COMBAT_STATE_ALIVE.participants[1], is_active_turn: true },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetGrounding.mockResolvedValue(GROUNDING_NO_TRANSITION);
});

describe('deadStatus (A2) — "Your character has died." row', () => {
  it('is present in the DOM, with content, when my PC is dead', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_MY_PC_DEAD);
    const { container } = render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    const row = await screen.findByText('Your character has died.');
    expect(row).toHaveAttribute('role', 'status');
    expect(container.querySelector('.deadStatus')).not.toBeNull();
  });

  // TAV-PLAY-A11Y-DEADSTATUS-NOT-ALWAYS-MOUNTED (Backlog, filed at step 0
  // closure): page.tsx:5733 gates the WHOLE wrapper on
  // `combatIsActive && isMyPcDead`, not just its text — unlike
  // .durableRetryRow below, which gates only its CHILDREN. The plan's A2 row
  // describes both regions as following "the same pattern"; only one of
  // them actually does. Do not fix in step 0 (Job 3 instruction) — this
  // documents the gap so step 2 doesn't silently carry it into Drawer/
  // region extraction as if it were the correct shape to copy.
  it.failing('stays mounted (empty) when my PC is alive, matching .durableRetryRow\'s pattern — TAV-PLAY-A11Y-DEADSTATUS-NOT-ALWAYS-MOUNTED', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_ALIVE);
    const { container } = render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await screen.findAllByRole('button', { name: /Attack/i });
    expect(container.querySelector('.deadStatus')).not.toBeNull();
  });
});

describe('durableRetryRow (A2) — durable-turn retry-after-failed row', () => {
  it('is present in the DOM (empty) when DURABLE_GENERATION_ENABLED is on and no job has failed', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_ALIVE);
    const { container } = render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await screen.findAllByRole('button', { name: /Attack/i });
    const row = container.querySelector('.durableRetryRow');
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute('role', 'status');
    expect(row?.textContent).toBe('');
  });
});
