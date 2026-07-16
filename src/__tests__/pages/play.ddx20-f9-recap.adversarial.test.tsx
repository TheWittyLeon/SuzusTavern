/**
 * DDX-20 F9 + Recap Design (6e027cf) — Miko-QA break-it pass.
 *
 * Companion to play.ddx20-f9-recap.test.tsx (Ren-Dev's own regression gate).
 * These tests target abuse cases Ren's own suite does NOT exercise:
 *
 *   1. F9 seed completeness for `opening_narrated` specifically — the exact
 *      kind called out in the design comment ("opening_narrated/recap/
 *      rebind/etc.") as the reason the ledger seeds from `sorted` (every
 *      event) rather than `rows` (only the ones that produced a LogRow), and
 *      the kind with 2026-07-01 regression precedent. Ren's own HISTORY
 *      fixture never includes an opening_narrated event.
 *   2. The ordering race between the mount rehydration effect (async,
 *      multi-fetch) and the poll effect's setInterval — both are gated by
 *      `state`, which flips to 'ok' BEFORE the rehydration Promise.all
 *      resolves (page.tsx line ~903 vs ~907). If rehydration is slower than
 *      POLL_INTERVAL_MS, the first poll tick can observe an EMPTY
 *      renderedSeqsRef (the seed hasn't run yet).
 *   3. journalEvents' merge-by-seq dedup computes `seen` ONCE from `prev` and
 *      never updates it while filtering `allNewEvents` — so it does not
 *      dedupe WITHIN a single tick's own batch. pollDurable's has_more
 *      pagination loop, combined with a since_seq-blind wire, can hand back
 *      the SAME page twice in one tick (see reconcileEvents.ts's own
 *      renderedSeqs, which — by contrast — mutates its dedup set as it
 *      iterates the sorted batch and is immune to this). Also: any event
 *      with a null/undefined seq is UNCONDITIONALLY "fresh" every tick
 *      (`e.seq == null` short-circuits the filter), independently bypassing
 *      the same guard.
 *   4. Recap narrowing holds by construction regardless of `data` contents
 *      (rule 3 gates on `e.kind`, never reads `data.turn_key` for the
 *      narration path) — proven directly against the pure function with a
 *      recap event carrying a spoofed key that WOULD match if the gate were
 *      data-driven instead of kind-driven.
 *   5. The two new console.debug tells (`ledger_seeded_from_rehydration`,
 *      `poll_page_redundant`) must never fire flag-OFF — a regression
 *      tripwire the existing dormancy suite doesn't assert (it never spies
 *      on console.debug at all).
 */
