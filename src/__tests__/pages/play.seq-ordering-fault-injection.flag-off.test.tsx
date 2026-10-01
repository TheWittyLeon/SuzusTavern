/**
 * A4 (Kage-CR Q3, routed to A7/A4b commit 0) — the seq-ordering survivor,
 * LIVE (flag-OFF) branch. Kage's own re-measurement found this branch has
 * the SAME hole Miko found on the durable branch — worse, because this is
 * the copy that runs in prod today (`DURABLE_GENERATION_ENABLED === false`
 * per `src/lib/config.ts:63`).
 *
 * `useSessionEvents.ts`'s flag-OFF branch advances `handlers.lastEventSeqRef`
 * AFTER processing (`:738-741`, past the `.map(eventToLogRow)` mapping and
 * the `setLog` call), inside a `try { … } catch {}` that swallows any
 * synchronous throw. Kage's M-A mutation (advance the cursor BEFORE
 * processing) survived the whole suite. This pins the ACTUAL contract
 * (advance-after / retry-on-throw): `eventToLogRow` throws on the first
 * poll tick, the row must NOT appear and the cursor must NOT move — the
 * next tick re-observes the SAME event (the engine's GET /events has no
 * since_seq filter at all — every tick returns the full raw list, per this
 * file's own header comment) and renders it once the throw clears.
 *
 * Mutation proof (M-A, "advance the cursor before processing" on this
 * branch): under that mutant, tick 1 still throws inside
 * `.map(eventToLogRow)`, but the cursor has already advanced to seq 7
 * before the throw — tick 2's `newOnes` filter (`e.seq > lastEventSeqRef`)
 * then finds nothing new (the raw feed still only has seq 7), the poll's
 * own `if (newOnes.length === 0) return;` guard fires, and the row this
 * test asserts on never appears. RED under the mutant, GREEN on `main`.
 */
import React from 'react';
import { screen, act } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, Participant, Session } from '@/lib/api/types';

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

// Flag OFF for this whole file (the SSE / legacy poll path — the LIVE
// prod path per src/lib/config.ts:63).
jest.mock('../../lib/config', () => ({
  DURABLE_GENERATION_ENABLED: false,
  OAUTH_ENABLED: false,
  CODEX_ENABLED: false,
}));

// The fault injection: `eventToLogRow` is a real jest.fn wrapping the ACTUAL
// implementation (and every other rehydration.ts export, e.g. the poll's
// rendered-kind vocabulary, is untouched real code via the spread) — so
// every call after the forced first-call throw behaves exactly like
// production, not a stubbed-out no-op.
jest.mock('../../lib/rehydration', () => {
  const actual = jest.requireActual('../../lib/rehydration');
  return {
    __esModule: true,
    ...actual,
    eventToLogRow: jest.fn(actual.eventToLogRow),
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsRaw = jest.fn<Promise<EngineSessionEvent[] | null>, unknown[]>(() =>
  Promise.resolve([]),
);
const mockGetParticipants = jest.fn<Promise<Participant[]>, unknown[]>(() => Promise.resolve([]));
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getSessionEventsPage: jest.fn(() =>
    Promise.resolve({ events: [], max_seq: 0, has_more: false, pending_generation: null }),
  ),
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
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' as const };
  }),
  postDmTurn: jest.fn(),
  subscribeDmJob: jest.fn(async function* () {}),
}));

import PlayPage from '@/app/play/[sessionId]/page';
import { eventToLogRow } from '@/lib/rehydration';

const mockEventToLogRow = eventToLogRow as jest.MockedFunction<typeof eventToLogRow>;

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

const EVENT_SEQ = 7;
// ChatLog renders a roll row from `roll.value`/`roll.modifier` (rollTotal,
// "value + modifier = total") and `text` (rollLabel) — NOT from
// `data.description` (that field only gates whether eventToLogRow returns a
// row at all). Picking a skill + nonzero modifier makes "= 17" render,
// distinctive enough that this test doesn't need to search for prose.
function diceRollEvent(seq: number): EngineSessionEvent {
  return {
    seq,
    kind: 'dice_roll',
    actor: 'leon',
    visibility: 'table',
    created_at: '2026-09-28T10:00:00Z',
    data: {
      kind: 'skill',
      skill: 'stealth',
      modifier: 6,
      rolls: [11],
      kept: 11,
      total: 17,
      description: 'Stealth check: rolled 11 + 6 = 17.',
    },
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
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue({ checks: [], transitions: [] });
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);

  // getSessionEventsRaw has no since_seq filter at all (the poll's own
  // header comment) — every tick, including the mount rehydration read,
  // sees the FULL current event list. Seeded empty for mount; the test
  // switches it to carry the one event once rendering settles.
  mockGetSessionEventsRaw.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('seq-ordering — flag-OFF (live) branch — advance-after / retry-on-throw', () => {
  it('a synchronous throw mid-batch does not move the cursor past an unrendered event, and the next tick recovers it', async () => {
    renderPlay(<PlayPage />);
    await screen.findByText('Test Table');

    // The event appears on the wire (a roll fired by another client) once
    // mount rehydration has already settled with an empty history.
    mockGetSessionEventsRaw.mockResolvedValue([diceRollEvent(EVENT_SEQ)]);

    // Tick 1's eventToLogRow throws (stand-in for a malformed row) — every
    // later call is the REAL function.
    mockEventToLogRow.mockImplementationOnce(() => {
      throw new Error('synthetic mid-batch failure');
    });

    // Tick 1: throws. Caught by the poll's own try/catch — non-fatal, but
    // the row must NOT render and the cursor must NOT advance.
    await tick();
    expect(
      screen.queryByText(/= 17/i),
    ).not.toBeInTheDocument();

    // Tick 2: eventToLogRow is back to its real implementation. THE
    // ASSERTION UNDER TEST — the cursor is still 0 (not advanced past seq 7
    // by the failed tick), so the un-cursored raw feed's same seq-7 event is
    // re-observed (`newOnes` still finds it, since lastEventSeqRef never
    // moved) and this time renders.
    await tick();
    expect(
      await screen.findByText(/= 17/i),
    ).toBeInTheDocument();
  });
});
