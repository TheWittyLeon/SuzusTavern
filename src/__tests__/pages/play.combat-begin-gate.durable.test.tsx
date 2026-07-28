/**
 * Miko-QA adversarial gate (2026-07-28) on the uncommitted TAVERN PLAY-UI
 * NITS (a)+(b) diff, branch `hardening/tavern-ui-2026-07-17` — the DURABLE
 * generation path (`DURABLE_GENERATION_ENABLED=true`), the path live on the
 * dev stack (10.69.69.226) Leon feel-checks this build on.
 *
 * The shipped `play.combat-begin-gate.test.tsx` never mocks `../../lib/
 * config`, so its own "disables while narration is in flight" case (test 3)
 * only exercises the LEGACY `streamDmNarration` path. This file is the
 * durable sibling (mirrors the play.struct006-gate-refetch.test.tsx /
 * play.struct006-gate-refetch.flag-off.test.tsx pairing convention) and
 * pins two real gaps found while probing the durable path specifically —
 * both handed to Ren-Dev as findings, neither fixed here (QA doesn't touch
 * production code):
 *
 *   FINDING A (MEDIUM) — `resumeThinking` (page.tsx ~4431: `DURABLE_
 *   GENERATION_ENABLED && !talking && activeJob != null`) is never folded
 *   into ANY `disabled` expression in page.tsx, including this button's new
 *   one (`talking || combatBusy || sessionLocked || rollBusy`). subscribe
 *   ToJob's finalization (page.tsx ~1084-1086) unconditionally clears
 *   `talking`/`subscribedJobIdRef` once its SSE tail ends — whether the tail
 *   ended because the beat genuinely finished, OR because the connection
 *   merely dropped (backgrounded tab, reverse-proxy idle-timeout) while the
 *   engine is still actually generating. In that second case `activeJob`
 *   stays non-null (nothing has cleared it — the next poll tick, up to
 *   POLL_INTERVAL_MS=4000ms away, is what would either re-subscribe or
 *   confirm the job is dead), so `resumeThinking` is true and the ChatLog
 *   visibly shows "Resuming Suzu's turn…" — but `talking` is already false
 *   again, and none of the other three terms cover this either. The button
 *   (and all 5 siblings gated on the identical `talking`-based pattern) is
 *   fully interactive during that window. See test group A2 below.
 *
 *   FINDING B (MEDIUM) — the durable poll's own grounding-invalidation
 *   refetch (page.tsx ~1723-1727: `getGrounding(sessionId).then(...).catch
 *   (() => {})`) silently swallows a fetch failure WITHOUT calling
 *   `setGrounding` — unlike `refreshGrounding()` (~2244-2249), which fails
 *   CLOSED (nulls grounding on failure). `refreshGrounding()` is only
 *   reachable from the LEGACY `narrate()` SSE path, dormant under this flag
 *   — so on the durable path (this file), a scene transition INTO a
 *   non-encounter scene, straddled by a transient grounding-refetch
 *   failure, leaves this button mounted+enabled for the scene the player
 *   already left. Clicking it reproduces the ORIGINAL "always 400s" bug
 *   this diff exists to close, narrowed to that race window instead of
 *   every non-encounter scene. See test group B below (paired with a
 *   same-shape success control, B0, proving the happy path this regresses
 *   from is itself real and this-file-covered).
 *
 * Both A2 and B are characterization tests (GREEN — pinning TODAY's actual
 * behavior as an explicit, commented regression tripwire) per this
 * codebase's own established convention for a disclosed-but-not-blocking
 * gap (see e.g. play.ddx20-pass3-synthetic-beats.test.tsx's file banner).
 * They are not proof the behavior is correct.
 *
 * Mock-indirection / `pageWith`/`tick()` helpers mirror play.struct006-
 * gate-refetch.test.tsx; the `mockSubscribeDmJob` async-generator pattern
 * mirrors play.ddx20-durable-turn.test.tsx.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type {
  EngineSessionEvent,
  EventsPage,
  GroundingData,
  Participant,
  Session,
} from '@/lib/api/types';

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
// whole file (the dev-stack/prod path). Mirrors play.ddx20-durable-turn.
// test.tsx / play.struct006-gate-refetch.test.tsx.
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
const mockCombatFromScene = jest.fn<Promise<unknown>, unknown[]>();
const mockRollInitiative = jest.fn<Promise<unknown>, unknown[]>(() =>
  Promise.resolve({ message: 'Initiative rolled.' }),
);
const mockPostRoll = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getSessionEventsPage: (...args: Parameters<AnyFn>) => mockGetSessionEventsPage(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  combatFromScene: (...args: Parameters<AnyFn>) => mockCombatFromScene(...args),
  rollInitiative: (...args: Parameters<AnyFn>) => mockRollInitiative(...args),
  postRoll: (...args: Parameters<AnyFn>) => mockPostRoll(...args),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
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
      name: 'Anomaly',
      char_class: 'Ranger',
      level: 1,
      current_hp: 10,
      max_hp: 10,
      ac: 13,
    },
  },
];

/** A scene with an authored combat encounter — the render gate reads
 *  presence alone (page.tsx `sceneHasEncounter`). */
