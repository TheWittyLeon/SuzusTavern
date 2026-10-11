/**
 * TAV-CONCLUDE-REPLAYS-ARRIVAL-LINE (+ the reload neighbour, W9-F2) — a terminal advance has no
 * destination scene, so it never plays an arrival line; it plays the ending. And a finished
 * adventure reloaded does not offer "Conclude the adventure" again (`progress.completed` rides
 * grounding as `adventure_completed`).
 *
 * Mounting fresh IS the reload: `lastArrivalSceneRef` starts null on every mount.
 */
import React from 'react';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
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

const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mAdvanceScene = dnd.advanceScene as jest.MockedFunction<typeof dnd.advanceScene>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;

const SESSION: Session = {
  session_id: 's1',
  channel: 'everfree',
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
    character: { character_id: 'c1', name: 'Anomaly', char_class: 'Wizard', level: 3, current_hp: 9, max_hp: 9, ac: 12 },
  },
];

const ARRIVAL = 'You step into the origin chamber; the air hums.';

/** The final scene: an authored arrival line and the single `to: null` exit. */
const FINAL_SCENE: GroundingData = {
  scene_id: 'anchor_origin_question',
  scene_name: 'The Origin Question',
  boxed_text: 'The glade falls quiet.',
  objective: 'Bring the tale to its close.',
  arrival_line: ARRIVAL,
  transitions: [{ to: null }],
  checks: [],
  flags: {},
  encounter_state: {},
};


beforeEach(() => {
  jest.clearAllMocks();
  (dnd.getSession as jest.Mock).mockResolvedValue(SESSION);
  (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
  mStream.mockImplementation(async function* () {
    yield { kind: 'chunk', text: 'The ending.' } as NarrationEvent;
    yield { kind: 'done' } as NarrationEvent;
  });
});

describe('TAV-CONCLUDE-REPLAYS-ARRIVAL-LINE', () => {
  it('concluding on the final scene plays the ending beat and not the arrival line', async () => {
    mGetGrounding.mockResolvedValue(FINAL_SCENE);
    mAdvanceScene.mockResolvedValue({ from_scene: 'anchor_origin_question', to_scene: null, completed: true });
    renderPlay(<PlayPage />);

    const btn = await screen.findByRole('button', { name: /Conclude the adventure/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(mStream.mock.calls[0][0])).toMatch(/the adventure concludes\. Narrate the ending/);
    expect(screen.queryByText(ARRIVAL)).not.toBeInTheDocument();
  });
});

describe('TAV-ADVENTURE-COMPLETE-NOT-REHYDRATED (the W9-F2 neighbour)', () => {
  it('a finished adventure reloaded does not offer "Conclude the adventure"', async () => {
    mGetGrounding.mockResolvedValue({ ...FINAL_SCENE, adventure_completed: true });
    renderPlay(<PlayPage />);
    await screen.findByRole('textbox');

    expect(screen.queryByRole('button', { name: /Conclude the adventure/i })).not.toBeInTheDocument();
  });

  it('a typed line that reaches the terminal exit on a finished adventure is still answered', async () => {
    // The composer's keyword fast path can call onMoveOn(null) here; the player's line must
    // never vanish. It posts the (idempotent) advance and the ending beat plays.
    mGetGrounding.mockResolvedValue({
      ...FINAL_SCENE,
      adventure_completed: true,
      transitions: [{ to: null, label: 'Conclude the adventure' }],
    });
    mAdvanceScene.mockResolvedValue({ from_scene: 'anchor_origin_question', to_scene: null, completed: true });
    renderPlay(<PlayPage />);
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'conclude the adventure' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    await waitFor(() => expect(mStream).toHaveBeenCalled());
  });
});
