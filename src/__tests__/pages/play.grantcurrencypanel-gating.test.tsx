/**
 * T12 (DDX-23t) — GrantCurrencyPanel mount-gate coverage.
 *
 * GrantCurrencyPanel itself has NO internal `isDm` guard — the ENTIRE gate
 * lives in the parent page's JSX conditional (`src/app/play/[sessionId]/
 * page.tsx` ~2287: `{isDm && (...)}`, the same "Session controls" group as
 * Pause/End/Award XP — see play.ddx25-session-controls.test.tsx's own
 * DDX25-AC1 pair). That means "non-DM never sees it" is NOT unit-testable
 * against GrantCurrencyPanel in isolation (it would always render once
 * mounted, proving nothing) — it can only be proven by mounting the real
 * page, same rationale as T6's play.castspellpanel-gating.test.tsx.
 *
 * `isDm` (unlike `isHumanDM`) does NOT depend on `session.dm_mode` — Award XP
 * and Pause/Resume/End already prove this same gate is dm_mode-independent;
 * this file adds the same positive control for Grant specifically (an
 * AI-dm_mode seat still sees it) so a future refactor that accidentally
 * re-gates Grant on `isHumanDM` fails loudly here rather than only in an
 * unrelated Award-XP test.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Session, Participant } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

let mockUsername = 'dm_alice';
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: mockUsername, email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsRaw = jest.fn<Promise<unknown[] | null>, unknown[]>(() => Promise.resolve(null));
const mockGetParticipants = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve([]));
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGrantCurrency = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postSessionEvent: jest.fn(() => Promise.resolve({ seq: 1 })),
  pauseSession: jest.fn(() => Promise.resolve({ message: 'ok' })),
  resumeSession: jest.fn(() => Promise.resolve({ message: 'ok' })),
  endSession: jest.fn(() => Promise.resolve({ message: 'ok' })),
  awardSessionXp: jest.fn(() => Promise.resolve({ message: 'ok' })),
  grantCurrency: (...args: Parameters<AnyFn>) => mockGrantCurrency(...args),
  npcAction: jest.fn(),
  combatFromScene: jest.fn(),
  rollInitiative: jest.fn(),
  monsterTurn: jest.fn(),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  resolveCheck: jest.fn(),
  setFlag: jest.fn(),
  bindCharacter: jest.fn(() =>
    Promise.resolve({ campaign_id: 's1', username: 'dm_alice', role: 'dm', character_id: null }),
  ),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
}));

import PlayPage from '@/app/play/[sessionId]/page';

const BASE_SESSION: Session = {
  session_id: 's1',
  channel: 'test_channel',
  name: 'The Hollow Tide',
  dm_username: 'dm_alice',
  dm_mode: 'ai',
  ai_assist_level: 'full',
  status: 'active',
  active_combat_id: null,
};

const BOUND_CHAR_PARTY: Participant[] = [
  { username: 'dm_alice', is_dm: true, character: null },
  {
    username: 'alex',
    is_dm: false,
    character: {
      character_id: '42',
      name: 'Ashwin',
      char_class: 'Fighter',
      level: 3,
      current_hp: 24,
      max_hp: 24,
      ac: 16,
    },
  },
];

const NO_BOUND_CHAR_PARTY: Participant[] = [
  { username: 'dm_alice', is_dm: true, character: null },
  { username: 'sam', is_dm: false, character: null },
];

function setup(session: Session = BASE_SESSION, participants: Participant[] = BOUND_CHAR_PARTY) {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(session);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue(null);
  mockGetParticipants.mockResolvedValue(participants);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('T12 — GrantCurrencyPanel mount gate (page-level, per-axis)', () => {
  it('renders for the DM seat (AI dm_mode) when a participant has a bound character (positive control)', async () => {
    mockUsername = 'dm_alice';
    setup(BASE_SESSION, BOUND_CHAR_PARTY);
    render(<PlayPage />);

    expect(await screen.findByText('Grant gold')).toBeInTheDocument();
    expect(screen.getByLabelText('Character')).toBeInTheDocument();
    expect(screen.getByLabelText('Gold')).toBeInTheDocument();
  });

  it('also renders for a HUMAN dm_mode DM seat — isDm does not depend on dm_mode (mirrors Award XP)', async () => {
    mockUsername = 'dm_alice';
    setup({ ...BASE_SESSION, dm_mode: 'human' }, BOUND_CHAR_PARTY);
    render(<PlayPage />);

    expect(await screen.findByText('Grant gold')).toBeInTheDocument();
  });

  it('never renders for a non-DM player, even when a participant has a bound character', async () => {
    mockUsername = 'alex';
    setup(BASE_SESSION, BOUND_CHAR_PARTY);
    render(<PlayPage />);

    await waitFor(() => expect(mockGetParticipants).toHaveBeenCalled());
    await settle();

    expect(screen.queryByText('Grant gold')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Character')).not.toBeInTheDocument();
    // The whole enclosing "Session controls" group is gone too (DDX-25's own
    // gate) — confirms this isn't merely CSS-hidden but genuinely unmounted.
    expect(screen.queryByRole('group', { name: /Session controls/i })).not.toBeInTheDocument();
  });

  it('DM seat but NO participant has a bound character: the panel shows an accessible empty-state, no interactive Grant controls (page-level integration of the component-level gate)', async () => {
    mockUsername = 'dm_alice';
    setup(BASE_SESSION, NO_BOUND_CHAR_PARTY);
    render(<PlayPage />);

    await waitFor(() => expect(mockGetParticipants).toHaveBeenCalled());
    await settle();

    // The DM DOES see the rest of the Session controls group (Award XP)...
    expect(await screen.findByRole('button', { name: /Award XP/i })).toBeInTheDocument();
    // ...and Grant gold renders an accessible empty-state (a SR DM knows the
    // feature exists but has no target) — with NO interactive Grant controls.
    expect(screen.getByText(/No characters seated yet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Character')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Gold')).not.toBeInTheDocument();
  });
});