const GROUNDING_WITH_ENCOUNTER: GroundingData = {
  scene_id: 'everfree_flight',
  scene_name: 'Flight Through the Everfree',
  boxed_text: 'The pack is closing in.',
  transitions: [],
  checks: [],
  flags: {},
  encounter_state: {},
  encounter: { kind: 'combat', trigger: 'manual' },
};

/** The scene the party advances to mid-session — no authored encounter. */
const GROUNDING_NO_ENCOUNTER: GroundingData = {
  scene_id: 'anchor_arrival_outskirts',
  scene_name: 'The Outskirts',
  boxed_text: 'The road winds on.',
  transitions: [],
  checks: [],
  flags: {},
  encounter_state: {},
  encounter: null,
};

const FROM_SCENE_RESULT = {
  combat_id: 'combat-flight',
  round: 1,
  monsters: [
    { participant_id: 'w1', name: 'Timberwolf', hp: 19, from_ref: 'dnd5e:monster:mlp-timberwolf' },
  ],
  terrain: {},
  encounter_id: 'everfree_timberwolves',
};

/** An EventsPage whose pending_generation reports one in-flight job. */
function pendingPage(jobId: string, turnKey = 'tk-resume'): EventsPage {
  return {
    events: [],
    max_seq: 5,
    has_more: false,
    pending_generation: {
      turn_key: turnKey,
      job_id: jobId,
      status: 'streaming',
      trigger_seq: 5,
      started_at: '2026-07-28T10:00:00Z',
    },
  };
}

function sceneAdvanceEvent(seq: number): EngineSessionEvent {
  return {
    seq,
    kind: 'scene_advance',
    actor: 'leon',
    visibility: 'table',
    created_at: '2026-07-28T10:00:00Z',
    data: { to_scene: 'anchor_arrival_outskirts' },
  };
}

function pageWith(...events: EngineSessionEvent[]): EventsPage {
  const maxSeq = events.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
  return { events, max_seq: maxSeq, has_more: false, pending_generation: null };
}

/** Advance one poll cycle (4s) then drain the async pollDurable chain,
 *  including a subscribeToJob SSE tail (deeper microtask chain than a
 *  plain fetch — extra flush passes vs. struct006's 3x are cheap/no-op
 *  once a chain is already drained). */
