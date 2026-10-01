/**
 * TAV-PLAY-SHELL A9c-1 C1 — X-card independence pins (Kage A9b IMPORTANT-3,
 * Iro A9b IMPORTANT-4, Iro A9b MINOR-1).
 *
 * The X-card is the highest-consequence control on the screen. DDX-26: it
 * stays reachable whatever the table is doing. Before this file nothing
 * pinned that: a one-line edit at its call site —
 *   disabled={xCardBusy || combatBusy || sessionLocked || (combatIsActive && !isPlayerTurn)}
 * — re-gated it on combat state and no test went red. These tests render
 * the REAL page (the seam the edit would land on) in every state the combat
 * verbs are gated by, and assert the X-card is neither natively disabled nor
 * aria-disabled in any of them, with a positive control in each state that
 * the combat verbs ARE gated (so "enabled" is not vacuous).
 *
 * Fixtures/mocks modeled on play.attack-button-stale.test.tsx (combat) and
 * play.ddx26-xcard.test.tsx (postXCard).
 */
import React from 'react';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
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

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  postXCard: jest.fn(),
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
const mPostXCard = dnd.postXCard as jest.MockedFunction<typeof dnd.postXCard>;
const mAttack = dnd.attack as jest.MockedFunction<typeof dnd.attack>;

function session(overrides: Partial<Session> = {}): Session {
  return {
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
    ...overrides,
  };
}

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

const GROUNDING: GroundingData = { scene_id: 'cave_mouth', scene_name: 'Cave Mouth', transitions: [] };

/** Active combat. `activeId` picks whose turn it is: 'p_velka' (the viewer's
 *  PC, Attack enabled) or 'p_gob1' (not the viewer's turn, Attack gated). */
function combat(activeId: 'p_velka' | 'p_gob1'): CombatState {
  const velkaActive = activeId === 'p_velka';
  return {
    combat_id: 'combat-42',
    session_id: 's1',
    round: 1,
    state: 'active',
    turn_index: velkaActive ? 0 : 1,
    active_participant_id: activeId,
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
        is_active_turn: velkaActive,
        took_turn: false,
        action_available: true,
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
        is_active_turn: !velkaActive,
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

function expectReachable(btn: HTMLElement) {
  expect(btn).toBeEnabled();
  expect(btn).not.toHaveAttribute('disabled');
  expect(btn).not.toHaveAttribute('aria-disabled');
  // Outside any role=group (Kage A9c-1 1): inside ActionBar's group (or the
  // cast-spell group A9c-2 D6 moves in beside it) AT hears the X-card as one
  // of the combat verbs and a group-level disable would take it down with them.
  expect(btn.closest('[role="group"]')).toBeNull();
}

const xCard = () => screen.findByRole('button', { name: /^X-card$/i });

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mGetSession.mockResolvedValue(session());
  mGetParticipants.mockResolvedValue(PARTY);
  mGetGrounding.mockResolvedValue(GROUNDING);
  mGetCombatState.mockResolvedValue(combat('p_velka'));
  mPostXCard.mockResolvedValue({ event: { seq: 5, kind: 'x_card', actor: 'alice' } });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('A9c C1 — the X-card is reachable in every state the combat verbs are gated by', () => {
  it('combat, NOT my turn: X-card reachable while Attack is gated (positive control)', async () => {
    mGetCombatState.mockResolvedValue(combat('p_gob1'));
    renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    const btn = await xCard();
    await waitFor(() => {
      // Positive control: the bar IS gated on turn, so "enabled" below means something.
      expect(screen.getByRole('button', { name: /^Attack/ })).toBeDisabled();
    });
    expectReachable(btn);
  });

  it('combat, my turn: X-card reachable (the ungated baseline)', async () => {
    renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    const btn = await xCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Attack' })).toBeEnabled());
    expectReachable(btn);
  });

  it('combat verb IN FLIGHT (combatBusy): X-card reachable and still posts', async () => {
    mAttack.mockImplementation(() => new Promise(() => {})); // never settles: combatBusy stays true
    renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    const btn = await xCard();

    fireEvent.click(await screen.findByRole('button', { name: 'Attack' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Goblin/ }));
    await waitFor(() => {
      // Positive control: a combat action is pending, so the verbs are busy-gated.
      expect(screen.getByRole('button', { name: /^Attack/ })).toBeDisabled();
    });
    expect(mAttack).toHaveBeenCalledTimes(1);

    expectReachable(btn);
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(mPostXCard).toHaveBeenCalledTimes(1);
  });

  it('session PAUSED (sessionLocked): X-card reachable', async () => {
    mGetSession.mockResolvedValue(session({ status: 'paused' }));
    renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    const btn = await xCard();
    expectReachable(btn);
  });

  it('session ENDED (sessionLocked): X-card reachable', async () => {
    mGetSession.mockResolvedValue(session({ status: 'ended' }));
    renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    const btn = await xCard();
    expectReachable(btn);
  });
});

describe('A9c C1 — the X-card own in-flight raise uses aria-disabled, never native disabled (Iro A9b IMPORTANT-4)', () => {
  it('keeps focus through the raise, never gains `disabled`, and a second click does not re-post', async () => {
    let resolveRaise: (v: unknown) => void = () => {};
    mPostXCard.mockImplementation(
      () => new Promise((res) => { resolveRaise = res as (v: unknown) => void; }) as ReturnType<typeof dnd.postXCard>,
    );
    renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    const btn = await xCard();

    btn.focus();
    expect(btn).toHaveFocus();
    await act(async () => {
      fireEvent.click(btn);
    });

    // In flight: announced as busy and aria-disabled, but NOT natively disabled
    // (native disabled blurs a focused button: the keyboard user lands on <body>).
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toHaveAttribute('disabled');
    expect(btn).toHaveFocus();

    await act(async () => {
      fireEvent.click(btn); // the xCardBusyRef latch is the click guard
    });
    expect(mPostXCard).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRaise({ event: { seq: 5, kind: 'x_card', actor: 'alice' } });
    });
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'false'));
    expect(btn).not.toHaveAttribute('aria-disabled');
    expect(btn).toHaveFocus();
  });
});

describe('A9c C1 — the X-card consequence copy is its accessible description (Iro A9b MINOR-1)', () => {
  it('aria-describedby resolves to the visible-in-DOM hint text', async () => {
    renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    const btn = await xCard();
    expect(btn).toHaveAccessibleDescription(/pause · rewind · suzu listens/i);
  });
});
