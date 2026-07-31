/**
 * Check Retry + Fail-Forward (2026-07-28 design) — Miko-QA ADVERSARIAL pass,
 * Tavern client. Break-it coverage on top of Ren-Dev's own
 * play.check-retry.test.tsx (items 20-27) and the struct006-gate-refetch
 * extensions (item 25).
 *
 *   1. Unknown/future lock_reason -> graceful fallback copy (not a crash),
 *      confirmed as a DELIBERATE match to the engine's own complication_line
 *      fallback convention, not an oversight.
 *   2. Malformed/partial wire payload (attempts_used/max_attempts present,
 *      `state` absent) -- every SceneCheck field is independently optional
 *      in types.ts, so nothing in the type system stops a future/buggy
 *      backend from sending this combination even though the real engine's
 *      project_checks_for_wire always sets all four fields atomically.
 *   3. DOUBLE-FETCH measurement: the acting client's own inline
 *      refreshGrounding() PLUS the same check_resolved event later arriving
 *      via its own durable poll -- quantified, not assumed.
 *   4. Spectator asymmetry: a client that did NOT submit the check sees the
 *      rail update (via GROUNDING_INVALIDATING_KINDS) but gets no payoff
 *      toast -- confirmed as consistent with the design's own framing (the
 *      toast is submitting-client UX, not a table-wide broadcast).
 *   5. checkBusyRef latch: two rapid clicks issue exactly one resolveCheck
 *      call, proving the client-side double-submit guard actually holds
 *      (ref-based, set before the first await -- not a stale-closure race).
 *   6. escalate_dc changing `dc` changes the `${skill}-${dc}` React key
 *      (page.tsx ~L5565) -- confirms a still-available (non-locked,
 *      non-resolved) check button survives an unmount/remount from a DC
 *      bump without getting stuck disabled or losing click-ability.
 *   7. Hostile note / lock_reason text renders as literal text, not markup
 *      (React's default JSX escaping -- no dangerouslySetInnerHTML on this
 *      path).
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type {
  EngineSessionEvent,
  EventsPage,
  GroundingData,
  NarrationEvent,
  Participant,
  SceneCheck,
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

// Fixed true (the prod path) -- needed for the double-fetch test's durable
// poll mechanics. Mirrors play.struct006-gate-refetch.test.tsx.
jest.mock('../../lib/config', () => ({
  DURABLE_GENERATION_ENABLED: true,
  OAUTH_ENABLED: false,
  CODEX_ENABLED: false,
}));

const EMPTY_PAGE: EventsPage = { events: [], max_seq: 0, has_more: false, pending_generation: null };

const mGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mGetParticipants = jest.fn<Promise<unknown>, unknown[]>();
const mGetGrounding = jest.fn<Promise<unknown>, unknown[]>();
const mGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mGetSessionEventsRaw = jest.fn<Promise<EngineSessionEvent[] | null>, unknown[]>(() =>
  Promise.resolve([]),
);
const mGetSessionEventsPage = jest.fn<Promise<EventsPage>, unknown[]>(() =>
  Promise.resolve(EMPTY_PAGE),
);
const mResolveCheck = jest.fn<Promise<unknown>, unknown[]>();
// Miko-QA / Ren-Dev tsc fix (2026-07-28): explicit generics -- an untyped
// `jest.fn(async function* () {...})` locks the mock's inferred return type
// to whatever that FIRST generator body yields (here, just `{kind:'done'}`),
// so the beforeEach below's broader `mockImplementation` (which also yields
// a `{kind:'chunk', text}` variant) fails assignability. Typed against the
// real NarrationEvent union so both shapes are valid from the start.
const mStream = jest.fn<AsyncGenerator<NarrationEvent, void, unknown>, unknown[]>(
  async function* () {
    yield { kind: 'done' as const };
  },
);
// DURABLE_GENERATION_ENABLED is forced true below, so onAttemptCheck's
// trailing flavor-narration beat goes through narrateDurableBeat ->
// postDmTurn, never the legacy streamDmNarration -- mirrors
// play.p4-offered-check-durable.test.tsx's own note on this exact
// follow-up-beat plumbing. Not itself under test here; a plain "created"
// resolution just keeps that follow-up call from throwing.
const mPostDmTurn = jest.fn<Promise<unknown>, unknown[]>(() =>
  Promise.resolve({ job_id: 'job-followup', turn_key: 'tk-followup', status: 'pending', deduped: false }),
);

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...a: unknown[]) => mGetSession(...a),
  getParticipants: (...a: unknown[]) => mGetParticipants(...a),
  getGrounding: (...a: unknown[]) => mGetGrounding(...a),
  getSessionEvents: (...a: unknown[]) => mGetSessionEvents(...a),
  getSessionEventsRaw: (...a: unknown[]) => mGetSessionEventsRaw(...a),
  getSessionEventsPage: (...a: unknown[]) => mGetSessionEventsPage(...a),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
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
  resolveCheck: (...a: unknown[]) => mResolveCheck(...a),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: (...a: unknown[]) => mStream(...a),
  postDmTurn: (...a: unknown[]) => mPostDmTurn(...a),
  subscribeDmJob: jest.fn(async function* () {
    /* not exercised -- every test here settles via the durable poll, not SSE */
  }),
}));

