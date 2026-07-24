/**
 * STRUCT-006 (2026-07-24) — flag-OFF / SSE mirror.
 *
 * On the flag-OFF path (`DURABLE_GENERATION_ENABLED=false`) the client polls
 * `getSessionEventsRaw` instead of the durable `getSessionEventsPage`. The beat
 * classifier still runs post-delivery (narration.py background thread +
 * buffered) and writes `beat_resolved`, so a classifier-opened gate has the
 * same "invisible until reload" gap here. This pins that the flag-OFF poll
 * branch re-fetches grounding on a beat-ledger event, mirroring the durable
 * path (page.tsx flag-OFF branch of `poll`).
 *
 * The durable (prod) path is pinned in play.struct006-gate-refetch.test.tsx.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, Participant, Session } from '@/lib/api/types';

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

// Flag OFF for this whole file (the SSE / legacy poll path).
jest.mock('../../lib/config', () => ({
  DURABLE_GENERATION_ENABLED: false,
  OAUTH_ENABLED: false,
  CODEX_ENABLED: false,
}));

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

const PARTY: Participant[] = [{ username: 'leon', is_dm: false, character: null }];

function beatResolved(seq: number): EngineSessionEvent {
  return {
    seq,
    kind: 'beat_resolved',
    actor: 'leon',
    visibility: 'table',
    created_at: '2026-07-24T10:00:00Z',
    data: { scene: 'anchor_first_contact', beat: 'first_impression', source: 'classifier' },
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
  window.localStorage.clear();
  mockGetSession.mockResolvedValue(AI_SESSION);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([]); // rehydration + first poll: empty
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue({ checks: [], transitions: [] });
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
});

describe('STRUCT-006 flag-OFF poll — beat_resolved re-fetches grounding', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a poll carrying a beat_resolved event triggers a grounding re-fetch', async () => {
    render(<PlayPage />);
    await screen.findByText('Test Table');
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const baseline = mockGetGrounding.mock.calls.length;

    // The classifier resolves a beat post-delivery; the next legacy poll sees it.
    mockGetSessionEventsRaw.mockResolvedValue([beatResolved(5)]);
    await tick();

    expect(mockGetGrounding.mock.calls.length).toBe(baseline + 1);
  });
});
