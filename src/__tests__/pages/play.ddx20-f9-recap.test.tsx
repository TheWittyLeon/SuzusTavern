/**
 * DDX-20 F9 + Recap Design (Sora-Arch, 2026-07-16) — page-level regression
 * gate for the three items that pass fixed:
 *
 *   1. F9 — the mount rehydration never armed `renderedSeqsRef` (the durable
 *      reconcile's rule-1 dedup ledger), so the FIRST flag-ON poll tick
 *      re-appended the entire history it had just rendered (a reload
 *      doubled the transcript, exactly once, then stayed stable).
 *   2. Recap guard — `reconcileEvents.ts` rule 3 narrowed to `narration`
 *      only (see reconcileEvents.test.ts for the pure-function inversion);
 *      this file adds the end-to-end proof that a durable `recap` event
 *      landing while a turn is in flight cannot hijack that turn's ledger
 *      entry / streaming row.
 *   3. `journalEvents` unbounded duplication — the flag-ON poll's own
 *      `setJournalEvents` merge (page.tsx, inside `pollDurable`) was a blind
 *      `[...prev, ...allNewEvents]` append with no dedup, BEFORE the
 *      reconcile ledger even runs — so item 1's fix does not cover it.
 *
 * THE VACUITY TRAP (design §6): `getSessionEventsPage` is mocked to IGNORE
 * `since_seq` and return the FULL history on every call, exactly like the
 * real broken wire (ProjectNekoNova/api/routes/dnd_sessions.py silently
 * drops `since_seq` before it reaches the engine — cross-repo, not fixed
 * here). A cursor-honouring fixture would pass against unfixed code and
 * prove nothing; every test below was run red-first against the unfixed
 * tree to confirm it actually exercises the bug (see the commit history /
 * handoff report for the captured red-first output).
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

// DURABLE_GENERATION_ENABLED is read once at import time (not a live
// binding) — fixed true for this whole file, same convention as
// play.ddx20-durable-turn.test.tsx.
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
      name: 'Velka',
      char_class: 'Rogue',
      level: 3,
      current_hp: 18,
      max_hp: 20,
      ac: 14,
    },
  },
];

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

function recapEvent(seq: number, text: string): EngineSessionEvent {
  return {
    seq,
    kind: 'recap',
    visibility: 'table',
    created_at: '2026-07-14T09:01:10Z',
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
  mockGetSession.mockResolvedValue(SESSION);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([]);
  mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockPostSessionEvent.mockResolvedValue({});
});

// A realistic mixed-kind history shared by the F9 and journalEvents suites
// below — deliberately includes TWO null-mapping kinds (session_start,
// recap) alongside five row-producing kinds, so a fix that only seeds/dedups
// the *rendered* rows (instead of every seq) would still leak. seq 4 (recap)
// and seq 6 (scene_advance) also feed the Journal pane's recap-history /
// quest-trail sections respectively.
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
    kind: 'narration',
    created_at: '2026-07-14T09:01:05Z',
    data: { who: 'Suzu', text: 'The room flickers into view.' },
  },
  {
    seq: 4,
    kind: 'recap',
    created_at: '2026-07-14T09:01:10Z',
    data: { who: 'Suzu', text: 'Previously, the tide rose fast.' },
  },
  {
    seq: 5,
    kind: 'dice_roll',
    actor: 'leon',
    created_at: '2026-07-14T09:01:15Z',
    data: {
      kind: 'skill',
      notation: null,
      skill: 'perception',
      ability: null,
      character_id: 'c1',
      modifier: 3,
      advantage: 'straight',
      rolls: [15],
      kept: 15,
      total: 18,
      description: 'Perception check: rolled 15 + 3 = 18.',
    },
  },
  {
    seq: 6,
    kind: 'scene_advance',
    created_at: '2026-07-14T09:01:18Z',
    data: { description: 'The party moves toward the hidden door.' },
  },
  {
    seq: 7,
    kind: 'narration',
    created_at: '2026-07-14T09:01:20Z',
    data: { who: 'Suzu', text: 'You spot a hidden door.' },
  },
];

async function tick() {
  await act(async () => {
    jest.advanceTimersByTime(4000);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DDX-20 F9 — reload does not double-render (§2.2 ledger seed)', () => {
  it('every rehydrated event renders exactly once at mount, after poll tick 1, and after poll tick 2 — against a wire that ignores since_seq and returns the full history every time', async () => {
    mockGetSessionEventsRaw.mockResolvedValue([...HISTORY]);
    // THE VACUITY TRAP GUARD: ignores whatever `since_seq` page.tsx sends and
    // always hands back the full history — the real (broken) NekoNova hop
    // shape. A mock that honoured since_seq would pass even against unfixed
    // code and prove nothing (design §6).
    mockGetSessionEventsPage.mockImplementation(() =>
      Promise.resolve({ events: [...HISTORY], max_seq: 7, has_more: false, pending_generation: null }),
    );

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');
      await flush();

      // Scoped to the transcript's `role="log"` region — JournalPane is
      // ALWAYS mounted (even while closed, see page.tsx's own comment on the
      // drawer `<aside>`), and its quest-trail section renders the SAME
      // `scene_advance` description text; an unscoped screen.getAllByText
      // would double-count across the two regions and give a false positive
      // for the very bug this test exists to catch.
      const log = await screen.findByRole('log');

      const assertRenderedOnce = () => {
        expect(within(log).getAllByText('I light a candle.')).toHaveLength(1);
        expect(within(log).getAllByText('The room flickers into view.')).toHaveLength(1);
        expect(within(log).getAllByText(/^Perception/)).toHaveLength(1);
        expect(within(log).getAllByText('The party moves toward the hidden door.')).toHaveLength(1);
        expect(within(log).getAllByText('You spot a hidden door.')).toHaveLength(1);
        // recap never renders a transcript row by design (eventToLogRow ->
        // null) — true with or without this fix, asserted for completeness.
        expect(within(log).queryByText(/Previously, the tide rose fast/)).not.toBeInTheDocument();
      };

      // After mount (rehydration only).
      assertRenderedOnce();

      // After poll tick 1 — THE F9 DISCRIMINATOR. Pre-fix, renderedSeqsRef is
      // empty on this tick, so reconcileDurableEvents' rule 1 can't skip
      // anything the rehydration already rendered and every row doubles.
      await tick();
      assertRenderedOnce();

      // After poll tick 2 — stays stable (tick 1's own reconcile would have
      // armed the ledger even without the fix; this just confirms no further
      // drift either way).
      await tick();
      assertRenderedOnce();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('DDX-20 recap guard — a durable recap event never hijacks an active narration entry (§3.4 rule-3 narrowing)', () => {
  it('a recap event landing mid-turn leaves the streaming row untouched; the real narration later reconciles normally to exactly one finalized row', async () => {
    let capturedTurnKey = '';
    mockPostDmTurn.mockImplementation(async (body: { turn_key: string }) => {
      capturedTurnKey = body.turn_key;
      return { job_id: 'job-1', turn_key: body.turn_key, status: 'streaming', deduped: false };
    });
    // Never resolved — the SSE tail is held open for the rest of the test,
    // models a still-streaming beat. The real finalization in this scenario
    // comes from the DURABLE POLL reconciling the narration event (rule 3
    // sub-case (a)), not from the SSE tail's own [DONE] — see
    // reconcileEvents.ts's module doc. RTL's automatic unmount/cleanup aborts
    // the tail's AbortSignal, so nothing ever resumes this await.
    const neverResolves = new Promise<void>(() => {});
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'The door cre' };
      await neverResolves;
      yield { kind: 'done' };
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');
      // Scoped to the transcript's `role="log"` region — the chat log's own
      // streaming row is the ONLY place narration renders today
      // (TAV-NARRATION-DECOUPLE: NarratorStrip no longer mirrors it). Only
      // the log's own row is what rule 3 reconciles.
      const log = await screen.findByRole('log');

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'I push the door open.' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(capturedTurnKey).toBeTruthy();
      // The live streaming preview is up and aria-hidden while still growing.
      const streamingRow = within(log).getByText('The door cre').closest('.row');
      expect(streamingRow).toHaveAttribute('aria-hidden', 'true');

      // Poll tick 1 — the durable player_action (stamps the optimistic row)
      // AND a durable recap event land TOGETHER, matching both the real
      // broken-wire shape (every tick returns the full history) and the
      // design's own repro (an in-flight turn, then a recap lands).
      mockGetSessionEventsPage.mockResolvedValue({
        events: [
          playerActionEvent(10, capturedTurnKey, 'I push the door open.'),
          recapEvent(11, 'Previously, the tide rose.'),
        ],
        max_seq: 11,
        has_more: false,
        pending_generation: null,
      });
      await tick();

      // Recap never renders a transcript row (true regardless of the fix —
      // locked here for completeness, not the discriminator).
      expect(within(log).queryByText(/Previously, the tide rose/)).not.toBeInTheDocument();
      // The streaming row must still be there, unhijacked, still growing.
      expect(within(log).getAllByText('The door cre')).toHaveLength(1);
      expect(within(log).getByText('The door cre').closest('.row')).toHaveAttribute(
        'aria-hidden',
        'true',
      );

      // Poll tick 2 — the REAL narration for this turn lands. The broken
      // wire keeps re-sending everything; rule 1 skips the already-processed
      // seqs 10/11, only seq 12 is new.
      mockGetSessionEventsPage.mockResolvedValue({
        events: [
          playerActionEvent(10, capturedTurnKey, 'I push the door open.'),
          recapEvent(11, 'Previously, the tide rose.'),
          narrationEvent(12, 'The door creaks open.'),
        ],
        max_seq: 12,
        has_more: false,
        pending_generation: null,
      });
      await tick();

      // Exactly ONE narration row for the completed beat, and it is
      // FINALIZED (not aria-hidden) — proves rule 3 sub-case (a) matched the
      // REAL narration against the SAME ledger entry the recap did not
      // touch. Pre-fix, the recap would have hijacked/resolved that entry,
      // so the real narration would instead APPEND as a brand-new row,
      // stranding "The door cre" aria-hidden forever (Kage #1's exact
      // regression) — assert that orphan is gone.
      expect(within(log).getAllByText('The door creaks open.')).toHaveLength(1);
      const finalRow = within(log).getByText('The door creaks open.').closest('.row');
      expect(finalRow).not.toHaveAttribute('aria-hidden');
      expect(within(log).queryByText('The door cre')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('DDX-20 journalEvents — merge-by-seq, no unbounded duplication (§2.4)', () => {
  it('the Journal pane recap/quest-trail entries stay at exactly one occurrence across repeated full-history poll ticks', async () => {
    mockGetSessionEventsRaw.mockResolvedValue([...HISTORY]);
    // Same broken-wire fixture as the F9 suite — every tick re-hands the
    // FULL history, ignoring since_seq. This is what makes the pre-fix bug
    // "every 4s, journalEvents grows by the whole history again" reachable.
    mockGetSessionEventsPage.mockImplementation(() =>
      Promise.resolve({ events: [...HISTORY], max_seq: 7, has_more: false, pending_generation: null }),
    );

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');
      await flush();

      const toggle = screen.getByRole('button', { name: 'Open journal' });
      toggle.focus();
      fireEvent.click(toggle);
      await waitFor(() =>
        expect(screen.getByText('Previously, the tide rose fast.')).toBeInTheDocument(),
      );

      // Scoped to each JournalPane section specifically — the SAME
      // scene_advance description also renders as a ChatLog transcript row
      // (kind 'system'), so an unscoped screen.getAllByText would double-
      // count across the transcript and the quest-trail section and give a
      // false positive for the very bug this test exists to catch.
      const recapSection = screen.getByText('Recap history').closest('section');
      const questSection = screen.getByText('Quest log').closest('section');
      if (!recapSection || !questSection) throw new Error('journal sections not found');

      const assertStable = () => {
        expect(within(recapSection).getAllByText('Previously, the tide rose fast.')).toHaveLength(
          1,
        );
        expect(
          within(questSection).getAllByText('The party moves toward the hidden door.'),
        ).toHaveLength(1);
      };

      assertStable();

      // Poll tick 1 — THE DISCRIMINATOR. Pre-fix, the blind
      // `[...prev, ...allNewEvents]` append (page.tsx, inside pollDurable,
      // BEFORE the reconcile ledger even runs) re-adds the entire history a
      // second time, duplicating both the recap and quest-trail entries.
      await tick();
      assertStable();

      // Poll tick 2 — proves this is bounded, not merely "doubles once".
      await tick();
      assertStable();
    } finally {
      jest.useRealTimers();
    }
  });
});