import React from 'react';
import { render, screen, act, within, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type {
  EngineSessionEvent,
  EventsPage,
  GroundingData,
  Participant,
  Session,
} from '@/lib/api/types';
import {
  reconcileDurableEvents,
  type PendingTurnEntry,
} from '@/lib/dnd/reconcileEvents';

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
const mockGetGrounding = jest.fn<Promise<GroundingData | null>, unknown[]>(() =>
  Promise.resolve(null),
);
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

const GROUNDING: GroundingData = {
  scene_id: 'approach',
  scene_name: 'The Approach',
  boxed_text: 'The cave mouth yawns before you.',
  objective: 'Reach the cave before the tide rises.',
  hook: 'A fishing crew vanished on the morning tide.',
  adventure_title: 'The Hollow Tide Cave',
  opening_lines: [],
  transitions: [],
  flags: {},
  encounter_state: {},
};

// Same shared mixed-kind history as Ren's own suite, PLUS an opening_narrated
// event at seq 0 (matching GROUNDING.scene_id) — the one null-mapping,
// grounding-dependent kind Ren's own fixture never included, despite the
// design comment naming it explicitly as the motivating case for seeding
// from `sorted` instead of `rows`.
const OPENING_EVENT: EngineSessionEvent = {
  seq: 1,
  kind: 'opening_narrated',
  data: { scene_id: 'approach', source: 'read_aloud_verbatim' },
  created_at: '2026-07-14T08:59:00Z',
};

const HISTORY: EngineSessionEvent[] = [
  { seq: 2, kind: 'session_start', created_at: '2026-07-14T09:00:00Z', data: {} },
  {
    seq: 3,
    kind: 'player_action',
    actor: 'leon',
    created_at: '2026-07-14T09:01:00Z',
    data: { who: 'leon', text: 'I light a candle.', turn_key: 'tk-old-1' },
  },
  {
    seq: 4,
    kind: 'narration',
    created_at: '2026-07-14T09:01:05Z',
    data: { who: 'Suzu', text: 'The room flickers into view.' },
  },
  {
    seq: 5,
    kind: 'recap',
    created_at: '2026-07-14T09:01:10Z',
    data: { who: 'Suzu', text: 'Previously, the tide rose fast.' },
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

const FULL_HISTORY = [OPENING_EVENT, ...HISTORY];

async function tick() {
  await act(async () => {
    jest.advanceTimersByTime(4000);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
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
  mockGetSession.mockResolvedValue(SESSION);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([]);
  mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue(GROUNDING);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockPostSessionEvent.mockResolvedValue({});
});

// ── 1. F9 seed completeness — opening_narrated survives a poll tick ─────────

describe('QA break-it — F9 seed and opening_narrated (grounding-dependent, mount-only special-case)', () => {
  it('the read-aloud block renders exactly once at mount and is neither duplicated nor erased by a poll tick that re-delivers the same opening_narrated event', async () => {
    mockGetSessionEventsRaw.mockResolvedValue([...FULL_HISTORY]);
    // checkShouldOpen (the LIVE opening trigger, a separate code path from
    // rehydration reconstruction) reads getSessionEvents — NOT
    // getSessionEventsRaw. It must also see the opening as already-persisted
    // so it does not fire a second, live read-aloud render on top of
    // rehydration's reconstructed one (that would be a false positive for
    // this test's own bug, not a Tavern bug — mirrors play.rehydration.test's
    // and play.ddx20-f9-recap.test's own convention).
    mockGetSessionEvents.mockResolvedValue([
      { event_type: 'opening_narrated', description: 'Already opened.' },
    ]);
    mockGetSessionEventsPage.mockImplementation(() =>
      Promise.resolve({
        events: [...FULL_HISTORY],
        max_seq: 7,
        has_more: false,
        pending_generation: null,
      }),
    );

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');
      await flush();

      const log = await screen.findByRole('log');

      // Mount: the full read-aloud block (grounding-reconstructed, not a
      // plain eventToLogRow mapping) is present exactly once.
      expect(within(log).getAllByText(/cave mouth yawns/i)).toHaveLength(1);

      await tick();
      // Poll tick 1 — the discriminator. The poll's own reconcile path
      // (reconcileDurableEvents rule 5) can NEVER reconstruct the read-aloud
      // block itself (eventToLogRow(opening_narrated) -> null unconditionally,
      // no grounding-aware special-casing outside the mount code) — so seeding
      // its seq at mount cannot suppress a "should-have-rendered-later" row.
      // This assertion is the flip side: confirm the row that WAS rendered at
      // mount also isn't wiped or doubled by the tick.
      expect(within(log).getAllByText(/cave mouth yawns/i)).toHaveLength(1);

      await tick();
      expect(within(log).getAllByText(/cave mouth yawns/i)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── 2. Ordering race — poll interval arms before rehydration resolves ──────

describe('QA break-it — poll-vs-rehydration ordering race', () => {
  it('a poll tick that fires while rehydration is still in flight does not leave a permanent artifact once rehydration lands', async () => {
    // state flips to 'ok' (arming the poll's setInterval, page.tsx ~line 903)
    // strictly BEFORE the rehydration Promise.all (grounding/participants/
    // rawEvents, ~line 907) resolves. Hold all three open past the first
    // POLL_INTERVAL_MS tick to force the poll effect's first invocation to
    // run against a still-empty renderedSeqsRef / lastEventSeqRef(0) /
    // rehydratedRef(false).
    let resolveGrounding!: (v: GroundingData | null) => void;
    let resolveParticipants!: (v: Participant[]) => void;
    let resolveRaw!: (v: EngineSessionEvent[] | null) => void;
    mockGetGrounding.mockReturnValue(
      new Promise((r) => {
        resolveGrounding = r;
      }),
    );
    mockGetParticipants.mockReturnValue(
      new Promise((r) => {
        resolveParticipants = r;
      }),
    );
    mockGetSessionEventsRaw.mockReturnValue(
      new Promise((r) => {
        resolveRaw = r;
      }),
    );
    mockGetSessionEventsPage.mockResolvedValue({
      events: [...HISTORY],
      max_seq: 7,
      has_more: false,
      pending_generation: null,
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      // getSession() (not deferred) resolves on its own — state flips to
      // 'ok', arming the poll interval — WITHOUT rehydration having started
      // its own state changes yet (grounding/participants/rawEvents are all
      // still pending).
      await screen.findByText('Test Table');
      await flush();

      // First poll tick fires while rehydration is STILL stuck.
      await tick();

      const log = await screen.findByRole('log');
      // The premature tick's own reconcile (empty ledger) is allowed to
      // render SOMETHING here (that's the known, documented cost of the
      // race) — but it must not be more than one copy of anything.
      const prematureCount = within(log).queryAllByText('I light a candle.').length;
      expect(prematureCount).toBeLessThanOrEqual(1);

      // Now let rehydration resolve. The mount code's unconditional
      // `setLog(rows)` (a plain replace, not an append) is the thing that
      // must win the race and produce the correct final state regardless of
      // whether the premature tick already ran.
      await act(async () => {
        resolveGrounding(GROUNDING);
        resolveParticipants(PARTY);
        resolveRaw([...HISTORY]);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      await flush();

      // Converged, correct, de-duplicated final state.
      expect(within(log).getAllByText('I light a candle.')).toHaveLength(1);
      expect(within(log).getAllByText('The room flickers into view.')).toHaveLength(1);
      expect(within(log).getAllByText('You spot a hidden door.')).toHaveLength(1);

      // A further tick (ledger now correctly seeded, from BOTH the
      // premature reconcile's own mutations and rehydration's explicit
      // seed) must stay stable, not drift.
      await tick();
      expect(within(log).getAllByText('I light a candle.')).toHaveLength(1);
      expect(within(log).getAllByText('The room flickers into view.')).toHaveLength(1);
      expect(within(log).getAllByText('You spot a hidden door.')).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── 3. journalEvents dedup does not survive a within-tick duplicate ────────

describe('QA break-it — journalEvents dedup does not cover within-tick duplicates', () => {
  it('FINDING: the has_more pagination loop re-fetching the same since_seq-blind page twice in ONE tick duplicates journalEvents, even though the transcript log itself stays clean', async () => {
    // Mount rehydration fails (engine transiently unreachable — the
    // documented, already-handled "render what we have" sentinel) so
    // journalEvents starts at its true initial state ([]), NOT pre-seeded
    // with the events the poll is about to (re)discover. This is the
    // realistic precondition for the bug: mount-time journalEvents seeding
    // would otherwise mask it (both duplicate copies would already be in
    // `seen` from mount, and get filtered out identically).
    mockGetSessionEventsRaw.mockResolvedValue(null);

    // has_more: true on every response (mock ignores since_seq, exactly like
    // the documented wire bug) — the client's own pagination loop
    // (page.tsx's pollDurable, `while (page.has_more && guard < 25)`) then
    // fetches a SECOND page, which — because since_seq is ignored — is
    // BYTE-IDENTICAL to the first. The loop's own "no forward progress"
    // guard (`pageMax <= sinceSeq`) breaks it after exactly 2 fetches, but
    // by then allNewEvents already contains every seq TWICE within the same
    // tick.
    mockGetSessionEventsPage.mockImplementation(() =>
      Promise.resolve({ events: [...HISTORY], max_seq: 7, has_more: true, pending_generation: null }),
    );

    // Kage-CR SUGGESTION (fold-pass polish) — this branch's own
    // `poll_page_redundant` tell was previously only verified by reading
    // console output during review, unlike the null-seq variant below (which
    // pins it with `toEqual`). Mirrored here so a regression that silences
    // the tell on THIS branch fails a test, not just a manual read.
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');
      await flush();

      await tick();

      const log = await screen.findByRole('log');
      // The transcript log is protected: reconcileDurableEvents mutates
      // renderedSeqs AS IT ITERATES the sorted batch, so the second copy of
      // each seq is skipped by rule 1 within the SAME call. Exactly one row
      // per row-producing kind.
      expect(within(log).getAllByText('I light a candle.')).toHaveLength(1);
      expect(within(log).getAllByText('The room flickers into view.')).toHaveLength(1);

      // journalEvents has no such protection — `seen` is computed once from
      // `prev` and never updated while filtering `allNewEvents`, so both
      // within-tick copies of every event pass the filter identically. Open
      // the Journal pane and check its recap-history section directly.
      const toggle = screen.getByRole('button', { name: 'Open journal' });
      toggle.focus();
      fireEvent.click(toggle);

      const recapSection = screen.getByText('Recap history').closest('section');
      if (!recapSection) throw new Error('recap section not found');

      // FINDING: this is expected to be 1 (matching the transcript's own
      // discipline) but reproduces at 2 against the current commit —
      // journalEvents duplicates every entry from the within-tick
      // pagination re-fetch. See finding write-up for repro details.
      expect(
        within(recapSection).getAllByText('Previously, the tide rose fast.'),
      ).toHaveLength(1);

      // Pinned tell (Kage-CR SUGGESTION): the has_more catch-up loop fetches
      // twice before its own "no forward progress" guard breaks it (6-event
      // HISTORY re-served both times = 12 fetched), and journalSeenSeqsRef
      // dedups each of the 6 keys' second occurrence = 6 fresh. Asserted by
      // exact shape, not just presence, so a regression that changes the
      // counts (not just silences the call) also fails here.
      const redundantCalls = debugSpy.mock.calls.filter((c) => c[0] === 'poll_page_redundant');
      expect(redundantCalls).toHaveLength(1);
      expect(redundantCalls).toEqual([['poll_page_redundant', { fetched: 12, fresh: 6 }]]);
    } finally {
      jest.useRealTimers();
      debugSpy.mockRestore();
    }
  });

  it('FINDING: an event with no seq at all is unconditionally "fresh" every tick — journalEvents duplicates it visibly, and the redundant-fetch observability tell never catches this variant either', async () => {
    mockGetSessionEventsRaw.mockResolvedValue(null);
    // A single malformed/no-seq event (e.g. a legacy row, a client-side
    // placeholder, or any future engine kind that omits seq). Uses 'recap'
    // specifically (not session_start) so its journalEvents-driven render
    // (JournalPane's "Recap history" section) is directly assertable — the
    // same visible surface finding #1 above uses, isolating THIS distinct
    // cause (missing seq, not the has_more loop: has_more stays false).
    const noSeqRecap: EngineSessionEvent = {
      kind: 'recap',
      created_at: '2026-07-14T09:00:00Z',
      data: { who: 'Suzu', text: 'Previously, no seq was assigned.' },
    };
    mockGetSessionEventsPage.mockImplementation(() =>
      Promise.resolve({
        events: [noSeqRecap],
        max_seq: 0,
        has_more: false,
        pending_generation: null,
      }),
    );

    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');
      await flush();

      // lastEventSeqRef never advances past 0 for a seq-less event (the
      // forward-progress bookkeeping uses `e.seq ?? 0`), so the wire keeps
      // re-serving the SAME no-seq event forever (it can never be cursored
      // past) and `e.seq == null` unconditionally short-circuits journalEvents'
      // filter to "fresh" every time — an unbounded-growth reproduction,
      // narrower than but mechanically identical in kind to the bug this
      // commit set out to fix.
      const toggle = screen.getByRole('button', { name: 'Open journal' });
      toggle.focus();
      fireEvent.click(toggle);
      await flush();

      await tick();
      await tick();
      await tick();

      const recapSection = screen.getByText('Recap history').closest('section');
      if (!recapSection) throw new Error('recap section not found');
      // FINDING: expected 1 (it is the literal same event every tick); this
      // commit's own dedup does not cover it, so it accumulates once per
      // tick — 3 occurrences after 3 ticks, and counting (UNLIKE the
      // has_more-pagination-loop finding above, this variant never
      // self-limits: every tick adds one more, forever, for as long as the
      // session stays mounted).
      const occurrences = within(recapSection).getAllByText(
        'Previously, no seq was assigned.',
      ).length;
      expect(occurrences).toBe(1);

      // Post-review update (Kage-CR SUGGESTION #3, fold commit) — this
      // assertion used to lock in a "Compounding gap": the tell stayed
      // SILENT for the null-seq variant because a null-seq event was always
      // counted as fresh, so `fetched`/`fresh` stayed numerically equal even
      // on a 100%-redundant tick. Kage's fold explicitly asks to close that
      // blind spot ("Make it actually tell"), and fixing the underlying
      // dedup (this file's own primary finding, `occurrences` above) does so
      // as a direct side effect: journalSeenSeqsRef now recognises the
      // re-served no-seq event as already-seen, so `fresh` correctly drops
      // to 0 on every tick AFTER the first. Flipped from "never fires" to
      // "fires exactly once per redundant tick" — tick 1 is genuinely new
      // (no tell), ticks 2 and 3 are each fully redundant (tell each time).
      const redundantCalls = debugSpy.mock.calls.filter((c) => c[0] === 'poll_page_redundant');
      expect(redundantCalls).toHaveLength(2);
      expect(redundantCalls).toEqual([
        ['poll_page_redundant', { fetched: 1, fresh: 0 }],
        ['poll_page_redundant', { fetched: 1, fresh: 0 }],
      ]);
    } finally {
      jest.useRealTimers();
      debugSpy.mockRestore();
    }
  });
});

// ── 4. Recap narrowing is kind-gated, not data-gated (defence in depth) ────

describe('QA break-it — recap exclusion holds regardless of `data` contents', () => {
  it('a recap event carrying a spoofed turn_key/client_key in `data` still cannot match rule 3 — the gate gate is `e.kind`, not a data-driven key lookup', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>([
      ['tk-1', { narrationRowId: 'r7', triggerSeq: 10, awaitingNarration: true }],
    ]);
    const noRow = () => undefined;
    // If rule 3's guard were ever accidentally refactored to key off
    // `data.turn_key` (mirroring rule 2/4's pattern) instead of `e.kind`,
    // THIS event would match and hijack 'tk-1' — data deliberately shaped
    // to look exactly like a real narration completion for the pending
    // turn.
    const spoofedRecap: EngineSessionEvent = {
      seq: 11,
      kind: 'recap',
      data: { text: 'Previously on…', turn_key: 'tk-1', client_key: 'tk-1' },
    };
    const result = reconcileDurableEvents([spoofedRecap], renderedSeqs, pendingByKey, noRow);
    expect(result.stamped).toHaveLength(0);
    expect(result.appended).toHaveLength(0);
    expect(pendingByKey.get('tk-1')?.awaitingNarration).toBe(true);
    expect(pendingByKey.get('tk-1')?.narrationRowId).toBe('r7');
  });

  it('a recap event with NO pending turns anywhere is a pure no-op — no phantom ledger entries, no crash', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>();
    const noRow = () => undefined;
    const lonelyRecap: EngineSessionEvent = {
      seq: 3,
      kind: 'recap',
      data: { text: 'Previously on…' },
    };
    const result = reconcileDurableEvents([lonelyRecap], renderedSeqs, pendingByKey, noRow);
    expect(result.stamped).toHaveLength(0);
    expect(result.appended).toHaveLength(0);
    expect(pendingByKey.size).toBe(0);
    expect(renderedSeqs.has(3)).toBe(true);
  });
});

// Flag-OFF byte-identity for the two new observability tells is covered in
// the sibling file play.ddx20-f9-recap.flag-off-debug.adversarial.test.tsx
// (needs the REAL config module at its shipped default, which is
// incompatible with this file's top-level `jest.mock('../../lib/config', ...
// DURABLE_GENERATION_ENABLED: true)`).
