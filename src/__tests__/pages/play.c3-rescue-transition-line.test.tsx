/**
 * Contract C3 (COMBAT-UX-FOLLOW-UP-1: rescue narration jarring, pinned
 * 2026-08-11) — the deterministic scripted rescue-transition line.
 *
 * PROVISIONAL FIELD NAME: WF-A has not shipped the engine mechanism (zero
 * commits on their side as of this pass). `C3_GROUNDING_FIELD` is imported
 * from the real `src/lib/api/dnd.ts` module (via `jest.requireActual`
 * spread in the mock factory below) rather than hardcoded here — per the
 * single-point-of-correction requirement, a WF-A rename only touches that
 * constant's own definition, never this file.
 *
 * Mirrors `play.arrival-narration.test.tsx`'s structure closely — same
 * fixtures, same "client advance" vs "server-INTENT advance" split — because
 * this feature is explicitly built on "the arrival-line pattern" (Backlog:
 * COMBAT-UX-FOLLOW-UP-1). The two differ in one deliberate way: the rescue
 * line does NOT replace the synthetic "We move on." beat the way
 * `arrival_line` does (that ruling is scoped to `arrival_line` specifically)
 * — it is an independent narration beat that plays alongside whatever else
 * fires for the same transition.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
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
  // Real C3_GROUNDING_FIELD constant survives the mock — every other export
  // used by the play screen is a fresh jest.fn() below, same convention as
  // play.arrival-narration.test.tsx.
  ...jest.requireActual('../../lib/api/dnd'),
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

const { C3_GROUNDING_FIELD } = dnd;

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

const RESCUE_LINE =
  'You come to on soft moss, the fight already three ridges behind you — someone unseen carried you clear.';

/** The scene being LEFT — one authored exit, no rescue line of its own. */
const SCENE_FIGHT: GroundingData = {
  scene_id: 'everfree_ambush',
  scene_name: 'The Ambush',
  boxed_text: 'Timberwolves close from three sides.',
  objective: 'Survive.',
  transitions: [{ to: 'everfree_zecoras_hut', label: 'Press forward — smoke to the southeast' }],
  checks: [],
  flags: {},
  encounter_state: {},
};

/** The DESTINATION, carrying an authored rescue-transition line. */
const SCENE_HUT: GroundingData = {
  scene_id: 'everfree_zecoras_hut',
  scene_name: "Zecora's Hut",
  boxed_text: 'Bottles hang from the eaves, catching what light there is.',
  objective: 'Work out where you are.',
  transitions: [],
  checks: [],
  flags: {},
  encounter_state: {},
  [C3_GROUNDING_FIELD]: RESCUE_LINE,
};

/** Same destination, authored WITHOUT a rescue line. */
const SCENE_HUT_NO_RESCUE_LINE: GroundingData = {
  ...SCENE_HUT,
  [C3_GROUNDING_FIELD]: undefined,
};

/** Same destination, an explicit engine-sent `null` — must degrade exactly
 *  like absence, never an empty-line render or a thrown error. */
const SCENE_HUT_EXPLICIT_NULL: GroundingData = {
  ...SCENE_HUT,
  [C3_GROUNDING_FIELD]: null,
};

/** Same destination, an over-ceiling authored string (>400 chars) — the
 *  render path's own defense-in-depth guard, since C3 has no shipped engine
 *  validator yet to rely on. */
