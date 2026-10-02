/**
 * A10 step 11, fix round F2 (Miko's QA gaps 10 and the reverse direction) — focus follows the dice across the combat edge, BOTH ways, on a desktop.
 *
 * `play.dice-home.desktop.test.tsx` pins one die (Roll d20) going one way (exploring -> combat, Story). The tray is the stage's tenant only in Story while exploring and Roll
 * is its home everywhere else, so the dice change home at the combat edge in Story and in no other cell. Whatever the user holds when that happens must never be dropped on <body>:
 *   - exploring -> combat (Story): EACH control of the tray, focused when the fight starts, ends on the scene head (the begin-encounter rescue);
 *   - combat -> exploring (Story): Roll focused, or a die focused under the open Roll popover, ends in the composer with the popover gone;
 *   - combat -> exploring (Table, where the composer is `roll` in both moments): nothing about the dice' home changed, so nothing is taken from the player: Roll keeps focus, and an
 *     open popover stays open with focus inside it.
 * The browser legs (`dice-focus-tray-story`, `dice-focus-end-roll-*`, `dice-focus-end-popover-*` in the harness) judge the same in Chromium.
 */
import React from 'react';
import { screen, act, waitFor, fireEvent } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { CombatState, GroundingData, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 's1' }) }));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }) }));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../app/play/[sessionId]/format', () => ({ ...jest.requireActual('../../app/play/[sessionId]/format'), POLL_INTERVAL_MS: 25 }));
jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  getCatalog: jest.fn(() => Promise.resolve({ items: [] })),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  combatFromScene: jest.fn(),
  rollInitiative: jest.fn(() => Promise.resolve({ message: 'Initiative rolled.' })),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));
jest.mock('../../lib/stream', () => ({ streamDmNarration: jest.fn(async function* () { yield { kind: 'done' }; }) }));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const SESSION: Session = {
  session_id: 's1', channel: 'everfree_flight_channel', name: 'Test Table', status: 'active', dm_username: 'suzu',
  participant_usernames: ['leon'], player_count: 1, active_combat_id: null, dm_mode: 'ai', ai_assist_level: 'off',
};
const PARTY: Participant[] = [
  { username: 'leon', is_dm: false, character: { character_id: 'c1', name: 'Anomaly', char_class: 'Ranger', level: 1, current_hp: 10, max_hp: 10, ac: 13 } },
];
const GROUNDING: GroundingData = {
  scene_id: 'everfree_flight', scene_name: 'Flight Through the Everfree', boxed_text: 'The pack is closing in.',
  transitions: [], checks: [], flags: {}, encounter_state: {}, encounter: { kind: 'combat', trigger: 'manual' },
};
const fight = (over: Record<string, unknown> = {}) =>
  ({
    combat_id: 'combat-flight', session_id: 's1', round: 1, state: 'active', turn_index: 0, active_participant_id: 'p1', initiative: ['p1', 'w1'],
    participants: [
      { participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 10, hp_max: 10, ac: 13, conditions: [], is_alive: true, can_be_targeted: false, is_active_turn: true, took_turn: false },
      { participant_id: 'w1', entity_id: 'g1', name: 'Timberwolf', is_pc: false, initiative: 9, hp_current: 19, hp_max: 19, ac: 13, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false },
    ],
    ...over,
  }) as unknown as CombatState;

const moment = (c: HTMLElement) => c.querySelector('[data-layout-resolved]')?.getAttribute('data-moment');
const sceneHead = (c: HTMLElement) => c.querySelector('[aria-label^="Scene:"]');
const rollButton = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-roll-control]');
const inComposer = (c: HTMLElement, el: Element | null) => !!el && !!c.querySelector('[data-region="composer"]')?.contains(el);
/** The tray's own controls, as a user would Tab to them. */
const trayControls = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-tenant="diceTray"] :is(button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"]))')].filter((e) => !(e as HTMLButtonElement).disabled);

let served: () => CombatState;
beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  served = () => fight();
  (dnd.getSession as jest.Mock).mockResolvedValue(SESSION);
  (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
  (dnd.getGrounding as jest.Mock).mockResolvedValue(GROUNDING);
  (dnd.getCombatState as jest.Mock).mockImplementation(() => Promise.resolve().then(() => served()));
  (dnd.combatFromScene as jest.Mock).mockResolvedValue({ combat_id: 'combat-flight', round: 1, monsters: [], terrain: {}, encounter_id: 'wolves' });
});

