/**
 * UIR2-TAV-11 cross-popover Escape leak — Miko-QA adversarial gate regression.
 *
 * TAV-11 added a `document`-level keydown listener (scoped to `xpFormOpen`)
 * that closes the Award-XP popover on ANY Escape reaching `document`. Two
 * sibling overlays deliberately swallow Escape WITHOUT stopPropagation()
 * while they're busy, by design — so the user can watch/retry an in-flight
 * request (combat outcome chooser: Tora MINOR-1; ConfirmDialog: busy-Tab
 * guard). Neither has mutual-exclusion with `xpFormOpen`, so a busy sibling's
 * "swallowed" Escape actually falls through to the document listener and
 * silently closes the unrelated Award-XP popover.
 *
 * This file proves the fix: the document-level XP-close fallback now no-ops
 * while a sibling Escape-handling overlay (outcome chooser / end-session
 * confirm / journal) is open, so a busy chooser's Escape can no longer leak
 * through to close Award-XP.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { CombatState, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// dm_alice is both the logged-in user and the session DM, so the Session
// controls group (Award XP / End session) and the combat outcome chooser
// are both reachable from a single render.
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
  getCombatState: jest.fn(),
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
  // endCombat is mocked to never resolve, so a click leaves combatBusy=true
  // — exactly the window in which the chooser's own Escape handler does NOT
  // call stopPropagation() (Tora MINOR-1: `if (e.key === 'Escape' &&
  // !combatBusy)`), and the leak would otherwise reach `document`.
  endCombat: jest.fn(() => new Promise(() => {})),
  setFlag: jest.fn(),
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'dm_alice', role: 'player', character_id: 55 })),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
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
const mGetCombatState = dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>;
const mEndCombat = dnd.endCombat as jest.MockedFunction<typeof dnd.endCombat>;

const SESSION: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'active',
  dm_username: 'dm_alice',
  name: 'The Hollow Tide',
  active_combat_id: 'combat-42',
  dm_mode: 'ai',
  ai_assist_level: 'full',
};

const PARTY: Participant[] = [
  { username: 'dm_alice', is_dm: true, character: null },
];

const COMBAT_ACTIVE: CombatState = {
  combat_id: 'combat-42',
  session_id: 's1',
  round: 1,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'p_gob1',
  initiative: ['p_gob1'],
  participants: [
    {
      participant_id: 'p_gob1',
      entity_id: 'm1',
      name: 'Goblin',
      is_pc: false,
      initiative: 10,
      hp_current: 7,
      hp_max: 7,
      ac: 13,
      conditions: [],
      is_alive: true,
      can_be_targeted: true,
      is_active_turn: true,
      took_turn: false,
    },
  ],
};

function setup() {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetCombatState.mockResolvedValue(COMBAT_ACTIVE);
  mEndCombat.mockReturnValue(new Promise(() => {}));
}

describe('UIR2-TAV-11 cross-popover Escape leak (Miko-QA gate)', () => {
  it('a busy combat-outcome chooser swallowing Escape must not leak through and close the Award-XP popover', async () => {
    setup();
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    // Open the Award-XP popover first.
    fireEvent.click(await screen.findByRole('button', { name: /Award XP/i }));
    const xpForm = await screen.findByRole('form', { name: /Award session XP/i });
    expect(xpForm).toBeInTheDocument();

    // Now open the combat outcome chooser (sibling overlay).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /End combat/i })).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /End combat/i }));
    });
    const chooser = await screen.findByRole('group', { name: /Choose combat outcome/i });

    // Pick an outcome — endCombat never resolves, so combatBusy stays true
    // and the chooser correctly stays open (Tora MINOR-1).
    fireEvent.click(within(chooser).getByRole('button', { name: /Unresolved/i }));
    await waitFor(() => expect(mEndCombat).toHaveBeenCalledTimes(1));

    // Escape on the still-busy chooser: its own handler does NOT
    // stopPropagation() while busy, so this event would otherwise bubble to
    // `document` and (pre-fix) close the unrelated Award-XP popover.
    fireEvent.keyDown(chooser, { key: 'Escape' });

    // The busy chooser must stay open (unchanged behavior).
    expect(screen.getByRole('group', { name: /Choose combat outcome/i })).toBeInTheDocument();
    // BUG (pre-fix): the Award-XP popover was silently closed by the leaked
    // Escape. Post-fix it must remain open.
    expect(screen.queryByRole('form', { name: /Award session XP/i })).toBeInTheDocument();
  });

  it('control: Escape from outside the form still closes the Award-XP popover when no sibling overlay is open', async () => {
    setup();
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const trigger = screen.getByRole('button', { name: /Award XP/i });
    fireEvent.click(trigger);
    const xpForm = await screen.findByRole('form', { name: /Award session XP/i });
    expect(xpForm).toBeInTheDocument();

    // Focus is outside the form (no sibling overlay open) — the original
    // TAV-11 fallback path must still work.
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('form', { name: /Award session XP/i })).not.toBeInTheDocument(),
    );
  });
});