import PlayPage from '@/app/play/[sessionId]/page';

const SESSION: Session = {
  session_id: 's1',
  channel: 'checkretry_adv_channel',
  name: 'Test Table',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['leon'],
  player_count: 1,
  active_combat_id: null,
  dm_mode: 'ai',
  ai_assist_level: 'full',
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

function grounding(checks: SceneCheck[]): GroundingData {
  return {
    scene_id: 'scene_a',
    scene_name: 'Scene A',
    boxed_text: 'The wood presses close.',
    objective: 'Find a way through.',
    transitions: [],
    checks,
    flags: {},
    encounter_state: {},
  };
}

function checkResolvedEvent(seq: number): EngineSessionEvent {
  return {
    seq,
    kind: 'check_resolved',
    actor: 'leon',
    visibility: 'table',
    created_at: '2026-07-28T10:00:00Z',
    data: { skill: 'survival', dc: 13, total: 16, success: true, flag_set: 'beat_a' },
  };
}

function pageWith(...events: EngineSessionEvent[]): EventsPage {
  const maxSeq = events.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
  return { events, max_seq: maxSeq, has_more: false, pending_generation: null };
}

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetSessionEvents.mockResolvedValue([]);
  mGetSessionEventsRaw.mockResolvedValue([]);
  mGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
  mStream.mockImplementation(async function* () {
    yield { kind: 'chunk' as const, text: 'Suzu narrates.' };
    yield { kind: 'done' as const };
  });
});

// ── 1. unknown lock_reason -> graceful fallback, not a crash ───────────────

describe('adversarial 1 — unknown lock_reason falls back gracefully', () => {
  it('a lock_reason the client has no copy for renders the max_attempts fallback line, not a crash/blank', async () => {
    mGetGrounding.mockResolvedValue(
      grounding([
        {
          skill: 'survival',
          dc: 13,
          state: 'locked',
          attempts_used: 1,
          max_attempts: 3,
          // @ts-expect-error -- deliberately a reason the client's copy map doesn't know.
          lock_reason: 'spent_a_resource',
        },
      ]),
    );
    render(<PlayPage />);
    const btn = await screen.findByRole('button', { name: /Survival, DC 13 — closed/i });
    // SPEC CHANGE (Iro-A11y MAJOR-3/MAJOR-4, 2026-07-28): a purely-locked
    // check is aria-disabled, not native disabled -- see
    // play.check-retry.test.tsx item 21 for the full rationale.
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    // Same fallback convention as the engine's own complication_line()
    // (engine/check_policy.py L205-207): an unrecognised reason reads as
    // "Out of attempts." This is semantically WRONG for a genuinely novel
    // reason, but it is non-empty, non-crashing, and matches a convention
    // the engine independently chose too -- reported as verified-consistent,
    // not a fresh defect.
    expect(btn).toHaveTextContent(/Out of attempts\./);
  });
});

