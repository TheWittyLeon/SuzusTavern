/**
 * DDX-26 (Tavern half) — durable, cross-client X-card safety event.
 *
 * Covers:
 *   - the banner renders from a polled `x_card` event, ANON text for a
 *     player, raiser additionally shown for the DM
 *   - dismiss hides the banner and keeps it hidden for THAT seq (re-poll of
 *     the same event does not re-show it); a NEW (higher-seq) x_card re-shows
 *   - auto-ease-off: a later narration beat (higher seq) hides the banner
 *     WITHOUT a dismiss; a `player_action` beat must NOT ease it off (Kage
 *     IMPORTANT-2 — the engine never clears soft_redirect on player_action)
 *   - rehydration: mounting with an unresolved, undismissed x_card shows the
 *     banner immediately (no poll tick required)
 *   - the X-card button posts via postXCard exactly once under a same-tick
 *     double-click (busy-latch), and the optimistic banner fires off the
 *     engine's NESTED `{event: {...}}` response shape (Kage IMPORTANT-1)
 *   - the banner is hoisted out of the Story pane: it renders regardless of
 *     which mobile tab is active (Iro CRITICAL-1)
 *   - dismiss restores focus to the permanent banner wrapper instead of
 *     dropping it to <body> (Iro MAJOR-2)
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Session, Participant, EngineSessionEvent } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'sess-ddx26' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEventsRaw = jest.fn<Promise<unknown[] | null>, unknown[]>(() => Promise.resolve([]));
const mockGetParticipants = jest.fn<Promise<unknown>, unknown[]>();
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockPostXCard = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: currentUsername, email: null } }),
}));

// Mutable so a single mock module can serve both the "player" and "DM" cases
// (the DM case just points dm_username at the same logged-in username).
let currentUsername = 'leon';

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postRoll: jest.fn(),
  postXCard: (...args: Parameters<AnyFn>) => mockPostXCard(...args),
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
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () { yield { kind: 'done' as const }; }),
}));

import PlayPage from '@/app/play/[sessionId]/page';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    session_id: 'sess-ddx26',
    channel: 'test_table',
    name: 'Test Table',
    status: 'active',
    dm_username: 'suzu',
    ai_assist_level: 'off',
    active_combat_id: null,
    ...overrides,
  };
}

const PARTY_NO_CHARACTER: Participant[] = [
  { username: 'leon', is_dm: false, character: null },
];

function xCardEvent(overrides: Partial<EngineSessionEvent> = {}): EngineSessionEvent {
  return {
    seq: 5,
    kind: 'x_card',
    actor: 'zara',
    visibility: 'table',
    created_at: '2026-07-10T10:00:00Z',
    data: {},
    ...overrides,
  };
}

function narrationEvent(overrides: Partial<EngineSessionEvent> = {}): EngineSessionEvent {
  return {
    seq: 10,
    kind: 'dm_narration',
    actor: 'suzu',
    visibility: 'table',
    created_at: '2026-07-10T10:05:00Z',
    data: { text: 'The room grows quiet.' },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  currentUsername = 'leon';
  mockGetSession.mockResolvedValue(makeSession());
  mockGetSessionEventsRaw.mockResolvedValue([]);
  mockGetParticipants.mockResolvedValue(PARTY_NO_CHARACTER);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
  // Kage IMPORTANT-1: the engine (and BFF passthrough) NEST the event under
  // `.event` — `{event: {seq, kind, actor}}`, never a flat object. A flat
  // mock here would mask the exact bug this fix addresses (result?.seq is
  // always undefined against the real wire shape).
  mockPostXCard.mockResolvedValue({ event: { seq: 5, kind: 'x_card', actor: 'leon' } });
});

// Anchored to the START of the node's normalized text so this never matches
// the (parenthesized) durable transcript row eventToLogRow also renders for
// an 'x_card' event ("(A safety signal was raised...)") — only the banner's
// own text (no leading paren) satisfies this.
const BANNER_TEXT = /^A safety signal was raised/i;
const RAISER_TEXT = /X-card raised by/i;

describe('DDX-26 — X-card durable safety banner', () => {
  it('a polled x_card shows the ANON banner to a player (no raiser)', async () => {
    jest.useFakeTimers();
    try {
      mockGetSession.mockResolvedValue(makeSession({ dm_username: 'suzu' })); // not leon
      render(<PlayPage />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      mockGetSessionEventsRaw.mockResolvedValue([xCardEvent()]);
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument());
      expect(screen.queryByText(RAISER_TEXT)).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a polled x_card ADDITIONALLY shows the raiser to the DM client', async () => {
    jest.useFakeTimers();
    try {
      mockGetSession.mockResolvedValue(makeSession({ dm_username: 'leon' })); // leon IS the DM
      render(<PlayPage />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      mockGetSessionEventsRaw.mockResolvedValue([xCardEvent({ actor: 'zara' })]);
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument());
      expect(screen.getByText(RAISER_TEXT)).toBeInTheDocument();
      expect(screen.getByText(/zara/)).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rehydration: an unresolved, undismissed x_card in history shows the banner on mount', async () => {
    mockGetSessionEventsRaw.mockResolvedValue([xCardEvent()]);
    render(<PlayPage />);

    await waitFor(() => expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument());
  });

  it('dismiss hides the banner and it stays hidden for that seq; a NEW x_card re-shows it', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionEventsRaw.mockResolvedValue([xCardEvent({ seq: 5 })]);
      render(<PlayPage />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /dismiss safety signal banner/i }));
      expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();

      // Re-poll of the SAME event (seq 5) — must stay dismissed.
      mockGetSessionEventsRaw.mockResolvedValue([xCardEvent({ seq: 5 })]);
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();

      // A NEW x_card (higher seq) — must re-show, even though the previous
      // raise was dismissed.
      mockGetSessionEventsRaw.mockResolvedValue([xCardEvent({ seq: 6, actor: 'another' })]);
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument());
    } finally {
      jest.useRealTimers();
    }
  });

  it('auto-eases-off once a later narration beat arrives — no dismiss required', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionEventsRaw.mockResolvedValue([xCardEvent({ seq: 5 })]);
      render(<PlayPage />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument());

      // A later narration beat (higher seq) — the table "eases off" on its
      // own; the banner must clear WITHOUT the dismiss button being clicked.
      mockGetSessionEventsRaw.mockResolvedValue([narrationEvent({ seq: 10 })]);
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument());
    } finally {
      jest.useRealTimers();
    }
  });

  it('the X-card button posts via postXCard exactly once under a same-tick double-click', async () => {
    let resolvePost: (v: unknown) => void = () => {};
    mockPostXCard.mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );

    render(<PlayPage />);
    const xCardBtn = await screen.findByRole('button', { name: /^X-card$/i });

    await act(async () => {
      fireEvent.click(xCardBtn);
      fireEvent.click(xCardBtn);
      fireEvent.click(xCardBtn);
    });

    expect(mockPostXCard).toHaveBeenCalledTimes(1);
    expect(mockPostXCard).toHaveBeenCalledWith('sess-ddx26');

    await act(async () => {
      resolvePost({ event: { seq: 1, kind: 'x_card', actor: 'leon' } });
      await Promise.resolve();
    });

    // Latch released — a second click after resolution fires again.
    mockPostXCard.mockResolvedValueOnce({ event: { seq: 2, kind: 'x_card', actor: 'leon' } });
    await act(async () => {
      fireEvent.click(xCardBtn);
    });
    expect(mockPostXCard).toHaveBeenCalledTimes(2);
  });

  it('Kage IMPORTANT-1: the optimistic banner fires off the NESTED postXCard response', async () => {
    mockGetSession.mockResolvedValue(makeSession({ dm_username: 'suzu' })); // not leon
    mockPostXCard.mockResolvedValue({ event: { seq: 9, kind: 'x_card', actor: 'leon' } });

    render(<PlayPage />);
    const xCardBtn = await screen.findByRole('button', { name: /^X-card$/i });

    // No poll tick fired — this is purely the optimistic path off the
    // resolved postXCard() response, proving result?.event?.seq is read.
    await act(async () => {
      fireEvent.click(xCardBtn);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
  });

  it('Kage IMPORTANT-2: a player_action beat does NOT auto-ease the banner off', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionEventsRaw.mockResolvedValue([xCardEvent({ seq: 5 })]);
      render(<PlayPage />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument());

      // A later player_action (higher seq) — the engine does NOT clear
      // soft_redirect on this kind, so the banner must stay put.
      mockGetSessionEventsRaw.mockResolvedValue([
        narrationEvent({ seq: 10, kind: 'player_action', actor: 'leon' }),
      ]);
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('Iro CRITICAL-1: the banner renders regardless of the active mobile tab', async () => {
    mockGetSessionEventsRaw.mockResolvedValue([xCardEvent()]);
    render(<PlayPage />);

    await waitFor(() => expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument());

    // Switch off the Story tab (where the banner used to live, inside
    // .center) onto Party, then Scene — the hoisted banner must stay visible
    // on every tab, including the raiser's own (Scene, where the X-card
    // button lives).
    fireEvent.click(screen.getByRole('button', { name: /^Party$/i }));
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Scene$/i }));
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
  });

  it('Iro MAJOR-2: dismiss restores focus to the permanent banner wrapper, not <body>', async () => {
    mockGetSessionEventsRaw.mockResolvedValue([xCardEvent({ seq: 5 })]);
    const { container } = render(<PlayPage />);

    await waitFor(() => expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument());

    const dismissBtn = screen.getByRole('button', { name: /dismiss safety signal banner/i });
    fireEvent.click(dismissBtn);

    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
    const wrapper = container.querySelector('[role="status"][tabindex="-1"]');
    expect(wrapper).not.toBeNull();
    expect(document.activeElement).toBe(wrapper);
  });
});
