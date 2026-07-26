/**
 * Phase 4 (Sora-Arch design §4 Fork 3; Miko-QA Phase 4 Test Plan §3.2) —
 * durable-poll `offered_check` consumer.
 *
 * `DURABLE_GENERATION_ENABLED` is mocked TRUE for this whole file (config is
 * read once at import time, not a live binding — mirrors
 * play.ddx20-durable-turn.test.tsx's own note on this).
 *
 * Coverage:
 *   - an `offered_check` carried on a durable narration session event's
 *     `data` (the completed-job payload, parity with the legacy SSE path in
 *     src/lib/stream.ts) surfaces the matching "Attempt {skill}" affordance
 *     for an AUTHORED skill (highlights the existing .checkWrap chip).
 *   - THE critical case (Miko-QA "the sleeper bug"): an `offered_check` for a
 *     skill NOT in the scene's authored `availableChecks` is NOT dropped —
 *     it routes to a dedicated freeform "Attempt {skill}" affordance that
 *     rolls via the always-available quickChecks/postRoll ->
 *     `/roll (kind=skill)` primitive, never the authored `/check` route.
 *   - no `offered_check` on the narration event -> no new affordance
 *     (legacy path unaffected).
 *   - clicking the freeform affordance rolls server-authoritatively (no
 *     client-supplied DC), then clears itself once a later beat lands
 *     without an offer.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, EventsPage, GroundingData, Participant, Session } from '@/lib/api/types';

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
const mockGetGrounding = jest.fn<Promise<GroundingData | null>, unknown[]>(() =>
  Promise.resolve(null),
);
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockPostSessionEvent = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve({}));
const mockPostRoll = jest.fn<Promise<unknown>, unknown[]>(() =>
  Promise.resolve({ description: 'Velka rolls Survival: 14.' }),
);
const mockResolveCheck = jest.fn();

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
  postRoll: (...args: Parameters<AnyFn>) => mockPostRoll(...args),
  resolveCheck: (...args: Parameters<AnyFn>) => mockResolveCheck(...args),
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
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() =>
    Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' }),
  ),
}));

const mockPostDmTurn = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
  postDmTurn: (...args: Parameters<AnyFn>) => mockPostDmTurn(...args),
  subscribeDmJob: jest.fn(async function* () {
    /* not exercised in this file — every beat here arrives via the poll */
  }),
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
      char_class: 'Ranger',
      level: 3,
      current_hp: 18,
      max_hp: 20,
      ac: 14,
    },
  },
];

/** Only `stealth` is authored on this scene — `survival` is freeform. */
const GROUNDING_STEALTH_ONLY: GroundingData = {
  scene_id: 'everfree_flight',
  scene_name: 'Flight Through the Everfree',
  boxed_text: 'The pack is closing in.',
  objective: 'Fight or flee.',
  transitions: [],
  checks: [{ skill: 'stealth', dc: 12 }],
  flags: {},
  encounter_state: {},
};

function narrationEventWithOffer(
  seq: number,
  text: string,
  offered_check: { skill: string; dc?: number | null; note?: string | null },
): EngineSessionEvent {
  return {
    seq,
    kind: 'narration',
    visibility: 'table',
    created_at: '2026-07-26T10:00:00Z',
    data: { who: 'Suzu', text, offered_check },
  };
}

function narrationEventNoOffer(seq: number, text: string): EngineSessionEvent {
  return {
    seq,
    kind: 'narration',
    visibility: 'table',
    created_at: '2026-07-26T10:00:01Z',
    data: { who: 'Suzu', text },
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

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockGetSession.mockResolvedValue(AI_SESSION);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([]);
  mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue(GROUNDING_STEALTH_ONLY);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockPostSessionEvent.mockResolvedValue({});
  mockPostRoll.mockResolvedValue({ description: 'Velka rolls Survival: 14.' });
  // The freeform-check click below triggers a trailing flavor-narration beat
  // (narrateDurableBeat -> postDmTurn) — not itself under test here, so a
  // simple "created" resolution keeps that follow-up call from throwing.
  mockPostDmTurn.mockResolvedValue({
    job_id: 'job-followup',
    turn_key: 'tk-followup',
    status: 'pending',
    deduped: false,
  });
});