// ── 2. malformed/partial wire payload -------------------------------------

describe('adversarial 2 — partial wire payload (state absent, counters present)', () => {
  it('attempts_used/max_attempts present but state absent does NOT render as locked, and does NOT pick up the last-attempt label either (FIXED, Miko-QA Finding 5)', async () => {
    mGetGrounding.mockResolvedValue(
      grounding([
        {
          skill: 'survival',
          dc: 13,
          attempts_used: 1,
          max_attempts: 2,
          // state and lock_reason both absent -- a combination the real
          // engine's project_checks_for_wire never produces (it always sets
          // all four fields together), but nothing in SceneCheck's type
          // (every retry field is independently optional) prevents it.
        },
      ]),
    );
    render(<PlayPage />);
    // Renders enabled (not locked) -- isLocked only checks state === 'locked'.
    const btn = await screen.findByRole('button', { name: /Attempt Survival, DC 13/i });
    expect(btn).not.toBeDisabled();
    // MIKO FINDING 5 (LOW) -- FIXED (Ren-Dev, 2026-07-28): isLastAttempt's
    // guard now requires `state === 'available'` explicitly (both render
    // sites, page.tsx), not merely `!isLocked`. A partial/future payload
    // that sets the counters without `state` no longer gets the
    // "last attempt" label -- it degrades to the same plain
    // "Attempt Survival, DC 13" rendering as any other absent-state
    // (pre-CHECK-RETRY / flag-off) payload.
    expect(btn).not.toHaveTextContent(/last attempt/i);
  });
});

// ── 3. double-fetch measurement --------------------------------------------

describe('adversarial 3 — double-fetch measurement (inline + poll echo)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('measures: the acting client refetches grounding a SECOND time when its own check_resolved event later arrives via the durable poll', async () => {
    // Ren-Dev extension (Iro-A11y MAJOR-1, 2026-07-28): the mount-time fetch
    // is available; every fetch AFTER that (the click's own inline refresh,
    // AND the later poll echo) reflects the check as genuinely resolved --
    // without this transition, MAJOR-1's own-click-exclusion logic is never
    // meaningfully exercised (a check whose `state` never actually becomes
    // 'resolved' trivially never explains, regardless of whether the
    // exclusion works).
    mGetGrounding
      .mockResolvedValueOnce(grounding([{ skill: 'survival', dc: 13 }]))
      .mockResolvedValue(
        grounding([
          {
            skill: 'survival',
            dc: 13,
            state: 'resolved',
            attempts_used: null,
            max_attempts: null,
            lock_reason: 'resolved',
          },
        ]),
      );
    mResolveCheck.mockResolvedValue({
      skill: 'survival',
      dc: 13,
      total: 16,
      success: true,
      flag_set: ['beat_a'],
      mechanics: 'Survival check: rolled 14 + 2 = 16 vs DC 13 — success.',
      description: 'Survival check (DC 13): 16 — success.',
      event_seq: 42,
    });

    render(<PlayPage />);
    await screen.findByText('Test Table');
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const baseline = mGetGrounding.mock.calls.length;

    const btn = await screen.findByRole('button', { name: /Attempt Survival/i });
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(mResolveCheck).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({ tone: 'success', message: 'The way forward opens.' }),
    );

    // The click's own inline `await refreshGrounding()` (onAttemptCheck,
    // page.tsx ~L3407) must have already fired by now.
    const afterClick = mGetGrounding.mock.calls.length;
    expect(afterClick).toBeGreaterThan(baseline);

    // Iro-A11y MAJOR-1 (2026-07-28): the ACTING client's own resolution
    // must NOT also get the spectator-facing explanation row -- only the
    // toast + silent row (already asserted above). ownResolvedCheckKeysRef
    // is what excludes it (set in onAttemptCheck, BEFORE refreshGrounding()
    // runs the diff).
    expect(
      screen.queryByText('✦ The Survival approach resolves.'),
    ).not.toBeInTheDocument();

    // Now the SAME event_seq the click just created shows up via the
    // client's OWN durable poll (a real echo -- the events endpoint has no
    // notion of "who submitted this", it is table-visible to everyone
    // including the submitter).
    mGetSessionEventsPage.mockResolvedValue(pageWith(checkResolvedEvent(42)));
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const afterPollEcho = mGetGrounding.mock.calls.length;
    // MEASURED (not a defect): the poll's invalidating-kind check has no
    // cross-channel awareness of the click's own already-completed inline
    // refresh -- it re-fetches again. Bounded to exactly one extra fetch
    // (not a loop -- confirmed by the struct006 harness's own "same event on
    // a subsequent tick is deduped" behaviour, reused here on the next tick).
    expect(afterPollEcho).toBe(afterClick + 1);
    // TOAST DEDUPE: despite the extra grounding fetch, the payoff toast is
    // still exactly ONE call total -- it is wired to the click handler's own
    // linear code path (onAttemptCheck), never to the generic poll/event
    // loop, so an echoed check_resolved event cannot re-fire it.
    expect(mockToast).toHaveBeenCalledTimes(1);
    // Iro-A11y MAJOR-1: the poll ECHO of my own already-explained/excluded
    // resolution appends NOTHING new -- both guards hold across the echo:
    // ownResolvedCheckKeysRef still has this key (never cleared mid-scene),
    // and even if it didn't, the check was already 'resolved' as of the
    // prior diff (prevCheckStatesRef), so it isn't a fresh transition
    // either way. Still exactly zero explanation rows in the DOM.
    expect(
      screen.queryByText('✦ The Survival approach resolves.'),
    ).not.toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mGetGrounding.mock.calls.length).toBe(afterPollEcho); // no further growth
  });
});

