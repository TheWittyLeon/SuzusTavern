/**
 * A4 (Kage-CR Q3, routed to A7/A4b commit 0) — the seq-ordering survivor.
 *
 * `useSessionEvents.ts`'s durable branch advances `handlers.lastEventSeqRef`
 * AFTER processing (`:526`, past the `if (allNewEvents.length > 0)` block
 * that calls `reconcileDurableEvents`/`setLog`/etc), inside a `try { … }
 * catch {}` that swallows any synchronous throw. No existing test forced
 * that throw, so Kage's M-B mutation (advance the cursor BEFORE processing
 * instead of after) survived the whole suite (247/3,623 green) even though
 * it changes an invariant the file's own comments document at length: a
 * throw mid-batch must retry the SAME `since_seq` next tick, never move the
 * watermark past events nothing rendered — "advance-before…moves the
 * watermark past events that were never rendered — permanently, for the
 * life of the mount" (Kage, verbatim).
 *
 * This pins the code's ACTUAL contract (advance-after / retry-on-throw), not
 * an invented one: `reconcileDurableEvents` throws on the first poll tick
 * (a stand-in for a malformed event / classifier payload), the row must NOT
 * appear and the cursor must NOT move; the second tick (throw cleared)
 * re-fetches from the SAME `since_seq` and the row appears. The
 * `getSessionEventsPage` mock filters by `since_seq` like the real engine
 * route, not the F9-design's deliberate "ignore since_seq" vacuity trap —
 * so this test is only satisfiable if the cursor genuinely didn't move.
 *
 * Mutation proof (M-B, "advance the cursor before processing"): under that
 * mutant, tick 1 still throws inside `reconcileDurableEvents`, but the
 * cursor has already jumped to `max_seq` before the throw — tick 2's
 * `since_seq` param becomes 5, the realistic mock returns an empty page (no
 * events past seq 5), and the row this test asserts on never appears. RED
 * under the mutant, GREEN on `main`.
 */
import React from 'react';
import { screen, act } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, EventsPage, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

// Kage-CR A4b IMP-4: an inline `toast: jest.fn()` allocates a fresh
// function every render, which destabilizes useSceneState's real
// `useCallback(..., [toast])` (applyOfferedCheckSignal/diffAndExplainResolvedChecks),
// which tears down and re-arms the poll's 4s interval on nearly every
// render — the exact IMPORTANT-1-class hazard the poll's own deps-array
// fix (A4) exists to catch. A module-level mock (Miko-QA's own pattern,
// e.g. adv6-play-edge.test.tsx) is stable across renders instead.
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

// DURABLE_GENERATION_ENABLED read once at import time — fixed true for this
// whole file, same convention as play.ddx20-durable-turn.test.tsx.
jest.mock('../../lib/config', () => ({
  DURABLE_GENERATION_ENABLED: true,
  OAUTH_ENABLED: false,
  CODEX_ENABLED: false,
}));

// The fault injection: `reconcileDurableEvents` is a real jest.fn wrapping
// the ACTUAL implementation, so every call after the forced first-call throw
// behaves exactly like production — this is not a stubbed-out no-op.
jest.mock('../../lib/dnd/reconcileEvents', () => {
  const actual = jest.requireActual('../../lib/dnd/reconcileEvents');
  return {
    __esModule: true,
    applyReconcileResult: actual.applyReconcileResult,
    reconcileDurableEvents: jest.fn(actual.reconcileDurableEvents),
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsRaw = jest.fn<Promise<EngineSessionEvent[] | null>, unknown[]>(() =>
  Promise.resolve([]),
);
const mockGetSessionEventsPage: jest.Mock<Promise<EventsPage>> = jest.fn();
const mockGetParticipants = jest.fn<Promise<Participant[]>, unknown[]>(() => Promise.resolve([]));
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getSessionEventsPage: (...args: Parameters<AnyFn>) => mockGetSessionEventsPage(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  postRoll: jest.fn(),
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
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' as const };
  }),
  postDmTurn: jest.fn(),
  subscribeDmJob: jest.fn(async function* () {}),
}));

import PlayPage from '@/app/play/[sessionId]/page';
import { reconcileDurableEvents } from '@/lib/dnd/reconcileEvents';

const mockReconcileDurableEvents = reconcileDurableEvents as jest.MockedFunction<
  typeof reconcileDurableEvents
>;

const SESSION: Session = {
  session_id: 's1',
  channel: 'test_channel',
  name: 'Test Table',
  status: 'active',
  dm_username: 'suzu',
  dm_mode: 'ai',
  ai_assist_level: 'full',
  active_combat_id: null,
};

const PARTY: Participant[] = [{ username: 'leon', is_dm: false, character: null }];

const EVENT_SEQ = 5;
function narrationEvent(seq: number): EngineSessionEvent {
  return {
    seq,
    kind: 'narration',
    visibility: 'table',
    created_at: '2026-09-28T10:00:00Z',
    data: { who: 'Suzu', text: 'The mid-batch throw did not eat this beat.' },
  };
}

async function tick() {
  await act(async () => {
    jest.advanceTimersByTime(4000);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  window.localStorage.clear();
  mockGetSession.mockResolvedValue(SESSION);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([]); // mount rehydration: seeds lastEventSeqRef to 0
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue({ checks: [], transitions: [] });
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);

  // Realistic since_seq-honouring fixture (the opposite of the F9 design's
  // deliberate vacuity trap) — this is exactly what makes the test sensitive
  // to whether the cursor moved: a page seeded past seq 5 sees nothing new.
  mockGetSessionEventsPage.mockImplementation((_sessionId: string, sinceSeq?: number) => {
    const since = sinceSeq ?? 0;
    if (since < EVENT_SEQ) {
      return Promise.resolve({
        events: [narrationEvent(EVENT_SEQ)],
        max_seq: EVENT_SEQ,
        has_more: false,
        pending_generation: null,
      });
    }
    return Promise.resolve({ events: [], max_seq: since, has_more: false, pending_generation: null });
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('seq-ordering — durable branch — advance-after / retry-on-throw', () => {
  it('a synchronous throw mid-batch does not move the cursor past an unrendered event, and the next tick recovers it', async () => {
    // Tick 1's reconcile throws (stand-in for a malformed event / classifier
    // payload blowing up mid-batch) — every later call is the REAL function.
    mockReconcileDurableEvents.mockImplementationOnce(() => {
      throw new Error('synthetic mid-batch failure');
    });

    renderPlay(<PlayPage />);
    await screen.findByText('Test Table');

    // Tick 1: throws. Caught by the poll's own try/catch — non-fatal, but
    // the row must NOT render and the cursor must NOT advance.
    await tick();
    expect(mockGetSessionEventsPage).toHaveBeenCalledTimes(1);
    expect(mockGetSessionEventsPage.mock.calls[0]?.[1]).toBe(0);
    expect(
      screen.queryByText(/The mid-batch throw did not eat this beat/i),
    ).not.toBeInTheDocument();

    // Tick 2: reconcile is back to its real implementation. THE ASSERTION
    // UNDER TEST — the cursor is still 0 (not advanced past seq 5 by the
    // failed tick), so the same page is re-fetched and this time succeeds.
    await tick();
    expect(mockGetSessionEventsPage).toHaveBeenCalledTimes(2);
    expect(mockGetSessionEventsPage.mock.calls[1]?.[1]).toBe(0);
    expect(
      await screen.findByText(/The mid-batch throw did not eat this beat/i),
    ).toBeInTheDocument();
  });
});
