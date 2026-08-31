/**
 * TAV-PLAY-CROSS-SESSION-BLEED — flag-OFF (production) regression test
 * (Ren-Dev, 2026-08-31, addressing Kage-CR's CHANGES REQUESTED CRITICAL).
 *
 * `play.cross-session-bleed.test.tsx` (the original regression suite) mocks
 * `DURABLE_GENERATION_ENABLED: true` in all four of its cases and drives the
 * `subscribeDmJob` path exclusively. Production ships with the flag OFF
 * (`src/lib/config.ts` — `DURABLE_GENERATION_ENABLED = false`), where
 * `onSend` calls `narrate()` (page.tsx) instead, and a non-streamMode beat's
 * chat row is painted by `revealText`'s client-side 26ms `setInterval`
 * typewriter (page.tsx), not by SSE deltas. That interval is NOT tied to
 * `narrationAbort` — aborting the fetch does not stop an already-scheduled
 * tick. This is exactly the gap that let the shipped
 * `streamRowIdRef.current = null;` line in the `[sessionId]`-keyed cleanup
 * effect cause the live bleed instead of preventing it: on a switch, a
 * pending tick's `upsertStreamNarration` call found no existing id (the ref
 * had just been nulled) and took the create-a-new-row branch, appending the
 * OUTGOING session's prose straight into the NEW session's log.
 *
 * Fix (page.tsx, `[sessionId]` cleanup effect): stop nulling
 * `streamRowIdRef` there, and instead clear the `revealRef` interval itself
 * (mirroring the existing unmount cleanup) so no stray tick can fire at all
 * after a switch.
 *
 * This test reproduces the exact production path the CRITICAL slipped
 * through on: flag OFF, `narrate()`, buffered (non-streamMode) beat,
 * `revealText`'s real un-mocked interval (reduced motion is explicitly
 * mocked FALSE to keep the interval path active rather than the
 * reduced-motion instant-paint branch).
 *
 * Verified failing without the fix: with the CRITICAL fix reverted (cleanup
 * restores `streamRowIdRef.current = null;` and no `revealRef` clear), this
 * test fails — "Table A" prose renders into Table B's log after the switch.
 */
import React from 'react';
import { render, screen, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, EventsPage, Participant, Session } from '@/lib/api/types';

let mockSessionId = 's1';
jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: mockSessionId }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }),
}));

// NOT reduced — this is what enables revealText's 26ms setInterval typewriter
// (the buffered/non-streamMode path this test targets).
jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

// config is deliberately left UNMOCKED here: DURABLE_GENERATION_ENABLED
// reads its real, shipped `false` value from src/lib/config.ts, so onSend
// takes the flag-OFF branch (narrate()) — the actual production path.

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
const mockPostSessionEvent = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve({}));

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

// narrate()'s flag-OFF beat drives streamDmNarration (not subscribeDmJob).
const mockStreamDmNarration = jest.fn();
jest.mock('../../lib/stream', () => ({
  streamDmNarration: (...args: Parameters<AnyFn>) => mockStreamDmNarration(...args),
  postDmTurn: jest.fn(),
  subscribeDmJob: jest.fn(),
}));

import PlayPage from '@/app/play/[sessionId]/page';

function makeSession(id: string, name: string): Session {
  return {
    session_id: id,
    channel: 'test_channel',
    name,
    status: 'active',
    dm_username: 'suzu',
    dm_mode: 'ai',
    ai_assist_level: 'full',
    active_combat_id: null,
  };
}

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

async function sendMessage(text: string) {
  const input = screen.getByRole('textbox');
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockSessionId = 's1';
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([]);
  mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockPostSessionEvent.mockResolvedValue({});
});

describe('TAV-PLAY-CROSS-SESSION-BLEED (flag OFF): revealText\'s 26ms interval does not survive a same-instance session switch', () => {
  it('does not paint the OUTGOING session\'s buffered narration into the new session\'s log', async () => {
    const SESSION_A = makeSession('s1', 'Table A');
    const SESSION_B = makeSession('s2', 'Table B');

    mockGetSession.mockImplementation((...args: unknown[]) =>
      Promise.resolve(args[0] === 's2' ? SESSION_B : SESSION_A),
    );

    // Buffered / non-streamMode beat: narrate()'s `else` branch drives
    // revealText(full), not per-chunk SSE deltas. Hold the generator open so
    // it is still "in flight" (mirroring the live incident) at the moment of
    // the switch.
    mockStreamDmNarration.mockImplementation(async function* () {
      yield {
        kind: 'chunk',
        text: 'GHOUL LUNGES FROM TABLE A THROUGH THE BROKEN DOOR NOW',
      };
      await new Promise<void>(() => {}); // stream stays open across the switch
    });

    const { rerender } = render(<PlayPage />);
    await screen.findByText('Table A');

    await sendMessage('I ready my blade.');
    await flush();
    // Let a couple of typewriter ticks land so streamRowIdRef/revealRef are
    // both populated and actively mid-reveal — matching the live window.
    await wait(60);

    // ── the switch: SAME component instance, sessionId prop changes ────────
    mockSessionId = 's2';
    mockGetSessionEventsRaw.mockResolvedValue([]);
    mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
    rerender(<PlayPage />);
    await screen.findByText('Table B');
    await flush();

    // Let the interval keep ticking well past the switch — if it wasn't
    // cleared, it will have painted the rest of Table A's prose by now.
    await wait(500);

    const log = await screen.findByRole('log');
    expect(within(log).queryByText(/GHOUL LUNGES FROM TABLE A/)).not.toBeInTheDocument();
  });
});
