/**
 * PLAY-PERSIST (Pass 2) — Tavern rehydration on mount.
 *
 * A session with persisted `player_action` + `narration` events restores the
 * transcript in seq order on mount, does NOT re-fire the live opening beat
 * when history exists, and a genuinely fresh session (no events) still fires
 * the opening normally. Also covers: no-duplicate rows, opening read-aloud
 * reconciliation (on-scene vs advanced), and resilience to a null events read.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Session, Participant, EngineSessionEvent } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'sess-rehydrate' }),
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

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
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
  // DDX-22 Phase 3: JournalPane is now unconditionally mounted on the play
  // page (only its CSS visibility/inert state is gated by journalVisible —
  // see page.tsx's <aside id="play-pane-journal">), so every render of this
  // page fires a getSessionNotes() GET regardless of whether the journal is
  // ever opened. Default to "no note yet" so this suite stays hermetic.
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () { yield { kind: 'done' as const }; }),
}));

import * as dnd from '@/lib/api/dnd';
import * as streamMod from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';

const mStream = streamMod.streamDmNarration as jest.MockedFunction<
  typeof streamMod.streamDmNarration
>;
const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetSessionEvents = dnd.getSessionEvents as jest.MockedFunction<typeof dnd.getSessionEvents>;
const mGetSessionEventsRaw = dnd.getSessionEventsRaw as jest.MockedFunction<
  typeof dnd.getSessionEventsRaw
>;
const mPostSessionEvent = dnd.postSessionEvent as jest.MockedFunction<typeof dnd.postSessionEvent>;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION: Session = {
  session_id: 'sess-rehydrate',
  channel: 'the_hollow_tide',
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
      name: 'Velka',
      char_class: 'Rogue',
      level: 1,
      current_hp: 8,
      max_hp: 10,
      ac: 14,
    },
  },
];

const GROUNDING_APPROACH = {
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

const GROUNDING_CAVE = {
  ...GROUNDING_APPROACH,
  scene_id: 'cave-mouth',
  scene_name: 'The Cave Mouth',
  boxed_text: 'Damp air rolls out of the darkness.',
};

const OPENING_EVENT: EngineSessionEvent = {
  seq: 1,
  kind: 'opening_narrated',
  data: { scene_id: 'approach', source: 'read_aloud_verbatim' },
  created_at: '2026-07-01T09:00:00Z',
};

const PLAYER_EVENT: EngineSessionEvent = {
  seq: 2,
  kind: 'player_action',
  actor: 'leon',
  data: { who: 'leon', text: 'I push open the door.', log_kind: 'player', mode: 'act' },
  created_at: '2026-07-01T09:01:00Z',
};

const NARRATION_EVENT: EngineSessionEvent = {
  seq: 3,
  kind: 'narration',
  data: { who: 'Suzu', text: 'The door creaks open, revealing a dim hall.', log_kind: 'narration' },
  created_at: '2026-07-01T09:01:05Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetGrounding.mockResolvedValue(GROUNDING_APPROACH);
  mGetSessionEvents.mockResolvedValue([]);
  mGetSessionEventsRaw.mockResolvedValue(null);
  mPostSessionEvent.mockResolvedValue({});
});

// ── Rehydration restores prior turns in order ────────────────────────────────

describe('PLAY-PERSIST rehydration — restores persisted turns on mount', () => {
  it('renders player_action + narration rows in seq order, and does NOT re-fire the opening', async () => {
    mGetSessionEventsRaw.mockResolvedValue([OPENING_EVENT, PLAYER_EVENT, NARRATION_EVENT]);
    // checkShouldOpen's independent gate must also see the same persisted history
    // so it doesn't try to re-fire (mirrors production: both reads reflect the
    // same durable event log).
    mGetSessionEvents.mockResolvedValue([
      { event_type: 'opening_narrated', description: 'Scene already opened.' },
      { event_type: 'player_action', description: 'I push open the door.' },
      { event_type: 'narration', description: 'The door creaks open, revealing a dim hall.' },
    ]);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getByText('I push open the door.')).toBeInTheDocument(),
    );
    expect(screen.getByText('The door creaks open, revealing a dim hall.')).toBeInTheDocument();

    // Ordering: the player line must precede the narration line in the DOM.
    const playerEl = screen.getByText('I push open the door.');
    const narrationEl = screen.getByText('The door creaks open, revealing a dim hall.');
    expect(
      playerEl.compareDocumentPosition(narrationEl) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Opening not re-fired: no new opening_narrated write, and no streamDmNarration
    // call carries kind:'opening' (checkShouldOpen saw the persisted fiction and
    // returned false). A "previously on" recap call is expected here — the recap
    // feature fires independently whenever real events exist — so we assert on
    // the absence of the OPENING call specifically, not on zero stream calls.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(mPostSessionEvent).not.toHaveBeenCalledWith(
      'sess-rehydrate',
      expect.objectContaining({ kind: 'opening_narrated' }),
    );
    const openingCall = mStream.mock.calls
      .map((c) => c[0] as unknown as Record<string, unknown>)
      .find((p) => p?.kind === 'opening');
    expect(openingCall).toBeUndefined();
  });

  it('reconstructs the opening read-aloud block when still on the opening scene (scene_id matches)', async () => {
    mGetSessionEventsRaw.mockResolvedValue([OPENING_EVENT, PLAYER_EVENT, NARRATION_EVENT]);
    mGetSessionEvents.mockResolvedValue([
      { event_type: 'opening_narrated', description: 'Already opened.' },
      { event_type: 'player_action', description: 'I push open the door.' },
    ]);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getByText(/cave mouth yawns/i)).toBeInTheDocument(),
    );
    // The reconstructed read-aloud must appear BEFORE the restored player line.
    const readAloudEl = screen.getByText(/cave mouth yawns/i);
    const playerEl = screen.getByText('I push open the door.');
    expect(
      readAloudEl.compareDocumentPosition(playerEl) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows a compact marker (not the current scene boxed_text) when the player has advanced past the opening scene', async () => {
    // Grounding now reports a DIFFERENT scene than the one opening_narrated recorded.
    mGetGrounding.mockResolvedValue(GROUNDING_CAVE);
    mGetSessionEventsRaw.mockResolvedValue([OPENING_EVENT, PLAYER_EVENT, NARRATION_EVENT]);
    mGetSessionEvents.mockResolvedValue([
      { event_type: 'opening_narrated', description: 'Already opened.' },
      { event_type: 'player_action', description: 'I push open the door.' },
    ]);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getByText('I push open the door.')).toBeInTheDocument(),
    );
    // Must NOT show the stale opening boxed_text (from the 'approach' scene).
    expect(screen.queryByText(/cave mouth yawns/i)).not.toBeInTheDocument();
    // Must show a compact marker referencing the adventure instead.
    expect(screen.getByText(/The Hollow Tide Cave.*opening/i)).toBeInTheDocument();
  });

  it('does not duplicate rows across a rejoin — each persisted turn renders exactly once', async () => {
    mGetSessionEventsRaw.mockResolvedValue([PLAYER_EVENT, NARRATION_EVENT]);
    mGetSessionEvents.mockResolvedValue([
      { event_type: 'player_action', description: 'I push open the door.' },
      { event_type: 'narration', description: 'The door creaks open, revealing a dim hall.' },
    ]);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getAllByText('I push open the door.')).toHaveLength(1),
    );
    expect(screen.getAllByText('The door creaks open, revealing a dim hall.')).toHaveLength(1);
  });
});

// ── Fresh session — opening still fires normally ─────────────────────────────

describe('PLAY-PERSIST rehydration — fresh session (no events)', () => {
  it('rehydration yields nothing and the normal opening beat still fires', async () => {
    mGetSessionEventsRaw.mockResolvedValue([]);
    mGetSessionEvents.mockResolvedValue([]);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getByText(/cave mouth yawns/i)).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(mPostSessionEvent).toHaveBeenCalledWith(
        'sess-rehydrate',
        expect.objectContaining({ kind: 'opening_narrated' }),
      ),
    );
  });
});

// ── Resilience ────────────────────────────────────────────────────────────────

describe('PLAY-PERSIST rehydration — resilience', () => {
  it('getSessionEventsRaw returning null (engine unreachable) does not crash; falls through to the normal opening path', async () => {
    mGetSessionEventsRaw.mockResolvedValue(null);
    mGetSessionEvents.mockResolvedValue([]);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    // Page renders fine and the fresh-session opening still fires (unchanged
    // behaviour — rehydration is additive, not a hard dependency).
    await waitFor(() =>
      expect(screen.getByText(/cave mouth yawns/i)).toBeInTheDocument(),
    );
  });

  it('an unknown event kind in the stream is skipped — log renders, no crash', async () => {
    mGetSessionEventsRaw.mockResolvedValue([
      { seq: 1, kind: 'hack', data: { text: 'should never render' } },
      PLAYER_EVENT,
    ]);
    mGetSessionEvents.mockResolvedValue([
      { event_type: 'player_action', description: 'I push open the door.' },
    ]);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getByText('I push open the door.')).toBeInTheDocument(),
    );
    expect(screen.queryByText('should never render')).not.toBeInTheDocument();
  });

  // MIKO ADVERSARIAL FINDING — FIXED (Ren-Dev, rehydration.ts:41): contrast
  // this with the "unknown event kind" test directly above — an unrecognized
  // *kind* string always degraded gracefully (skipped, log renders); a
  // malformed *data value* on a KNOWN kind used to NOT (it threw inside the
  // mount-time `for` loop's un-try/catch'd `eventToLogRow` call, propagating
  // to the outer catch and calling `setState('error')` — the ENTIRE play
  // screen replaced by "The table is unreachable." for every future load of
  // that session). decodeHtmlEntities now guards with
  // `if (typeof s !== 'string' || !s) return s;`, so the malformed value
  // (12345) passes through untouched: eventToLogRow returns a real row
  // (`text: 12345`, not skipped — the truthy non-string value survives the
  // `if (!text) return null` check same as any other truthy text), the row
  // renders inertly (React stringifies the number child), and the rest of
  // the play screen loads completely normally. This test now locks the
  // FIXED, resilient behavior — see rehydration.test.ts's sibling
  // isolated-function locks for the same fix at the unit level.
  it('a malformed historical event (non-string data.text on a KNOWN kind) no longer crashes the mount — the play screen loads normally and the row renders inertly instead of tanking the whole transcript', async () => {
    mGetSessionEventsRaw.mockResolvedValue([
      { seq: 1, kind: 'player_action', actor: 'leon', data: { who: 'leon', text: 12345 } },
    ]);
    mGetSessionEvents.mockResolvedValue([]);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    // Normal load — NOT the error/notfound fallback.
    expect(screen.queryByText(/table is unreachable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/table has closed/i)).not.toBeInTheDocument();

    // The log itself renders — the whole screen did not tank.
    await waitFor(() => expect(screen.getByRole('log')).toBeInTheDocument());
    // The malformed row degrades inertly: the non-string value renders as
    // plain text (React stringifies a number child) rather than crashing.
    expect(screen.getByText('12345')).toBeInTheDocument();
  });
});
