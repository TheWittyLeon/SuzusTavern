/**
 * F3/COMBAT-NO-AUTO-RESOLVE (WF-TAV-AUDIT-BATCH-2026-07-22 Pass P) —
 * advisory (never blocking) "All enemies are down — End combat" prompt.
 *
 * Coverage:
 *   1. Fires when the sole hostile is down (state==='active', no living
 *      targetable foes) and opens the SAME outcome chooser as the existing
 *      "End" button.
 *   2. Does NOT fire while any hostile is still alive.
 *   3. Does NOT fire before combat starts (no combatId) or after combat has
 *      ended (state==='ended') — targetableFoes is empty in both of those
 *      cases too, for a different reason; the gate is on state==='active'
 *      explicitly, not emptiness alone.
 *   4. Advisory, not blocking: Dodge/Dash/End-turn stay enabled.
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
  getGrounding: jest.fn(() => Promise.resolve(null)),
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
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
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

/** All hostiles down, combat still active — the trigger case. */
const COMBAT_ALL_DOWN: CombatState = {
  combat_id: 'combat-42',
  session_id: 's1',
  round: 2,
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
      hp_current: 0,
      hp_max: 7,
      ac: 13,
      conditions: [],
      is_alive: false,
      can_be_targeted: false,
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

/** A living hostile — must NOT trigger the prompt. */
const COMBAT_HOSTILE_ALIVE: CombatState = {
  ...COMBAT_ALL_DOWN,
  participants: [
    COMBAT_ALL_DOWN.participants[0],
    { ...COMBAT_ALL_DOWN.participants[1], is_alive: true, can_be_targeted: true, hp_current: 7 },
  ],
};

/** Combat already ended — must NOT trigger the prompt, even though
 *  targetableFoes is also empty here (for a different reason). */
const COMBAT_ENDED: CombatState = {
  ...COMBAT_ALL_DOWN,
  state: 'ended',
  active_participant_id: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
  mGetParticipants.mockResolvedValue(PARTY);
});

describe('F3/COMBAT-NO-AUTO-RESOLVE — prompt fires when the sole hostile is down', () => {
  it('shows the "All enemies are down" banner and its "Wrap up" button opens the SAME outcome chooser', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_ALL_DOWN);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const banner = await screen.findByText(/All enemies are down/i);
    expect(banner).toBeInTheDocument();

    const promptBtn = screen.getByRole('button', { name: /wrap up the fight/i });
    await act(async () => {
      fireEvent.click(promptBtn);
    });

    // Same outcome chooser the pre-existing "End" trigger opens.
    expect(await screen.findByRole('group', { name: /Choose combat outcome/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Victory/i })).toBeInTheDocument();
  });

  it('advisory only — Dodge/Dash/End turn stay enabled while the prompt is showing', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_ALL_DOWN);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await screen.findByText(/All enemies are down/i);

    await waitFor(() => {
      const dodge = screen.getAllByRole('button', { name: /^Dodge$/i })[0];
      const dash = screen.getAllByRole('button', { name: /^Dash$/i })[0];
      const endTurn = screen.getAllByRole('button', { name: /^End turn$/i })[0];
      expect(dodge).not.toBeDisabled();
      expect(dash).not.toBeDisabled();
      expect(endTurn).not.toBeDisabled();
    });
  });
});

describe('F3/COMBAT-NO-AUTO-RESOLVE — never fires outside the exact trigger condition', () => {
  it('does NOT fire while a hostile is still alive', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_HOSTILE_ALIVE);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Attack/i }).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/All enemies are down/i)).not.toBeInTheDocument();
  });

  it('does NOT fire once combat has ended (targetableFoes is also empty here, for a different reason)', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_ENDED);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => expect(mGetCombatState).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText(/All enemies are down/i)).not.toBeInTheDocument();
  });

  it('does NOT fire before combat starts (no combatId at all)', async () => {
    mGetSession.mockResolvedValue({ ...SESSION_WITH_COMBAT, active_combat_id: null });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    // TAVERN PLAY-UI NITS (2026-07-23 pre-flight playthrough) item a: the
    // begin-combat button now only renders when the scene has an authored
    // encounter, which this file's grounding mock never sets — so it can no
    // longer serve as this test's "page has settled" proxy. `getCombatState`
    // is also never called with no combatId, so flush a couple of ticks
    // (mirrors the sibling "combat has ended" case above) and assert the
    // no-combat state directly instead.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText(/All enemies are down/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^combat$/i)).not.toBeInTheDocument();
  });
});

// ── Iro MAJOR-1: outcome chooser refocuses whichever control opened it ─────
// The chooser is a single popover opened by two different triggers ("End" and
// the new "Wrap up" banner button). Its Escape handler and Cancel button used
// to hardcode `endCombatBtnRef`, so opening via "Wrap up" then dismissing threw
// focus to the (invisible-to-the-user-in-that-flow) "End" button instead of
// back to "Wrap up". `lastOpenerRef` now captures whichever button was
// actually clicked.
describe('Iro MAJOR-1 — outcome chooser refocuses the actual opener on dismiss', () => {
  it('open via "Wrap up" → Escape → focus returns to "Wrap up"', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_ALL_DOWN);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const promptBtn = await screen.findByRole('button', { name: /wrap up the fight/i });
    await act(async () => {
      fireEvent.click(promptBtn);
    });
    const chooser = await screen.findByRole('group', { name: /Choose combat outcome/i });

    fireEvent.keyDown(chooser, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('group', { name: /Choose combat outcome/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /wrap up the fight/i })).toHaveFocus();
  });

  it('open via "Wrap up" → Cancel → focus returns to "Wrap up"', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_ALL_DOWN);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const promptBtn = await screen.findByRole('button', { name: /wrap up the fight/i });
    await act(async () => {
      fireEvent.click(promptBtn);
    });
    await screen.findByRole('group', { name: /Choose combat outcome/i });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    });

    await waitFor(() => {
      expect(screen.queryByRole('group', { name: /Choose combat outcome/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /wrap up the fight/i })).toHaveFocus();
  });

  it('regression pin: open via "End" → Escape → focus returns to "End" (unchanged)', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_ALL_DOWN);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const endBtn = await screen.findByRole('button', { name: /End combat — choose outcome/i });
    await act(async () => {
      fireEvent.click(endBtn);
    });
    const chooser = await screen.findByRole('group', { name: /Choose combat outcome/i });

    fireEvent.keyDown(chooser, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('group', { name: /Choose combat outcome/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /End combat — choose outcome/i })).toHaveFocus();
  });
});