async function tick() {
  await act(async () => {
    jest.advanceTimersByTime(4000);
  });
  await act(async () => {
    for (let i = 0; i < 8; i += 1) {
       
      await Promise.resolve();
    }
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
  mockGetGrounding.mockResolvedValue(GROUNDING_WITH_ENCOUNTER);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockCombatFromScene.mockResolvedValue(FROM_SCENE_RESULT);
  // beginEncounter's own combat-start beat, fired via narrateDurableBeat
  // after combatFromScene resolves (page.tsx ~3484-3490) — every test that
  // clicks the button through to a real combatFromScene call reaches this;
  // unmocked it resolves `undefined`, and `'busy' in handle` throws.
  mockPostDmTurn.mockResolvedValue({
    job_id: 'job-click',
    turn_key: 'tk-click',
    status: 'pending',
    deduped: false,
  });
});

describe('Question A1 (positive control) — a durable job THIS client is actively tailing disables the button', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('poll-discovered job with an open SSE tail (talking=true) disables "Stand and fight"; a click while disabled never fires combatFromScene', async () => {
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'Suzu is still narrating.' };
      await new Promise(() => {}); // never completes — talking stays true
    });

    render(<PlayPage />);
    await screen.findByText('Test Table');
    const fightBtn = await screen.findByRole('button', { name: /Stand and fight/i });
    expect(fightBtn).not.toBeDisabled();

    // Poll discovers another client's in-flight job -> subscribeToJob ->
    // setTalking(true) synchronously, same tick (page.tsx ~947) as
    // setActiveJob (~1783) -> React 18 batches both into one render, so
    // this is never observably a "disabled without also busy" state.
    mockGetSessionEventsPage.mockResolvedValue(pendingPage('job-other'));
    await tick();

    expect(fightBtn).toBeDisabled();

    // Native DOM semantics: a disabled button does not dispatch click to
    // its handler. This is the mechanism's own proof, not a UI-only nicety.
    fireEvent.click(fightBtn);
    expect(mockCombatFromScene).not.toHaveBeenCalled();
  });
});

describe('Question A2 — FINDING: the "tail dropped, job still active" resume window is not covered by any of the 4 disabled terms', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('an SSE tail that ends WITHOUT ctrl.signal.aborted (dropped connection, not a real completion) leaves the button enabled while "Resuming Suzu\'s turn…" is visibly shown; clicking it fires combatFromScene unguarded', async () => {
    // subscribeDmJob's async generator yields one chunk then returns
    // normally — no `done`, no `error`, no throw. subscribeToJob (page.tsx
    // ~1012-1086) has no way to distinguish this from a genuine early
    // close: its post-loop finalization unconditionally runs
    // `setThinking(false); setTalking(false); subscribedJobIdRef.current =
    // null;` whenever the tail ends and `ctrl.signal.aborted` is false —
    // which is also true here.
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'Suzu starts narrating, then the tail dies.' };
    });

    render(<PlayPage />);
    await screen.findByText('Test Table');
    const fightBtn = await screen.findByRole('button', { name: /Stand and fight/i });

    mockGetSessionEventsPage.mockResolvedValue(pendingPage('job-dropped'));
    await tick();

    // Observable proxy for `resumeThinking === true` (page.tsx ~4431:
    // DURABLE_GENERATION_ENABLED && !talking && activeJob != null):
    // activeJob is still the object this same tick's discovery set (no
    // later poll tick has run to clear or refresh it), and talking has
    // already gone false again per the tail's finalization above.
    expect(screen.getByText(/Resuming Suzu's turn/i)).toBeInTheDocument();

    // FINDING: none of talking / combatBusy / sessionLocked / rollBusy
    // reflect this — the button is fully interactive despite the visible
    // "still composing" indicator right above it.
    expect(fightBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(fightBtn);
    });
    expect(mockCombatFromScene).toHaveBeenCalledTimes(1);
  });
});