describe('durable poll offered_check — authored skill (parity with the SSE path)', () => {
  it('highlights the existing authored .checkWrap chip', async () => {
    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');

      mockGetSessionEventsPage.mockResolvedValue({
        events: [narrationEventWithOffer(11, 'Something rustles.', { skill: 'stealth', dc: 12 })],
        max_seq: 11,
        has_more: false,
        pending_generation: null,
      });

      await tick();

      const stealthBtn = await screen.findByRole('button', { name: /Attempt Stealth, DC 12/i });
      expect(stealthBtn.className).toEqual(expect.stringContaining('checkBtnOffered'));
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'info', message: expect.stringContaining('Stealth') }),
      );
      // Never a second, freeform button for the same authored skill.
      expect(screen.queryByRole('button', { name: /^Attempt Stealth$/i })).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('durable poll offered_check — freeform skill (Miko-QA "the sleeper bug" fix, CRITICAL)', () => {
  it('a skill NOT in authored availableChecks is not dropped — it surfaces via the freeform "Attempt {skill}" affordance', async () => {
    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');

      // `survival` is not in GROUNDING_STEALTH_ONLY.checks — the pre-Phase-4
      // client would have silently dropped this offer entirely.
      mockGetSessionEventsPage.mockResolvedValue({
        events: [
          narrationEventWithOffer(11, 'Something about the ground catches your eye.', {
            skill: 'survival',
            dc: null,
            note: null,
          }),
        ],
        max_seq: 11,
        has_more: false,
        pending_generation: null,
      });

      await tick();

      const attemptBtn = await screen.findByRole('button', { name: /Attempt Survival/i });
      expect(attemptBtn).toBeInTheDocument();
      // No DC shown for the freeform affordance (unlike the authored chip) —
      // the offer is informational only, never a client-supplied DC.
      expect(attemptBtn.textContent).not.toMatch(/DC/i);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'info', message: expect.stringContaining('Survival') }),
      );

      // Iro-A11y MAJOR-1: this scene ALSO has an authored check (`stealth`,
      // GROUNDING_STEALTH_ONLY.checks), so the authored .checkWrap group
      // renders back-to-back with this freeform one — exactly the collision
      // scenario this phase targets. Both `role="group"` blocks must have
      // DISTINCT accessible names (the freeform one skill-specific, the
      // authored one the plain generic label) — a screen reader must never
      // announce two indistinguishable "Skill check" groups.
      expect(screen.getByRole('group', { name: 'Skill check: Survival' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Skill check' })).toBeInTheDocument();

      // Clicking rolls via the SAME quickChecks/postRoll -> /roll(kind=skill)
      // primitive used elsewhere on this page — never the authored /check
      // route, which 400s `no_such_check` for anything unauthored.
      await act(async () => {
        fireEvent.click(attemptBtn);
      });
      expect(mockPostRoll).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ kind: 'skill', skill: 'survival' }),
      );
      expect(mockResolveCheck).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a later beat with no offer at all clears the freeform affordance (mirrors narrate()\'s per-beat clear)', async () => {
    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');

      mockGetSessionEventsPage.mockResolvedValue({
        events: [
          narrationEventWithOffer(11, 'Something catches your eye.', { skill: 'survival' }),
        ],
        max_seq: 11,
        has_more: false,
        pending_generation: null,
      });
      await tick();
      await screen.findByRole('button', { name: /Attempt Survival/i });

      mockGetSessionEventsPage.mockResolvedValue({
        events: [narrationEventNoOffer(12, 'The moment passes; the path continues.')],
        max_seq: 12,
        has_more: false,
        pending_generation: null,
      });
      await tick();

      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /Attempt Survival/i })).not.toBeInTheDocument(),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('durable poll — no offered_check present (legacy path unaffected)', () => {
  it('a plain narration beat with no offered_check renders no new affordance (freeform-scene scoped so no authored chip can mask the assertion)', async () => {
    // No authored checks on this scene at all — isolates "did a NEW
    // (freeform) affordance appear" from D1a's unrelated always-available
    // authored-chip rendering (grounding.checks), which would otherwise
    // legitimately match an `/Attempt/i` query regardless of any offer.
    mockGetGrounding.mockResolvedValue({ ...GROUNDING_STEALTH_ONLY, checks: [] });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      await screen.findByText('Test Table');

      mockGetSessionEventsPage.mockResolvedValue({
        events: [narrationEventNoOffer(11, 'The path continues quietly.')],
        max_seq: 11,
        has_more: false,
        pending_generation: null,
      });

      await tick();

      await waitFor(() => expect(mockGetSessionEventsPage).toHaveBeenCalled());
      expect(screen.queryByText(/Attempt/i)).not.toBeInTheDocument();
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'info', message: expect.stringContaining('invites') }),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
