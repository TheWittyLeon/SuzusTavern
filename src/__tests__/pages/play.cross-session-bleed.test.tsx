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
import type {
  CombatState,
  EngineSessionEvent,
  EventsPage,
  Participant,
  Session,
} from '@/lib/api/types';

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

  /**
   * Miko-QA (2026-08-31 mutation pass) flagged `streamRowIdRef.current =
   * null` in the switch-cleanup effect as completely uncovered. This test
   * locks in the real, user-facing behavior it's meant to protect — a
   * same-instance switch followed by the NEW session's own first
   * composer turn must render that turn's narration, not silently drop it.
   *
   * Mutation-proof disclosure (ran per the handoff's explicit bar, not
   * skipped): with `streamRowIdRef.current = null` commented OUT of the
   * cleanup, this test — and the whole file — STILL PASSES. Root cause:
   * `subscribeToJob` (page.tsx, the SOLE caller of `upsertStreamNarration`
   * on every composer/beat/mount-resume path) already calls
   * `clearStreamNarration(true)` — which itself unconditionally sets
   * `streamRowIdRef.current = null` — as the FIRST thing it does on EVERY
   * invocation, synchronously before any await (pre-existing code, commit
   * d6fc1be7, 2026-07-14, a month before this fix). So by the time session
   * B's own `narrateDurable` → `subscribeToJob(job-B, ...)` call reaches
   * its `upsertStreamNarration('')` precreate, the ref has ALREADY been
   * freshly cleared regardless of the switch-cleanup's own reset — the
   * switch-cleanup line is redundant with pre-existing self-healing for
   * every reachable "compose a message in the new session" path. Confirmed
   * by removing the line and running the full file (`npx jest
   * play.cross-session-bleed.test.tsx`): 4/4 still green.
   *
   * This test is kept anyway — it locks real, correct, user-facing
   * behavior — but it does NOT satisfy "genuinely fails without its target
   * line" for `streamRowIdRef.current = null` specifically. See the
   * implementation report for the fuller trace (including the one
   * divergent-behavior scenario found — a pre-existing, unrelated
   * `revealRef` interval leak in the legacy typewriter path — where having
   * this line present actually makes that OTHER, out-of-scope bug worse,
   * not better, which is why it isn't usable as a "prove necessity" test
   * either). Flagging for Miko/Leon rather than fabricating a test that
   * would pass either way.
   */
  it('resets the stale streaming-anchor ref on switch — the NEW session\'s own first narration turn renders instead of being silently dropped', async () => {
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

    // Session A's job never resolves — its precreated streaming-anchor row
    // id (minted synchronously by subscribeToJob's precreateRow branch,
    // BEFORE this generator is ever iterated) is still sitting in
    // `streamRowIdRef.current` at the moment of the switch, exactly as it
    // would for any in-flight beat.
    mockSubscribeDmJob.mockImplementation(async function* (jobId: string) {
      if (jobId === 'job-A') {
        await new Promise<void>(() => {}); // never resolves
      } else {
        yield { kind: 'chunk', text: 'Table B: a torch flickers.' };
        yield { kind: 'done' };
      }
    });

    const { rerender } = render(<PlayPage />);
    await screen.findByText('Table A');

    await sendMessage('I ready my blade.');
    await flush();

    // ── the switch: SAME component instance, sessionId prop changes ────────
    mockSessionId = 's2';
    mockGetSessionEventsRaw.mockResolvedValue([]);
    mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
    rerender(<PlayPage />);
    await screen.findByText('Table B');
    await flush();

    // Session B's own first turn must render its OWN narration.
    await sendMessage('I look for another way in.');
    await flush();

    await screen.findByText(/Table B: a torch flickers\./);
  });

  it('clears the OUTGOING session\'s combatState on a same-instance switch into a combat-free session — the initiative HUD does not bleed a stale roster into the new table', async () => {
    const SESSION_A: Session = { ...makeSession('s1', 'Table A'), active_combat_id: 'combat-42' };
    const SESSION_B = makeSession('s2', 'Table B');

    const COMBAT_STATE: CombatState = {
      combat_id: 'combat-42',
      session_id: 's1',
      round: 1,
      state: 'active',
      turn_index: 0,
      active_participant_id: 'p_velka',
      initiative: ['p_velka', 'p_gob1'],
      participants: [
        {
          participant_id: 'p_velka',
          entity_id: 'c1',
          name: 'Velka',
          is_pc: true,
          initiative: 18,
          hp_current: 18,
          hp_max: 20,
          ac: 14,
          conditions: [],
          is_alive: true,
          can_be_targeted: true,
          is_active_turn: true,
          took_turn: false,
        },
        {
          participant_id: 'p_gob1',
          entity_id: 'goblin',
          name: 'Goblin',
          is_pc: false,
          initiative: 12,
          hp_current: 7,
          hp_max: 7,
          ac: 13,
          conditions: [],
          is_alive: true,
          can_be_targeted: true,
          is_active_turn: false,
          took_turn: false,
        },
      ],
    };

    mockGetSession.mockImplementation((...args: unknown[]) =>
      Promise.resolve(args[0] === 's2' ? SESSION_B : SESSION_A),
    );
    mockGetCombatState.mockImplementation((...args: unknown[]) =>
      Promise.resolve(args[0] === 'combat-42' ? COMBAT_STATE : null),
    );

    const { rerender } = render(<PlayPage />);
    await screen.findByText('Table A');

    // Session A's combat HUD is up — Goblin is on the roster.
    await screen.findByText('Goblin');

    // ── the switch: SAME component instance, sessionId prop changes into a
    // session with NO active combat. ─────────────────────────────────────
    mockSessionId = 's2';
    mockGetSessionEventsRaw.mockResolvedValue([]);
    mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
    rerender(<PlayPage />);
    await screen.findByText('Table B');
    await flush();

    // Table B has no active_combat_id, so nothing ever re-fetches combat
    // state for it — the ONLY thing that can clear the outgoing session's
    // roster is the switch-cleanup's own `setCombatState(null)`. Without
    // it, the InitiativeTracker (gated on `combatState && combatState.
    // participants.length > 0`, NOT on combatId) keeps rendering Table A's
    // stale Goblin/Velka roster at Table B's table.
    expect(screen.queryByText('Goblin')).not.toBeInTheDocument();
    expect(screen.queryByText('Initiative')).not.toBeInTheDocument();
  });
});