describe('Question B — grounding degradation straddling a scene transition (durable poll path)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function mountWithEncounter() {
    render(<PlayPage />);
    await screen.findByText('Test Table');
    expect(await screen.findByRole('button', { name: /Stand and fight/i })).toBeInTheDocument();
  }

  it('B0 (success control): a scene_advance event whose grounding refetch resolves to no-encounter correctly unmounts the button', async () => {
    await mountWithEncounter();

    mockGetGrounding.mockResolvedValueOnce(GROUNDING_NO_ENCOUNTER);
    mockGetSessionEventsPage.mockResolvedValue(pageWith(sceneAdvanceEvent(5)));
    await tick();

    expect(screen.queryByRole('button', { name: /Stand and fight/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Begin an encounter/i })).not.toBeInTheDocument();
  });

  it('FINDING: a scene_advance event whose grounding refetch FAILS leaves the button mounted+enabled for the scene the player already left', async () => {
    await mountWithEncounter();

    // page.tsx ~1723-1727 (durable poll's grounding-invalidation branch):
    // `getGrounding(sessionId).then((g) => { if (invalidatesGrounding)
    // setGrounding(g); ... }).catch(() => {})` — a rejection is swallowed
    // WITHOUT ever calling setGrounding, unlike refreshGrounding()
    // (~2244-2249: `.catch(() => null)` THEN unconditionally
    // `setGrounding(g)` — fails CLOSED). refreshGrounding() only runs from
    // the legacy narrate() SSE path, dormant under this flag — so on the
    // durable path `grounding` is left at its STALE (pre-transition) value.
    mockGetGrounding.mockRejectedValueOnce(new Error('engine unreachable'));
    mockGetSessionEventsPage.mockResolvedValue(pageWith(sceneAdvanceEvent(5)));
    await tick();

    const staleBtn = screen.getByRole('button', { name: /Stand and fight/i });
    expect(staleBtn).not.toBeDisabled();

    // Reproduces the ORIGINAL bug this diff exists to close — server-side
    // this 400s "No encounter available for the current scene." for the
    // scene the player is actually now on (that 400/toast path is already
    // covered elsewhere, e.g. adv6-play-edge.test.tsx); resolved here only
    // to prove the client is willing to fire the mutation unguarded.
    await act(async () => {
      fireEvent.click(staleBtn);
    });
    expect(mockCombatFromScene).toHaveBeenCalledTimes(1);
  });
});

describe('Question C — sessionLocked (new 3rd term) engages the gate mid-session, no reload required', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('the session-status poll observing status=paused disables "Stand and fight"', async () => {
    render(<PlayPage />);
    await screen.findByText('Test Table');
    const fightBtn = await screen.findByRole('button', { name: /Stand and fight/i });
    expect(fightBtn).not.toBeDisabled();

    mockGetSession.mockResolvedValue({ ...SESSION, status: 'paused' });
    await tick();

    expect(fightBtn).toBeDisabled();
  });
});

describe('Question A (4th term) — rollBusy engages the gate', () => {
  it('a dice-tray roll left in flight (postRoll unresolved) also disables "Stand and fight"', async () => {
    let resolveRoll!: (v: unknown) => void;
    mockPostRoll.mockReturnValue(
      new Promise((r) => {
        resolveRoll = r;
      }),
    );

    render(<PlayPage />);
    await screen.findByText('Test Table');
    const fightBtn = await screen.findByRole('button', { name: /Stand and fight/i });
    expect(fightBtn).not.toBeDisabled();

    // DiceTray lives in the mobile "Scene" tab pane (mirrors
    // play.ddx08-dice-roll.test.tsx's renderAndOpenScene helper).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /scene/i }));
    });
    const d20btn = await screen.findByRole('button', { name: /^Roll d20$/i });
    await act(async () => {
      fireEvent.click(d20btn);
    });

    expect(fightBtn).toBeDisabled();

    await act(async () => {
      resolveRoll({
        kind: 'raw',
        notation: '1d20',
        rolls: [12],
        kept: 12,
        total: 12,
        description: 'Rolled d20: 12.',
        event_seq: 1,
      });
    });
  });
});
