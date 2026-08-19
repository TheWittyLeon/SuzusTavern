/**
 * TEST-NULL-TOSCENE-TAVERN-TYPE-MISMATCH (P1, 2026-08-19).
 *
 * The engine sends `{to_scene: null, completed: true}` on the terminal
 * transition of an authored adventure (engine `d41351f`,
 * TAV-SLICE-END-ADVANCE-NULL, 2026-08-09) — but `src/lib/api/types.ts`
 * declared `AdvanceSceneResult.to_scene: string` (non-nullable) and the
 * `normalizeGrounding` projection in `src/lib/api/dnd.ts` cast the wire
 * value with `t.to as string`, silently lying about the type without
 * changing the value. This is the LAST CLICK of a finished adventure — the
 * highest-value moment in the game to not break.
 *
 * These tests drive the terminal shape end-to-end through the real client
 * path: grounding → availableTransitions → the "Move on" button → onMoveOn →
 * advanceScene → the appended log line → the narration prompt sent to the
 * model. Same harness/mocking convention as
 * play.tav-scene-transition-flag-gate.test.tsx and
 * play.checks-and-fork.test.tsx.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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
  useReducedMotion: () => true,
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
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' as const };
  }),
}));

import * as dnd from '@/lib/api/dnd';
import * as stream from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetSessionEvents = dnd.getSessionEvents as jest.MockedFunction<typeof dnd.getSessionEvents>;
const mGetSessionEventsRaw = dnd.getSessionEventsRaw as jest.MockedFunction<
  typeof dnd.getSessionEventsRaw
>;
const mAdvanceScene = dnd.advanceScene as jest.MockedFunction<typeof dnd.advanceScene>;
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
      level: 5,
      current_hp: 30,
      max_hp: 30,
      ac: 15,
    },
  },
];

/** The finale scene: its ONLY authored transition is the terminal exit
 *  (`to: null`) — exactly what `engine/beats.py::available_transitions`
 *  hands over for a scene whose sole open exit ends the adventure. */
const GROUNDING_FINALE: GroundingData = {
  scene_id: 'finale_scene',
  scene_name: 'The Last Stand',
  boxed_text: 'The threat is broken. Everfree falls quiet.',
  transitions: [{ to: null, label: 'End the adventure here' }],
  checks: [],
  flags: {},
  encounter_state: {},
};

function streamOnce(events: NarrationEvent[]) {
  mStream.mockImplementation(async function* () {
    for (const e of events) yield e;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetSessionEvents.mockResolvedValue([]);
  mGetSessionEventsRaw.mockResolvedValue(null);
  mGetGrounding.mockResolvedValue(GROUNDING_FINALE);
  streamOnce([{ kind: 'chunk', text: 'The story closes.' }, { kind: 'done' }]);
});

describe('TEST-NULL-TOSCENE-TAVERN-TYPE-MISMATCH — terminal to_scene:null end-to-end', () => {
  it('renders the terminal exit button with its authored label (not "Move on → null")', async () => {
    render(<PlayPage />);
    const btn = await screen.findByRole('button', { name: /End the adventure here/i });
    expect(btn).not.toHaveTextContent(/null/i);
  });

  it('an UNLABELLED terminal exit falls back to "End the adventure", not "Move on → null"', async () => {
    mGetGrounding.mockResolvedValue({
      ...GROUNDING_FINALE,
      transitions: [{ to: null }],
    });
    render(<PlayPage />);
    const btn = await screen.findByRole('button', { name: /End the adventure/i });
    expect(btn).not.toHaveTextContent(/null/i);
  });

  it('clicking the terminal exit calls advanceScene with to_scene: null', async () => {
    mAdvanceScene.mockResolvedValue({
      from_scene: 'finale_scene',
      to_scene: null,
      flags_set: [],
      visited_scenes_count: 7,
      ends_adventure: true,
      completed: true,
    });
    render(<PlayPage />);

    const btn = await screen.findByRole('button', { name: /End the adventure here/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    expect(mAdvanceScene.mock.calls[0][0]).toBe('s1');
    expect(mAdvanceScene.mock.calls[0][1]).toMatchObject({ to_scene: null });
  });

  it('logs an honest completion line, never the "→ null" garbage shape', async () => {
    mAdvanceScene.mockResolvedValue({
      from_scene: 'finale_scene',
      to_scene: null,
      flags_set: [],
      visited_scenes_count: 7,
      ends_adventure: true,
      completed: true,
    });
    render(<PlayPage />);

    const btn = await screen.findByRole('button', { name: /End the adventure here/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    await screen.findByText(/The adventure reaches its end at finale_scene\./i);
    expect(screen.queryByText(/→\s*null/i)).not.toBeInTheDocument();
  });

  it('the narration prompt sent to the model describes a closing beat, never interpolates null', async () => {
    mAdvanceScene.mockResolvedValue({
      from_scene: 'finale_scene',
      to_scene: null,
      flags_set: [],
      visited_scenes_count: 7,
      ends_adventure: true,
      completed: true,
    });
    render(<PlayPage />);

    const btn = await screen.findByRole('button', { name: /End the adventure here/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => expect(mStream).toHaveBeenCalled());
    const payload = mStream.mock.calls[mStream.mock.calls.length - 1][0] as {
      mechanics?: string;
    };
    expect(payload.mechanics).toMatch(/Adventure complete/i);
    expect(payload.mechanics).not.toMatch(/null/i);
  });

  it('does not crash when the terminal write does not persist (completed absent)', async () => {
    // apply_adventure_completion's own `persisted` gate: a 0-row write means
    // the route never sets `completed`/`to_scene: null` at all -- the client
    // must still be able to receive a well-formed non-terminal-shaped error
    // response without special-casing this test's mock. Pinned here as a
    // sibling case, not because the type change affects this path.
    mAdvanceScene.mockResolvedValue({
      from_scene: 'finale_scene',
      to_scene: 'finale_scene',
      flags_set: [],
    });
    render(<PlayPage />);

    const btn = await screen.findByRole('button', { name: /End the adventure here/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/→\s*null/i)).not.toBeInTheDocument();
  });
});
