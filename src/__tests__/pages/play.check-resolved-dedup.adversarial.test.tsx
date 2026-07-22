/**
 * F4/CHECK-DOUBLE-RENDER (WF-TAV-AUDIT-BATCH-2026-07-22 Pass P) —
 * onAttemptCheck's own event_seq-seeding fix (flag ON / DURABLE_GENERATION_
 * ENABLED only — the flag-OFF poll never appends `check_resolved` at all,
 * see play.checks-and-fork.test.tsx's own regression pin for that side).
 *
 * Coverage:
 *   1. The optimistic row from resolveCheck's own response renders exactly
 *      once, even after a durable poll tick re-delivers the SAME
 *      check_resolved event (same seq) — the seeded renderedSeqsRef entry
 *      makes reconcileDurableEvents' rule 1 skip the duplicate.
 *   2. event_seq null/absent (should not happen on the real wire, but the
 *      type allows it) degrades gracefully: the optimistic row still
 *      renders once, no crash, nothing seeded.
 *   3. Two different players' checks (different seqs) are not over-
 *      suppressed — seeding one seq must never swallow a genuinely
 *      different later event.
 */
import React from 'react';
import { render, screen, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type {
  EngineSessionEvent,
  EventsPage,
  GroundingData,
  Participant,
  Session,
} from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
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
const mockGetSessionEventsRaw = jest.fn<Promise<EngineSessionEvent[] | null>, unknown[]>(() =>
  Promise.resolve([]),
);
const mockGetSessionEventsPage = jest.fn<Promise<EventsPage>, unknown[]>(() =>
  Promise.resolve(EMPTY_PAGE),
);
const mockGetParticipants = jest.fn<Promise<Participant[]>, unknown[]>(() => Promise.resolve([]));
const mockGetGrounding = jest.fn<Promise<GroundingData | null>, unknown[]>(() =>
  Promise.resolve(null),
);
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockPostSessionEvent = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve({}));
const mockResolveCheck = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getSessionEventsPage: (...args: Parameters<AnyFn>) => mockGetSessionEventsPage(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postSessionEvent: (...args: Parameters<AnyFn>) => mockPostSessionEvent(...args),
  resolveCheck: (...args: Parameters<AnyFn>) => mockResolveCheck(...args),
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
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() =>
    Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' }),
  ),
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
  {
    username: 'leon',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Anomaly',
      char_class: 'Ranger',
      level: 1,
      current_hp: 10,
      max_hp: 10,
      ac: 13,
    },
  },
];

const GROUNDING: GroundingData = {
  scene_id: 'timberwolf',
  scene_name: 'The Timberwolf',
  boxed_text: 'Twigs snap somewhere close.',
  objective: 'Slip past or fight the timberwolf.',
  transitions: [],
  checks: [{ skill: 'stealth', dc: 12 }],
  flags: {},
  encounter_state: {},
};

function checkResolvedEvent(seq: number, description: string): EngineSessionEvent {
  return {
    seq,
    kind: 'check_resolved',
    actor: 'leon',
    created_at: '2026-07-14T09:01:00Z',
    data: { skill: 'stealth', dc: 12, success: true, description },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function tick() {
  await act(async () => {
    jest.advanceTimersByTime(4000);
  });
  await flush();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(SESSION);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([]);
  mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue(GROUNDING);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockPostSessionEvent.mockResolvedValue({});
  mockStreamDmNarration.mockImplementation(async function* () {
    yield { kind: 'done' as const };
  });
  // onAttemptCheck fires narrateDurableBeat (flag ON) with suppressIntent —
  // give it a real job handle + an immediately-done SSE tail so it settles
  // without crashing (mirrors play.ddx20-durable-turn.test.tsx's own setup).
  mockPostDmTurn.mockResolvedValue({
    job_id: 'job-check-1',
    turn_key: 'tk-check-1',
    status: 'pending',
    deduped: false,
  });
  mockSubscribeDmJob.mockImplementation(async function* () {
    yield { kind: 'done' as const };
  });
});

describe('F4/CHECK-DOUBLE-RENDER — flag-ON durable poll dedup', () => {
  it('optimistic row renders once; a poll tick re-delivering the SAME check_resolved event is deduped, not double-rendered', async () => {
    mockResolveCheck.mockResolvedValue({
      skill: 'stealth',
      dc: 12,
      total: 15,
      success: true,
      flag_set: [],
      mechanics: 'd20+3 = 15 vs DC 12',
      description: 'Anomaly slips past the timberwolf unseen.',
      event_seq: 42,
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');
      await flush();

      const stealthBtn = await screen.findByRole('button', { name: /Attempt Stealth/i });
      await act(async () => {
        stealthBtn.click();
      });
      await flush();

      const log = await screen.findByRole('log');
      expect(within(log).getAllByText(/slips past the timberwolf unseen/i)).toHaveLength(1);

      // The next durable poll tick re-delivers the SAME event (seq 42) —
      // e.g. the NekoNova proxy's own since_seq drop re-serving history.
      mockGetSessionEventsPage.mockResolvedValue({
        events: [checkResolvedEvent(42, 'Anomaly slips past the timberwolf unseen.')],
        max_seq: 42,
        has_more: false,
        pending_generation: null,
      });
      await tick();

      expect(within(log).getAllByText(/slips past the timberwolf unseen/i)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('event_seq null/absent degrades gracefully: the optimistic row still renders once, no crash', async () => {
    mockResolveCheck.mockResolvedValue({
      skill: 'stealth',
      dc: 12,
      total: 15,
      success: true,
      flag_set: [],
      mechanics: 'd20+3 = 15 vs DC 12',
      description: 'Anomaly slips past, seq unknown.',
      event_seq: null,
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');
      await flush();

      const stealthBtn = await screen.findByRole('button', { name: /Attempt Stealth/i });
      await act(async () => {
        stealthBtn.click();
      });
      await flush();

      const log = await screen.findByRole('log');
      expect(within(log).getAllByText(/seq unknown/i)).toHaveLength(1);

      // A poll tick with nothing new must not crash or duplicate anything.
      await tick();
      expect(within(log).getAllByText(/seq unknown/i)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('seeding one check\'s seq never suppresses a DIFFERENT later check_resolved event (different seq)', async () => {
    mockResolveCheck.mockResolvedValue({
      skill: 'stealth',
      dc: 12,
      total: 15,
      success: true,
      flag_set: [],
      mechanics: 'd20+3 = 15 vs DC 12',
      description: "Anomaly's own check resolves.",
      event_seq: 10,
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');
      await flush();

      const stealthBtn = await screen.findByRole('button', { name: /Attempt Stealth/i });
      await act(async () => {
        stealthBtn.click();
      });
      await flush();

      const log = await screen.findByRole('log');
      expect(within(log).getAllByText(/Anomaly's own check resolves/i)).toHaveLength(1);

      // A DIFFERENT player's check (seq 11, different description) arrives
      // via the poll — must render normally, not be swallowed by seq 10's seed.
      mockGetSessionEventsPage.mockResolvedValue({
        events: [checkResolvedEvent(11, "Twilight's own check resolves elsewhere.")],
        max_seq: 11,
        has_more: false,
        pending_generation: null,
      });
      await tick();

      expect(within(log).getAllByText(/Twilight's own check resolves elsewhere/i)).toHaveLength(1);
      // The first check's own row is still there too — nothing got clobbered.
      expect(within(log).getAllByText(/Anomaly's own check resolves/i)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
