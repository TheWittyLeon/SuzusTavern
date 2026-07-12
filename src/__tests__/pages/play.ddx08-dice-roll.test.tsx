/**
 * DDX-08 / T3 — server-authoritative dice roll.
 *
 * Covers the client-side half of DDX-07/DDX-08: the DiceTray/quick-check
 * buttons must forward a roll request to POST /api/dnd/sessions/{id}/roll
 * (via postRoll) and render the OUTCOME only from the session-events poll —
 * never compute or append a roll row locally, and never fire twice from a
 * same-tick double-click.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Session, Participant, EngineSessionEvent } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'sess-ddx08' }),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsRaw = jest.fn<Promise<unknown[] | null>, unknown[]>(() => Promise.resolve([]));
const mockGetParticipants = jest.fn<Promise<unknown>, unknown[]>();
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockPostRoll = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postRoll: (...args: Parameters<AnyFn>) => mockPostRoll(...args),
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

import PlayPage from '@/app/play/[sessionId]/page';

const SESSION: Session = {
  session_id: 'sess-ddx08',
  channel: 'test_table',
  name: 'Test Table',
  status: 'active',
  dm_username: 'suzu',
  ai_assist_level: 'off',
  active_combat_id: null,
};

const PARTY_WITH_CHARACTER: Participant[] = [
  {
    username: 'leon',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Velka',
      char_class: 'Rogue',
      level: 3,
      current_hp: 18,
      max_hp: 20,
      ac: 14,
    },
  },
];

const SHEET_WITH_SKILLS = {
  character_id: 'c1',
  owner_username: 'leon',
  name: 'Velka',
  race: 'Half-Elf',
  subrace: '',
  char_class: 'Rogue',
  subclass: '',
  level: 3,
  background: 'Criminal',
  alignment: 'CN',
  ability_scores: {},
  hp: { current: 18, max: 20, temp: 0 },
  ac: 14,
  initiative: 3,
  proficiency_bonus: 2,
  speed: 30,
  xp: 900,
  xp_next: 2700,
  hit_dice_remaining: 3,
  proficient_saves: [],
  proficient_skills: ['perception'],
  class_features: [],
  conditions: [],
  spellcasting: null,
  spell_slots: {},
  is_spellcaster: false,
  inventory: [],
  inventory_weight: 0,
  skills: [
    { name: 'perception', ability: 'wisdom', modifier: 3, proficient: true },
  ],
};

function rollEvent(overrides: Partial<EngineSessionEvent> = {}): EngineSessionEvent {
  return {
    seq: 1,
    kind: 'dice_roll',
    actor: 'leon',
    visibility: 'table',
    created_at: '2026-07-09T10:00:00Z',
    data: {
      kind: 'skill',
      notation: null,
      skill: 'perception',
      ability: null,
      character_id: 'c1',
      modifier: 3,
      advantage: 'straight',
      rolls: [15],
      kept: 15,
      total: 18,
      description: 'Perception check: rolled 15 + 3 = 18.',
    },
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(SESSION);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([]);
  mockGetParticipants.mockResolvedValue(PARTY_WITH_CHARACTER);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(SHEET_WITH_SKILLS);
  mockPostRoll.mockResolvedValue({
    kind: 'skill',
    notation: null,
    skill: 'perception',
    ability: null,
    character_id: 'c1',
    modifier: 3,
    advantage: 'straight',
    rolls: [15],
    kept: 15,
    total: 18,
    description: 'Perception check: rolled 15 + 3 = 18.',
    event_seq: 1,
  });
});

async function renderAndOpenScene() {
  render(<PlayPage />);
  await screen.findByText('Test Table');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /scene/i }));
  });
}

describe('DDX-08 / T3 — dice roll is server-authoritative', () => {
  it('a plain d20 click posts kind=raw + advantage, no notation, no client modifier', async () => {
    await renderAndOpenScene();
    const d20btn = await screen.findByRole('button', { name: /^Roll d20$/i });

    await act(async () => {
      fireEvent.click(d20btn);
    });
    await flush();

    expect(mockPostRoll).toHaveBeenCalledWith('sess-ddx08', {
      username: 'leon',
      kind: 'raw',
      advantage: 'straight',
    });
  });

  it('a non-d20 die click posts raw notation only (no advantage, no modifier)', async () => {
    await renderAndOpenScene();
    const d6btn = await screen.findByRole('button', { name: /^Roll d6$/i });

    await act(async () => {
      fireEvent.click(d6btn);
    });
    await flush();

    expect(mockPostRoll).toHaveBeenCalledWith('sess-ddx08', {
      username: 'leon',
      notation: '1d6',
    });
  });

  it('a quick-check click posts kind=skill with the engine slug — no client-supplied modifier field', async () => {
    await renderAndOpenScene();
    const perceptionBtn = await screen.findByRole('button', { name: /perception/i });

    await act(async () => {
      fireEvent.click(perceptionBtn);
    });
    await flush();

    expect(mockPostRoll).toHaveBeenCalledWith('sess-ddx08', {
      username: 'leon',
      kind: 'skill',
      skill: 'perception',
      advantage: 'straight',
    });
    // No modifier field anywhere in the request the client sent.
    const body = mockPostRoll.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('modifier');
  });

  it('does not append a roll row to the log itself — the result must come from the events poll', async () => {
    await renderAndOpenScene();
    const d20btn = await screen.findByRole('button', { name: /^Roll d20$/i });

    await act(async () => {
      fireEvent.click(d20btn);
    });
    await flush();

    // postRoll resolved (mocked above with a real result payload) but no Die
    // tile / roll row should exist yet — rendering happens via the poll only.
    expect(screen.queryByLabelText(/d20 shows/i)).not.toBeInTheDocument();
  });

  it('double-click fires postRoll only once (synchronous busy latch)', async () => {
    let resolveRoll: (v: unknown) => void = () => {};
    mockPostRoll.mockReturnValue(
      new Promise((resolve) => {
        resolveRoll = resolve;
      }),
    );

    await renderAndOpenScene();
    const d20btn = await screen.findByRole('button', { name: /^Roll d20$/i });

    await act(async () => {
      fireEvent.click(d20btn);
      fireEvent.click(d20btn);
      fireEvent.click(d20btn);
    });

    expect(mockPostRoll).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRoll({
        kind: 'raw',
        notation: null,
        skill: null,
        ability: null,
        character_id: null,
        modifier: 0,
        advantage: 'straight',
        rolls: [12],
        kept: null,
        total: 12,
        description: 'Rolled d20: [12] -> 12.',
        event_seq: 1,
      });
      await Promise.resolve();
    });
  });

  it('renders a dice_roll session event from another client via the events poll', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionEventsRaw.mockResolvedValue([]);
      render(<PlayPage />);
      await screen.findByText('Test Table');

      // Simulate a roll fired by a DIFFERENT client — this tab's own onRoll
      // is never invoked; the row must still appear once the poll picks it up.
      mockGetSessionEventsRaw.mockResolvedValue([rollEvent()]);

      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByText(/= 18/)).toBeInTheDocument();
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('rollBusy releases on a FAILED roll too — the tray is not permanently wedged', async () => {
    mockPostRoll.mockRejectedValueOnce(new Error('network down'));

    await renderAndOpenScene();
    const d20btn = await screen.findByRole('button', { name: /^Roll d20$/i });

    await act(async () => {
      fireEvent.click(d20btn);
    });
    await flush();

    expect(mockPostRoll).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'error', message: expect.stringMatching(/roll/i) }),
    );
    // The button must not be left disabled by a wedged latch.
    expect(d20btn).not.toBeDisabled();

    // A second click after the failure must fire postRoll again — proves the
    // `finally` block released rollBusyRef/rollBusy on the error path too.
    mockPostRoll.mockResolvedValueOnce({
      kind: 'raw',
      notation: null,
      skill: null,
      ability: null,
      character_id: null,
      modifier: 0,
      advantage: 'straight',
      rolls: [7],
      kept: null,
      total: 7,
      description: 'Rolled d20: 7.',
      event_seq: 2,
    });
    await act(async () => {
      fireEvent.click(d20btn);
    });
    await flush();

    expect(mockPostRoll).toHaveBeenCalledTimes(2);
  });

  it('a roll triggered by this tab renders exactly once — from the poll, never from the click', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionEventsRaw.mockResolvedValue([]);
      await renderAndOpenScene();
      const d20btn = await screen.findByRole('button', { name: /^Roll d20$/i });

      await act(async () => {
        fireEvent.click(d20btn);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // postRoll has resolved but nothing is rendered from the click itself —
      // no optimistic local append exists in this codepath.
      expect(screen.queryByText(/= 18/)).not.toBeInTheDocument();

      // The engine has now durably persisted the roll as a session event;
      // only the poll renders it.
      mockGetSessionEventsRaw.mockResolvedValue([rollEvent()]);
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getAllByText(/= 18/)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('poll watermark: the SAME (unfiltered) event list returned on later ticks does not re-append the row', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionEventsRaw.mockResolvedValue([]);
      render(<PlayPage />);
      await screen.findByText('Test Table');

      // The engine's GET /events has no "since seq" filter — every tick
      // refetches the SAME full list. The client must dedupe on `seq`.
      mockGetSessionEventsRaw.mockResolvedValue([rollEvent()]);

      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByText(/= 18/)).toBeInTheDocument());

      // Two more ticks, same unfiltered list each time.
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getAllByText(/= 18/)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('unmount clears the dice-roll poll interval — no further getSessionEventsRaw calls afterward', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionEventsRaw.mockResolvedValue([]);
      const { unmount } = render(<PlayPage />);
      await screen.findByText('Test Table');

      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });
      const callsBeforeUnmount = mockGetSessionEventsRaw.mock.calls.length;
      expect(callsBeforeUnmount).toBeGreaterThan(0);

      unmount();

      await act(async () => {
        jest.advanceTimersByTime(20000);
      });

      expect(mockGetSessionEventsRaw.mock.calls.length).toBe(callsBeforeUnmount);
    } finally {
      jest.useRealTimers();
    }
  });
});
