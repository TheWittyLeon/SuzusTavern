/**
 * T4p2 — NextPartOffer's live mount point: the play page's terminal-advance
 * completion state (design doc §6.4). RENDER-ONLY addition — reuses the
 * exact same terminal-transition harness as play.checks-and-fork.test.tsx's
 * TEST-NULL-TOSCENE suite; only the advanceScene mock response's
 * series/next_adventure fields differ.
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
  streamDmNarration: jest.fn(async function* () { yield { kind: 'done' as const }; }),
}));

import * as dnd from '@/lib/api/dnd';
import * as stream from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetSessionEvents = dnd.getSessionEvents as jest.MockedFunction<typeof dnd.getSessionEvents>;
const mGetSessionEventsRaw = dnd.getSessionEventsRaw as jest.MockedFunction<typeof dnd.getSessionEventsRaw>;
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

const GROUNDING_TERMINAL: GroundingData = {
  scene_id: 'slice_everfree_finale',
  scene_name: 'The Finale',
  boxed_text: 'The glade falls quiet.',
  objective: 'Bring the tale to its close.',
  transitions: [{ to: null }],
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
  mGetGrounding.mockResolvedValue(GROUNDING_TERMINAL);
  streamOnce([{ kind: 'chunk', text: 'Suzu narrates.' }, { kind: 'done' }]);
});

async function conclude() {
  render(<PlayPage />);
  const btn = await screen.findByRole('button', { name: /Conclude the adventure/i });
  await act(async () => {
    fireEvent.click(btn);
  });
  await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
}

it('renders the next-part offer when the completion response carries a series pointer with next_status=ok', async () => {
  mAdvanceScene.mockResolvedValue({
    from_scene: 'slice_everfree_finale',
    to_scene: null,
    completed: true,
    series: [
      {
        ref: 'dnd5e:series:mlp-toto-campaign',
        title: 'Tales of the Oppressed',
        position: 1,
        total: 4,
        next_status: 'ok',
      },
    ],
    next_adventure: {
      ref: 'dnd5e:adventure:mlp-act2-canterlot',
      label: 'Act II',
    },
  });
  await conclude();

  expect(await screen.findByText(/up next: act ii/i)).toBeInTheDocument();
  const cta = screen.getByRole('link', { name: /start act ii as a new table/i });
  expect(cta).toHaveAttribute(
    'href',
    `/modules?adventure=${encodeURIComponent('dnd5e:adventure:mlp-act2-canterlot')}`,
  );
});

it('renders the end-of-series message when next_status=end_of_series', async () => {
  mAdvanceScene.mockResolvedValue({
    from_scene: 'slice_everfree_finale',
    to_scene: null,
    completed: true,
    series: [
      {
        ref: 'dnd5e:series:mlp-toto-campaign',
        title: 'Tales of the Oppressed',
        position: 4,
        total: 4,
        next_status: 'end_of_series',
      },
    ],
    next_adventure: null,
  });
  await conclude();

  expect(await screen.findByText(/completed tales of the oppressed/i)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /start.*as a new table/i })).not.toBeInTheDocument();
});

it('renders nothing extra when the completion response carries no series field at all (older engine / flag off)', async () => {
  mAdvanceScene.mockResolvedValue({
    from_scene: 'slice_everfree_finale',
    to_scene: null,
    completed: true,
  });
  await conclude();

  await waitFor(() => expect(screen.getByText('The adventure is complete.')).toBeInTheDocument());
  expect(screen.queryByText(/up next:/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/completed tales of the oppressed/i)).not.toBeInTheDocument();
});