const SCENE_HUT_TOO_LONG: GroundingData = {
  ...SCENE_HUT,
  [C3_GROUNDING_FIELD]: 'x'.repeat(401),
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
  mAdvanceScene.mockResolvedValue({
    from_scene: 'everfree_ambush',
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

describe('C3 rescue-transition line — client-driven advance (Move on)', () => {
  it('present: plays the destination rescue-transition line as Suzu narration, not read_aloud', async () => {
    mGetGrounding.mockResolvedValueOnce(SCENE_FIGHT).mockResolvedValue(SCENE_HUT);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I press forward');

    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    const line = await screen.findByText(RESCUE_LINE);
    expect(line).toBeInTheDocument();

    // Register check: rendered as Suzu narration (the same `.narration` row
    // class arrival lines use), and explicitly NOT the read_aloud register
    // (no "READ ALOUD" label anywhere near this row).
    const row = line.closest('.row') as HTMLElement | null;
    expect(row).not.toBeNull();
    expect(row!.className).toMatch(/(?:^|\s)narration(?:\s|$)/);
    expect(row!.className).not.toMatch(/read_aloud/);
    expect(within(row!).queryByText('READ ALOUD')).not.toBeInTheDocument();
  });

  it('absent: no key on the wire renders nothing extra — today\'s behaviour is unchanged', async () => {
    mGetGrounding.mockResolvedValueOnce(SCENE_FIGHT).mockResolvedValue(SCENE_HUT_NO_RESCUE_LINE);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I press forward');

    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(RESCUE_LINE)).not.toBeInTheDocument();
  });

  it('explicit null: treated identically to absent, never an empty-line row or a crash', async () => {
    mGetGrounding.mockResolvedValueOnce(SCENE_FIGHT).mockResolvedValue(SCENE_HUT_EXPLICIT_NULL);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I press forward');

    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(RESCUE_LINE)).not.toBeInTheDocument();
  });

  it('>400 chars: the render path refuses to play an over-ceiling line', async () => {
    mGetGrounding.mockResolvedValueOnce(SCENE_FIGHT).mockResolvedValue(SCENE_HUT_TOO_LONG);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I press forward');

    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/^x+$/)).not.toBeInTheDocument();
  });

  // Kage SUGG-3 (2026-08-12): a silent drop is how "the feature just doesn't
  // appear" becomes unexplainable — pin that the >400 path actually warns.
  it('>400 chars: warns to the console instead of dropping the line without a trace', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mGetGrounding.mockResolvedValueOnce(SCENE_FIGHT).mockResolvedValue(SCENE_HUT_TOO_LONG);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I press forward');

    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/\[C3\].*401 chars.*dropped/)),
    );
    warnSpy.mockRestore();
  });

  it('absent/blank/null lines do NOT warn — only the length-drop path does', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mGetGrounding.mockResolvedValueOnce(SCENE_FIGHT).mockResolvedValue(SCENE_HUT_NO_RESCUE_LINE);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I press forward');

    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does NOT gate the synthetic "We move on." replace ruling — that stays scoped to arrival_line', async () => {
    // A destination with a rescue line but NO arrival_line still falls
    // through to today's synthetic narrate() beat, exactly as it would with
    // no rescue line at all — the C3 line plays ALONGSIDE that beat, it
    // never substitutes for the arrival_line-specific "replace" ruling.
    mGetGrounding.mockResolvedValueOnce(SCENE_FIGHT).mockResolvedValue(SCENE_HUT);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I press forward');

    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    await screen.findByText(RESCUE_LINE);
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    const payload = mStream.mock.calls[0][0];
    expect(payload.message).toBe('We move on.');
  });
});

describe('C3 rescue-transition line — server-INTENT advance', () => {
  it('present: plays alongside the streamed beat, after refreshing grounding', async () => {
    mGetGrounding.mockResolvedValueOnce(SCENE_FIGHT).mockResolvedValue(SCENE_HUT);
    streamOnce([
      {
        kind: 'chunk',
        text: 'The wolves fall behind as the world tilts sideways.',
        sceneAdvanced: true,
        advancedTo: 'everfree_zecoras_hut',
      },
      { kind: 'done' },
    ]);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I keep running');

    expect(
      await screen.findByText(/The wolves fall behind as the world tilts sideways\./),
    ).toBeInTheDocument();
    expect(await screen.findByText(RESCUE_LINE)).toBeInTheDocument();
    expect(mStream).toHaveBeenCalledTimes(1);
  });

  it('does not replay the rescue line when a second path signals the SAME advance', async () => {
    mGetGrounding.mockResolvedValueOnce(SCENE_FIGHT).mockResolvedValue(SCENE_HUT);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I press forward');
    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    await screen.findByText(RESCUE_LINE);
    // Unlike arrival_line, the rescue line never gates the synthetic "We move
    // on." beat (it doesn't participate in that `return`), so message 1 ALSO
    // fires narrate() here — this is call #1, not a suppressed call.
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));

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

    // Call #2: the second, distinct narration turn for message 2. The real
    // assertion under test is below — the rescue line itself must not
    // double-render just because THIS beat's grounding refresh re-lands on
    // the same scene.
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText(RESCUE_LINE)).toHaveLength(1));
  });
});
