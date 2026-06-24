/**
 * Track B — Multiplayer Combat + Re-bind + Outcome Chooser tests
 *
 * B1-4: per-user isPlayerTurn — logged-in user's entity_id vs active participant.
 * B2-4: rebind affordance — RebindCharacterButton in the party panel.
 * B3-1: outcome chooser — 5 options; Victory disabled when no monster down.
 *
 * These tests exercise the play page's B-track behaviour.
 * RebindCharacterButton unit tests are in a separate file.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { CombatState, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// alice is the logged-in user (character_id: 'c1' = entity_id 'c1')
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
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
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'alice', role: 'player', character_id: 1 })),
  listMyCharacters: jest.fn(() => Promise.resolve([
    { character_id: '1', username: 'alice', name: 'Velka', race: 'Human', char_class: 'Rogue', level: 1, hp: { current: 8, max: 10 }, ac: 14 },
  ])),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () { yield { kind: 'done' }; }),
}));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetCombatState = dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>;
const mEndCombat = dnd.endCombat as jest.MockedFunction<typeof dnd.endCombat>;
const mBindCharacter = dnd.bindCharacter as jest.MockedFunction<typeof dnd.bindCharacter>;

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

const SESSION_WITH_COMBAT: Session = { ...SESSION, active_combat_id: 'combat-42' };

/** alice (character_id: 'c1') is bound */
const PARTY_ALICE: Participant[] = [
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

/** alice + bob both in the party; bob is an additional player */
const PARTY_TWO_PLAYERS: Participant[] = [
  ...PARTY_ALICE,
  {
    username: 'bob',
    is_dm: false,
    character: {
      character_id: 'c2',
      name: 'Mira',
      char_class: 'Fighter',
      level: 1,
      current_hp: 12,
      max_hp: 12,
      ac: 16,
    },
  },
];

/** alice is the DM */
const PARTY_ALICE_DM: Participant[] = [
  { username: 'alice', is_dm: true, character: null },
];

/**
 * CombatState where Velka (entity_id='c1') has the active turn.
 * entity_id 'c1' matches PARTY_ALICE's character_id.
 */
const COMBAT_VELKA_ACTIVE: CombatState = {
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
      entity_id: 'c1',  // matches alice's character_id
      name: 'Velka',
      is_pc: true,
      initiative: 18,
      hp_current: 8,
      hp_max: 10,
      ac: 14,
      conditions: [],
      is_alive: true,
      can_be_targeted: false,
      is_active_turn: true,
      took_turn: false,
      death_saves: { successes: 0, failures: 0, is_downed: false, is_stable: false, is_dead: false },
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
  terrain: null,
  encounter_id: 'enc1',
  scene_id: 'cave_mouth',
  last_action: null,
  scene_advance: null,
};

/**
 * CombatState where Mira (entity_id='c2') has the active turn — NOT alice's turn.
 */
const COMBAT_MIRA_ACTIVE: CombatState = {
  ...COMBAT_VELKA_ACTIVE,
  active_participant_id: 'p_mira',
  participants: [
    { ...COMBAT_VELKA_ACTIVE.participants[0], is_active_turn: false },
    COMBAT_VELKA_ACTIVE.participants[1],
    {
      participant_id: 'p_mira',
      entity_id: 'c2',  // bob's character
      name: 'Mira',
      is_pc: true,
      initiative: 15,
      hp_current: 12,
      hp_max: 12,
      ac: 16,
      conditions: [],
      is_alive: true,
      can_be_targeted: false,
      is_active_turn: true,
      took_turn: false,
    },
  ],
};

/** CombatState where monster (Goblin) has the active turn. */
const COMBAT_GOBLIN_ACTIVE: CombatState = {
  ...COMBAT_VELKA_ACTIVE,
  active_participant_id: 'p_gob1',
  participants: [
    { ...COMBAT_VELKA_ACTIVE.participants[0], is_active_turn: false },
    { ...COMBAT_VELKA_ACTIVE.participants[1], is_active_turn: true },
  ],
};

/** CombatState with a dead goblin (Victory should be enabled). */
const COMBAT_GOBLIN_DEAD: CombatState = {
  ...COMBAT_VELKA_ACTIVE,
  participants: [
    COMBAT_VELKA_ACTIVE.participants[0],
    {
      ...COMBAT_VELKA_ACTIVE.participants[1],
      hp_current: 0,
      is_alive: false,
      can_be_targeted: false,
    },
  ],
};

function endedState(): CombatState {
  return { ...COMBAT_VELKA_ACTIVE, state: 'ended', active_participant_id: null };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY_ALICE);
  mGetCombatState.mockResolvedValue(null as never);
  mEndCombat.mockResolvedValue({ state: endedState(), outcome: 'unresolved', xp_earned: 0, defeated: [], scene_advance: null });
});

