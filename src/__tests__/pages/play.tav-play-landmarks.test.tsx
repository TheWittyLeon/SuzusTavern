/**
 * TAV-PLAY-LANDMARKS (P2 / Miko P2, Iro MINOR-1) — the two structural
 * `<aside>` landmarks on /play must have a distinguishing accessible name,
 * so screen-reader landmark navigation announces something more useful than
 * a bare "complementary" twice over.
 *
 *   - `play-pane-party` (left)  → aria-label="Party and initiative"
 *   - `play-pane-scene` (right) → aria-label="Scene" (distinct from the
 *     inner `sceneHeadRef` div's own DYNAMIC scene-name aria-label — that's
 *     a focus anchor, a different node; the landmark itself keeps a short,
 *     stable name)
 *
 * The third pane (`play-pane-journal`) already has its own aria-labelledby
 * and is intentionally excluded from the "always 2" count below — in the
 * DEFAULT render state it's `aria-hidden`/`inert` (closed desktop drawer,
 * not the active mobile tab), so it does not surface as a THIRD
 * complementary landmark to the accessibility tree at all. This is verified
 * explicitly (not assumed) via `getAllByRole('complementary')`'s count.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Session, Participant } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'dm_alice', email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({ seq: 1 })),
  pauseSession: jest.fn(),
  resumeSession: jest.fn(),
  endSession: jest.fn(),
  awardSessionXp: jest.fn(),
  advanceScene: jest.fn(),
  resolveCheck: jest.fn(),
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
  submitOverride: jest.fn(),
  bindCharacter: jest.fn(),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  // DDX-22 Phase 3: JournalPane is unconditionally mounted (only its CSS
  // visibility/inert state is gated) — every render fires getSessionNotes().
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' };
  }),
}));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;

const SESSION: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'active',
  dm_username: 'dm_alice',
  name: 'The Hollow Tide',
  dm_mode: 'ai',
  ai_assist_level: 'full',
};

const PARTY: Participant[] = [{ username: 'dm_alice', is_dm: true, character: null }];

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
});

describe('TAV-PLAY-LANDMARKS', () => {
  it('the party pane resolves as a named complementary landmark: "Party and initiative"', async () => {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    expect(
      screen.getByRole('complementary', { name: 'Party and initiative' }),
    ).toBeInTheDocument();
  });

  it('the scene pane resolves as a named complementary landmark: "Scene"', async () => {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    expect(screen.getByRole('complementary', { name: 'Scene' })).toBeInTheDocument();
  });

  it('exactly 2 complementary landmarks in the default render state — the journal pane is closed/inert (not the mobile tab), so it does not surface as a 3rd', async () => {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    // Wait for the async session-notes fetch (journal pane data) to settle so
    // the count below reflects the steady-state render, not an in-flight one.
    await waitFor(() => expect(dnd.getSessionNotes).toHaveBeenCalled());
    const landmarks = screen.getAllByRole('complementary');
    expect(landmarks).toHaveLength(2);
    expect(landmarks.map((el) => el.getAttribute('aria-label'))).toEqual(
      expect.arrayContaining(['Party and initiative', 'Scene']),
    );
  });
});