/** The page in Story, exploring, with the tray in the stage. */
async function loadExploring() {
  window.localStorage.setItem('tavern.layout', 'story');
  (dnd.getCombatState as jest.Mock).mockResolvedValue(null);
  const r = renderPlay(<PlayPage />);
  await screen.findByText('Test Table');
  await screen.findByRole('button', { name: /Stand and fight/i });
  return r;
}

/** The page loaded INTO a fight (Roll is the dice' home), in `layout`. */
async function loadFight(layout: 'story' | 'table') {
  window.localStorage.setItem('tavern.layout', layout);
  (dnd.getSession as jest.Mock).mockResolvedValue({ ...SESSION, active_combat_id: 'combat-flight' });
  const r = renderPlay(<PlayPage />);
  await screen.findByText('Test Table');
  await waitFor(() => expect(moment(r.container)).toBe('combat'));
  await waitFor(() => expect(rollButton(r.container)).not.toBeNull());
  return r;
}

const endFight = () => { served = () => fight({ state: 'ended', active_participant_id: null }); };

describe('Story: every control of the tray, focused when a fight starts, lands on the scene head', () => {
  it('the tray has controls to try: six dice and three modifiers at least (an empty set is a refused pass)', async () => {
    const { container, unmount } = await loadExploring();
    expect(trayControls(container).length).toBeGreaterThanOrEqual(9);
    unmount();
  });

  it('each one: focus is on the scene head when the fight is on, never <body>, and the control left the stage with the tray', async () => {
    const probe = await loadExploring();
    const n = trayControls(probe.container).length;
    probe.unmount();
    for (let i = 0; i < n; i++) {
      const { container, unmount } = await loadExploring();
      const control = trayControls(container)[i];
      const name = control.getAttribute('aria-label') ?? control.textContent;
      act(() => control.focus());
      expect([name, document.activeElement === control]).toEqual([name, true]);
      (dnd.getCombatState as jest.Mock).mockResolvedValue(fight());
      await act(async () => {
        fireEvent.click(await screen.findByRole('button', { name: /Stand and fight/i }));
      });
      await waitFor(() => expect(moment(container)).toBe('combat'));
      await waitFor(() => expect([name, document.activeElement]).toEqual([name, sceneHead(container)]));
      expect([name, control.isConnected]).toEqual([name, false]);
      unmount();
    }
  });
});

describe('Story: a fight ending takes the dice home to the stage; focus ends in the composer and the popover is gone', () => {
  it('Roll focused', async () => {
    const { container } = await loadFight('story');
    act(() => rollButton(container)!.focus());
    expect(document.activeElement).toBe(rollButton(container));
    endFight();
    await waitFor(() => expect(moment(container)).toBe('exploring'));
    await waitFor(() => expect(inComposer(container, document.activeElement)).toBe(true));
    expect(document.activeElement).not.toBe(document.body);
    expect(rollButton(container)).toBeNull();
  });

  it('a die focused under the open Roll popover', async () => {
    const { container } = await loadFight('story');
    fireEvent.click(rollButton(container)!);
    const dialog = await screen.findByRole('dialog', { name: 'Roll dice' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    endFight();
    await waitFor(() => expect(moment(container)).toBe('exploring'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Roll dice' })).toBeNull());
    await waitFor(() => expect(inComposer(container, document.activeElement)).toBe(true));
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('Table: its composer is `roll` in both moments, so a fight ending takes nothing from the player', () => {
  it('Roll focused stays focused', async () => {
    const { container } = await loadFight('table');
    const roll = rollButton(container)!;
    act(() => roll.focus());
    endFight();
    await waitFor(() => expect(moment(container)).toBe('exploring'));
    expect(rollButton(container)).toBe(roll);
    expect(document.activeElement).toBe(roll);
  });

  it('an open Roll popover stays open and keeps focus inside it', async () => {
    const { container } = await loadFight('table');
    fireEvent.click(rollButton(container)!);
    const dialog = await screen.findByRole('dialog', { name: 'Roll dice' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    endFight();
    await waitFor(() => expect(moment(container)).toBe('exploring'));
    expect(screen.getByRole('dialog', { name: 'Roll dice' })).toBe(dialog);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
