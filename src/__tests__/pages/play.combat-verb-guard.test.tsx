/**
 * TAV-COMBAT-VERB-NO-MECHANICS — play-page wiring for the combat-verb guard.
 *
 * The unit-level matcher lives in dnd-combat-intent.test.ts. This suite pins
 * the three things only the page can get wrong:
 *
 *   1. the turn is WITHHELD — narrate() is never called, so the fabricated
 *      prose is never generated (the only point it can be stopped, since
 *      DM-STREAM reveals tokens as they arrive);
 *   2. the guard is GATED on an authored combat encounter that has never
 *      started — a resolved encounter, a non-combat encounter, and a live
 *      combat all fall through to normal narration;
 *   3. it runs BEFORE the movement fast-path, so an attack declaration that
 *      happens to contain a movement phrase does not advance the scene past
 *      a live threat.
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
const mCombatFromScene = dnd.combatFromScene as jest.MockedFunction<typeof dnd.combatFromScene>;
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
      char_class: 'Warlock',
      level: 1,
      current_hp: 9,
      max_hp: 9,
      ac: 12,
    },
  },
];

/** The filed repro's scene: an authored combat encounter that has never been
 *  started (no `encounter_state` entry), one authored exit. */
const GROUNDING_UNSTARTED_ENCOUNTER: GroundingData = {
  scene_id: 'everfree_flight',
  scene_name: 'The Flight',
  boxed_text: 'Something is pacing you through the trees.',
  objective: 'Get clear, or turn and face it.',
  transitions: [{ to: 'everfree_zecoras_hut', label: 'Press forward — smoke to the southeast' }],
  checks: [],
  flags: {},
  encounter_state: {},
  encounter: {
    id: 'enc_timberwolf',
    kind: 'combat',
    monsters_resolved: [{ id: 'mlp-timberwolf-juvenile', name: 'Timberwolf (juvenile)' }],
  },
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
  streamOnce([{ kind: 'chunk', text: 'Suzu narrates.' }, { kind: 'done' }]);
});

async function sendMessage(text: string) {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
}

describe('TAV-COMBAT-VERB-NO-MECHANICS — the turn is withheld', () => {
  it('the filed repro no longer reaches the narrator, and says why', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_UNSTARTED_ENCOUNTER);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage(
      'I stand my ground and attack the nearest timberwolf with Eldritch Blast',
    );

    // The whole point: no narration turn is generated at all, so there is no
    // fabricated hit for the player to mistake for a real one.
    expect(mStream).not.toHaveBeenCalled();
    // And nothing mechanical is started either — refuse-and-prompt, never
    // auto-start (Leon's ruling, and /combat/from-scene is DM-only anyway).
    expect(mCombatFromScene).not.toHaveBeenCalled();
    expect(mAdvanceScene).not.toHaveBeenCalled();

    // The player's own words are kept in the transcript...
    expect(
      await screen.findByText(/attack the nearest timberwolf/i),
    ).toBeInTheDocument();
    // ...and the refusal explains the mechanical truth (nothing lands before
    // initiative) rather than silently doing nothing.
    const refusal = await screen.findByText(/nothing you do lands until initiative is rolled/i);
    expect(refusal).toBeInTheDocument();
    // The named creature is surfaced, so the line reads as this scene's.
    expect(refusal.textContent).toMatch(/Timberwolf \(juvenile\) is right there/i);
  });

  it('announces out of band and lands focus on the control it names', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_UNSTARTED_ENCOUNTER);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I attack');

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'warn', message: expect.stringMatching(/Stand and fight/) }),
      ),
    );

    const btn = screen.getByRole('button', { name: /stand and fight/i });
    await waitFor(() => expect(document.activeElement).toBe(btn));
  });

  it('a plain roleplay turn on the SAME scene still narrates normally', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_UNSTARTED_ENCOUNTER);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I hold still and listen for where it is');

    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].message).toBe('I hold still and listen for where it is');
    // The scene's own rising-edge "this can turn into a fight" toast fires on
    // mount and is not this guard's — assert the REFUSAL toast specifically.
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/hasn.t started yet/i) }),
    );
  });
});

describe('TAV-COMBAT-VERB-NO-MECHANICS — gating', () => {
  it('does NOT fire once the encounter has been started (entry present)', async () => {
    // An `encounter_state` entry exists the moment combat starts and survives
    // resolution — presence either way means this guard is not the right
    // answer. Mirrors core/dm_narrator.py::combat_encounter_unstarted.
    mGetGrounding.mockResolvedValue({
      ...GROUNDING_UNSTARTED_ENCOUNTER,
      encounter_state: { enc_timberwolf: { status: 'resolved_victory' } },
    });
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I attack the timberwolf');

    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].message).toBe('I attack the timberwolf');
  });

  it('does NOT fire on a non-combat encounter kind', async () => {
    mGetGrounding.mockResolvedValue({
      ...GROUNDING_UNSTARTED_ENCOUNTER,
      encounter: { ...GROUNDING_UNSTARTED_ENCOUNTER.encounter, kind: 'social' },
    } as GroundingData);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I attack');

    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
  });

  it('does NOT fire on a scene with no authored encounter at all (Leon: left as-is this pass)', async () => {
    mGetGrounding.mockResolvedValue({
      ...GROUNDING_UNSTARTED_ENCOUNTER,
      encounter: null,
    });
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I attack');

    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].message).toBe('I attack');
  });
});

describe('TAV-COMBAT-VERB-NO-MECHANICS — ordering vs the movement fast-path', () => {
  it('an attack declaration containing a movement phrase does NOT advance the scene', async () => {
    // Regression lock on the ordering bug this fix would otherwise create:
    // "press forward" is a MOVE_ON_PHRASE and this scene has exactly one
    // authored exit, so with the guard placed AFTER matchKeywordIntent the
    // player would be walked past a live threat on an attack declaration.
    mGetGrounding.mockResolvedValue(GROUNDING_UNSTARTED_ENCOUNTER);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I press forward and attack the timberwolf');

    expect(mAdvanceScene).not.toHaveBeenCalled();
    expect(mStream).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/nothing you do lands until initiative is rolled/i),
    ).toBeInTheDocument();
  });

  it('a pure movement phrase on the same scene still fast-paths to advanceScene', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_UNSTARTED_ENCOUNTER);
    mAdvanceScene.mockResolvedValue({
      from_scene: 'everfree_flight',
      to_scene: 'everfree_zecoras_hut',
    });
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I press forward');

    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    expect(mAdvanceScene.mock.calls[0][1]).toMatchObject({ to_scene: 'everfree_zecoras_hut' });
  });
});
