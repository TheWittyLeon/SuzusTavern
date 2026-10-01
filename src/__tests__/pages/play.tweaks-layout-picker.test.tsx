/**
 * A9c-2 D3 (R23) — the layout picker is reachable FROM /play. `/play` is outside
 * `TavernShell` (R25), TweaksPanel's only other mount, so the TopBar `settings`
 * slot is the escape hatch. Picking Table while exploring flips the resolved
 * preset in place: presets place, never unmount (the story log is not remounted).
 */
import React from 'react';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
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
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-layout');
  (dnd.getSession as jest.Mock).mockResolvedValue(SESSION);
  (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
});

const root = (c: HTMLElement) => c.querySelector('[data-layout-resolved]') as HTMLElement;

describe('/play — the TopBar settings slot hosts the Appearance trigger', () => {
  it('the trigger sits in the topBar region, after the journal toggle', async () => {
    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    const trigger = screen.getByRole('button', { name: 'Appearance settings' });
    const journal = screen.getByRole('button', { name: 'Open journal' });
    expect(container.querySelector('[data-region="topBar"]')).toContainElement(trigger);
    expect(journal.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the exit is still the first tab stop of the header
    const exit = screen.getByRole('link', { name: 'Leave session' });
    expect(exit.compareDocumentPosition(journal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('picking Table while exploring flips data-layout-resolved in place; the story log is not remounted', async () => {
    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    expect(root(container)).toHaveAttribute('data-layout-resolved', 'story');
    const log = container.querySelector('[data-region="storyLog"]') as HTMLElement;
    expect(log).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Appearance settings' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
    });

    await waitFor(() => expect(root(container)).toHaveAttribute('data-layout-resolved', 'table'));
    expect(root(container)).toHaveAttribute('data-moment', 'exploring');
    expect(container.querySelector('[data-region="storyLog"]')).toBe(log);
    expect(window.localStorage.getItem('tavern.layout')).toBe('table');

    // and back to Auto: the key is cleared, the row follows the moment (exploring -> story)
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    });
    await waitFor(() => expect(root(container)).toHaveAttribute('data-layout-resolved', 'story'));
    expect(window.localStorage.getItem('tavern.layout')).toBeNull();
    expect(container.querySelector('[data-region="storyLog"]')).toBe(log);
  });

  it('the open picker is portaled out of the page tree (an overlay slot cannot clip it)', async () => {
    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    fireEvent.click(screen.getByRole('button', { name: 'Appearance settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Appearance' });
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
  });
});