// ── 4. spectator asymmetry --------------------------------------------------

describe('adversarial 4 — a non-acting client sees the rail update but gets no payoff toast', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a check_resolved event observed only via poll (never through this client\'s own resolveCheck) refreshes grounding without firing the payoff toast', async () => {
    mGetGrounding.mockResolvedValueOnce(grounding([{ skill: 'survival', dc: 13 }]));
    render(<PlayPage />);
    await screen.findByText('Test Table');
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    mGetGrounding.mockResolvedValue(
      grounding([
        {
          skill: 'survival',
          dc: 13,
          state: 'resolved',
          attempts_used: null,
          max_attempts: null,
          lock_reason: 'resolved',
        },
      ]),
    );
    mGetSessionEventsPage.mockResolvedValue(pageWith(checkResolvedEvent(7)));
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The rail updates (this client never clicked anything -- mResolveCheck
    // was never called) ...
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Survival/i })).not.toBeInTheDocument();
    });
    expect(mResolveCheck).not.toHaveBeenCalled();
    // ... but the payoff signal is specific to the SUBMITTING client's own
    // onAttemptCheck code path (page.tsx ~L3416-3419) -- a spectator gets
    // no "The way forward opens." toast for someone else's roll. Confirmed
    // as the design's intended scope (§7.3 describes the payoff as the
    // acting player's own missing-signal fix), not re-litigated here as a
    // gap, but pinned so a future change can't silently broaden or narrow
    // who gets it without a test noticing.
    expect(mockToast).not.toHaveBeenCalledWith({
      tone: 'success',
      message: 'The way forward opens.',
    });
    // Iro-A11y MAJOR-1 (2026-07-28): a spectator (never clicked, never got a
    // toast) still gets a NON-silent log-row explanation of why the check
    // vanished -- the one spoken channel (ChatLog's own aria-live region)
    // for everyone else at the table who wasn't the one who resolved it.
    const explanationRows = screen.getAllByText('✦ The Survival approach resolves.');
    expect(explanationRows).toHaveLength(1);
    expect(explanationRows[0].parentElement).not.toHaveAttribute('aria-hidden');
  });
});

// ── 5. checkBusyRef latch ----------------------------------------------------