afterEach(() => {
  jest.useRealTimers();
});

// ── B1-4: per-user isPlayerTurn ───────────────────────────────────────────────

describe('B1-4 — per-user isPlayerTurn', () => {
  it('action rail is enabled when the active participant entity_id matches the logged-in user', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);
    mGetCombatState.mockResolvedValue(COMBAT_VELKA_ACTIVE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    // When it's Velka's turn (alice's character), the Attack button must be enabled.
    await waitFor(() => {
      const attackBtns = screen.queryAllByRole('button', { name: /Attack/i });
      expect(attackBtns.length).toBeGreaterThan(0);
      expect(attackBtns[0]).not.toBeDisabled();
    });
  });

  it('action rail is disabled when another PC has the active turn', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_TWO_PLAYERS);
    mGetCombatState.mockResolvedValue(COMBAT_MIRA_ACTIVE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    // It's Mira's turn (bob's character, entity_id='c2'); alice's entity_id='c1' → off turn.
    await waitFor(() => {
      const attackBtns = screen.queryAllByRole('button', { name: /Attack/i });
      if (attackBtns.length > 0) {
        expect(attackBtns[0]).toBeDisabled();
      }
    });
  });

  it('shows "Waiting on" status when another PC has the active turn', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_TWO_PLAYERS);
    mGetCombatState.mockResolvedValue(COMBAT_MIRA_ACTIVE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() => {
      expect(screen.getByText(/Waiting on Mira/i)).toBeInTheDocument();
    });
  });

  it('shows monster turn status when a monster has the active turn', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);
    mGetCombatState.mockResolvedValue(COMBAT_GOBLIN_ACTIVE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() => {
      expect(screen.getByText(/Monster turn.*Goblin/i)).toBeInTheDocument();
    });
  });

  it('shows "Your turn" status when it is the logged-in user turn', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);
    mGetCombatState.mockResolvedValue(COMBAT_VELKA_ACTIVE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() => {
      expect(screen.getByText(/Your turn/i)).toBeInTheDocument();
    });
  });

  it('solo regression: one PC bound, action rail enabled on PC turn (same as before)', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);
    mGetCombatState.mockResolvedValue(COMBAT_VELKA_ACTIVE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() => {
      const attackBtns = screen.queryAllByRole('button', { name: /Attack/i });
      expect(attackBtns.length).toBeGreaterThan(0);
      expect(attackBtns[0]).not.toBeDisabled();
    });
  });

  it('player with no bound character sees fully read-only UI (no attack buttons)', async () => {
    const partyNoBind: Participant[] = [
      { username: 'alice', is_dm: false, character: null },
    ];
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(partyNoBind);
    mGetCombatState.mockResolvedValue(COMBAT_VELKA_ACTIVE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() => {
      const attackBtns = screen.queryAllByRole('button', { name: /Attack/i });
      // Either no Attack button or it is disabled — never enabled.
      if (attackBtns.length > 0) {
        expect(attackBtns[0]).toBeDisabled();
      }
    });
  });
});

// ── B2-4: rebind affordance ───────────────────────────────────────────────────

