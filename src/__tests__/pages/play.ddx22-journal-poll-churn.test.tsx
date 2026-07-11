/**
 * DDX-22 Phase 0 review-fix — journal poll-churn re-render (Miko).
 *
 * The dice-roll/events poll (~4s, see the effect just above the "DDX-22"
 * comment in page.tsx) used to call
 * `setJournalEvents([...events].sort(...))` unconditionally, BEFORE the
 * existing `if (newOnes.length === 0) return;` no-op guard. `getSessionEventsRaw`
 * has no "since seq" filter — every tick refetches the FULL event list from a
 * fresh `fetch().json()`, so even a completely content-identical tick handed
 * back a brand-new array reference, and `setJournalEvents(newArray)` always
 * commits a re-render (React's bailout only skips on `Object.is` identity,
 * never shallow/deep equality). That re-rendered the whole PlayPage and
 * re-ran all 3 JournalPane derivations (deriveQuestTrail/deriveRecapHistory/
 * deriveNpcsMet) every ~4s, forever, even when nothing happened server-side.
 *
 * This mirrors DDX-25 R3's own regression-test shape
 * (play.ddx25-r3-recap-poll-churn.test.tsx) — a React Profiler proves the
 * page's actual commit count stays flat across several no-op poll ticks,
 * rather than merely asserting on a downstream consumer that might mask a
 * still-broken poll. Also mirrors that file's "wait for a concrete signal,
 * then a defensive extra flush" baselining trick — SessionRecap's own
 * mount-time `getSessionEvents` fetch settles asynchronously and must be
 * fully drained BEFORE the commit-count baseline is captured, or it gets
 * misattributed to the first poll tick below.
 */
import React, { Profiler } from 'react';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
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

const EVENTS: EngineSessionEvent[] = [
  { seq: 1, kind: 'scene_advance', data: { description: 'The party enters the cave.' } },
];

describe('DDX-22 review-fix — journal poll must not re-render on a no-op tick', () => {
  it('a repeated, content-identical events list does not commit an extra render', async () => {
    jest.useFakeTimers();
    try {
      jest.clearAllMocks();
      mGetSession.mockResolvedValue(SESSION);
      mGetParticipants.mockResolvedValue(PARTY);
      mockGetSessionEvents.mockResolvedValue([]);
      // A BRAND NEW array (fresh reference) on every call, identical content —
      // the exact real-world shape of the bug (GET /events has no "since seq"
      // filter; every tick refetches the full list from a fresh response).
      mockGetSessionEventsRaw.mockImplementation(() => Promise.resolve([...EVENTS]));

      const onRender = jest.fn();
      render(
        <Profiler id="play-ddx22-journal-poll-probe" onRender={onRender}>
          <PlayPage />
        </Profiler>,
      );
      await screen.findByText('The Hollow Tide');

      // Let SessionRecap's own mount-time fetch (getSessionEvents -> setRecap)
      // fully settle before baselining the commit count — same rationale as
      // DDX-25 R3's identical baselining step.
      await waitFor(() => expect(mockGetSessionEvents).toHaveBeenCalled());
      // Flush any leftover scheduling from waitFor's own internal (fake-timer
      // aware) polling loop before baselining — otherwise its last in-flight
      // check can land inside the monitored window below and read as a
      // false-positive "extra" commit unrelated to the poll (empirically
      // confirmed against this exact file).
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      const commitsAfterMount = onRender.mock.calls.length;

      // Three more no-op poll cycles (~12s) — same content, fresh reference.
      // Two-step act() per tick (advance, then a separate microtask flush)
      // mirrors play.ddx08-dice-roll.test.tsx's own proven-reliable pattern
      // for this exact poll.
      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          jest.advanceTimersByTime(4000);
        });
        await act(async () => {
          await Promise.resolve();
        });
      }

      expect(mockGetSessionEventsRaw.mock.calls.length).toBeGreaterThanOrEqual(4); // mount + 3 ticks
      // This is the DDX-22 regression: before the fix, each of the 3 ticks
      // above calls setJournalEvents(freshArray) unconditionally, and this
      // assertion would see 3 extra commits over the baseline.
      expect(onRender.mock.calls.length).toBe(commitsAfterMount);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a tick with a genuinely NEW event still updates the journal (the fix does not over-suppress)', async () => {
    jest.useFakeTimers();
    try {
      jest.clearAllMocks();
      mGetSession.mockResolvedValue(SESSION);
      mGetParticipants.mockResolvedValue(PARTY);
      mockGetSessionEvents.mockResolvedValue([]);
      mockGetSessionEventsRaw.mockResolvedValue([...EVENTS]);

      render(<PlayPage />);
      await screen.findByText('The Hollow Tide');

      // A genuinely new recap event arrives on the next tick.
      mockGetSessionEventsRaw.mockResolvedValue([
        ...EVENTS,
        { seq: 2, kind: 'recap', data: { text: 'Previously, the tide rose fast.', who: 'Suzu' } },
      ]);

      await act(async () => {
        jest.advanceTimersByTime(4000);
      });

      // Prove the journal actually absorbed the new event — open the drawer
      // and check the recap section, rather than just asserting a call count.
      const toggle = screen.getByRole('button', { name: 'Open journal' });
      toggle.focus();
      fireEvent.click(toggle);

      expect(await screen.findByText(/Previously, the tide rose fast\./)).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