describe('adversarial 5 — rapid double-click issues exactly one resolveCheck call', () => {
  it('two back-to-back clicks before the first POST resolves only submit once', async () => {
    mGetGrounding.mockResolvedValue(grounding([{ skill: 'survival', dc: 13 }]));
    let resolvePromise: (v: unknown) => void = () => {};
    mResolveCheck.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
    );
    render(<PlayPage />);
    const btn = await screen.findByRole('button', { name: /Attempt Survival/i });

    // Two clicks fired in the SAME act() batch, before either await settles
    // -- the worst-case race for a state-based (not ref-based) guard.
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });

    expect(mResolveCheck).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePromise({
        skill: 'survival',
        dc: 13,
        total: 16,
        success: true,
        flag_set: ['beat_a'],
        mechanics: 'Survival check: rolled 14 + 2 = 16 vs DC 13 — success.',
        description: 'Survival check (DC 13): 16 — success.',
        event_seq: 1,
      });
    });
  });
});

// ── 6. escalate_dc-driven remount ------------------------------------------

describe('adversarial 6 — a DC change (escalate_dc) remounts the check button without stranding it', () => {
  it('the button remains present, enabled, and clickable after its own [skill]-[dc] React key changes', async () => {
    mGetGrounding.mockResolvedValueOnce(
      grounding([
        { skill: 'survival', dc: 13, state: 'available', attempts_used: 0, max_attempts: 3, lock_reason: null },
      ]),
    );
    mResolveCheck.mockResolvedValue({
      skill: 'survival',
      dc: 13,
      total: 10,
      success: false,
      flag_set: [],
      mechanics: 'Survival check: rolled 8 + 2 = 10 vs DC 13 — failure.',
      description: 'Survival check (DC 13): 8 — failure.',
      event_seq: 5,
    });
    render(<PlayPage />);
    const before = await screen.findByRole('button', { name: /Attempt Survival, DC 13/i });
    act(() => before.focus());
    expect(before).toHaveFocus();

    // After the roll, grounding reports an ESCALATED dc (15, not 13) for the
    // SAME still-available check -- the `${skill}-${dc}` key (page.tsx
    // ~L5565) changes, so React unmounts the old <button> and mounts a new
    // one, even though nothing about the check's availability changed.
    mGetGrounding.mockResolvedValue(
      grounding([
        { skill: 'survival', dc: 15, state: 'available', attempts_used: 1, max_attempts: 3, lock_reason: null },
      ]),
    );

    await act(async () => {
      fireEvent.click(before);
    });

    const after = await screen.findByRole('button', { name: /Attempt Survival, DC 15/i });
    expect(after).not.toBe(before); // genuinely remounted, not just relabelled
    // The remounted button can briefly render disabled (checkBusy is only
    // cleared in onAttemptCheck's `finally`, which runs after the fire-and-
    // forget narrateDurableBeat call is kicked off) -- wait for the settle,
    // don't assert the transient frame.
    await waitFor(() => expect(after).not.toBeDisabled());

    // Existing focus rescue (refocusSceneHeadIfStranded, called
    // unconditionally after every refreshGrounding() in onAttemptCheck,
    // page.tsx ~L3408) already covers this case even though the design doc
    // only narrates it for the resolved/hidden path -- confirm focus lands
    // somewhere sane (the scene heading), not silently on <body>.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));

    // And the remounted button is still genuinely clickable.
    mResolveCheck.mockClear();
    await act(async () => {
      fireEvent.click(after);
    });
    expect(mResolveCheck).toHaveBeenCalledTimes(1);
  });
});

// ── 7. hostile note / lock_reason text renders as literal text -------------

describe('adversarial 7 — hostile authored text never becomes markup', () => {
  it('a note containing HTML-shaped text renders as literal characters, not injected markup', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    mGetGrounding.mockResolvedValue(
      grounding([{ skill: 'survival', dc: 13, note: hostile }]),
    );
    const { container } = render(<PlayPage />);
    await screen.findByRole('button', { name: /Attempt Survival/i });

    // No actual <img> element was injected into the DOM.
    expect(container.querySelector('img[src="x"]')).toBeNull();
    // The literal text is present somewhere (React escapes it into a text node).
    expect(container.textContent).toContain(hostile);
  });
});
