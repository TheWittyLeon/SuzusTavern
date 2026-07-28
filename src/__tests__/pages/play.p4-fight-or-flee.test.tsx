/**
 * Phase 4 Package B (Sora-Arch design §3 Fork 2; §4 sketch) — Tavern client:
 * "Stand and fight" reframe of the existing "Begin an encounter" button.
 *
 * Coverage:
 *   - a scene with an authored combat encounter (`grounding.encounter`) and
 *     no active combat renders the button labelled "Stand and fight".
 *   - a scene with NO authored encounter renders NO begin-combat button at
 *     all (2026-07-23 pre-flight playthrough nit — the button used to stay
 *     mounted with the generic "Begin an encounter" label and always 400
 *     when clicked there; see play.combat-begin-gate.test.tsx for the
 *     dedicated render-gate + busy-disabled coverage).
 *   - clicking "Stand and fight" still calls the SAME `combatFromScene` ->
 *     `rollInitiative` flow, unchanged — the label swap itself is
 *     copy-only, no logic change to `beginEncounter`.
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
  postRoll: jest.fn(),
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
const mGetCombatState = dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;
const mCombatFromScene = dnd.combatFromScene as jest.MockedFunction<typeof dnd.combatFromScene>;
const mRollInitiative = dnd.rollInitiative as jest.MockedFunction<typeof dnd.rollInitiative>;

const SESSION: Session = {
  session_id: 's1',
  channel: 'everfree_flight_channel',
  name: 'Test Table',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['leon'],
  player_count: 1,
  active_combat_id: null,
  dm_mode: 'ai',
  ai_assist_level: 'off',
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

/** everfree_flight-shaped scene — an authored combat encounter is present
 *  (any trigger; Package B never auto-starts regardless), plus the two
 *  pre-combat flee checks the design's "no railroad" promise relies on. */
const GROUNDING_WITH_ENCOUNTER: GroundingData = {
  scene_id: 'everfree_flight',
  scene_name: 'Flight Through the Everfree',
  boxed_text: 'The pack is closing in.',
  objective: 'Fight or flee.',
  transitions: [],
  checks: [
    { skill: 'survival', dc: 13, note: 'Break for the light.' },
    { skill: 'athletics', dc: 13, note: 'Outrun the pack.' },
  ],
  flags: {},
  encounter_state: {},
  encounter: { kind: 'combat', trigger: 'manual' },
};

/** A scene with no authored encounter at all. */
const GROUNDING_NO_ENCOUNTER: GroundingData = {
  scene_id: 'anchor_arrival_outskirts',
  scene_name: 'The Outskirts',
  boxed_text: 'The road winds on.',
  objective: 'Get your bearings.',
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
    { participant_id: 'w2', name: 'Timberwolf', hp: 19, from_ref: 'dnd5e:monster:mlp-timberwolf' },
  ],
  terrain: {},
  encounter_id: 'everfree_timberwolves',
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
  streamOnce([{ kind: 'chunk', text: 'The pack is closing in.' }, { kind: 'done' }]);
  mCombatFromScene.mockResolvedValue(FROM_SCENE_RESULT);
  mRollInitiative.mockResolvedValue({ message: 'Initiative rolled.' });
});

describe('Package B — "Stand and fight" reframe', () => {
  it('a scene with an authored combat encounter shows "Stand and fight" instead of the generic label', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_ENCOUNTER);
    render(<PlayPage />);
    await screen.findByText('Test Table');

    expect(
      await screen.findByRole('button', { name: /Stand and fight/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Begin an encounter$/i })).not.toBeInTheDocument();

    // Package B's own promise: both the fight affordance AND the flee checks
    // are visible pre-combat — no railroad, no gate relaxation.
    expect(await screen.findByRole('button', { name: /Attempt Survival, DC 13/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Attempt Athletics, DC 13/i })).toBeInTheDocument();
  });

  it('a scene with NO authored encounter renders no begin-combat button at all (regression pin — dedicated render-gate coverage lives in play.combat-begin-gate.test.tsx)', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_NO_ENCOUNTER);
    render(<PlayPage />);
    await screen.findByText('The Outskirts');

    expect(screen.queryByRole('button', { name: /^Begin an encounter$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stand and fight/i })).not.toBeInTheDocument();
  });

  it('clicking "Stand and fight" drives the SAME combatFromScene -> rollInitiative flow as "Begin an encounter" — no logic change', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_ENCOUNTER);
    render(<PlayPage />);
    await screen.findByText('Test Table');

    const fightBtn = await screen.findByRole('button', { name: /Stand and fight/i });
    await act(async () => {
      fireEvent.click(fightBtn);
    });

    await waitFor(() => expect(mCombatFromScene).toHaveBeenCalledWith({ session_id: 's1' }));
    await waitFor(() => expect(mRollInitiative).toHaveBeenCalled());
  });
});

describe('Iro-A11y MAJOR-2 — toast on the sceneHasEncounter rising edge', () => {
  it('never toasts for the mount-time value, but toasts once the scene ADVANCES into one with an encounter while combat has not started', async () => {
    mGetGrounding
      .mockResolvedValueOnce(GROUNDING_NO_ENCOUNTER)
      .mockResolvedValue(GROUNDING_WITH_ENCOUNTER);
    // ai_assist_level must be eligible (not 'off'/'assist') for narrate() to
    // actually process the streamed `sceneAdvanced` signal below — the
    // shared SESSION fixture uses 'off' so the OTHER tests in this file
    // never fire an unrelated narration row.
    mGetSession.mockResolvedValue({ ...SESSION, ai_assist_level: 'full' });

    render(<PlayPage />);
    await screen.findByText('Test Table');

    // Mount value has no encounter — the button is entirely absent (render
    // gate, TAVERN PLAY-UI NITS item a), so there is no rising edge yet.
    await screen.findByText('The Outskirts');
    expect(
      screen.queryByRole('button', { name: /Begin an encounter|Stand and fight/i }),
    ).not.toBeInTheDocument();
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'warn' }));

    // A beat signals sceneAdvanced -> refreshGrounding() picks up the
    // encounter-bearing fixture queued above; the button now MOUNTS for the
    // first time (post-render-gate — previously it relabeled an
    // already-mounted node in place). It still isn't wrapped in its own
    // live region (would double-announce on mount), so the toast remains
    // the channel that tells a screen-reader user a new fight-or-flee
    // option just appeared.
    streamOnce([
      {
        kind: 'chunk',
        text: 'The pack lunges from the treeline.',
        sceneAdvanced: true,
        advancedTo: 'everfree_flight',
      },
      { kind: 'done' },
    ]);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'I keep moving.' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    await screen.findByRole('button', { name: /Stand and fight/i });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'warn',
        message: expect.stringContaining('Stand and fight'),
      }),
    );
  });

  it('does not toast when the scene has an encounter already active in combat (button not shown; no rising edge to report)', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_ENCOUNTER);
    mGetSession.mockResolvedValue({ ...SESSION, active_combat_id: 'combat-flight', ai_assist_level: 'full' });
    mGetCombatState.mockResolvedValue({
      combat_id: 'combat-flight',
      session_id: 's1',
      state: 'active',
      round: 1,
      turn_index: 0,
      active_participant_id: null,
      initiative: [],
      participants: [],
      encounter_id: 'everfree_timberwolves',
    });

    render(<PlayPage />);
    await screen.findByText('Test Table');

    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'warn' }));
  });
});
