/**
 * DDX-20 Pass 2 — the flag-ON durable turn path (Client Integration Design
 * §4/§5/§6/§9). `DURABLE_GENERATION_ENABLED` is mocked TRUE for this WHOLE
 * file (config is read once at import time, not a live binding — mirrors
 * codex-flag-guard-enabled.test.tsx's own note on this). The flag-OFF
 * regression gate lives in play.ddx20-flag-off-dormancy.test.tsx and is
 * UNCHANGED/still green — this file is additive, exercising the new branch
 * only.
 *
 * Covers:
 *   - durable turn happy-path (postDmTurn -> subscribeDmJob live tail)
 *   - 409-busy pivot: orphaned row removed, composer text restored, busy
 *     toast, subscribes to the in-flight job instead of erroring/re-POSTing
 *   - deduped-resume: no double-append once the poll's durable events land
 *   - don't-re-POST: a pending_generation discovered on the poll subscribes,
 *     never calls postDmTurn
 *   - turn_key lifecycle: cleared once the poll observes completion; retry
 *     after a failed job mints a NEW turn_key
 *   - human-DM client_key dedup (ledger rule 4)
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

// DURABLE_GENERATION_ENABLED read once at import time — fixed true for this
// whole file (see file banner).
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

const HUMAN_DM_SESSION: Session = {
  session_id: 's1',
  channel: 'test_channel',
  name: 'Test Table',
  status: 'active',
  dm_username: 'leon',
  dm_mode: 'human',
  ai_assist_level: 'off',
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function playerActionEvent(seq: number, turnKey: string, text: string): EngineSessionEvent {
  return {
    seq,
    kind: 'player_action',
    actor: 'leon',
    visibility: 'table',
    created_at: '2026-07-14T10:00:00Z',
    data: { who: 'leon', text, turn_key: turnKey },
  };
}

function narrationEvent(seq: number, text: string): EngineSessionEvent {
  return {
    seq,
    kind: 'narration',
    visibility: 'table',
    created_at: '2026-07-14T10:00:01Z',
    data: { who: 'Suzu', text },
  };
}

async function sendMessage(text: string) {
  const input = screen.getByRole('textbox');
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

describe('durable turn happy path', () => {
  it('appends the optimistic player row, POSTs /dm/turn with a fresh turn_key, then subscribes to the SSE tail', async () => {
    mockPostDmTurn.mockResolvedValue({
      job_id: 'job-1',
      turn_key: 'will-be-overwritten-by-assertion',
      status: 'pending',
      deduped: false,
    });
    let releaseGen: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGen = resolve;
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'The door creaks open.' };
      await gate;
      yield { kind: 'done' };
    });

    render(<PlayPage />);
    await screen.findByText('Test Table');

    await sendMessage('I push the door open.');
    await flush();

    // Optimistic player row shown immediately.
    expect(screen.getByText('I push the door open.')).toBeInTheDocument();

    // postDmTurn called with a real UUID v4 turn_key and the composer content.
    expect(mockPostDmTurn).toHaveBeenCalledTimes(1);
    const body = mockPostDmTurn.mock.calls[0][0];
    expect(body).toMatchObject({
      username: 'leon',
      channel: 'test_channel',
      session_id: 's1',
      message: 'I push the door open.',
      mode: 'say',
    });
    expect(body.turn_key).toMatch(UUID_RE);

    // turn_key persisted to localStorage (§4c).
    expect(window.localStorage.getItem('st:dnd:s1:activeTurnKey')).toBe(body.turn_key);

    // Live SSE tail subscribed and its chunk rendered.
    await waitFor(() => {
      expect(mockSubscribeDmJob).toHaveBeenCalledWith(
        'job-1',
        expect.anything(),
        expect.anything(),
      );
    });
    await waitFor(() => {
      expect(screen.getAllByText('The door creaks open.').length).toBeGreaterThan(0);
    });

    // Kage #7: drain the generator's post-release continuation (subscribeToJob's
    // setThinking/setTalking(false) after `yield {kind:'done'}`) INSIDE act()
    // so it doesn't fire after the test body returns (an unwrapped act()
    // warning, not a real failure, but worth keeping the suite's log clean).
    await act(async () => {
      releaseGen();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('a human-DM/AI-off table still shows the player row but never creates a job', async () => {
    mockGetSession.mockResolvedValue({
      ...AI_SESSION,
      dm_mode: 'human',
      ai_assist_level: 'off',
    });
    render(<PlayPage />);
    await screen.findByText('Test Table');

    await sendMessage('I look around.');
    await flush();

    expect(screen.getByText('I look around.')).toBeInTheDocument();
    expect(mockPostDmTurn).not.toHaveBeenCalled();
  });
});

describe('409-busy pivot', () => {
  it('removes the orphaned optimistic row, restores composer text, toasts, and subscribes to the in-flight job', async () => {
    mockPostDmTurn.mockResolvedValue({
      busy: true,
      job_id: 'job-inflight',
      status: 'streaming',
      trigger_seq: 42,
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'done' };
    });

    render(<PlayPage />);
    await screen.findByText('Test Table');

    await sendMessage('Second message while Suzu is busy.');
    await flush();

    // Orphaned optimistic row removed from the transcript — never shown as a
    // permanent row (scoped to the log so the composer's restored text,
    // asserted separately below, isn't mistaken for a lingering row).
    const log = await screen.findByRole('log');
    expect(within(log).queryByText('Second message while Suzu is busy.')).not.toBeInTheDocument();

    // Composer text restored so the user doesn't lose their message.
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(input.value).toBe('Second message while Suzu is busy.');

    // Busy toast shown (non-error tone, informative copy).
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'info',
        message: expect.stringMatching(/still responding/i),
      }),
    );

    // Subscribed to the OTHER client's in-flight job, not a new one.
    expect(mockSubscribeDmJob).toHaveBeenCalledWith(
      'job-inflight',
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('deduped-resume — no double-append', () => {
  it('a dedup-return (status resumed) does not double-append; the durable poll stamps the SAME row, never a second one', async () => {
    let capturedTurnKey = '';
    mockPostDmTurn.mockImplementation(async (body: { turn_key: string }) => {
      capturedTurnKey = body.turn_key;
      return { job_id: 'job-1', turn_key: body.turn_key, status: 'streaming', deduped: true };
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'Suzu narrates the scene.' };
      yield { kind: 'done' };
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'I open the chest.' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(capturedTurnKey).toMatch(UUID_RE);
      // Exactly one optimistic row so far.
      expect(screen.getAllByText('I open the chest.')).toHaveLength(1);

      // The durable poll now delivers this SAME turn's player_action (which
      // must STAMP the existing row, not append a duplicate) AND its
      // narration (which must replace the live streaming preview, not
      // append alongside it).
      mockGetSessionEventsPage.mockResolvedValue({
        events: [
          playerActionEvent(10, capturedTurnKey, 'I open the chest.'),
          narrationEvent(11, 'Suzu narrates the scene fully.'),
        ],
        max_seq: 11,
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

      // Still exactly ONE player row for this text — the poll stamped the
      // existing row's seq rather than appending a second copy.
      expect(screen.getAllByText('I open the chest.')).toHaveLength(1);
      // Exactly one narration row with the durable (canonical) text.
      expect(screen.getAllByText('Suzu narrates the scene fully.')).toHaveLength(1);

      // Kage #1 — the reconciled narration row must NOT be aria-hidden. The
      // ledger's replace-streaming-with-durable patch must carry an explicit
      // `streaming:false`; a regression here would leave the row permanently
      // aria-hidden (never announced to screen readers) since
      // applyReconcileResult shallow-merges the patch onto the old row.
      const narrationText = screen.getByText('Suzu narrates the scene fully.');
      const narrationRow = narrationText.closest('.row');
      expect(narrationRow).not.toBeNull();
      expect(narrationRow).not.toHaveAttribute('aria-hidden');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('TAV-NARRATION-DECOUPLE — poll-claim race (reconcileEvents rule 3 sub-case (c))', () => {
  it('a durable narration event that lands on the poll BEFORE this client\'s first SSE chunk still reconciles to exactly one, server-authoritative, non-aria-hidden row — no ledger change needed, no double-render', async () => {
    // The generator is gated so it yields NOTHING until released — this
    // simulates the poll's own reconciliation tick observing the durable
    // narration event before subscribeToJob's first SSE byte ever arrives
    // (Kage #3's rule 3 sub-case (c)): `awaitingNarration` is registered
    // synchronously (before subscribeDmJob is even called), but
    // `narrationRowId` is never set locally because no chunk has run yet.
    let releaseGen: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGen = resolve;
    });
    let capturedTurnKey = '';
    mockPostDmTurn.mockImplementation(async (body: { turn_key: string }) => {
      capturedTurnKey = body.turn_key;
      return { job_id: 'job-race', turn_key: body.turn_key, status: 'pending', deduped: false };
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      await gate;
      yield { kind: 'chunk', text: 'Suzu narrates the scene fully.' };
      yield { kind: 'done' };
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'I open the chest.' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(capturedTurnKey).toMatch(UUID_RE);
      // subscribeToJob has registered intent (awaitingNarration) but the
      // generator is still gated — NO chat row exists yet for the
      // narration (only the optimistic player row).
      expect(screen.queryByText('Suzu narrates the scene fully.')).not.toBeInTheDocument();

      // The poll now delivers BOTH events for this turn before this
      // client's tail has produced a single chunk — sub-case (c) appends
      // the durable row whole and claims `narrationRowId` for it.
      mockGetSessionEventsPage.mockResolvedValue({
        events: [
          playerActionEvent(10, capturedTurnKey, 'I open the chest.'),
          narrationEvent(11, 'Suzu narrates the scene fully.'),
        ],
        max_seq: 11,
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

      // Exactly one row, server-authoritative text, already visible/
      // announced (never aria-hidden) — reconcile's sub-case (c) treats
      // this as a complete, final row from the moment it's appended.
      expect(screen.getAllByText('Suzu narrates the scene fully.')).toHaveLength(1);
      const preReleaseRow = screen.getByText('Suzu narrates the scene fully.').closest('.row');
      expect(preReleaseRow).not.toHaveAttribute('aria-hidden');

      // Now let the SSE tail actually run. Its chunk arrives AFTER the poll
      // already claimed this turn's narrationRowId — `subscribeToJob` must
      // detect that (pollClaimedNarration) and NEVER touch the transcript
      // again for this beat: still exactly one row, unchanged text, same
      // node (no supersede/replace churn).
      await act(async () => {
        releaseGen();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getAllByText('Suzu narrates the scene fully.')).toHaveLength(1);
      const postReleaseRow = screen.getByText('Suzu narrates the scene fully.').closest('.row');
      expect(postReleaseRow).toBe(preReleaseRow);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('TAV-NARRATION-DECOUPLE — NarratorStrip no longer carries narration text', () => {
  it('the durable narration text lands ONLY in the chat log; every role=status region (including NarratorStrip) shows scene/combat status, never the narration prose', async () => {
    mockGetGrounding.mockResolvedValue({
      scene_id: 'scene-1',
      scene_name: 'The Sunken Archive',
      objective: 'Find the missing ledger.',
      boxed_text: '',
      transitions: [],
      checks: [],
      flags: {},
      encounter_state: {},
    });
    mockPostDmTurn.mockResolvedValue({
      job_id: 'job-2',
      turn_key: 'tk-bar-decouple',
      status: 'pending',
      deduped: false,
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'The archive groans as you enter.' };
      yield { kind: 'done' };
    });

    render(<PlayPage />);
    await screen.findByText('Test Table');
    // Scene banner shows on mount, before any turn is sent.
    await screen.findByText('The Sunken Archive — Find the missing ledger.');

    await sendMessage('I step inside.');
    await flush();

    // Narration is live in the chat log.
    await waitFor(() => {
      expect(screen.getAllByText(/The archive groans as you enter\.?/).length).toBeGreaterThan(0);
    });

    // The scene banner is untouched by the narration stream, and no
    // role=status region (NarratorStrip included) ever renders the
    // narration prose.
    expect(
      screen.getByText('The Sunken Archive — Find the missing ledger.'),
    ).toBeInTheDocument();
    for (const region of screen.getAllByRole('status')) {
      expect(within(region).queryByText(/archive groans/i)).not.toBeInTheDocument();
    }
  });
});

describe("don't-re-POST rule (stateless poll-discovery)", () => {
  it('a pending_generation discovered on the poll subscribes to it — postDmTurn is NEVER called', async () => {
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'Suzu is finishing a beat.' };
      // never yields done in this test — asserts the subscribe happened,
      // not that it completed.
      await new Promise(() => {});
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');

      mockGetSessionEventsPage.mockResolvedValue({
        events: [],
        max_seq: 5,
        has_more: false,
        pending_generation: {
          turn_key: 'tk-other-client',
          job_id: 'job-other',
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

      expect(mockSubscribeDmJob).toHaveBeenCalledWith(
        'job-other',
        expect.anything(),
        expect.anything(),
      );
      expect(mockPostDmTurn).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not re-subscribe on a later tick for the SAME still-in-flight job', async () => {
    let subscribeCalls = 0;
    mockSubscribeDmJob.mockImplementation(async function* () {
      subscribeCalls += 1;
      yield { kind: 'chunk', text: 'still going' };
      await new Promise(() => {});
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');

      const pendingPage: EventsPage = {
        events: [],
        max_seq: 5,
        has_more: false,
        pending_generation: {
          turn_key: 'tk-other-client',
          job_id: 'job-other',
          status: 'streaming',
          trigger_seq: 5,
          started_at: '2026-07-14T10:00:00Z',
        },
      };
      mockGetSessionEventsPage.mockResolvedValue(pendingPage);

      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(subscribeCalls).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('turn_key lifecycle', () => {
  it('clears the persisted turn_key once the poll observes the beat completed', async () => {
    let capturedTurnKey = '';
    mockPostDmTurn.mockImplementation(async (body: { turn_key: string }) => {
      capturedTurnKey = body.turn_key;
      return { job_id: 'job-1', turn_key: body.turn_key, status: 'pending', deduped: false };
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'Suzu narrates.' };
      yield { kind: 'done' };
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'I knock on the door.' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(window.localStorage.getItem('st:dnd:s1:activeTurnKey')).toBe(capturedTurnKey);

      mockGetSessionEventsPage.mockResolvedValue({
        events: [
          playerActionEvent(1, capturedTurnKey, 'I knock on the door.'),
          narrationEvent(2, 'A voice answers.'),
        ],
        max_seq: 2,
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

      expect(window.localStorage.getItem('st:dnd:s1:activeTurnKey')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('retry-after-failed mints a NEW turn_key — never reuses the failed one', async () => {
    const seenTurnKeys: string[] = [];
    mockPostDmTurn.mockImplementation(async (body: { turn_key: string }) => {
      seenTurnKeys.push(body.turn_key);
      return { job_id: `job-${seenTurnKeys.length}`, turn_key: body.turn_key, status: 'pending', deduped: false };
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'error', error: 'generation failed' };
    });

    render(<PlayPage />);
    await screen.findByText('Test Table');

    await sendMessage('I attempt a risky climb.');
    await flush();

    expect(seenTurnKeys).toHaveLength(1);
    const failedKey = seenTurnKeys[0];

    // The failure surfaces the retry affordance.
    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    retryBtn.focus();

    await act(async () => {
      fireEvent.click(retryBtn);
    });

    // Iro MAJOR-1: clicking Retry unmounts the button (jobFailed flips
    // false) — focus must land on the permanent retry-row wrapper, never
    // drop to <body>.
    expect(document.activeElement?.tagName).not.toBe('BODY');

    await flush();

    expect(seenTurnKeys).toHaveLength(2);
    expect(seenTurnKeys[1]).not.toBe(failedKey);
    expect(seenTurnKeys[1]).toMatch(UUID_RE);
  });
});

describe('human-DM client_key dedup (ledger rule 4)', () => {
  async function renderAsHumanDm() {
    mockGetSession.mockResolvedValue(HUMAN_DM_SESSION);
    render(<PlayPage />);
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: /DM Narration/i })).toBeInTheDocument(),
    );
  }

  it('stamps data.client_key on the postSessionEvent body and the optimistic row carries pendingKey (no double-render on poll reconciliation)', async () => {
    await renderAsHumanDm();

    const textarea = screen.getByRole('textbox', { name: /Compose/i });
    fireEvent.change(textarea, { target: { value: 'The torches flicker ominously.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));
    });
    await flush();

    expect(mockPostSessionEvent).toHaveBeenCalledTimes(1);
    const [, body] = mockPostSessionEvent.mock.calls[0] as [string, { data: { client_key?: string } }];
    expect(body.data.client_key).toMatch(UUID_RE);
    const clientKey = body.data.client_key!;

    // Exactly one optimistic row so far.
    expect(screen.getAllByText('The torches flicker ominously.')).toHaveLength(1);

    jest.useFakeTimers();
    try {
      mockGetSessionEventsPage.mockResolvedValue({
        events: [
          {
            seq: 20,
            kind: 'dm_narration',
            actor: 'leon',
            visibility: 'table',
            created_at: '2026-07-14T10:00:00Z',
            data: { text: 'The torches flicker ominously.', client_key: clientKey },
          },
        ],
        max_seq: 20,
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

      // Still exactly one row — the poll STAMPED the existing optimistic
      // row (ledger rule 4) instead of appending a durable duplicate.
      expect(screen.getAllByText('The torches flicker ominously.')).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
