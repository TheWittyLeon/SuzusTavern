/**
 * DDX-25 R3 — HIGH regression fix pass (found via live browser verification).
 *
 * D1's session-status poll (see play.ddx25-session-controls-adversarial.test.tsx,
 * ADV-4) calls setSession(freshlyDeserializedObject) every ~4s so a pause/
 * resume/end by the DM converges on every open tab. Even when NOTHING
 * changed, that gave `session` a brand-new object identity every tick.
 * SessionRecap's two effects depended on the WHOLE `session` object, so they
 * re-fired on every poll tick — the second one re-issuing a REAL LLM-backed
 * `streamDmNarration` ("previously on" recap) every ~4s per viewer,
 * indefinitely. Live-observed: 20+ repeated recap requests spamming the chat
 * transcript, scaling with concurrent viewers — a direct hit to inference
 * cost and to the "Suzu is your DM" transcript experience.
 *
 * This file locks BOTH halves of the fix:
 *   R3-1  sessionsEqual() — the pure structural-equality predicate the poll
 *         now gates setSession() on. A no-op tick (content-identical but
 *         freshly-deserialized) must compare equal; a genuine field change
 *         must not.
 *   R3-2  End-to-end: with the fetched session hander back a fresh object
 *         every tick (the real-world shape of the bug), the "previously on"
 *         recap must still fire exactly once across many poll ticks.
 *
 * Existing DDX-25 suites already lock D1 cross-tab convergence (ADV-4) and
 * the double-submit latches (ADV-5/5b/D5) — this file only adds the coverage
 * live testing exposed as missing, it doesn't repeat those.
 */
import React, { Profiler } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockUsername = 'bob';
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: mockUsername, email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>();
const mockGetSessionEventsRaw = jest.fn<Promise<unknown[] | null>, unknown[]>(() => Promise.resolve(null));
const mockGetParticipants = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve([]));
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postSessionEvent: jest.fn(() => Promise.resolve({ seq: 1 })),
  pauseSession: jest.fn(() => Promise.resolve({ message: 'ok' })),
  resumeSession: jest.fn(() => Promise.resolve({ message: 'ok' })),
  endSession: jest.fn(() => Promise.resolve({ message: 'ok' })),
  awardSessionXp: jest.fn(() => Promise.resolve({ message: 'ok' })),
  npcAction: jest.fn(),
  combatFromScene: jest.fn(),
  rollInitiative: jest.fn(),
  monsterTurn: jest.fn(),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  resolveCheck: jest.fn(),
  setFlag: jest.fn(),
  bindCharacter: jest.fn(() =>
    Promise.resolve({ campaign_id: 's1', username: 'bob', role: 'player', character_id: null }),
  ),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
}));

const mockStreamDmNarration = jest.fn(async function* mockStream(..._args: unknown[]) {
  // yields nothing — tests only care whether/how-often this was called.
});
jest.mock('../../lib/stream', () => ({
  streamDmNarration: (...args: Parameters<AnyFn>) => mockStreamDmNarration(...args),
}));

import PlayPage, { sessionsEqual } from '@/app/play/[sessionId]/page';
import type { Session, Participant } from '@/lib/api/types';

const BASE_SESSION: Session = {
  session_id: 's1',
  channel: 'test_channel',
  name: 'The Hollow Tide',
  dm_username: 'dm_alice',
  dm_mode: 'ai',
  ai_assist_level: 'full',
  status: 'active',
  active_combat_id: null,
};

const PARTY: Participant[] = [
  { username: 'dm_alice', is_dm: true, character: null },
  { username: 'bob', is_dm: false, character: null },
];

function setup() {
  jest.clearAllMocks();
  // Real play history so SessionRecap's `fromEvents` gate is satisfied and
  // the LLM recap path is actually reachable (mirrors SessionRecap.test.tsx).
  mockGetSessionEvents.mockResolvedValue([
    { event_type: 'scene_advance', description: 'The party fled the rising tide.' },
  ]);
  mockGetParticipants.mockResolvedValue(PARTY);
}

describe('DDX-25 R3 — sessionsEqual (root-cause predicate for the session poll)', () => {
  it('treats a content-identical-but-freshly-deserialized object as equal', () => {
    const a: Session = { ...BASE_SESSION };
    const b: Session = JSON.parse(JSON.stringify(BASE_SESSION)); // new identity, same content
    expect(a).not.toBe(b);
    expect(sessionsEqual(a, b)).toBe(true);
  });

  it('is insensitive to key order (defends against field-order drift across responses)', () => {
    const reordered = Object.fromEntries(Object.entries(BASE_SESSION).reverse()) as Session;
    expect(sessionsEqual(BASE_SESSION, reordered)).toBe(true);
  });

  it('detects a genuine status change (must still converge pause/resume/end)', () => {
    expect(sessionsEqual(BASE_SESSION, { ...BASE_SESSION, status: 'paused' })).toBe(false);
  });

  it('detects a genuine xp_pool change', () => {
    expect(sessionsEqual(BASE_SESSION, { ...BASE_SESSION, xp_pool: 300 })).toBe(false);
  });

  it('handles null/undefined without throwing', () => {
    expect(sessionsEqual(null, null)).toBe(true);
    expect(sessionsEqual(undefined, undefined)).toBe(true);
    expect(sessionsEqual(null, BASE_SESSION)).toBe(false);
    expect(sessionsEqual(BASE_SESSION, null)).toBe(false);
    expect(sessionsEqual(BASE_SESSION, undefined)).toBe(false);
  });
});

