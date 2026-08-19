/**
 * TAV-DANGLING-COMBAT-404-POLL (P2, user-visible, 2026-08-19).
 *
 * `session.active_combat_id` was found NOT cleared when a combat disappears
 * (the engine half of this fix lives in NekoNova-DnDEngine), so the Tavern's
 * combat-state poll (GET /combat/{id}/state every 4s) retried forever on a
 * 404, with no give-up/backoff — surviving hard reloads and fresh tabs
 * because mount always re-derives `combatId` from the session's stale field.
 *
 * This file pins the CLIENT half: bounded retries before giving up, and no
 * resumption on a remount for the same confirmed-dead id (module-level
 * `deadCombatIds`, page.tsx). Each test uses its OWN combat_id — the dead-id
 * memory is module-level and this file does not reset it between tests, by
 * design (that persistence across remounts within one page load is exactly
 * what's under test), so cross-test ids must never collide.
 *
 * Same harness convention as combat-ui-adv78.test.tsx (its "Poll loop"
 * describe block is the sibling coverage for the ordinary, healthy poll).
 */
import React from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
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
  resolveCheck: jest.fn(),
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'alice', role: 'player', character_id: 1 })),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' as const };
  }),
}));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetCombatState = dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>;

const BASE_SESSION: Session = {
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

const PARTY: Participant[] = [
  {
    username: 'alice',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Velka',
      char_class: 'Fighter',
      level: 3,
      current_hp: 20,
      max_hp: 20,
      ac: 15,
    },
  },
];

const GROUNDING: GroundingData = {
  scene_id: 'cave_mouth',
  scene_name: 'Cave Mouth',
  boxed_text: 'The tide has carved a hollow into the cliff.',
  transitions: [],
  checks: [],
  flags: {},
  encounter_state: {},
};

const COMBAT_STATE: CombatState = {
  combat_id: 'combat-live',
  session_id: 's1',
  round: 1,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'p1',
  initiative: ['p1'],
  participants: [
    {
      participant_id: 'p1',
      entity_id: 'c1',
      name: 'Velka',
      is_pc: true,
      initiative: 15,
      hp_current: 20,
      hp_max: 20,
      ac: 15,
      conditions: [],
      is_alive: true,
      can_be_targeted: false,
      is_active_turn: true,
      took_turn: false,
    },
  ],
};

function apiError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function streamOnce(events: NarrationEvent[]) {
  const stream = jest.requireMock('../../lib/stream') as {
    streamDmNarration: jest.Mock;
  };
  stream.streamDmNarration.mockImplementation(async function* () {
    for (const e of events) yield e;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mGetParticipants.mockResolvedValue(PARTY);
  mGetGrounding.mockResolvedValue(GROUNDING);
  streamOnce([{ kind: 'chunk', text: 'The scene unfolds.' }, { kind: 'done' }]);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe('TAV-DANGLING-COMBAT-404-POLL — mount-time detection', () => {
  it('a 404 on the very first read gives up immediately — no poll interval ever starts', async () => {
    const deadId = 'combat-404-mount-1';
    mGetSession.mockResolvedValue({ ...BASE_SESSION, active_combat_id: deadId });
    mGetCombatState.mockRejectedValue(apiError(404, 'Combat not found.'));
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() => expect(mGetCombatState).toHaveBeenCalledTimes(1));

    // Advance well past several poll intervals — the mount-time 404 must
    // have cleared combatId before the poll effect ever scheduled anything.
    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });
    expect(mGetCombatState).toHaveBeenCalledTimes(1);
  });
});

