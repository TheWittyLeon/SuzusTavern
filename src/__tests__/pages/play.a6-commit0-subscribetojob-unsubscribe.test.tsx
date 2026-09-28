/**
 * A5 / Miko-QA pre-existing survivor (routed to A6 commit 0, 2026-09-28) —
 * `subscribeToJob`'s unsubscribe (`narrationAbort.current?.abort()` at the
 * top of `hooks/useNarration.ts::subscribeToJob`, called BEFORE creating
 * the new `AbortController`) is unpinned. Mutation (delete that line)
 * leaves the whole suite green: nothing exercises two overlapping job
 * subscriptions to prove the OLDER one's SSE tail actually stops writing
 * to shared state once a NEWER one starts. Live consequence: a stale job's
 * late chunk could still call `upsertStreamNarration` against a newer
 * job's row, silently overwriting it.
 *
 * Overlap mechanism (real code, not a stub): `subscribeToJob`'s only
 * self-dedup guard is keyed to `jobId` (`pendingByKeyRef` lookup) — a
 * DIFFERENT job_id sails straight through, calls
 * `narrationAbort.current?.abort()`, and starts a fresh tail. Two
 * INDEPENDENT triggers land two DIFFERENT job_ids without fighting the
 * `talking` gate that blocks every UI-driven double-fire (onSend/onMoveOn/
 * onAttemptCheck all refuse while `talking`):
 *   1. A combat "End turn" action → `narrateDurableBeat` → job-1 (its own
 *      trigger, not gated on `talking`; nothing else is running yet).
 *   2. The unified events poll's own stateless resume-discovery
 *      (page.tsx:1240-ish, `useSessionEvents` territory, not yet
 *      extracted) — fires on ANY poll tick whose `pending_generation.
 *      job_id` differs from `subscribedJobIdRef.current`, regardless of
 *      `talking`. A second poll tick reporting job-2 triggers exactly this.
 *
 * `subscribeToJob`'s own per-chunk guard (`!ctrl.signal.aborted`, `ctrl`
 * being THAT invocation's own AbortController) is what actually suppresses
 * a late chunk — but `ctrl` only BECOMES aborted if a later invocation's
 * `narrationAbort.current?.abort()` fires while `narrationAbort.current`
 * still points at it. That is the exact line under test.
 */
import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { EventsPage, Session, Participant } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'sess-a6' }),
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
const mockGetSessionEventsRaw = jest.fn<Promise<unknown[] | null>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsPage = jest.fn<Promise<EventsPage>, unknown[]>(() => Promise.resolve(EMPTY_PAGE));
const mockGetParticipants = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve([]));
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockEndTurn = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
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

const SESSION: Session = {
  session_id: 'sess-a6',
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
  session_id: 'sess-a6',
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
  mockGetSession.mockResolvedValue(SESSION);
  mockGetSessionEventsRaw.mockResolvedValue([]);
  mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(COMBAT_STATE_ACTIVE);
  mockGetCharacterSheet.mockResolvedValue(null);
});

describe('A6 commit 0 — subscribeToJob unsubscribe (Miko-QA A5 survivor)', () => {
  it('a stale job-1 chunk that arrives AFTER job-2 starts is never rendered — proves the OLD controller was aborted before the NEW one was created', async () => {
    let releaseJob1: (() => void) | null = null;
    const job1Gate = new Promise<void>((resolve) => {
      releaseJob1 = resolve;
    });

    mockPostDmTurn.mockImplementation(async (body: { message: string; turn_key: string }) => {
      if (body.message === 'I end my turn.') {
        return { job_id: 'job-1', turn_key: body.turn_key, status: 'streaming', deduped: false };
      }
      return { job_id: 'job-fallback', turn_key: body.turn_key, status: 'streaming', deduped: false };
    });

    mockSubscribeDmJob.mockImplementation(async function* (jobId: string) {
      if (jobId === 'job-1') {
        // Parked "in flight" — nothing yielded yet, so its ledger entry is
        // still `awaitingNarration: true` when job-2's own subscribeToJob
        // call runs its dedup check (keyed on job_id, so job-2 is
        // unaffected either way).
        await job1Gate;
        // Yields its late chunk only once the test releases it — AFTER
        // job-2 has already started (below). Whether this chunk actually
        // reaches the transcript depends entirely on whether job-2's
        // subscribeToJob call aborted THIS invocation's own controller.
        yield { kind: 'chunk', text: 'STALE JOB1 TEXT' };
        await new Promise(() => {});
      } else if (jobId === 'job-2') {
        yield { kind: 'chunk', text: 'Job 2 text.' };
        await new Promise(() => {});
      }
    });

    mockEndTurn.mockResolvedValue({
      message: 'You end your turn.',
      state: { ...COMBAT_STATE_ACTIVE, state: 'ended' as const, active_participant_id: null },
      scene_advance: null,
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');

      // 1. Start job-1 via a real combat action, not gated on `talking`
      //    (nothing else is running yet). Sets `subscribedJobIdRef` to
      //    'job-1' and parks its tail on job1Gate.
      const endTurnBtn = await screen.findByRole('button', { name: /^End turn$/i });
      await act(async () => {
        fireEvent.click(endTurnBtn);
      });
      await flush();
      expect(mockPostDmTurn).toHaveBeenCalledTimes(1);

      // 2. The events poll's own stateless resume-discovery (not gated on
      //    `talking`) observes a DIFFERENT job_id on its next tick and
      //    subscribes to it — this is the call that should abort job-1's
      //    controller BEFORE creating job-2's.
      mockGetSessionEventsPage.mockResolvedValue({
        events: [],
        max_seq: 0,
        has_more: false,
        pending_generation: {
          turn_key: 'tk-job2',
          job_id: 'job-2',
          status: 'streaming',
          trigger_seq: 1,
          started_at: '2026-09-28T10:00:00Z',
        },
      });
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await flush();

      const log = screen.getByRole('log');
      expect(within(log).getByText('Job 2 text.')).toBeInTheDocument();

      // 3. NOW release job-1's stale chunk — strictly after job-2 started.
      await act(async () => {
        releaseJob1?.();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // THE ASSERTION UNDER TEST: the stale chunk must never surface, and
      // job-2's own content must survive it (not be overwritten).
      expect(screen.queryByText('STALE JOB1 TEXT')).not.toBeInTheDocument();
      expect(within(log).getByText('Job 2 text.')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
