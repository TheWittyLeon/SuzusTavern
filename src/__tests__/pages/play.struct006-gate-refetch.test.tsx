/**
 * STRUCT-006 (2026-07-24) — a classifier-opened anti-skip gate must appear
 * WITHOUT a page reload.
 *
 * The beat classifier resolves required beats AFTER the narration turn is
 * delivered and writes `beat_resolved` (source=classifier) / `beat_done` /
 * `beat_override` session events (all visibility="table"). Resolving the last
 * unmet required beat opens a previously-hidden gate: a new exit + its check
 * appear in grounding WITHOUT the scene cursor advancing. Before the fix the
 * durable events poll only re-fetched grounding on `scene_advance`, so a
 * classifier-opened gate stayed invisible until a manual reload.
 *
 * This file pins the DURABLE path (`DURABLE_GENERATION_ENABLED=true`, the prod
 * path — durable generation is ON on staging/prod). It mirrors the existing
 * `scene_advance` re-fetch behavior in the durable events poll (page.tsx
 * ~line 1520): an events poll carrying a beat-ledger event triggers a grounding
 * re-fetch; an unrelated event (dice_roll) does NOT.
 *
 * The flag-OFF/SSE mirror lives in play.struct006-gate-refetch.flag-off.test.tsx.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, EventsPage, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

// DURABLE_GENERATION_ENABLED is read once at import time — fixed true for this
// whole file (the prod path). Mirrors play.ddx20-durable-turn.test.tsx.
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
const mockGetSessionEventsRaw = jest.fn<Promise<EngineSessionEvent[] | null>, unknown[]>(() =>
  Promise.resolve([]),
);
const mockGetSessionEventsPage = jest.fn<Promise<EventsPage>, unknown[]>(() =>
  Promise.resolve(EMPTY_PAGE),
);
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
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
  postDmTurn: jest.fn(),
  subscribeDmJob: jest.fn(),
}));

import PlayPage from '@/app/play/[sessionId]/page';

const AI_SESSION: Session = {
  session_id: 's1',
  channel: 'test_channel',
  name: 'Test Table',
  status: 'active',
  dm_username: 'suzu',
  dm_mode: 'ai',
  ai_assist_level: 'full',
  active_combat_id: null,
};

const PARTY: Participant[] = [
  { username: 'leon', is_dm: false, character: null },
];

function beatEvent(seq: number, kind: string): EngineSessionEvent {
  return {
    seq,
    kind,
    actor: 'leon',
    visibility: 'table',
    created_at: '2026-07-24T10:00:00Z',
    data: { scene: 'anchor_first_contact', beat: 'first_impression', source: 'classifier' },
  };
}

function pageWith(...events: EngineSessionEvent[]): EventsPage {
  const maxSeq = events.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
  return { events, max_seq: maxSeq, has_more: false, pending_generation: null };
}

/** Advance one poll cycle (4s) then flush the async pollDurable microtasks. */
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
  window.localStorage.clear();
  mockGetSession.mockResolvedValue(AI_SESSION);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([]); // rehydration: no prior events
  mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue({ checks: [], transitions: [] });
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
});

async function mountAndSettle(): Promise<number> {
  render(<PlayPage />);
  await screen.findByText('Test Table');
  // Let the mount-time grounding fetch + first (empty) poll settle before
  // baselining, mirroring the DDX-22 poll-churn test's baselining step.
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return mockGetGrounding.mock.calls.length;
}

describe('STRUCT-006 durable poll — a beat-ledger event re-fetches grounding', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // The classifier path (beat_resolved) is the load-bearing one; beat_done and
  // beat_override cover the operator CLI / reopen paths; scene_advance is the
  // pre-existing behavior this fix generalizes and must NOT regress.
  it.each(['beat_resolved', 'beat_done', 'beat_override', 'scene_advance'])(
    'a poll carrying a %s event triggers exactly one grounding re-fetch',
    async (kind) => {
      const baseline = await mountAndSettle();

      // Next poll tick delivers a fresh beat-ledger event (seq 5 > the seeded 0).
      mockGetSessionEventsPage.mockResolvedValue(pageWith(beatEvent(5, kind)));
      await tick();

      expect(mockGetGrounding.mock.calls.length).toBe(baseline + 1);

      // The same event on a subsequent tick is seq-deduped (journalSeenSeqsRef)
      // → no redundant re-fetch.
      await tick();
      expect(mockGetGrounding.mock.calls.length).toBe(baseline + 1);
    },
  );

  it('a poll carrying only an unrelated event (dice_roll) does NOT re-fetch grounding', async () => {
    const baseline = await mountAndSettle();

    mockGetSessionEventsPage.mockResolvedValue(
      pageWith({
        seq: 5,
        kind: 'dice_roll',
        actor: 'leon',
        visibility: 'table',
        created_at: '2026-07-24T10:00:00Z',
        data: { notation: '1d20', total: 14 },
      }),
    );
    await tick();

    expect(mockGetGrounding.mock.calls.length).toBe(baseline);
  });
});
