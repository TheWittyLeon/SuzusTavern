/**
 * TAV-EVENTS-FEED-FROZEN-PAST-200 — past 200 events the play page read only the
 * campaign's OLDEST 200 rows, forever: a reload rebuilt only the opening of the
 * story, and the flag-OFF events poll (which filtered that fixed list by
 * seq > watermark) never saw a new dice row / safety signal again.
 *
 * `fakeEngine` below behaves like the real GET /events route: ascending,
 * rows with seq > since_seq, `limit` capped at 500, and an UNPARAMETERISED
 * request (no since_seq) gets the engine default of the oldest 200.
 */
import { screen, act, fireEvent } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, Participant, Session } from '@/lib/api/types';

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

const mockGetSessionEventsRaw = jest.fn<Promise<EngineSessionEvent[] | null>, unknown[]>();
// SessionRecap (mounted unconditionally by the play page) fetches this once
// at mount via its own effect — used below purely as a settle signal for
// baselining, same role play.ddx25-r3-recap-poll-churn.test.tsx uses
// mockStreamDmNarration for.
const mockGetSessionEvents = jest.fn<Promise<unknown[] | null>, unknown[]>(() =>
  Promise.resolve([]),
);

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: (...args: unknown[]) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: unknown[]) => mockGetSessionEventsRaw(...args),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
  getCombatState: jest.fn(() => Promise.resolve(null)),
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
  bindCharacter: jest.fn(() =>
    Promise.resolve({ campaign_id: 's1', username: 'alice', role: 'player', character_id: null }),
  ),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  // DDX-22 Phase 3: JournalPane mounts (drawer open / mobile tab active) and
  // GETs the caller's own note — a one-shot fetch on open, NOT a new poll (see
  // the second test below, which opens the drawer and confirms no additional
  // 4s-poll commits are introduced by it).
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

// Same object REFERENCE resolved on every call (mockResolvedValue, not a
// factory) — isolates this test to the events/journal poll: the sibling
// session-status poll's own sessionsEqual gate trivially passes on an
// identical reference, so it never contributes an extra commit here.
const SESSION: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['alice'],
  player_count: 1,
  active_combat_id: null,
  dm_mode: 'ai',
};
const PARTY: Participant[] = [{ username: 'alice', is_dm: false, character: null }];

const TOTAL = 1200; // > 200 (the engine default) and > 2 pages of 500
let campaign: EngineSessionEvent[] = [];

const fakeEngine = (...args: unknown[]) => {
  const sinceSeq = args[2] as number | undefined;
  const limit = sinceSeq === undefined ? 200 : 500;
  return Promise.resolve(
    campaign.filter((e) => (e.seq ?? 0) > (sinceSeq ?? 0)).slice(0, limit),
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  campaign = Array.from({ length: TOTAL }, (_, i) => ({
    seq: i + 1,
    kind: 'narration',
    actor: 'suzu',
    data: { text: `story line ${i + 1}.` },
  }));
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockImplementation(fakeEngine);
});

describe('TAV-EVENTS-FEED-FROZEN-PAST-200', () => {
  it('a mount rebuilds the WHOLE story of a >200-event campaign, not just the opening', async () => {
    renderPlay(<PlayPage />);
    expect(await screen.findByText('story line 1200.')).toBeInTheDocument();
    expect(screen.getByText('story line 1.')).toBeInTheDocument();
    expect(screen.getByText('story line 500.')).toBeInTheDocument();
    expect(screen.getByText('story line 501.')).toBeInTheDocument();
  });

  it('a new event past the 200 cap reaches the log on the next poll tick', async () => {
    jest.useFakeTimers();
    try {
      renderPlay(<PlayPage />);
      expect(await screen.findByText('story line 1200.')).toBeInTheDocument();

      campaign.push({ seq: TOTAL + 1, kind: 'x_card', actor: 'bob', data: {} });
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getAllByText(/A safety signal was raised/).length).toBeGreaterThan(0);
      // The poll asked only for rows past its watermark, never from zero.
      const sinceArgs = mockGetSessionEventsRaw.mock.calls.map((c) => c[2]);
      expect(sinceArgs[sinceArgs.length - 1]).toBe(TOTAL);
    } finally {
      jest.useRealTimers();
    }
  });

  it('the journal keeps the earlier story when a poll tick brings only the new rows', async () => {
    jest.useFakeTimers();
    try {
      campaign = [
        { seq: 1, kind: 'recap', data: { text: 'Previously, the tide rose.', who: 'Suzu' } },
        ...Array.from({ length: 599 }, (_, i) => ({
          seq: i + 2,
          kind: 'narration',
          data: { text: `filler ${i + 2}.` },
        })),
      ];
      renderPlay(<PlayPage />);
      expect(await screen.findByText('filler 600.')).toBeInTheDocument();

      campaign.push({ seq: 601, kind: 'x_card', data: {} });
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      const toggle = screen.getByRole('button', { name: 'Open journal' });
      toggle.focus();
      fireEvent.click(toggle);
      expect(await screen.findByText(/Previously, the tide rose\./)).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
