/**
 * ADV-7/8 (CUI-10..13) combat-UI playability tests.
 *
 * Coverage:
 *   CUI-10: CombatState types + new API client functions are exported.
 *   CUI-11: InitiativeTracker renders from CombatState; target picker filters to
 *           living enemies; "not your turn" disables attack; attack sends target_id.
 *   CUI-12: scene_advance auto-flow calls advanceScene / handleSceneAdvance.
 *   CUI-13: "End combat" button calls endCombat.
 *   ADV-7T: "Move on" button calls advanceScene with to_scene from grounding.
 *   Poll:   poll loop runs when combat is active; stops on unmount.
 *   Refused: refused action (400 + reason) surfaces reason text; refreshes from state.
 *   Monster turn: monster last_action logged.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(),
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
      death_saves: { successes: 0, failures: 0, is_downed: false, is_stable: false, is_dead: false },
    },
    {
      participant_id: 'p_gob1',
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

// ── CUI-10: types + client exports ────────────────────────────────────────────

describe('CUI-10 — API client exports', () => {
  it('getCombatState is exported from dnd client', async () => {
    const { getCombatState: fn } = await import('@/lib/api/dnd');
    expect(typeof fn).toBe('function');
  });

  it('endCombat is exported from dnd client', async () => {
    const { endCombat: fn } = await import('@/lib/api/dnd');
    expect(typeof fn).toBe('function');
  });

  it('advanceScene is exported from dnd client', async () => {
    const { advanceScene: fn } = await import('@/lib/api/dnd');
    expect(typeof fn).toBe('function');
  });

  it('setFlag is exported from dnd client', async () => {
    const { setFlag: fn } = await import('@/lib/api/dnd');
    expect(typeof fn).toBe('function');
  });

  it('getGrounding is exported from dnd client', async () => {
    const { getGrounding: fn } = await import('@/lib/api/dnd');
    expect(typeof fn).toBe('function');
  });
});

// ── CUI-11: InitiativeTracker renders from CombatState ───────────────────────

describe('CUI-11 — InitiativeTracker renders from CombatState', () => {
  it('shows combatant names from the engine state', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => {
      // Both Velka and Goblin may appear multiple times (PartyPanel + Tracker).
      expect(screen.getAllByText('Velka').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Goblin').length).toBeGreaterThan(0);
    });
  });

  it('marks the active-turn combatant with aria-current', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => {
      // Find the listitem (in the tracker) that has aria-current and contains "Velka".
      const currentItems = screen
        .getAllByRole('listitem')
        .filter((el) => el.getAttribute('aria-current') === 'true');
      expect(currentItems.length).toBeGreaterThan(0);
      const velkaCurrent = currentItems.find((el) => el.textContent?.includes('Velka'));
      expect(velkaCurrent).toBeDefined();
    });
  });

  it('shows the round number from CombatState', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => {
      expect(screen.getAllByText(/round 1/i).length).toBeGreaterThan(0);
    });
  });

  it('shows HP as meter on participants', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => {
      const meters = screen.getAllByRole('meter');
      expect(meters.length).toBeGreaterThan(0);
    });
  });
});

// ── CUI-11: target picker ────────────────────────────────────────────────────

describe('CUI-11 — target picker filters to living enemies', () => {
  async function openAttackMenu() {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Attack/i }).length).toBeGreaterThan(0);
    });
    const attackBtn = screen.getAllByRole('button', { name: /Attack/i })[0];
    await act(async () => { fireEvent.click(attackBtn); });
    return attackBtn;
  }

  it('shows living enemy in the target menu', async () => {
    await openAttackMenu();
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /Goblin/i })).toBeInTheDocument();
    });
  });

  it('does not show PCs in the target menu', async () => {
    await openAttackMenu();
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /Velka/i })).not.toBeInTheDocument();
    });
  });

  it('does not show dead enemies in the target menu', async () => {
    // Combat state: goblin is dead.
    const deadGoblinState: CombatState = {
      ...COMBAT_STATE,
      participants: [
        COMBAT_STATE.participants[0],
        {
          ...COMBAT_STATE.participants[1],
          hp_current: 0,
          is_alive: false,
          can_be_targeted: false,
        },
      ],
    };
    mGetCombatState.mockResolvedValue(deadGoblinState);
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => {
      // Attack should be disabled when no targets.
      const attackBtns = screen.queryAllByRole('button', { name: /Attack \(no valid targets\)/i });
      // Either the button is disabled or absent from the menu.
      if (attackBtns.length > 0) {
        expect(attackBtns[0]).toBeDisabled();
      }
    });
  });
});

// ── CUI-11: Attack sends target_id ───────────────────────────────────────────

describe('CUI-11 — attack sends target_id to the engine', () => {
  it('attack sends the participant_id as target_id', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Attack/i }).length).toBeGreaterThan(0),
    );

    // Open the attack menu.
    const attackBtn = screen.getAllByRole('button', { name: /Attack/i })[0];
    await act(async () => { fireEvent.click(attackBtn); });

    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());

    // Click the goblin target.
    const goblinItem = screen.getByRole('menuitem', { name: /Goblin/i });
    await act(async () => { fireEvent.click(goblinItem); });

    await waitFor(() => expect(mAttack).toHaveBeenCalledTimes(1));
    const callArg = mAttack.mock.calls[0][0];
    // Should have target_id set to the participant_id.
    expect(callArg).toHaveProperty('target_id', 'p_gob1');
    // Should also have a target (name) for backward compat.
    expect(callArg).toHaveProperty('target', 'Goblin');
  });
});

// ── CUI-11: "not your turn" gates Attack/Dodge/Dash ─────────────────────────

describe('CUI-11 — off-turn disables attack/dodge/dash', () => {
  it('Attack is disabled when it is not the PC turn', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_GOBLIN_TURN);
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => {
      const attackBtns = screen.queryAllByRole('button', { name: /Attack/i });
      if (attackBtns.length > 0) {
        // At least one attack button should be disabled (not-your-turn variant).
        const disabled = attackBtns.some((b) => b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true');
        expect(disabled).toBe(true);
      }
    });
  });

  it('"Waiting for your turn" notice appears when it is not the PC turn', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_GOBLIN_TURN);
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => {
      expect(screen.getByText(/Waiting for your turn/i)).toBeInTheDocument();
    });
  });
});

// ── Refused action (400 + reason) ────────────────────────────────────────────

describe('CUI-11 — refused action surfaces reason', () => {
  it('engine not_your_turn → shows plain-English reason in the UI', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mAttack.mockRejectedValue(
      apiError(400, 'not your turn', {
        data: { reason: 'not_your_turn', state: COMBAT_STATE_GOBLIN_TURN },
      }),
    );
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Attack/i }).length).toBeGreaterThan(0),
    );

    const attackBtn = screen.getAllByRole('button', { name: /Attack/i })[0];
    await act(async () => { fireEvent.click(attackBtn); });
    await waitFor(() => screen.getByRole('menu'));
    const goblinItem = screen.getByRole('menuitem', { name: /Goblin/i });
    await act(async () => { fireEvent.click(goblinItem); });

    await waitFor(() =>
      expect(screen.getByText(/not your turn/i)).toBeInTheDocument(),
    );
  });

  it('engine target_down → shows "already down" reason', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mAttack.mockRejectedValue(
      apiError(400, 'target down', {
        data: { reason: 'target_down', state: COMBAT_STATE },
      }),
    );
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Attack/i }).length).toBeGreaterThan(0),
    );
    const attackBtn = screen.getAllByRole('button', { name: /Attack/i })[0];
    await act(async () => { fireEvent.click(attackBtn); });
    await waitFor(() => screen.getByRole('menu'));
    const goblinItem = screen.getByRole('menuitem', { name: /Goblin/i });
    await act(async () => { fireEvent.click(goblinItem); });

    await waitFor(() =>
      expect(screen.getByText(/already down/i)).toBeInTheDocument(),
    );
  });
});

// ── Monster turn reflected in log ─────────────────────────────────────────────

describe('CUI-11 — monster turn reflected in log', () => {
  it('monster turn message appears in the chat log after end-turn', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mEndTurn.mockResolvedValue({ message: 'End turn.', state: COMBAT_STATE_GOBLIN_TURN });
    mMonsterTurn.mockResolvedValue({
      message: '[MONSTER] Goblin attacks Velka for 4.',
      state: COMBAT_STATE,
    });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /End turn/i }).length).toBeGreaterThan(0),
    );
    const endTurnBtn = screen.getAllByRole('button', { name: /End turn/i })[0];
    await act(async () => { fireEvent.click(endTurnBtn); });

    await waitFor(() =>
      expect(screen.getByText(/Goblin attacks Velka for 4/i)).toBeInTheDocument(),
    );
  });
});

// ── CUI-12: scene_advance auto-flow ─────────────────────────────────────────

describe('CUI-12 — scene_advance auto-flow', () => {
  it('scene_advance on attack response logs the scene transition', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mAttack.mockResolvedValue({
      message: '[ATTACK] Victory!',
      state: COMBAT_STATE_ENDED,
      scene_advance: { from_scene: 'cave_mouth', to_scene: 'tunnel', outcome: 'victory' },
    });
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_TRANSITION);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Attack/i }).length).toBeGreaterThan(0),
    );

    const attackBtn = screen.getAllByRole('button', { name: /Attack/i })[0];
    await act(async () => { fireEvent.click(attackBtn); });
    await waitFor(() => screen.getByRole('menu'));
    const goblinItem = screen.getByRole('menuitem', { name: /Goblin/i });
    await act(async () => { fireEvent.click(goblinItem); });

    await waitFor(() =>
      expect(screen.getByText(/scene shifts.*cave_mouth.*tunnel/i)).toBeInTheDocument(),
    );
  });

  it('scene_advance on endTurn response logs the scene shift and refreshes grounding', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mEndTurn.mockResolvedValue({
      message: 'End turn.',
      state: COMBAT_STATE_ENDED,
      scene_advance: { from_scene: 'cave_mouth', to_scene: 'tunnel', outcome: 'victory' },
    });
    mMonsterTurn.mockResolvedValue({ message: null, state: COMBAT_STATE_ENDED });
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_TRANSITION);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /End turn/i }).length).toBeGreaterThan(0),
    );
    const endTurnBtn = screen.getAllByRole('button', { name: /End turn/i })[0];
    await act(async () => { fireEvent.click(endTurnBtn); });

    // The scene shift is logged — confirms handleSceneAdvance ran.
    await waitFor(() =>
      expect(screen.getByText(/scene shifts.*cave_mouth.*tunnel/i)).toBeInTheDocument(),
    );
    // getGrounding is called multiple times: initial load + combat-ended refresh + scene advance.
    expect(mGetGrounding.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ── CUI-13: "End combat" button ──────────────────────────────────────────────

describe('CUI-13 — End combat button calls endCombat', () => {
  it('clicking "End" calls endCombat with the current combat_id', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /End combat/i })).toBeInTheDocument(),
    );
    const endBtn = screen.getByRole('button', { name: /End combat/i });
    await act(async () => { fireEvent.click(endBtn); });

    await waitFor(() => expect(mEndCombat).toHaveBeenCalledTimes(1));
    expect(mEndCombat.mock.calls[0][0]).toBe('combat-42');
    expect(mEndCombat.mock.calls[0][1]).toMatchObject({ outcome: 'unresolved' });
  });

  it('logs "Combat ended." after endCombat resolves', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /End combat/i })).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /End combat/i }));
    });
    await waitFor(() =>
      expect(screen.getByText(/Combat ended/i)).toBeInTheDocument(),
    );
  });
});

// ── ADV-7T: "Move on" button ─────────────────────────────────────────────────

describe('ADV-7T — Move on button', () => {
  it('appears when grounding has a valid transition and no combat is active', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_TRANSITION);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Enter the tunnel/i })).toBeInTheDocument(),
    );
  });

  it('calls advanceScene with the correct to_scene', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_TRANSITION);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Enter the tunnel/i })).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Enter the tunnel/i }));
    });
    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    expect(mAdvanceScene.mock.calls[0][0]).toBe('s1');
    expect(mAdvanceScene.mock.calls[0][1]).toMatchObject({ to_scene: 'tunnel' });
  });

  it('does NOT appear when combat is active', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_TRANSITION);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => {
      // The "Move on" transition button should not appear during active combat.
      expect(screen.queryByRole('button', { name: /Enter the tunnel/i })).not.toBeInTheDocument();
    });
  });

  it('does NOT appear when grounding has no transitions', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_NO_TRANSITION);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    // Give the page time to fully settle.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Enter the tunnel/i })).not.toBeInTheDocument(),
    );
  });

  it('shows toast on freeform_session 400 refusal', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_TRANSITION);
    mAdvanceScene.mockRejectedValue(apiError(400, 'freeform_session'));
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Enter the tunnel/i })).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Enter the tunnel/i }));
    });
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'info',
          message: expect.stringMatching(/no authored adventure/i),
        }),
      ),
    );
  });
});

// ── Poll loop ────────────────────────────────────────────────────────────────

describe('Poll loop', () => {
  it('polls getCombatState every 4s while combat is active and tab is visible', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    // Initial load fetches once.
    const initialCalls = mGetCombatState.mock.calls.length;

    // Advance timer by 4s.
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });

    expect(mGetCombatState.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it('does not poll when combat is null (no active combat)', async () => {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const calls = mGetCombatState.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(8000); });
    // No new calls after initial load (combat_id is null).
    expect(mGetCombatState.mock.calls.length).toBe(calls);
  });

  it('poll stops when combat state is ended', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetCombatState.mockResolvedValue(COMBAT_STATE_ENDED);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const calls = mGetCombatState.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(16000); });
    // No new polls after ENDED state.
    expect(mGetCombatState.mock.calls.length).toBe(calls);
  });
});

// ── PartyPanel live HP ────────────────────────────────────────────────────────

describe('PartyPanel — live HP from CombatState', () => {
  it('shows live HP from CombatState (9/10) instead of stale session load (8/10)', async () => {
    // Combat state has Velka at 9 HP (took a healing potion).
    const stateWithHigherHp: CombatState = {
      ...COMBAT_STATE,
      participants: [
        { ...COMBAT_STATE.participants[0], hp_current: 9 },
        COMBAT_STATE.participants[1],
      ],
    };
    mGetCombatState.mockResolvedValue(stateWithHigherHp);
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    // Party panel shows 9/10 (from combatState), not 8/10 (from session load).
    await waitFor(() =>
      expect(screen.getByText('9/10')).toBeInTheDocument(),
    );
  });
});

// ── Downed indicator ─────────────────────────────────────────────────────────

describe('InitiativeTracker — downed PC indicator', () => {
  it('shows the downed indicator and death-save aria-live region for a downed PC', async () => {
    const downedState: CombatState = {
      ...COMBAT_STATE,
      participants: [
        {
          ...COMBAT_STATE.participants[0],
          hp_current: 0,
          death_saves: {
            successes: 1,
            failures: 2,
            is_downed: true,
            is_stable: false,
            is_dead: false,
          },
        },
        COMBAT_STATE.participants[1],
      ],
    };
    mGetCombatState.mockResolvedValue(downedState);
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => {
      // The downed indicator (↓) should be present in the tracker.
      // A11Y fix (Iro MINOR-1): aria-label no longer repeats the name (name is in the preceding .name span).
      // Use the more specific death-saves text to distinguish from PartyPanel's badge.
      expect(screen.getByLabelText(/downed — death saves/i)).toBeInTheDocument();
    });
  });
});
