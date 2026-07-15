/**
 * Miko-QA re-gate adversarial probe on the DDX-20 Pass 3 fold (7504cb4,
 * parent 3edd2d7) — NOT part of the fold itself. Exercises two things the
 * fold's own tests don't:
 *
 * (1) Confirms the `subscribeToJob` job-id dedupe guard's blast radius is
 *     bounded by the pre-existing `talking` gate on `onSend` — i.e. a
 *     composer submission literally cannot fire (and therefore cannot
 *     409-pivot with a mis-attributed `origin: 'composer'`) while a beat's
 *     own job is in flight. This is what makes the dedupe guard's
 *     "whoever registers first wins the origin label" semantics safe for
 *     the shipped call sites, even though the guard itself has no way to
 *     know which origin is "true" for a given job_id.
 *
 * (2) Empirically confirms the fold's own documented worst-case claim for
 *     the poll's stateless resume-discovery path (page.tsx comment, §4b):
 *     "worst case on a genuine beat-job SSE error post-reload is a Retry
 *     banner whose click no-ops ... not a wrong-content resubmit." A fresh
 *     mount discovers an in-flight job via `pending_generation` (origin
 *     defaulted to 'composer' — the code openly admits it can't know the
 *     job's true origin post-reload) whose SSE tail then errors: the Retry
 *     banner DOES appear (misleading — it's actually a beat's job) but
 *     clicking it is a genuine no-op (no second postDmTurn, lastDurableTurnRef
 *     is null across a fresh mount) — confirming the documented trade-off
 *     holds and doesn't silently resubmit stale/wrong content.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Session, Participant, EventsPage } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'sess-reqa' }),
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

jest.mock('../../lib/config', () => ({
  DURABLE_GENERATION_ENABLED: true,
  OAUTH_ENABLED: false,
  CODEX_ENABLED: false,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const EMPTY_PAGE: EventsPage = { events: [], max_seq: 0, has_more: false, pending_generation: null };

const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsRaw = jest.fn<Promise<unknown[] | null>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsPage = jest.fn<Promise<EventsPage>, unknown[]>(() => Promise.resolve(EMPTY_PAGE));
const mockGetParticipants = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve([]));
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockEndTurn = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getSessionEventsPage: (...args: Parameters<AnyFn>) => mockGetSessionEventsPage(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postRoll: jest.fn(),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  combatFromScene: jest.fn(),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  rollInitiative: jest.fn(() => Promise.resolve({ message: 'Initiative rolled.' })),
  monsterTurn: jest.fn(() => Promise.resolve({ message: undefined, state: null })),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: (...args: Parameters<AnyFn>) => mockEndTurn(...args),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  resolveCheck: jest.fn(),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

const mockStreamDmNarration = jest.fn();
const mockPostDmTurn = jest.fn();
const mockSubscribeDmJob = jest.fn();

jest.mock('../../lib/stream', () => ({
  streamDmNarration: (...args: Parameters<AnyFn>) => mockStreamDmNarration(...args),
  postDmTurn: (...args: Parameters<AnyFn>) => mockPostDmTurn(...args),
  subscribeDmJob: (...args: Parameters<AnyFn>) => mockSubscribeDmJob(...args),
}));

import PlayPage from '@/app/play/[sessionId]/page';

const AI_SESSION_WITH_COMBAT: Session = {
  session_id: 'sess-reqa',
  channel: 'test_channel',
  name: 'Test Table',
  status: 'active',
  dm_username: 'suzu',
  dm_mode: 'ai',
  ai_assist_level: 'full',
  active_combat_id: 'combat-1',
};

const COMBAT_STATE_ACTIVE = {
  combat_id: 'combat-1',
  session_id: 'sess-reqa',
  round: 1,
  state: 'active' as const,
  turn_index: 0,
  active_participant_id: 'p_velka',
  initiative: ['p_velka'],
  participants: [
    {
      participant_id: 'p_velka',
      entity_id: 'c1',
      name: 'Velka',
      is_pc: true,
      initiative: 18,
      hp_current: 18,
      hp_max: 20,
      ac: 14,
      conditions: [],
      is_alive: true,
      can_be_targeted: true,
      is_active_turn: true,
      took_turn: false,
    },
  ],
  scene_id: 'cave_mouth',
  last_action: null,
  scene_advance: null,
};

const COMBAT_STATE_ENDED = {
  ...COMBAT_STATE_ACTIVE,
  state: 'ended' as const,
  active_participant_id: null,
};

const PARTY: Participant[] = [
  {
    username: 'leon',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Velka',
      char_class: 'Rogue',
      level: 3,
      current_hp: 18,
      max_hp: 20,
      ac: 14,
    },
  },
];

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockGetSession.mockResolvedValue(AI_SESSION_WITH_COMBAT);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([]);
  mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(COMBAT_STATE_ACTIVE);
  mockGetCharacterSheet.mockResolvedValue(null);
});

describe('re-QA (1): the `talking` gate on onSend structurally prevents a composer-vs-beat mis-attributed-origin race', () => {
  it('a beat (End turn) sets talking=true synchronously; a same-tick composer Enter submission is a hard no-op while the beat is still in flight — postDmTurn is called ONCE (the beat\'s own), never twice', async () => {
    let releaseBeat6: ((v: unknown) => void) | null = null;
    const beat6Promise = new Promise((resolve) => {
      releaseBeat6 = resolve;
    });
    mockPostDmTurn.mockImplementation(async (body: { message: string; turn_key: string }) => {
      if (body.message === 'I end my turn.') return beat6Promise;
      // Would be the composer's own call IF it ever fired.
      return { job_id: 'job-composer', turn_key: body.turn_key, status: 'pending', deduped: false };
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'Velka ends her turn.' };
      await new Promise(() => {});
    });
    mockEndTurn.mockResolvedValue({
      message: 'You end your turn.',
      state: COMBAT_STATE_ENDED,
      scene_advance: null,
    });

    render(<PlayPage />);
    await screen.findByText('Test Table');

    const endTurnBtn = await screen.findByRole('button', { name: /^End turn$/i });
    await act(async () => {
      fireEvent.click(endTurnBtn);
    });
    // Beat 6's postDmTurn is deliberately still pending (unresolved promise) —
    // `talking` was flipped true synchronously before this await, per
    // narrateDurableBeat's own "Miko-QA finding (b)" discipline.

    // Attempt a composer submission WHILE the beat's job is still in flight.
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Wait, I have an idea!' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await flush();

    // onSend's `if (!text || talking) return;` guard blocks the composer
    // entirely — postDmTurn was never called a second time, and the
    // composer's own text was never cleared (proves onSend returned before
    // setMsg('')).
    expect(mockPostDmTurn).toHaveBeenCalledTimes(1);
    expect((input as HTMLTextAreaElement).value).toBe('Wait, I have an idea!');

    // Release beat 6's job now so the test doesn't leak a hanging promise.
    await act(async () => {
      releaseBeat6?.({ job_id: 'job-6', turn_key: 'tk-beat6', status: 'pending', deduped: false });
      await Promise.resolve();
    });
  });
});

describe('re-QA (2): reload-resume-discovery\'s documented "worst case = no-op Retry" claim (page.tsx §4b comment) holds empirically', () => {
  it('a fresh mount discovers a genuinely beat-originated in-flight job via pending_generation (origin defaults to "composer" — unknowable post-reload); when its SSE tail errors, the Retry banner DOES appear (misattributed) but clicking it is a real no-op — no second postDmTurn, no resubmitted content', async () => {
    // Simulate: this is a FRESH mount (reload) — no lastDurableTurnRef, no
    // turnKeyRef survive a reload (both are in-memory refs). The poll
    // discovers an in-flight job that (in this scenario) really belongs to
    // another client's synthetic beat — the resume-discovery code has no way
    // to know that and defaults origin to 'composer' (page.tsx:1316-1326).
    mockGetSessionEventsPage.mockResolvedValue({
      events: [],
      max_seq: 5,
      has_more: false,
      pending_generation: {
        turn_key: 'tk-other-clients-beat',
        job_id: 'job-other-beat',
        status: 'streaming',
        trigger_seq: 5,
        started_at: '2026-07-14T10:00:00Z',
      },
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'error', error: 'generation failed' };
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');

      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // The mis-attribution IS observable: a Retry banner appears for what
      // is really a beat's job (documented, accepted trade-off — not a bug
      // this gate is asking to be fixed).
      const retryBtn = await screen.findByRole('button', { name: /retry/i });
      expect(screen.getByText(/stepped away/i)).toBeInTheDocument();

      // THE CLAIM UNDER TEST: clicking Retry is a genuine no-op — no second
      // postDmTurn call, because lastDurableTurnRef.current is null on a
      // fresh mount (onRetryFailedTurn's own `if (last)` guard).
      await act(async () => {
        fireEvent.click(retryBtn);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(mockPostDmTurn).not.toHaveBeenCalled();
      // The (misleading) Retry button unmounts regardless — jobFailed is
      // reset unconditionally at the top of onRetryFailedTurn.
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
