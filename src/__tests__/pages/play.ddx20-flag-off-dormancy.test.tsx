/**
 * DDX-20 — flag-off dormancy regression gate (HARD REQUIREMENT #1 of the
 * Pass-1 handoff). With DURABLE_GENERATION_ENABLED=false (the shipped
 * default), the play screen must be behaviourally IDENTICAL to pre-DDX-20:
 *
 *   - DM turns still POST via the legacy generate-and-stream
 *     `streamDmNarration` (never the new `postDmTurn`/`subscribeDmJob`).
 *   - The events poll still reads via `getSessionEventsRaw` (full refetch)
 *     and renders ONLY `dice_roll`/`x_card` rows — never
 *     `getSessionEventsPage` (the cursor endpoint), and player_action/
 *     narration rows from the poll never get double-appended.
 *   - ChatLog keeps keying on `r.id` — ordinary log rows render with no
 *     `seq`/`pendingKey` artefacts leaking into the DOM (they're metadata
 *     only, per the LogRow additions in ChatLog.tsx).
 *
 * This suite exists ALONGSIDE (not instead of) the pre-existing play.*.test
 * files, which already exercise the same legacy paths — this file is the
 * dedicated, explicitly-named DDX-20 regression gate a reviewer can point at.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, NarrationEvent, Participant, Session } from '@/lib/api/types';
import { DURABLE_GENERATION_ENABLED } from '@/lib/config';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'sess-ddx20-flagoff' }),
}));

jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
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
const mockGetSessionEventsRaw = jest.fn<Promise<EngineSessionEvent[] | null>, unknown[]>(() =>
  Promise.resolve([]),
);
const mockGetSessionEventsPage = jest.fn<Promise<unknown>, unknown[]>();
const mockGetParticipants = jest.fn<Promise<Participant[]>, unknown[]>(() =>
  Promise.resolve([]),
);
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockPostSessionEvent = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve({}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  // DDX-20 — must NEVER be called while the flag is off.
  getSessionEventsPage: (...args: Parameters<AnyFn>) => mockGetSessionEventsPage(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postRoll: jest.fn(),
  postSessionEvent: (...args: Parameters<AnyFn>) => mockPostSessionEvent(...args),
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

const mockStreamDmNarration = jest.fn<AsyncGenerator<NarrationEvent>, unknown[]>();
const mockPostDmTurn = jest.fn();
const mockSubscribeDmJob = jest.fn();

jest.mock('../../lib/stream', () => ({
  streamDmNarration: (...args: Parameters<AnyFn>) => mockStreamDmNarration(...args),
  // DDX-20 — must NEVER be called while the flag is off.
  postDmTurn: (...args: Parameters<AnyFn>) => mockPostDmTurn(...args),
  subscribeDmJob: (...args: Parameters<AnyFn>) => mockSubscribeDmJob(...args),
}));

import PlayPage from '@/app/play/[sessionId]/page';

const SESSION: Session = {
  session_id: 'sess-ddx20-flagoff',
  channel: 'test_table',
  name: 'Test Table',
  status: 'active',
  dm_username: 'suzu',
  dm_mode: 'ai',
  ai_assist_level: 'full',
  active_combat_id: null,
};

const PARTY: Participant[] = [
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

function rollEvent(seq: number, skill: string): EngineSessionEvent {
  // Mirrors play.ddx08-dice-roll.test.tsx's rollEvent shape — `text` is
  // rendered from the skill-derived label (ChatLog.tsx rollLabel), NOT from
  // `data.description` (description only gates whether the row renders at
  // all — see rehydration.ts::diceRollLogRow).
  return {
    seq,
    kind: 'dice_roll',
    actor: 'leon',
    visibility: 'table',
    created_at: '2026-07-14T10:00:00Z',
    data: {
      kind: 'skill',
      notation: null,
      skill,
      ability: null,
      character_id: 'c1',
      modifier: 3,
      advantage: 'straight',
      rolls: [15],
      kept: 15,
      total: 18,
      description: `${skill} check: rolled 15 + 3 = 18.`,
    },
  };
}

function playerActionEvent(seq: number, turnKey: string): EngineSessionEvent {
  return {
    seq,
    kind: 'player_action',
    actor: 'leon',
    visibility: 'table',
    created_at: '2026-07-14T10:00:00Z',
    data: { who: 'leon', text: `cross-client action #${seq}`, turn_key: turnKey },
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
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockStreamDmNarration.mockImplementation(
    async function* (): AsyncGenerator<NarrationEvent> {
      yield { kind: 'chunk', text: 'Suzu narrates.' };
      yield { kind: 'done' };
    },
  );
});

describe('DDX-20 flag-off dormancy — HARD REQUIREMENT #1', () => {
  it('the flag itself is false (shipped default)', () => {
    expect(DURABLE_GENERATION_ENABLED).toBe(false);
  });

  it('a DM turn POSTs via the legacy streamDmNarration — postDmTurn/subscribeDmJob are never called', async () => {
    render(<PlayPage />);
    await screen.findByText('Test Table');

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'I hum a little tune and wait.' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await flush();

    expect(mockStreamDmNarration).toHaveBeenCalledTimes(1);
    expect(mockPostDmTurn).not.toHaveBeenCalled();
    expect(mockSubscribeDmJob).not.toHaveBeenCalled();
  });

  it('the events poll calls getSessionEventsRaw (full refetch) and NEVER getSessionEventsPage (cursor)', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionEventsRaw.mockResolvedValue([rollEvent(1, 'perception')]);
      render(<PlayPage />);
      await screen.findByText('Test Table');

      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(mockGetSessionEventsRaw).toHaveBeenCalled();
      expect(mockGetSessionEventsPage).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('the poll still renders ONLY dice_roll/x_card — a player_action from another client is NOT rendered by the poll', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionEventsRaw.mockResolvedValue([]);
      render(<PlayPage />);
      await screen.findByText('Test Table');

      // Simulate durable rows a flag-ON engine COULD already be emitting
      // (player_action is always a first-class event server-side, flag or
      // not) — the flag-OFF poll must still skip it, exactly as today.
      mockGetSessionEventsRaw.mockResolvedValue([
        playerActionEvent(1, 'tk-someone-else'),
        rollEvent(2, 'stealth'),
      ]);

      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByText(/^Stealth/)).toBeInTheDocument();
      });
      expect(screen.queryByText(/cross-client action #1/)).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a rendered dice-roll row carries no visible seq/pendingKey artefacts in the DOM', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionEventsRaw.mockResolvedValue([]);
      render(<PlayPage />);
      await screen.findByText('Test Table');

      mockGetSessionEventsRaw.mockResolvedValue([rollEvent(9, 'perception')]);
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      const row = await screen.findByText(/^Perception/);
      // seq/pendingKey are LogRow metadata fields only — never rendered text.
      expect(row.textContent).not.toMatch(/pendingKey|"seq"/);
    } finally {
      jest.useRealTimers();
    }
  });

  // ── Pass 2 additions — the new durable-turn/ledger/UI surface must stay
  // fully dormant too, not just the poll/SSE plumbing Pass 1 already proved. ──

  it('never mints or persists a turn_key to localStorage on a normal send', async () => {
    render(<PlayPage />);
    await screen.findByText('Test Table');

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'I check the door for traps.' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await flush();

    expect(window.localStorage.getItem('st:dnd:sess-ddx20-flagoff:activeTurnKey')).toBeNull();
  });

  it('never renders the resume ("Resuming Suzu\'s turn…") or retry affordances', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionEventsRaw.mockResolvedValue([]);
      render(<PlayPage />);
      await screen.findByText('Test Table');

      // Even if a durable-shaped pending_generation-like signal somehow
      // showed up in the raw (flag-OFF) event feed, the flag-OFF poll never
      // reads pending_generation at all — getSessionEventsRaw's return type
      // doesn't even carry the field. Just confirm the affordances are
      // absent on a normal render.
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.queryByText(/Resuming Suzu/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a human-DM composer send never stamps client_key — dm_narration data is exactly {text}', async () => {
    mockGetSession.mockResolvedValue({
      ...SESSION,
      dm_username: 'leon',
      dm_mode: 'human',
      ai_assist_level: 'off',
    });
    render(<PlayPage />);
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: /DM Narration/i })).toBeInTheDocument(),
    );

    const textarea = screen.getByRole('textbox', { name: /Compose/i });
    fireEvent.change(textarea, { target: { value: 'The candle gutters out.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));
    });
    await flush();

    expect(mockPostSessionEvent).toHaveBeenCalledWith(
      'sess-ddx20-flagoff',
      expect.objectContaining({ kind: 'dm_narration', data: { text: 'The candle gutters out.' } }),
    );
  });
});
