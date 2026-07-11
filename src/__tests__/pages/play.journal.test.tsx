/**
 * DDX-22 Phase 0 — Journal pane wiring on /play/[sessionId].
 *
 * Covers what only the full page can prove (JournalPane.test.tsx covers
 * section derivation + notes in isolation; journal.test.ts covers the pure
 * derivation functions):
 *   - the 4th mobile tab switches like the existing three (aria-pressed)
 *   - the desktop drawer toggle opens it with dialog semantics + moves focus
 *     to the close button
 *   - Escape / the close button / the scrim all close it and return focus to
 *     the toggle button (ConfirmDialog's focus-restore convention)
 *   - the drawer is NOT a dialog (no role) while merely the active mobile tab
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', email: null } }),
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
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'alice', role: 'player', character_id: 1 })),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' as const };
  }),
}));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetSessionEventsRaw = dnd.getSessionEventsRaw as jest.MockedFunction<
  typeof dnd.getSessionEventsRaw
>;

const SESSION: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['alice'],
  player_count: 1,
  active_combat_id: null,
  dm_mode: 'ai',
};

const PARTY: Participant[] = [
  {
    username: 'alice',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Velka',
      char_class: 'Rogue',
      level: 1,
      current_hp: 8,
      max_hp: 10,
      ac: 14,
    },
  },
];

const EVENTS: EngineSessionEvent[] = [
  { seq: 1, kind: 'scene_advance', data: { description: 'The party enters the cave.' } },
];

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetSessionEventsRaw.mockResolvedValue(EVENTS);
});

describe('Journal — 4th mobile tab', () => {
  it('switches alongside Story/Party/Scene and controls the journal pane', async () => {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const story = screen.getByRole('button', { name: /story/i });
    // Exact name: the mobile tab's accessible name is "Journal" (icon +
    // visible text); the desktop toggle's is "Open journal" (aria-label) —
    // /journal/i would ambiguously match both.
    const journalTab = screen.getByRole('button', { name: 'Journal' });

    expect(story).toHaveAttribute('aria-pressed', 'true');
    expect(journalTab).toHaveAttribute('aria-pressed', 'false');
    expect(journalTab).toHaveAttribute('aria-controls', 'play-pane-journal');

    fireEvent.click(journalTab);
    expect(journalTab).toHaveAttribute('aria-pressed', 'true');
    expect(story).toHaveAttribute('aria-pressed', 'false');
  });

  it('is not a dialog while merely the active mobile tab', async () => {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const journalTab = screen.getByRole('button', { name: 'Journal' });
    fireEvent.click(journalTab);

    const pane = document.getElementById('play-pane-journal');
    expect(pane).not.toHaveAttribute('role', 'dialog');
    expect(pane).not.toHaveAttribute('aria-modal');
  });
});

describe('Journal — desktop drawer', () => {
  it('opens with dialog semantics and moves focus to the close button', async () => {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const toggle = screen.getByRole('button', { name: 'Open journal' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // fireEvent.click does not natively move focus the way a real browser
    // click does (jsdom limitation) — focus explicitly first so
    // "previously focused" (captured by the drawer's open effect) is
    // actually the toggle button, matching real user behavior.
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const pane = document.getElementById('play-pane-journal');
    expect(pane).toHaveAttribute('role', 'dialog');
    expect(pane).toHaveAttribute('aria-modal', 'true');
    expect(pane).toHaveAttribute('aria-labelledby', 'journal-pane-heading');

    const closeBtn = screen.getByRole('button', { name: 'Close journal' });
    await waitFor(() => expect(closeBtn).toHaveFocus());
  });

  it('Escape closes the drawer and returns focus to the toggle button', async () => {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const toggle = screen.getByRole('button', { name: 'Open journal' });
    // fireEvent.click does not natively move focus the way a real browser
    // click does (jsdom limitation) — focus explicitly first so
    // "previously focused" (captured by the drawer's open effect) is
    // actually the toggle button, matching real user behavior.
    toggle.focus();
    fireEvent.click(toggle);

    const closeBtn = await screen.findByRole('button', { name: 'Close journal' });
    await waitFor(() => expect(closeBtn).toHaveFocus());

    fireEvent.keyDown(closeBtn, { key: 'Escape' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const pane = document.getElementById('play-pane-journal');
    expect(pane).not.toHaveAttribute('role', 'dialog');
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it('the close button closes the drawer and returns focus to the toggle button', async () => {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const toggle = screen.getByRole('button', { name: 'Open journal' });
    // fireEvent.click does not natively move focus the way a real browser
    // click does (jsdom limitation) — focus explicitly first so
    // "previously focused" (captured by the drawer's open effect) is
    // actually the toggle button, matching real user behavior.
    toggle.focus();
    fireEvent.click(toggle);

    const closeBtn = await screen.findByRole('button', { name: 'Close journal' });
    await waitFor(() => expect(closeBtn).toHaveFocus());

    fireEvent.click(closeBtn);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it('clicking the scrim closes the drawer', async () => {
    const { container } = render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const toggle = screen.getByRole('button', { name: 'Open journal' });
    // fireEvent.click does not natively move focus the way a real browser
    // click does (jsdom limitation) — focus explicitly first so
    // "previously focused" (captured by the drawer's open effect) is
    // actually the toggle button, matching real user behavior.
    toggle.focus();
    fireEvent.click(toggle);
    await screen.findByRole('button', { name: 'Close journal' });

    const scrim = container.querySelector('[class*="journalScrim"]');
    expect(scrim).not.toBeNull();
    fireEvent.click(scrim as Element);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('Tab does not escape the drawer while open (focus trap)', async () => {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const toggle = screen.getByRole('button', { name: 'Open journal' });
    toggle.focus();
    fireEvent.click(toggle);
    const closeBtn = await screen.findByRole('button', { name: 'Close journal' });
    await waitFor(() => expect(closeBtn).toHaveFocus());

    // Shift+Tab from the first focusable (close button, since it's focused
    // on open and nothing precedes it in the drawer) wraps to the last
    // focusable inside the drawer, never escaping to page chrome behind it.
    fireEvent.keyDown(closeBtn, { key: 'Tab', shiftKey: true });
    const pane = document.getElementById('play-pane-journal');
    expect(pane?.contains(document.activeElement)).toBe(true);
  });

  it('Tab from the last focusable wraps forward to the close button (Iro MINOR-3)', async () => {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const toggle = screen.getByRole('button', { name: 'Open journal' });
    toggle.focus();
    fireEvent.click(toggle);
    const closeBtn = await screen.findByRole('button', { name: 'Close journal' });
    await waitFor(() => expect(closeBtn).toHaveFocus());

    // The notes textarea is the LAST focusable element inside the drawer
    // (close button, then no other interactive element until the notes
    // textarea). A forward Tab from there must wrap back around to the
    // close button (the FIRST focusable) — the mirror image of the
    // Shift+Tab-from-first case above, previously untested.
    const textarea = screen.getByLabelText('Your notes for this session');
    textarea.focus();
    fireEvent.keyDown(textarea, { key: 'Tab' });
    expect(closeBtn).toHaveFocus();
  });
});
