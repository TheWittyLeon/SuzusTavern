/**
 * DDX-20 Pass 2 — QA adversarial gap probes (Miko-QA gate on Ren-Dev's
 * durable-turn client wiring). These are NOT a re-test of what
 * play.ddx20-durable-turn.test.tsx / play.ddx20-flag-off-dormancy.test.tsx /
 * reconcileEvents.test.ts already cover — each test here targets a specific
 * abuse case from the QA break-it checklist that those suites do not
 * exercise:
 *
 *   1. Concurrent double-submit racing the client-side `talking` guard
 *      DURING the postDmTurn network round-trip (not after subscribeToJob
 *      has already flipped `talking` true).
 *   2. Reload mid-turn: mount discovers `pending_generation` (no optimistic
 *      row exists client-side), a LATER poll delivers the durable narration
 *      — must reconcile via the ledger, never double-append. The existing
 *      don't-re-POST tests only assert `subscribeDmJob` was called; they
 *      never carry the scenario through to the narration landing.
 *   3. Poll-only failure detection (Client Integration Design §4d, second
 *      bullet): "pending_generation transitions to null with no narration
 *      seq > trigger_seq within a grace window (poll-only)". Only the SSE
 *      mid-stream `error` path is implemented client-side; this probes
 *      whether a job that silently disappears (SSE tail ends without an
 *      error frame, then pending_generation goes null with no narration
 *      ever landing) leaves the row/turn_key permanently stuck instead of
 *      surfacing the retry affordance.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, EventsPage, Participant, Session } from '@/lib/api/types';

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

function narrationEvent(seq: number, text: string): EngineSessionEvent {
  return {
    seq,
    kind: 'narration',
    visibility: 'table',
    created_at: '2026-07-14T10:00:01Z',
    data: { who: 'Suzu', text },
  };
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
  mockGetSession.mockResolvedValue(AI_SESSION);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([]);
  mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockPostSessionEvent.mockResolvedValue({});
});

describe('ADVERSARIAL — concurrent double-submit races the busy-guard', () => {
  // MIKO-QA FINDING (DDX-20 Pass 2) — FIXED. narrateDurable() now calls
  // setTalking(true)/setThinking(true) SYNCHRONOUSLY before the first
  // `await` (mirroring narrate()'s own pattern), so onSend's
  // `if (!text || talking) return` guard covers the entire postDmTurn
  // network round-trip window, not just the post-resolve subscribeToJob
  // phase. A matching setTalking(false)/setThinking(false) was added to the
  // postDmTurn error catch (the only path that previously left `talking`
  // permanently true with no subscribeToJob ever running to release it).
  it('two Enter presses fired before postDmTurn resolves must not both create a turn', async () => {
    // postDmTurn never resolves within this test — simulates a slow network
    // round-trip, the exact window the `talking` guard is supposed to close.
    let resolvePost: (v: unknown) => void = () => {};
    mockPostDmTurn.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );

    render(<PlayPage />);
    await screen.findByText('Test Table');

    const input = screen.getByRole('textbox');

    // First send.
    fireEvent.change(input, { target: { value: 'I push the door open.' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Second send, fired in the SAME macrotask window, before postDmTurn's
    // promise has had a chance to resolve (it never will in this test).
    fireEvent.change(input, { target: { value: 'I push the door open again.' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await flush();

    // The `talking` guard (page.tsx onSend: `if (!text || talking) return`)
    // is supposed to make a rapid second Enter a no-op, mirroring the
    // legacy narrate() path where setTalking(true) runs synchronously
    // before any await. narrateDurable only flips `talking` true inside
    // subscribeToJob, which does not run until AFTER postDmTurn resolves —
    // so during the network round-trip this guard is not yet armed.
    expect(mockPostDmTurn).toHaveBeenCalledTimes(1);

    resolvePost({ job_id: 'job-1', turn_key: 'x', status: 'pending', deduped: false });
  });
});

describe('ADVERSARIAL — reload mid-turn reconstructs purely from poll (mocked)', () => {
  it('mount discovers pending_generation with no local optimistic row; a later poll delivering the narration must not double-append', async () => {
    // Fresh mount — no localStorage turn_key, no client-side ledger entry.
    // This is "another tab / this tab after a hard reload" discovering an
    // in-flight turn purely through the cursor poll's pending_generation
    // block (§4b don't-re-POST / stateless resume).
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'Suzu is mid-sentence' };
      await new Promise(() => {}); // still open — narration lands via poll, not SSE
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');

      mockGetSessionEventsPage.mockResolvedValueOnce({
        events: [],
        max_seq: 5,
        has_more: false,
        pending_generation: {
          turn_key: 'tk-reload-discovered',
          job_id: 'job-reload',
          status: 'streaming',
          trigger_seq: 5,
          started_at: '2026-07-14T10:00:00Z',
        },
      });

      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockSubscribeDmJob).toHaveBeenCalledWith('job-reload', expect.anything());

      // Let the SSE tail's first chunk actually land and register itself in
      // the ledger (subscribeToJob's chunk handler sets
      // entry.narrationRowId = streamRowIdRef.current) BEFORE the next poll
      // tick runs reconciliation — otherwise this test's own timing, not a
      // product bug, would explain a miss.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      const log = await screen.findByRole('log');
      expect(within(log).getByText('Suzu is mid-sentence')).toBeInTheDocument();

      // Next poll tick: the durable narration for this turn lands (seq 6 >
      // trigger_seq 5). Must reconcile into the ledger's narrationRowId
      // (wired by subscribeToJob's chunk handler) rather than appending a
      // brand-new row alongside the live SSE preview.
      mockGetSessionEventsPage.mockResolvedValueOnce({
        events: [narrationEvent(6, 'Suzu finishes the sentence.')],
        max_seq: 6,
        has_more: false,
        pending_generation: null,
      });

      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Exactly one TRANSCRIPT row with the durable (canonical) text — not
      // stuck as a live "Suzu is mid-sentence" preview row AND a separate
      // appended durable row. Scoped to role="log" so the mirrored
      // top-of-screen narratorText widget (a SEPARATE, expected DOM node)
      // doesn't produce a false multi-match.
      await waitFor(() => {
        expect(within(log).getAllByText('Suzu finishes the sentence.')).toHaveLength(1);
      });
      expect(within(log).queryByText('Suzu is mid-sentence')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  // Kage #3 (code review) — the REVERSED ordering from the test above: the
  // durable narration lands on the poll BEFORE subscribeToJob's SSE tail has
  // delivered even its FIRST chunk (a real network round-trip can easily
  // take longer than the 4s poll cadence). Without registering
  // `awaitingNarration` synchronously ahead of the SSE fetch,
  // reconcileDurableEvents' rule 3 would have no ledger entry to match
  // against yet, append the durable row as a plain reload-style row, and
  // then the LATE-arriving SSE chunk would create a SECOND, orphaned
  // streaming row for the same beat that never reconciles.
  it('the poll observes the narration BEFORE the SSE tail delivers its first chunk — no duplicate/orphaned row', async () => {
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      // Gated — simulates a slow network round-trip that outlasts the poll
      // tick which observes the durable narration first.
      await gate;
      yield { kind: 'chunk', text: 'Suzu is mid-sentence' };
      yield { kind: 'done' };
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');

      // First poll tick: discovers the in-flight job and subscribes —
      // registering `awaitingNarration` synchronously, but the SSE tail is
      // still gated (no chunk has landed yet).
      mockGetSessionEventsPage.mockResolvedValueOnce({
        events: [],
        max_seq: 5,
        has_more: false,
        pending_generation: {
          turn_key: 'tk-race',
          job_id: 'job-race',
          status: 'streaming',
          trigger_seq: 5,
          started_at: '2026-07-14T10:00:00Z',
        },
      });
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockSubscribeDmJob).toHaveBeenCalledWith('job-race', expect.anything());

      const log = await screen.findByRole('log');
      // Nothing rendered into the transcript yet — the SSE tail is still gated.
      expect(within(log).queryByText(/Suzu is mid-sentence/)).not.toBeInTheDocument();

      // Second poll tick: the durable narration lands BEFORE the SSE tail's
      // first chunk. Rule 3 sub-case (c) must APPEND it now (a row exists to
      // find later) and CLAIM the ledger entry's narrationRowId.
      mockGetSessionEventsPage.mockResolvedValueOnce({
        events: [narrationEvent(6, 'Suzu finishes the sentence.')],
        max_seq: 6,
        has_more: false,
        pending_generation: null,
      });
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(within(log).getAllByText('Suzu finishes the sentence.')).toHaveLength(1);
      });
      // The durable row is fully announced (not aria-hidden) — it was a
      // plain append, never a streaming placeholder.
      const durableRow = within(log).getByText('Suzu finishes the sentence.').closest('.row');
      expect(durableRow).not.toHaveAttribute('aria-hidden');

      // NOW release the gated SSE tail — its (late) first chunk arrives.
      await act(async () => {
        releaseGate();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // No duplicate/orphaned row: still exactly one row for the durable
      // text, the stale preview text never appears at all, and no
      // aria-hidden streaming row was left behind.
      expect(within(log).getAllByText('Suzu finishes the sentence.')).toHaveLength(1);
      expect(within(log).queryByText(/Suzu is mid-sentence/)).not.toBeInTheDocument();
      expect(log.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('ADVERSARIAL — poll-only failure detection (design §4d, second bullet)', () => {
  // MIKO-QA FINDING (DDX-20 Pass 2) — FIXED. pollDurable now tracks a grace
  // counter (pollFailureGraceRef, POLL_FAILURE_GRACE_TICKS=2) for THIS
  // client's own in-flight turn_key: each tick `pending_generation` doesn't
  // reflect it (and the ledger entry is still unresolved), the counter
  // increments; once it reaches the grace threshold, the job is treated as
  // dead — same cleanup as subscribeToJob's SSE-error path (drop the stuck
  // streaming row, clear turn_key, setJobFailed(true)). This closes the gap
  // for any client NOT actively holding the SSE tail when a job dies
  // server-side (reload after a silent failure, a dropped SSE tail with no
  // error frame, a backgrounded tab). Note: readTurnKey() / mechanism-2
  // idempotent re-POST remain unwired — see the TODO(DDX-20 mechanism-2)
  // marker in src/lib/turnKey.ts; out of scope for this fix.
  it('pending_generation goes non-null then null with NO narration ever landing and NO SSE error frame — must surface retry, not leave the turn stuck forever', async () => {
    mockPostDmTurn.mockResolvedValue({
      job_id: 'job-silent-fail',
      turn_key: 'will-be-overwritten',
      status: 'pending',
      deduped: false,
    });
    // Simulates a dropped/silently-ended tail: yields one chunk then the
    // generator just ends (no {kind:'error'}, no {kind:'done'}) — the
    // connection closed without either signal, e.g. a proxy timeout that
    // truncates the stream without writing an SSE error frame.
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'Suzu begins to answer' };
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'I attempt a risky climb.' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // The SSE tail ends silently (no error) — subscribeToJob's own
      // sawError branch never fires, so jobFailed is never set by that path.

      // Poll now reports the job gone from pending_generation, WITHOUT ever
      // having delivered a narration event for it — the server-side signal
      // that the job actually failed (Redis TTL eviction / runner crash),
      // per design's poll-only failure-detection fallback.
      mockGetSessionEventsPage.mockResolvedValue({
        events: [],
        max_seq: 0,
        has_more: false,
        pending_generation: null,
      });

      // Advance well past any plausible "grace window" — several poll ticks.
      for (let i = 0; i < 5; i += 1) {
        await act(async () => {
          jest.advanceTimersByTime(4000);
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
      }

      // Desired behavior per Client Integration Design §4d: a retry
      // affordance surfaces so the user isn't left staring at a permanently
      // unresolved beat. Documents the current gap if this fails.
      const retryBtn = await screen.findByRole('button', { name: /retry/i });
      expect(retryBtn).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
