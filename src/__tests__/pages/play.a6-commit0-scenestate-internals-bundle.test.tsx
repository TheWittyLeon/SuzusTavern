/**
 * A5 / Kage-CR IMPORTANT-2 (routed to A6's first commit, 2026-09-28) —
 * `useSceneState`'s `internals` bundle (`hooks/useSceneState.ts:618-627`) is
 * unpinned: swapping two of its five entries —
 * `setSceneAdvanceBusy: setCheckBusy` / `setCheckBusy: setSceneAdvanceBusy` —
 * leaves the whole suite green, because both consumers ALSO gate on
 * `talking`, and `talking` settles before any existing assertion inspects
 * the busy state. Kage's own fix: "one case that gates the advanceScene
 * promise (the same deferred-promise shape play.a5-reduced-motion-
 * revealtext.test.tsx already establishes) and asserts, mid-flight,
 * aria-busy="true" on Move on and aria-busy="false" on Attempt."
 *
 * Mechanism under test: `Offers.tsx`'s "Move on" button reads
 * `sceneAdvanceBusy` for its `aria-busy`/`disabled`; "Attempt" reads
 * `checkBusy`. Both setters live inside `useSceneState`'s `internals`
 * bundle and are read ONLY by `useSceneActions` (`onMoveOn`/
 * `onAttemptCheck`) via that bundle's five named keys. If the bundle wires
 * `setSceneAdvanceBusy` to the WRONG setter, `onMoveOn`'s busy state lands
 * on `checkBusy` instead — Move on never shows its own busy state, and
 * Attempt shows a busy state it never earned.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'bob', email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEventsRaw = jest.fn<Promise<unknown[] | null>, unknown[]>(() => Promise.resolve(null));
const mockGetParticipants = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve([]));
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockAdvanceScene = jest.fn<Promise<unknown>, unknown[]>();
const mockResolveCheck = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
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
  advanceScene: (...args: Parameters<AnyFn>) => mockAdvanceScene(...args),
  resolveCheck: (...args: Parameters<AnyFn>) => mockResolveCheck(...args),
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
  setFlag: jest.fn(),
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'bob', role: 'player', character_id: 55 })),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* mockStream(): AsyncGenerator<unknown> {
    // yields nothing — narrate() completes to its fallback quickly, no
    // interference with the sceneAdvanceBusy/checkBusy state under test.
  }),
}));

import PlayPage from '@/app/play/[sessionId]/page';
import type { Session, Participant } from '@/lib/api/types';

const ACTIVE_SESSION: Session = {
  session_id: 's1',
  channel: 'test_channel',
  name: 'The Hollow Tide',
  dm_username: 'dm_alice',
  dm_mode: 'ai',
  ai_assist_level: 'full',
  status: 'active',
  active_combat_id: null,
};

const PARTICIPANTS: Participant[] = [
  { username: 'dm_alice', is_dm: true, character: null },
  { username: 'bob', is_dm: false, character: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(ACTIVE_SESSION);
  mockGetSessionEventsRaw.mockResolvedValue(null);
  mockGetParticipants.mockResolvedValue(PARTICIPANTS);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockResolveCheck.mockResolvedValue({ description: 'ok', mechanics: 'ok' });
  mockGetGrounding.mockResolvedValue({
    transitions: [{ to: 'forest_clearing', label: 'Head to the clearing' }],
    checks: [{ skill: 'perception', dc: 12 }],
  });
});

describe('A6 commit 0 — useSceneState internals bundle wiring (Kage-CR A5 IMPORTANT-2)', () => {
  it('Move on shows aria-busy=true mid-flight while Attempt stays aria-busy=false — proves sceneAdvanceBusy/checkBusy land on the RIGHT setter', async () => {
    let releaseAdvance: (v: unknown) => void = () => {};
    const advanceGate = new Promise((resolve) => {
      releaseAdvance = resolve;
    });
    mockAdvanceScene.mockImplementation(() => advanceGate);

    render(<PlayPage />);
    const moveOnBtn = await screen.findByRole('button', { name: /Head to the clearing/i });
    const attemptBtn = await screen.findByRole('button', { name: /Attempt Perception, DC 12/i });

    // Baseline: neither affordance is busy before the click.
    expect(moveOnBtn).toHaveAttribute('aria-busy', 'false');
    expect(attemptBtn).toHaveAttribute('aria-busy', 'false');

    fireEvent.click(moveOnBtn);
    // Let onMoveOn's synchronous `setSceneAdvanceBusy(true)` (via the
    // internals bundle) flush, before advanceScene's gated promise resolves.
    await act(async () => {
      await Promise.resolve();
    });

    // THE ASSERTION UNDER TEST: with the bundle wired correctly, ONLY Move
    // on goes busy. A swapped bundle (setSceneAdvanceBusy pointing at
    // setCheckBusy) would leave Move on's aria-busy false and flip
    // Attempt's true instead — this pin fails either direction of the swap.
    expect(moveOnBtn).toHaveAttribute('aria-busy', 'true');
    expect(attemptBtn).toHaveAttribute('aria-busy', 'false');

    // Release the gate and let onMoveOn's promise chain settle cleanly.
    await act(async () => {
      releaseAdvance({ from_scene: 'start', to_scene: 'forest_clearing' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});
