/**
 * Miko-QA re-verification pass on the DDX-20 F9+Recap FOLD commit (70721c3,
 * parent 6e027cf) — NOT part of the fold itself. Verifies Findings 1+2 from
 * play.ddx20-f9-recap.adversarial.test.tsx are genuinely fixed (see that
 * file — unchanged, still the primary regression lock) and attacks the NEW
 * surface the fix itself introduces: `journalSeenSeqsRef`, a Set that now
 * PERSISTS across poll ticks for the lifetime of the component, instead of
 * being recomputed fresh each tick. A persistent ref is a different failure
 * class than a per-tick snapshot: it can drift from the state it's meant to
 * mirror, it never shrinks, and its lifetime assumptions (one ref per
 * session) are only as good as the code that seeds/reseeds it.
 *
 *   1. Same-instance session switch. PlayPage reads `sessionId` via
 *      `useParams()`, not a prop, and `journalSeenSeqsRef`'s reseed
 *      (page.tsx ~L942) sits OUTSIDE the `rehydratedRef` gate that guards
 *      its sibling `renderedSeqsRef` (~L1038) — a deliberate asymmetry, not
 *      an oversight (renderedSeqsRef's gate long predates this fold). This
 *      proves `journalSeenSeqsRef` does NOT go stale across a same-instance
 *      sessionId change, using the realistic adversarial construction where
 *      both sessions' seq spaces start at 1 (confirmed against the engine:
 *      msm_repo.py's sole seq-assigning writer scopes `MAX(seq)` per
 *      `campaign_id`, so two different sessions legitimately both have
 *      events at seq 1, 2, 3, ...).
 *
 *      Reachability note (verified, not assumed): `grep -rn
 *      "useRouter|router.push|router.replace" src/app/play` (excluding
 *      __tests__) returns nothing — this page never programmatically
 *      navigates itself. Every other `/play/` reference in the repo is
 *      either an inbound Link from a genuinely different top-level route
 *      (dashboard, modules, LevelUpButton — crossing route trees forces a
 *      real unmount) or a doc-comment (JournalPane.tsx:5, describes where
 *      the pane is rendered, not a navigation target). So there is currently
 *      NO in-app path that reuses a mounted PlayPage instance across two
 *      different sessionIds. This test is therefore defense-in-depth against
 *      React's own (undisputed, Next.js App Router-documented) same-instance
 *      reuse semantics for a dynamic-segment-only prop change, not a
 *      reproduction of a currently-live bug. Re-check this grep if play/
 *      ever grows its own internal navigation.
 *
 *   2. The documented `?? 0` collapse, constructed directly. The production
 *      comment (page.tsx ~L1340) accepts that two GENUINELY DISTINCT
 *      null-seq events landing in the same poll batch would collapse onto
 *      the shared key `0` and the second would be dropped — reasoned to be
 *      dormant because "both engine paths always emit seq today." This test
 *      proves exactly what happens if that ever stops being true, so the
 *      trade-off is a characterized, asserted behavior instead of only a
 *      comment. (Cross-repo verification of the "always emit seq" premise
 *      itself is reported in prose, not re-derivable from this repo alone —
 *      see the handoff.)
 *
 *   3. React.StrictMode double-invoke — actually exercised, not just
 *      reasoned about. No existing test in this suite renders under
 *      `<React.StrictMode>` (grepped to confirm: only play.opening.test.tsx
 *      discusses it in a comment). Proves the mount seed doesn't double-
 *      append under a real double-effect-invoke, and that the hoisted
 *      `console.debug` + the `setJournalEvents` updater survive React
 *      dev-mode's double-invoke-to-detect-impurity check for state updater
 *      functions.
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

// Mutable, unlike the sibling adversarial files' static mock — the whole
// point of the session-switch test is to change this value BETWEEN renders
// without unmounting. Jest's out-of-scope-variable check for `jest.mock`
// factories special-cases identifiers prefixed with `mock` (case-insensitive).
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

function openJournal() {
  const toggle = screen.getByRole('button', { name: 'Open journal' });
  fireEvent.click(toggle);
}

function getRecapSection(): HTMLElement {
  const el = screen.getByText('Recap history').closest('section');
  if (!el) throw new Error('recap section not found');
  return el as HTMLElement;
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockSessionId = 's1';
  // Default single-session fixture — tests that need a session SWITCH
  // (describe block 1) override this with their own mockImplementation.
  mockGetSession.mockResolvedValue(makeSession('s1', 'Test Table'));
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([]);
  mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue(GROUNDING);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockPostSessionEvent.mockResolvedValue({});
});

// ── 1. Same-instance session switch ─────────────────────────────────────────

describe('QA re-verify — journalSeenSeqsRef does not go stale across a same-instance session switch', () => {
  it("session B's own seq 1..3 events are not suppressed by session A's (also seq 1..3) leftover ledger", async () => {
    const SESSION_A = makeSession('s1', 'Table A');
    const SESSION_B = makeSession('s2', 'Table B');

    // Deliberately identical seq NUMBERS across sessions — realistic, not
    // contrived: msm_repo.py's sole writer scopes `COALESCE(MAX(seq),0)+1`
    // per campaign_id, so every session's seq space independently starts
    // at 1. A ref that was never reseeded (or reseeded to the wrong
    // session) would not necessarily show up as "empty" here — it could
    // coincidentally already contain {1,2,3} from session A and silently
    // eat session B's real events too.
    const EVENTS_A: EngineSessionEvent[] = [
      { seq: 1, kind: 'session_start', created_at: '2026-07-14T09:00:00Z', data: {} },
      {
        seq: 2,
        kind: 'recap',
        created_at: '2026-07-14T09:01:00Z',
        data: { who: 'Suzu', text: 'Previously in table A.' },
      },
      {
        seq: 3,
        kind: 'narration',
        created_at: '2026-07-14T09:01:05Z',
        data: { who: 'Suzu', text: 'Table A opens the door.' },
      },
    ];
    const EVENTS_B: EngineSessionEvent[] = [
      { seq: 1, kind: 'session_start', created_at: '2026-07-15T09:00:00Z', data: {} },
      {
        seq: 2,
        kind: 'recap',
        created_at: '2026-07-15T09:01:00Z',
        data: { who: 'Suzu', text: 'Previously in table B.' },
      },
      {
        seq: 3,
        kind: 'narration',
        created_at: '2026-07-15T09:01:05Z',
        data: { who: 'Suzu', text: 'Table B opens the door.' },
      },
    ];

    mockGetSession.mockImplementation((...args: unknown[]) =>
      Promise.resolve(args[0] === 's2' ? SESSION_B : SESSION_A),
    );
    mockGetSessionEventsRaw.mockImplementation((...args: unknown[]) =>
      Promise.resolve(args[0] === 's2' ? [...EVENTS_B] : [...EVENTS_A]),
    );
    mockGetSessionEventsPage.mockImplementation((...args: unknown[]) =>
      Promise.resolve({
        events: args[0] === 's2' ? [...EVENTS_B] : [...EVENTS_A],
        max_seq: 3,
        has_more: false,
        pending_generation: null,
      }),
    );

    jest.useFakeTimers();
    try {
      const { rerender } = render(<PlayPage />);
      await screen.findByText('Table A');
      await flush();

      openJournal();
      expect(within(getRecapSection()).getAllByText('Previously in table A.')).toHaveLength(1);

      // Session A's own redundant tick, fully absorbed — baseline sanity,
      // not the point of this test (already covered by the sibling file).
      await tick();
      expect(within(getRecapSection()).getAllByText('Previously in table A.')).toHaveLength(1);

      // ── the switch: SAME component instance, sessionId prop changes ─────
      mockSessionId = 's2';
      rerender(<PlayPage />);
      await screen.findByText('Table B');
      await flush();

      // Session B's content must actually render (mount-time
      // setJournalEvents(journalSeed) is an unconditional REPLACE, so this
      // alone doesn't yet distinguish "ref correctly reseeded" from "ref
      // stale" — the discriminator is the poll tick below).
      expect(within(getRecapSection()).getAllByText('Previously in table B.')).toHaveLength(1);
      expect(within(getRecapSection()).queryAllByText('Previously in table A.')).toHaveLength(0);

      // The discriminator: session B's OWN seq 1..3 re-served verbatim
      // (since_seq-blind wire, same shape as every other test in this
      // suite). A correctly-reseeded ref treats this as fully redundant
      // (fresh:0). A ref that silently carried session A's {1,2,3} forward
      // would ALSO produce fresh:0 here BUT would have already dropped
      // session B's real content at the assertion above — so the two
      // assertions together are what actually distinguish "reseeded to B"
      // from "never reseeded at all".
      const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
      await tick();
      expect(within(getRecapSection()).getAllByText('Previously in table B.')).toHaveLength(1);
      const redundant = debugSpy.mock.calls.filter((c) => c[0] === 'poll_page_redundant');
      expect(redundant).toHaveLength(1);
      expect(redundant[0]).toEqual(['poll_page_redundant', { fetched: 3, fresh: 0 }]);
      debugSpy.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── 2. The `?? 0` collapse, constructed directly ────────────────────────────

describe('QA re-verify — the `?? 0` collapse: two GENUINELY DISTINCT null-seq events in one batch', () => {
  it('characterization (accepted trade-off per the production comment, not a regression): the SECOND null-seq event in a tick is silently dropped and never rendered, even once', async () => {
    // Same precondition as the sibling file's Finding-2 test: mount
    // rehydration fails, so journalSeenSeqsRef starts genuinely empty (not
    // pre-armed from mount), isolating this from the mount-seed path.
    mockGetSessionEventsRaw.mockResolvedValue(null);

    const first: EngineSessionEvent = {
      kind: 'recap',
      created_at: '2026-07-14T09:00:00Z',
      data: { who: 'Suzu', text: 'First unnumbered recap.' },
    };
    const second: EngineSessionEvent = {
      kind: 'recap',
      created_at: '2026-07-14T09:00:01Z',
      data: { who: 'Suzu', text: 'Second unnumbered recap.' },
    };
    // Both delivered in the SAME page/tick, has_more:false (isolates this
    // from the has_more pagination-loop finding — that one duplicates,
    // this one drops).
    mockGetSessionEventsPage.mockImplementation(() =>
      Promise.resolve({
        events: [first, second],
        max_seq: 0,
        has_more: false,
        pending_generation: null,
      }),
    );

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');
      await flush();

      openJournal();
      await flush();

      await tick();

      const recapSection = getRecapSection();
      // `allNewEvents` is NOT re-sorted before pollDurable's dedup loop
      // (page.tsx ~L1288, confirmed by reading the source) — it iterates
      // `page.events` in wire order, so the FIRST seq-less event in the
      // array claims the shared key `0`; the second is treated as
      // "already rendered" before it is ever appended to journalEvents.
      // This is a one-shot drop, not a duplicate — assert by absence.
      expect(within(recapSection).queryAllByText('First unnumbered recap.')).toHaveLength(1);
      expect(within(recapSection).queryAllByText('Second unnumbered recap.')).toHaveLength(0);

      // The drop is permanent for the life of the mount, not just this
      // tick — the wire is since_seq-blind for a seq-less event (it can
      // never be cursored past, `lastEventSeqRef` uses `e.seq ?? 0`), so
      // the SAME pair re-arrives every tick and the second is re-dropped
      // every time, never once slipping through.
      await tick();
      await tick();
      expect(within(recapSection).queryAllByText('First unnumbered recap.')).toHaveLength(1);
      expect(within(recapSection).queryAllByText('Second unnumbered recap.')).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── 3. React.StrictMode double-invoke, actually exercised ──────────────────

describe('QA re-verify — React.StrictMode double-invoke purity (new technique: no other test in this suite renders under StrictMode)', () => {
  it('the mount seed does not double-append under a real double-effect-invoke, and a redundant poll tick logs the tell exactly once (updater purity)', async () => {
    const HISTORY: EngineSessionEvent[] = [
      { seq: 1, kind: 'session_start', created_at: '2026-07-14T09:00:00Z', data: {} },
      {
        seq: 2,
        kind: 'recap',
        created_at: '2026-07-14T09:01:00Z',
        data: { who: 'Suzu', text: 'Strict mode recap.' },
      },
    ];
    mockGetSessionEventsRaw.mockResolvedValue([...HISTORY]);
    mockGetSessionEventsPage.mockImplementation(() =>
      Promise.resolve({ events: [...HISTORY], max_seq: 2, has_more: false, pending_generation: null }),
    );

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    jest.useFakeTimers();
    try {
      render(
        <React.StrictMode>
          <PlayPage />
        </React.StrictMode>,
      );
      await screen.findByText('Test Table');
      await flush();

      openJournal();
      await flush();

      // Mount-time seed: exactly one copy, not two, despite StrictMode
      // invoking the mount effect (and therefore
      // `journalSeenSeqsRef.current = new Set(...)` + `setJournalEvents`)
      // twice. Both are plain REPLACE assignments (not merges/appends), so
      // this is expected to hold — proving it empirically rather than by
      // reading the source only.
      expect(within(getRecapSection()).getAllByText('Strict mode recap.')).toHaveLength(1);

      // A double-seed of a list keyed by `recap-${seq}` (journal.ts's
      // deriveRecapHistory) would surface as a React duplicate-key warning
      // even if the visible count above happened to look right.
      const keyWarnings = errorSpy.mock.calls.filter((c) =>
        String(c[0]).includes('two children with the same key'),
      );
      expect(keyWarnings).toHaveLength(0);

      // A fully-redundant poll tick must log the tell exactly once, not
      // twice — the real check on whether hoisting console.debug OUT of
      // the setJournalEvents updater (Kage-CR's suggestion) actually
      // matters: React dev builds double-invoke the FUNCTION FORM of a
      // state updater to catch impurity. If the debug call were still
      // inside the updater, this assertion would be the one to catch a
      // regression back to double-logging.
      await tick();
      const redundant = debugSpy.mock.calls.filter((c) => c[0] === 'poll_page_redundant');
      expect(redundant).toHaveLength(1);
      expect(redundant[0]).toEqual(['poll_page_redundant', { fetched: 2, fresh: 0 }]);
    } finally {
      jest.useRealTimers();
      debugSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