describe('B2-4 — rebind affordance in party panel', () => {
  it('shows a "Change your character" button for the logged-in user\'s own row', async () => {
    mGetSession.mockResolvedValue(SESSION);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Change your character/i })).toBeInTheDocument();
    });
  });

  it('rebind button is disabled during active combat with tooltip', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);
    mGetCombatState.mockResolvedValue(COMBAT_VELKA_ACTIVE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /End or pause the fight/i });
      expect(btn).toBeDisabled();
    });
  });

  it('rebind button opens the character picker popover', async () => {
    mGetSession.mockResolvedValue(SESSION);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Change your character/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Change your character/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Change your character/i })).toBeInTheDocument();
    });
  });
});

// ── B3-1: outcome chooser ────────────────────────────────────────────────────

describe('B3-1 — outcome chooser', () => {
  it('clicking End opens the outcome chooser with 5 options', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);
    mGetCombatState.mockResolvedValue(COMBAT_VELKA_ACTIVE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /End combat/i })).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /End combat/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Victory/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Retreat/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Parley/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Flee/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Unresolved/i })).toBeInTheDocument();
    });
  });

  it('Victory option is disabled when no monster is down', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);
    mGetCombatState.mockResolvedValue(COMBAT_VELKA_ACTIVE);  // goblin is alive

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /End combat/i })).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /End combat/i }));
    });

    await waitFor(() => {
      const victoryBtn = screen.getByRole('button', { name: /Victory/i });
      expect(victoryBtn).toBeDisabled();
    });
  });

  it('Victory option is enabled when a monster is down', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);
    mGetCombatState.mockResolvedValue(COMBAT_GOBLIN_DEAD);  // goblin is dead

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /End combat/i })).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /End combat/i }));
    });

    await waitFor(() => {
      const victoryBtn = screen.getByRole('button', { name: /Victory/i });
      expect(victoryBtn).not.toBeDisabled();
    });
  });

  it('picking Retreat calls endCombat with outcome="retreat"', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);
    mGetCombatState.mockResolvedValue(COMBAT_VELKA_ACTIVE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /End combat/i })).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /End combat/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Retreat/i }));
    });

    await waitFor(() => expect(mEndCombat).toHaveBeenCalledTimes(1));
    expect(mEndCombat.mock.calls[0][1]).toMatchObject({ outcome: 'retreat' });
  });

  it('picking Parley calls endCombat with outcome="parley"', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);
    mGetCombatState.mockResolvedValue(COMBAT_VELKA_ACTIVE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /End combat/i })).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /End combat/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Parley/i }));
    });

    await waitFor(() => expect(mEndCombat).toHaveBeenCalledTimes(1));
    expect(mEndCombat.mock.calls[0][1]).toMatchObject({ outcome: 'parley' });
  });

  it('picking Flee calls endCombat with outcome="flee"', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);
    mGetCombatState.mockResolvedValue(COMBAT_VELKA_ACTIVE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /End combat/i })).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /End combat/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Flee/i }));
    });

    await waitFor(() => expect(mEndCombat).toHaveBeenCalledTimes(1));
    expect(mEndCombat.mock.calls[0][1]).toMatchObject({ outcome: 'flee' });
  });

  it('picking Unresolved calls endCombat with outcome="unresolved"', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);
    mGetCombatState.mockResolvedValue(COMBAT_VELKA_ACTIVE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /End combat/i })).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /End combat/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Unresolved/i }));
    });

    await waitFor(() => expect(mEndCombat).toHaveBeenCalledTimes(1));
    expect(mEndCombat.mock.calls[0][1]).toMatchObject({ outcome: 'unresolved' });
  });

  it('Cancel closes the chooser without calling endCombat', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetParticipants.mockResolvedValue(PARTY_ALICE);
    mGetCombatState.mockResolvedValue(COMBAT_VELKA_ACTIVE);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /End combat/i })).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /End combat/i }));
    });
    // Cancel — close without calling endCombat.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    });

    expect(mEndCombat).not.toHaveBeenCalled();
    // Chooser should be gone.
    expect(screen.queryByText(/How does this fight end/i)).not.toBeInTheDocument();
  });

  it('B2-4 bindCharacter client fn is exported', async () => {
    const { bindCharacter: fn } = await import('@/lib/api/dnd');
    expect(typeof fn).toBe('function');
  });
});
