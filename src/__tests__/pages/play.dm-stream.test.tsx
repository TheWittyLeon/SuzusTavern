/**
 * DM-STREAM (docs/design/DM-STREAM_streaming_narration.md §10 P2) — Tavern
 * client streamMode chunk handling in play/[sessionId]/page.tsx narrate().
 *
 * Coverage:
 *   - a streamMode:true chunk sets narratorText DIRECTLY (server already
 *     paces the reveal) — the client-side fake-typewriter interval
 *     (revealText's setInterval) is never scheduled for that beat.
 *   - a chunk with no stream_mode key (flag-OFF / buffered beat) still runs
 *     the existing fake-typewriter reveal — regression lock for the
 *     A/B-invariant "flag off = unchanged" behaviour at the CLIENT layer.
 *   - a pending typewriter interval from an EARLIER buffered chunk is
 *     cleared the moment a LATER chunk in the same beat switches to
 *     streamMode (defensive; the design says beats are never mixed in
 *     practice, but the code guards for it and the guard deserves a test).
 *   - appendLog's single post-loop call receives the FINAL cumulative text
 *     exactly once in the transcript log (not once per delta).
 *   - the final streamed event's offered_check/scene_advanced metadata still
 *     drives the same post-narration reactions (refreshGrounding()) as the
 *     buffered path.
 *
 * parseDataLine itself (stream_mode -> NarrationEvent.streamMode) is covered
 * in src/__tests__/lib/stream.test.ts ("readSSE — DM-STREAM stream_mode /
 * final"); this file covers the CONSUMER (narrate()) that reacts to it.
 *
 * Every OTHER play.*.test.tsx mocks useReducedMotion() -> true for stability
 * (revealText short-circuits to an instant setNarratorText). THIS file
 * deliberately mocks it -> false, because the whole point here is to prove
 * streamMode chunks skip the setInterval-based typewriter — reduced=true
 * would mask that exact distinction.
 */
import React from 'react';
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { GroundingData, NarrationEvent, Participant, Session } from '@/lib/api/types';

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
  useReducedMotion: () => false,
}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
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
  resolveCheck: jest.fn(),
  bindCharacter: jest.fn(() =>
    Promise.resolve({ campaign_id: 's1', username: 'leon', role: 'player', character_id: 1 }),
  ),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
}));

import * as dnd from '@/lib/api/dnd';
import * as stream from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;

