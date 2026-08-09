/**
 * DM-ARRIVAL-NARRATION — the authored per-scene arrival line, played
 * deterministically when a scene advance lands.
 *
 * The defect it closes (2026-07-29 feel-check): the beat that CAUSES an
 * advance is grounded on the scene being LEFT, so "I keep running towards the
 * light" narrated the chase while the scene card had already flipped to The
 * Keeper of the Wood. The journey prose was correct; the ARRIVAL was missing.
 *
 * The two paths behave differently on purpose, and both are pinned here:
 *   - CLIENT advance (Move on / fast-path): the arrival line REPLACES the
 *     synthetic `narrate('We move on.', …)` beat (Leon's ruling 2026-08-09) —
 *     no model call at all, so the seam stops costing a 65-156s turn.
 *   - SERVER-INTENT advance: the prose has already streamed, so the arrival
 *     line FOLLOWS it and the transcript catches up to the card.
 * Plus the regression that matters most: a scene with NO authored arrival line
 * must behave exactly as it does today.
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
  putSessionNotes: jest.fn(() =>
    Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' }),
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
      level: 1,
      current_hp: 10,
      max_hp: 10,
      ac: 13,
    },
  },
];

const ARRIVAL =
  'The trees give out all at once, and the smell of woodsmoke arrives before the hut does.';

/** The scene being LEFT — one authored exit, no arrival line of its own. */
const SCENE_FLIGHT: GroundingData = {
  scene_id: 'everfree_flight',
  scene_name: 'The Flight',
  boxed_text: 'Something is pacing you through the trees.',
  objective: 'Get clear.',
  transitions: [{ to: 'everfree_zecoras_hut', label: 'Press forward — smoke to the southeast' }],
  checks: [],
  flags: {},
  encounter_state: {},
};

/** The DESTINATION, carrying an authored arrival line. */
const SCENE_HUT: GroundingData = {
  scene_id: 'everfree_zecoras_hut',
  scene_name: "Zecora's Hut",
  boxed_text: 'Bottles hang from the eaves, catching what light there is.',
  objective: 'Work out where you are.',
  transitions: [],
  checks: [],
  flags: {},
  encounter_state: {},
  arrival_line: ARRIVAL,
};

/** Same destination, authored WITHOUT an arrival line — the state of every
 *  scene written before 2026-08-09. */
const SCENE_HUT_NO_ARRIVAL: GroundingData = { ...SCENE_HUT, arrival_line: undefined };

function streamOnce(events: NarrationEvent[]) {
  mStream.mockImplementation(async function* () {
    for (const e of events) yield e;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  streamOnce([{ kind: 'chunk', text: 'Suzu narrates.' }, { kind: 'done' }]);
  mAdvanceScene.mockResolvedValue({
    from_scene: 'everfree_flight',
    to_scene: 'everfree_zecoras_hut',
  });
});

async function sendMessage(text: string) {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
}

describe('DM-ARRIVAL-NARRATION — client-driven advance', () => {
  it('plays the destination arrival line and SKIPS the synthetic narrate beat', async () => {
    // First grounding fetch = the scene we are on; the post-advance refresh
    // returns the destination.
    mGetGrounding.mockResolvedValueOnce(SCENE_FLIGHT).mockResolvedValue(SCENE_HUT);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I press forward');

    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(ARRIVAL)).toBeInTheDocument();
    // The whole point of the "replace" ruling: no model call at this seam.
    // `narrate('We move on.', …)` used to fire here and cost a full turn.
    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalled());
    expect(mStream).not.toHaveBeenCalled();
  });

  it('falls back to today\'s synthetic narrate beat when the destination has no arrival line', async () => {
    // Regression lock for every scene authored before this feature: absence
    // must be the ordinary path, not a degraded one.
    mGetGrounding.mockResolvedValueOnce(SCENE_FLIGHT).mockResolvedValue(SCENE_HUT_NO_ARRIVAL);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I press forward');

    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    const payload = mStream.mock.calls[0][0];
    expect(payload.message).toBe('We move on.');
    expect(payload.suppress_intent).toBe(true);
    expect(screen.queryByText(ARRIVAL)).not.toBeInTheDocument();
  });

  it('does not replay the arrival line when a second path signals the SAME advance', async () => {
    // The real double-play risk: onMoveOn plays the line, and then narrate()'s
    // own sceneAdvancedSignal fires for the same seam and refreshes grounding
    // again. Both paths call playArrivalLine; only one row may result.
    mGetGrounding.mockResolvedValueOnce(SCENE_FLIGHT).mockResolvedValue(SCENE_HUT);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I press forward');
    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    await screen.findByText(ARRIVAL);

    streamOnce([
      {
        kind: 'chunk',
        text: 'You take stock of the hut.',
        sceneAdvanced: true,
        advancedTo: 'everfree_zecoras_hut',
      },
      { kind: 'done' },
    ]);
    await sendMessage('I look at the bottles');

    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText(ARRIVAL)).toHaveLength(1));
  });
});

describe('DM-ARRIVAL-NARRATION — server-INTENT advance', () => {
  it('plays the arrival line AFTER the streamed beat, so the prose catches up to the card', async () => {
    // The server classified the free text as a transition, advanced the scene
    // itself, and signalled it on the SSE — the narration was generated from
    // the scene being left and has already streamed.
    mGetGrounding.mockResolvedValueOnce(SCENE_FLIGHT).mockResolvedValue(SCENE_HUT);
    // NOTE: `sceneAdvanced`/`advancedTo` ride on the CHUNK event, not `done`
    // (`{kind:'done'}` carries no fields) — see NarrationEvent in types.ts.
    streamOnce([
      {
        kind: 'chunk',
        text: 'The light swells and the wolves fall behind you.',
        sceneAdvanced: true,
        advancedTo: 'everfree_zecoras_hut',
      },
      { kind: 'done' },
    ]);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I keep running towards the light');

    // Both are present: the journey (correct for what the player did) and the
    // arrival (which is what was missing).
    expect(
      await screen.findByText(/The light swells and the wolves fall behind you\./),
    ).toBeInTheDocument();
    expect(await screen.findByText(ARRIVAL)).toBeInTheDocument();
    // Exactly one narration turn — the arrival must not cost a second one.
    expect(mStream).toHaveBeenCalledTimes(1);
  });

  it('does not play an arrival line on a beat that did NOT advance the scene', async () => {
    mGetGrounding.mockResolvedValue(SCENE_HUT);
    streamOnce([{ kind: 'chunk', text: 'You take the room in.' }, { kind: 'done' }]);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I look around');

    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    // Sitting ON a scene that has an arrival line must never replay it — the
    // line belongs to the moment of arriving, not to the scene's existence.
    expect(screen.queryByText(ARRIVAL)).not.toBeInTheDocument();
  });
});