describe('TAV-DANGLING-COMBAT-404-POLL — bounded retries in the poll loop', () => {
  it('stops polling after 3 consecutive 404s (does not hammer forever)', async () => {
    const deadId = 'combat-404-poll-1';
    mGetSession.mockResolvedValue({ ...BASE_SESSION, active_combat_id: deadId });
    // Succeed once on mount (so the poll effect actually starts), then 404
    // every tick after.
    mGetCombatState
      .mockResolvedValueOnce(COMBAT_STATE)
      .mockRejectedValue(apiError(404, 'Combat not found.'));
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() => expect(mGetCombatState).toHaveBeenCalledTimes(1));

    // Tick 1..3: three consecutive 404s exhaust COMBAT_POLL_MAX_404S.
    await act(async () => { jest.advanceTimersByTime(4000); });
    await act(async () => { jest.advanceTimersByTime(4000); });
    await act(async () => { jest.advanceTimersByTime(4000); });
    const callsAfterGiveUp = mGetCombatState.mock.calls.length;
    expect(callsAfterGiveUp).toBe(4); // 1 mount success + 3 failing ticks

    // Further ticks must NOT call getCombatState again — the interval was
    // torn down (combatId cleared) once the threshold was hit.
    await act(async () => { jest.advanceTimersByTime(20_000); });
    expect(mGetCombatState).toHaveBeenCalledTimes(callsAfterGiveUp);
  });

  it('a single 404 blip does not trip the give-up threshold — a later success keeps polling', async () => {
    const liveId = 'combat-404-blip-1';
    mGetSession.mockResolvedValue({ ...BASE_SESSION, active_combat_id: liveId });
    mGetCombatState
      .mockResolvedValueOnce(COMBAT_STATE) // mount
      .mockRejectedValueOnce(apiError(404, 'Combat not found.')) // tick 1: blip
      .mockResolvedValue(COMBAT_STATE); // tick 2+: recovered
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => expect(mGetCombatState).toHaveBeenCalledTimes(1));

    await act(async () => { jest.advanceTimersByTime(4000); }); // tick 1 (blip)
    await act(async () => { jest.advanceTimersByTime(4000); }); // tick 2 (recovered)
    await act(async () => { jest.advanceTimersByTime(4000); }); // tick 3

    // Still polling — the blip alone never reached the 3-consecutive-404
    // threshold, and the recovered success reset the tally.
    expect(mGetCombatState.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

describe('TAV-DANGLING-COMBAT-404-POLL — no resumption on remount for the same dead id', () => {
  it('unmount + remount with the SAME confirmed-dead id does not re-poll it', async () => {
    const deadId = 'combat-404-remount-1';
    mGetSession.mockResolvedValue({ ...BASE_SESSION, active_combat_id: deadId });
    mGetCombatState.mockRejectedValue(apiError(404, 'Combat not found.'));

    const { unmount } = render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => expect(mGetCombatState).toHaveBeenCalledTimes(1));
    unmount();

    const callsBeforeRemount = mGetCombatState.mock.calls.length;

    // Simulate returning to the same session (e.g. client-side nav away and
    // back) — same JS module instance, so deadCombatIds is still populated.
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await act(async () => { jest.advanceTimersByTime(20_000); });

    // No new getCombatState calls at all for this id — the remount's own
    // mount-time check (deadCombatIds.has) must have suppressed both the
    // immediate fetch AND the poll effect.
    expect(mGetCombatState.mock.calls.length).toBe(callsBeforeRemount);
  });

  it('a DIFFERENT (fresh) combat_id on the same session is unaffected by a prior dead id', async () => {
    const deadId = 'combat-404-isolation-dead';
    const freshId = 'combat-404-isolation-fresh';

    // First mount: confirm deadId as dead.
    mGetSession.mockResolvedValue({ ...BASE_SESSION, active_combat_id: deadId });
    mGetCombatState.mockRejectedValue(apiError(404, 'Combat not found.'));
    const { unmount } = render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => expect(mGetCombatState).toHaveBeenCalledTimes(1));
    unmount();

    // Second mount: a brand-new combat_id (a fresh encounter started since).
    jest.clearAllMocks();
    mGetParticipants.mockResolvedValue(PARTY);
    mGetGrounding.mockResolvedValue(GROUNDING);
    streamOnce([{ kind: 'chunk', text: 'The scene unfolds.' }, { kind: 'done' }]);
    mGetSession.mockResolvedValue({ ...BASE_SESSION, active_combat_id: freshId });
    mGetCombatState.mockResolvedValue({ ...COMBAT_STATE, combat_id: freshId });

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    // The fresh id must be fetched normally — the dead-id memory is scoped
    // per id, not per session. (Mount-time call also passes an AbortSignal
    // as arg 2 — match on arg 1 only.)
    await waitFor(() =>
      expect(mGetCombatState.mock.calls.some((call) => call[0] === freshId)).toBe(true),
    );
  });
});
