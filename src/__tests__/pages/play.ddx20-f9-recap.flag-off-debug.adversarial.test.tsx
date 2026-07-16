/**
 * DDX-20 F9 + Recap Design (6e027cf) — Miko-QA break-it pass, part 2.
 *
 * Companion to play.ddx20-f9-recap.adversarial.test.tsx. Separate file
 * because it needs the REAL `lib/config` module at its shipped default
 * (DURABLE_GENERATION_ENABLED: false) — incompatible with the sibling file's
 * top-level `jest.mock('../../lib/config', () => ({ ... true }))`.
 *
 * The commit adds two new `console.debug` calls (`ledger_seeded_from_rehydration`
 * in the mount rehydration effect, `poll_page_redundant` inside `pollDurable`).
 * Both are structurally gated behind `DURABLE_GENERATION_ENABLED` (the first by
 * an explicit `if`, the second by living inside `pollDurable`, which `poll()`
 * only ever calls behind its own flag check) — verified by direct code
 * reading, not just convention. The existing flag-off dormancy suite
 * (play.ddx20-flag-off-dormancy.test.tsx) never spies on `console.debug` at
 * all, so it would not catch a future refactor that accidentally moved either
 * call outside its gate. This is that tripwire.
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, Participant, Session } from '@/lib/api/types';
import { DURABLE_GENERATION_ENABLED } from '@/lib/config';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'sess-ddx20-flagoff-debug' }),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsRaw = jest.fn<Promise<EngineSessionEvent[] | null>, unknown[]>(() =>
  Promise.resolve([]),
);
const mockGetSessionEventsPage = jest.fn<Promise<unknown>, unknown[]>();
const mockGetParticipants = jest.fn<Promise<Participant[]>, unknown[]>(() => Promise.resolve([]));
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockPostSessionEvent = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve({}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  // DDX-20 — must NEVER be called while the flag is off.
  getSessionEventsPage: (...args: Parameters<AnyFn>) => mockGetSessionEventsPage(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postRoll: jest.fn(),
  postSessionEvent: (...args: Parameters<AnyFn>) => mockPostSessionEvent(...args),
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
  session_id: 'sess-ddx20-flagoff-debug',
  channel: 'test_table',
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
      name: 'Velka',
      char_class: 'Rogue',
      level: 3,
      current_hp: 18,
      max_hp: 20,
      ac: 14,
    },
  },
];

const HISTORY: EngineSessionEvent[] = [
  { seq: 1, kind: 'session_start', created_at: '2026-07-14T09:00:00Z', data: {} },
  {
    seq: 2,
    kind: 'player_action',
    actor: 'leon',
    created_at: '2026-07-14T09:01:00Z',
    data: { who: 'leon', text: 'I light a candle.', turn_key: 'tk-old-1' },
  },
  {
    seq: 3,
    kind: 'recap',
    created_at: '2026-07-14T09:01:10Z',
    data: { who: 'Suzu', text: 'Previously, the tide rose fast.' },
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
  mockGetSession.mockResolvedValue(SESSION);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([...HISTORY]);
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
});

describe('QA break-it — flag-OFF console.debug tripwire (HARD REQUIREMENT #1 extension)', () => {
  it('the flag itself is false (shipped default) — precondition for this whole file', () => {
    expect(DURABLE_GENERATION_ENABLED).toBe(false);
  });

  it('ledger_seeded_from_rehydration and poll_page_redundant never fire across mount + repeated poll ticks', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      jest.useFakeTimers();
      try {
        render(<PlayPage />);
        await screen.findByText('Test Table');
        await flush();

        // Several ticks — the flag-off poll (getSessionEventsRaw, full
        // refetch of the SAME repeated history) is exactly the shape that
        // would trip `poll_page_redundant` if pollDurable's branch were ever
        // reached accidentally.
        for (let i = 0; i < 3; i += 1) {
          await act(async () => {
            jest.advanceTimersByTime(4000);
          });
          await flush();
        }

        // Also open the journal — touches the same journalEvents state the
        // flag-ON merge logic writes to, from a different (legacy) code path.
        const toggle = screen.queryByRole('button', { name: 'Open journal' });
        if (toggle) {
          fireEvent.click(toggle);
          await flush();
        }

        const calls = debugSpy.mock.calls.map((c) => c[0]);
        expect(calls).not.toContain('ledger_seeded_from_rehydration');
        expect(calls).not.toContain('poll_page_redundant');
        // getSessionEventsPage (the cursor endpoint) must never be reached
        // either — same invariant the dormancy suite already locks, repeated
        // here so a debug-tell regression and a wrong-endpoint regression are
        // both visible from one failing assertion block.
        expect(mockGetSessionEventsPage).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    } finally {
      debugSpy.mockRestore();
    }
  });
});
