/**
 * TAV-PLAY-CROSS-SESSION-BLEED regression test (Ren-Dev, 2026-08-31).
 *
 * The live incident: `/play` rendered a DIFFERENT same-account campaign's
 * live state for ~roughly 2 minutes. Root cause: PlayPage reads `sessionId`
 * via `useParams()` and takes no props, so on a same-instance `sessionId`
 * change (React reconciles it as the SAME component instance — see
 * play.rehydration.session-switch-staleness.adversarial.test.tsx for the
 * sibling proof of that mechanism), the DM-narration SSE tail's
 * `AbortController` (`narrationAbort`, page.tsx) was only ever reassigned
 * when a NEW stream started, never aborted on a session switch. An in-flight
 * narration stream from the OUTGOING session kept resolving chunks into
 * setState calls that landed on whatever session the persisted instance was
 * now rendering — for as long as that generation kept running (a real LLM
 * narration tail can run close to the reported ~2 minutes).
 *
 * Fix: a `useEffect(() => () => {...}, [sessionId])` cleanup in page.tsx
 * aborts `narrationAbort` (and resets the sibling session-scoped refs) the
 * instant `sessionId` changes — cleanup runs BEFORE the new session's load
 * effect body, so nothing from the outgoing session's stream can land after
 * the switch.
 *
 * This test proves BOTH halves:
 *   1. The abort signal passed to `subscribeDmJob` for the OUTGOING
 *      session's job is actually aborted after the switch (the mechanism).
 *   2. A chunk that arrives on that outgoing stream AFTER the switch never
 *      renders into the (now session-B) transcript (the observable
 *      guarantee — this is the actual "bleed" a user would see).
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

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

// Flag-ON: reuses the exact subscribeDmJob/postDmTurn contract already
// proven in play.ddx20-durable-turn.test.tsx. The cleanup this test locks
// is flag-agnostic (narrationAbort is aborted regardless of
// DURABLE_GENERATION_ENABLED), but flag-ON gives a real, controllable SSE
// tail to assert against instead of a synthetic stand-in.
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

const mockStreamDmNarration = jest.fn();
const mockPostDmTurn = jest.fn();
const mockSubscribeDmJob = jest.fn();

jest.mock('../../lib/stream', () => ({
  streamDmNarration: (...args: Parameters<AnyFn>) => mockStreamDmNarration(...args),
  postDmTurn: (...args: Parameters<AnyFn>) => mockPostDmTurn(...args),
  subscribeDmJob: (...args: Parameters<AnyFn>) => mockSubscribeDmJob(...args),
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

describe('TAV-PLAY-CROSS-SESSION-BLEED: an in-flight DM-narration SSE tail is aborted on a same-instance session switch', () => {
  it('aborts the OUTGOING session job\'s signal, and a chunk delivered after the switch never reaches the transcript', async () => {
    const SESSION_A = makeSession('s1', 'Table A');
    const SESSION_B = makeSession('s2', 'Table B');

    mockGetSession.mockImplementation((...args: unknown[]) =>
      Promise.resolve(args[0] === 's2' ? SESSION_B : SESSION_A),
    );

    mockPostDmTurn.mockResolvedValue({
      job_id: 'job-A',
      turn_key: 'turn-A',
      status: 'pending',
      deduped: false,
    });

    // Capture the abort signal handed to subscribeDmJob for session A's job,
    // and hold the generator open (never yields 'done') so it stays
    // "in-flight" across the switch — mirroring the live incident's "tail of
    // an in-flight LLM narration" window.
    let capturedSignal: AbortSignal | undefined;
    let yieldSecondChunk: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      yieldSecondChunk = resolve;
    });
    mockSubscribeDmJob.mockImplementation(async function* (
      _jobId: string,
      _sid: string,
      opts: { signal?: AbortSignal },
    ) {
      capturedSignal = opts?.signal;
      yield { kind: 'chunk', text: 'Table A: the ghoul lunges.' };
      await gate;
      // This chunk simulates the outgoing session's stream tail resolving
      // AFTER the user has already switched to Table B — the exact shape of
      // the live bleed. It must never be applied post-abort.
      yield { kind: 'chunk', text: 'Table A: it claws at you.' };
      yield { kind: 'done' };
    });

    const { rerender } = render(<PlayPage />);
    await screen.findByText('Table A');

    await sendMessage('I ready my blade.');
    await flush();

    expect(mockSubscribeDmJob).toHaveBeenCalledWith('job-A', 's1', expect.anything());
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);
    await screen.findByText(/Table A: the ghoul lunges\./);

    // ── the switch: SAME component instance, sessionId prop changes ────────
    mockSessionId = 's2';
    mockGetSessionEventsRaw.mockResolvedValue([]);
    mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
    rerender(<PlayPage />);
    await screen.findByText('Table B');
    await flush();

    // Mechanism: the outgoing session's job signal is now aborted.
    expect(capturedSignal?.aborted).toBe(true);

    // Observable guarantee: releasing the outgoing stream's held chunk must
    // NOT bleed Table A's narration into the now-rendered Table B session.
    await act(async () => {
      yieldSecondChunk();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const log = await screen.findByRole('log');
    expect(within(log).queryByText(/Table A: it claws at you\./)).not.toBeInTheDocument();
    expect(within(log).queryByText(/Table A: the ghoul lunges\./)).not.toBeInTheDocument();
  });

  it('does not leave the composer permanently locked in the NEW session — `talking` is cleared on switch, not just left for a successor beat that will never arrive', async () => {
    const SESSION_A = makeSession('s1', 'Table A');
    const SESSION_B = makeSession('s2', 'Table B');

    mockGetSession.mockImplementation((...args: unknown[]) =>
      Promise.resolve(args[0] === 's2' ? SESSION_B : SESSION_A),
    );

    mockPostDmTurn.mockImplementation((...args: unknown[]) =>
      Promise.resolve({
        job_id: (args[0] as { session_id: string }).session_id === 's2' ? 'job-B' : 'job-A',
        turn_key: `turn-${(args[0] as { session_id: string }).session_id}`,
        status: 'pending',
        deduped: false,
      }),
    );

    // Session A's job never resolves ('talking' stays true for the whole
    // window if nothing resets it on switch — the exact bug this locks).
    mockSubscribeDmJob.mockImplementation(
      async function* (jobId: string) {
        if (jobId === 'job-A') {
          yield { kind: 'chunk', text: 'Table A: the ghoul lunges.' };
          await new Promise<void>(() => {}); // never resolves
        } else {
          yield { kind: 'chunk', text: 'Table B: a torch flickers.' };
          yield { kind: 'done' };
        }
      },
    );

    const { rerender } = render(<PlayPage />);
    await screen.findByText('Table A');

    await sendMessage('I ready my blade.');
    await flush();
    await screen.findByText(/Table A: the ghoul lunges\./);

    // ── the switch: SAME component instance, sessionId prop changes ────────
    mockSessionId = 's2';
    mockGetSessionEventsRaw.mockResolvedValue([]);
    mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
    rerender(<PlayPage />);
    await screen.findByText('Table B');
    await flush();

    // The new session's composer must accept a message — if `talking` had
    // leaked across the switch, onSend's `if (!text || talking) return;`
    // guard would silently no-op this and postDmTurn would never fire for B.
    await sendMessage('I look for another way in.');
    await flush();

    expect(mockPostDmTurn).toHaveBeenCalledTimes(2);
    const secondCallBody = mockPostDmTurn.mock.calls[1][0] as { session_id: string };
    expect(secondCallBody.session_id).toBe('s2');
  });
});