const SESSION: Session = {
  session_id: 's1',
  channel: 'mlp_everfree_leon',
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

const GROUNDING_SINGLE_EDGE: GroundingData = {
  scene_id: 'slice_everfree_navigate',
  scene_name: 'Into the Everfree',
  boxed_text: 'The path narrows ahead.',
  objective: 'Press onward.',
  transitions: [{ to: 'slice_everfree_timberwolf', label: 'Get moving' }],
  checks: [{ skill: 'survival', dc: 12 }],
  flags: {},
  encounter_state: {},
};

function streamOnce(events: NarrationEvent[]) {
  mStream.mockImplementation(async function* () {
    for (const e of events) yield e;
  });
}

async function sendMessage(text: string) {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetGrounding.mockResolvedValue(GROUNDING_SINGLE_EDGE);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('DM-STREAM — narrate() streamMode chunk handling', () => {
  it('sets narratorText directly on a streamMode chunk and never schedules the fake-typewriter interval', async () => {
    const setIntervalSpy = jest.spyOn(window, 'setInterval');
    streamOnce([
      { kind: 'chunk', text: 'You wade', streamMode: true },
      { kind: 'chunk', text: 'You wade toward the water.', streamMode: true },
      { kind: 'done' },
    ]);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    // Deliberately NOT a MOVE_ON_PHRASES/HEAD_MOVE_PHRASES match (see
    // intentFastPath.ts) — a fast-path phrase would route to onMoveOn
    // instead of the plain narrate() call this test exercises.
    await sendMessage('I hum a little tune and wait.');

    // Appears twice once settled (NarratorStrip panel + the ChatLog row) —
    // use getAllByText rather than getByText to avoid a spurious
    // "found multiple elements" throw.
    await waitFor(() => {
      expect(screen.getAllByText('You wade toward the water.').length).toBeGreaterThan(0);
    });

    // revealText's word-by-word setInterval (a distinctive 26ms cadence,
    // never used elsewhere in the component) was never scheduled for this
    // beat — every delta went through the direct setNarratorText branch.
    // (RTL's own `waitFor` polling ALSO uses setInterval — at a 50ms
    // cadence — so filter by delay rather than asserting zero total calls,
    // which would spuriously fail on RTL's own internal polling.)
    const revealIntervalCalls = setIntervalSpy.mock.calls.filter(([, delay]) => delay === 26);
    expect(revealIntervalCalls).toHaveLength(0);
  });

  it('runs the fake-typewriter reveal for a chunk with no stream_mode key (flag-OFF path unchanged)', async () => {
    const setIntervalSpy = jest.spyOn(window, 'setInterval');
    streamOnce([{ kind: 'chunk', text: 'Hello there' }, { kind: 'done' }]);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I look around.');

    // The buffered (non-streamMode) path still schedules revealText's
    // distinctive 26ms typewriter interval — regression lock for the
    // unchanged flag-OFF path. (See delay-filter note above re: RTL's own
    // 50ms polling interval sharing the same spy.)
    await waitFor(() => {
      const revealIntervalCalls = setIntervalSpy.mock.calls.filter(([, delay]) => delay === 26);
      expect(revealIntervalCalls.length).toBeGreaterThan(0);
    });

    // The reveal eventually converges on the full text once every real tick
    // has run (revealText ticks every 26ms — well within the default
    // waitFor timeout).
    await waitFor(() => {
      expect(screen.getAllByText('Hello there').length).toBeGreaterThan(0);
    });
  });

  it('clears a pending typewriter interval when a later chunk in the same beat switches to streamMode', async () => {
    const clearIntervalSpy = jest.spyOn(window, 'clearInterval');
    streamOnce([
      // First delta: no stream_mode — starts the fake-typewriter interval.
      { kind: 'chunk', text: 'Hello there, traveler' },
      // Second delta (same beat): now carries stream_mode — must clear the
      // interval scheduled by the first delta and set text directly instead.
      { kind: 'chunk', text: 'Hello there, traveler. Welcome.', streamMode: true },
      { kind: 'done' },
    ]);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I look around.');

    // If the interval from the first (non-streamMode) delta had NOT been
    // cleared, the typewriter would keep ticking toward "Hello there,
    // traveler" (the FIRST delta's text) and this assertion — which requires
    // the SECOND delta's longer final text — would never be satisfied.
    await waitFor(() => {
      expect(screen.getAllByText('Hello there, traveler. Welcome.').length).toBeGreaterThan(0);
    });
    expect(clearIntervalSpy).toHaveBeenCalled();

    // Give any (incorrectly) still-running interval a real chance to fire —
    // the text must not have been overwritten by a stray typewriter tick.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(screen.getAllByText('Hello there, traveler. Welcome.').length).toBeGreaterThan(0);
  });

  it('appends the final cumulative text to the log exactly once for a multi-delta streamed beat', async () => {
    streamOnce([
      { kind: 'chunk', text: 'You wade', streamMode: true },
      { kind: 'chunk', text: 'You wade toward', streamMode: true },
      { kind: 'chunk', text: 'You wade toward the sound of water.', streamMode: true },
      { kind: 'done' },
    ]);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    // Not a MOVE_ON_PHRASES/HEAD_MOVE_PHRASES match — see comment above.
    await sendMessage('I hum a little tune and wait.');

    const log = await screen.findByRole('log');
    await waitFor(() => {
      expect(within(log).getAllByText('You wade toward the sound of water.')).toHaveLength(1);
    });
    // Neither intermediate delta ever became its own separate log row.
    expect(within(log).queryByText('You wade')).not.toBeInTheDocument();
    expect(within(log).queryByText('You wade toward')).not.toBeInTheDocument();
  });

  it('a streamed final event still drives scene_advanced -> refreshGrounding(), same as the buffered path', async () => {
    streamOnce([
      { kind: 'chunk', text: 'You push on', streamMode: true },
      {
        kind: 'chunk',
        text: 'You push on toward the ridge.',
        streamMode: true,
        sceneAdvanced: true,
        advancedTo: 'slice_everfree_timberwolf',
      },
      { kind: 'done' },
    ]);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I push toward the ridge.');

    // Mount fetches grounding once; the sceneAdvanced signal on the final
    // streamed event must trigger a SECOND fetch via refreshGrounding().
    await waitFor(() => {
      expect(mGetGrounding).toHaveBeenCalledTimes(2);
    });
  });
});