describe('DDX-25 R3 — no-op session-status poll ticks must not re-fire the recap', () => {
  it('the "previously on" recap fires exactly once across MULTIPLE poll ticks that each hand back a fresh-but-unchanged session object', async () => {
    jest.useFakeTimers();
    try {
      setup();
      // Every call (mount fetch + every poll tick) resolves a BRAND NEW
      // object with identical content — the exact real-world shape of the
      // bug: `getSession` always deserializes a fresh object from
      // `fetch().json()`, even when the server has nothing new to report.
      mockGetSession.mockImplementation(() => Promise.resolve({ ...BASE_SESSION }));

      render(<PlayPage />);
      await screen.findByText('The Hollow Tide');
      await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(1));

      // Let the recap's own async chain fully settle (getSessionEvents ->
      // buildRecap -> streamDmNarration) before advancing the poll. `waitFor`
      // (not a fixed microtask-count flush) mirrors the ADV-4 pattern above,
      // which already proves this resolves correctly under fake timers.
      await waitFor(() => expect(mockStreamDmNarration).toHaveBeenCalledTimes(1));

      // Four more no-op poll cycles (~16s) — nothing server-side ever changes.
      for (let i = 0; i < 4; i += 1) {
        await act(async () => {
          jest.advanceTimersByTime(4000);
        });
      }

      // 1 mount fetch + 4 poll ticks all resolved.
      expect(mockGetSession).toHaveBeenCalledTimes(5);
      // The recap must still have fired exactly once — this is the DDX-25 R3
      // regression: before the fix, each tick hands `session` a new identity,
      // SessionRecap's effects re-fire, and this assertion would see 5.
      expect(mockStreamDmNarration).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a no-op poll tick does not even commit a re-render of the page — proves the poll itself skips setSession, not merely that a downstream consumer shields it', async () => {
    // SessionRecap's own session_id-primitive dependency already stops ITS
    // effects from re-running when only `session`'s object identity changes,
    // which would make the previous test pass even if the poll's own
    // setSession() gate were silently un-wired. This test uses React's
    // Profiler to observe the page's actual commit count directly, so it
    // fails specifically if the poll ever goes back to calling setSession()
    // unconditionally — independent of any consumer-side hardening.
    jest.useFakeTimers();
    try {
      setup();
      mockGetSession.mockImplementation(() => Promise.resolve({ ...BASE_SESSION }));
      const onRender = jest.fn();

      render(
        <Profiler id="play-r3-wiring-probe" onRender={onRender}>
          <PlayPage />
        </Profiler>,
      );
      await screen.findByText('The Hollow Tide');
      // Wait for the recap's async chain to fully settle before taking the
      // "settled" commit-count baseline, same rationale as the test above.
      await waitFor(() => expect(mockStreamDmNarration).toHaveBeenCalledTimes(1));
      // Flush any leftover scheduling from waitFor's own internal (fake-timer
      // aware) polling loop before baselining the commit count — otherwise
      // its last in-flight check can land inside the monitored window below
      // and read as a false-positive "extra" commit unrelated to the poll
      // (empirically confirmed: with this flush, the commit count is flat
      // all the way through, including across the real poll tick at t=4000).
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      const commitsAfterMount = onRender.mock.calls.length;

      // Two no-op poll cycles — the combat-state poll never starts (no
      // active_combat_id on BASE_SESSION), so the session-status poll is the
      // only periodic activity in flight here.
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });

      expect(mockGetSession.mock.calls.length).toBeGreaterThanOrEqual(3); // mount + 2 ticks
      expect(onRender.mock.calls.length).toBe(commitsAfterMount);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a later GENUINE status change still converges (D1 preserved) without re-firing the already-fired recap', async () => {
    jest.useFakeTimers();
    try {
      setup();
      // Mount + one no-op tick see 'active'; the tick after that reports the
      // DM's real pause.
      mockGetSession
        .mockResolvedValueOnce({ ...BASE_SESSION })
        .mockResolvedValueOnce({ ...BASE_SESSION })
        .mockResolvedValue({ ...BASE_SESSION, status: 'paused' });

      render(<PlayPage />);
      await screen.findByText('The Hollow Tide');
      await waitFor(() => expect(mockStreamDmNarration).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(/Session paused by the DM/i)).not.toBeInTheDocument();

      // Tick 1: no-op (still 'active').
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      expect(screen.queryByText(/Session paused by the DM/i)).not.toBeInTheDocument();

      // Tick 2: genuine change to 'paused' — D1 convergence must still work.
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      expect(screen.getByText(/Session paused by the DM/i)).toBeInTheDocument();

      // The pause must NOT have re-triggered a second "previously on" recap.
      expect(mockStreamDmNarration).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
