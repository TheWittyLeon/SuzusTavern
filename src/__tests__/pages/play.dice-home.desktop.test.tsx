/**
 * A10 step 11, S1 (Sora's build brief 3.1, Amendment F.4) — the dice leave every stage that will hold a map, on a DESKTOP.
 *
 * The real /play page under a desktop `matchMedia` (jsdom's default: nothing matches the phone query). The dice have ONE home, chosen by the row:
 *   - Story while EXPLORING: the stage is a `panel`, the composer `full`, and the tray is the stage's tenant (it was, and stays).
 *   - Story in COMBAT and Table in BOTH moments: the stage is a `hero`, which hosts no tenant: the composer is `roll`, Roll sits in the composer's
 *     mode row, and the tray is mounted only while its popover is open.
 * The tray remounts at the combat edge in Story; `advantage` lives in the page and must survive it, and focus that was on a die when the tray
 * left must not drop to <body> (the begin-encounter rescue lands it on the scene head). The geometry (one row, the composer's height, Roll whole at
 * rest) is the browser harness's: z:modeRow, o:restControls and the dice-focus legs; jsdom has no layout.
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
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  monsterTurn: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  resolveCheck: jest.fn(),
  postRoll: jest.fn(),
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
const COMBAT = {
  combat_id: 'combat-flight', session_id: 's1', round: 1, state: 'active', turn_index: 0, active_participant_id: 'p1', initiative: ['p1', 'w1'],
  participants: [
    { participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 10, hp_max: 10, ac: 13, conditions: [], is_alive: true, can_be_targeted: false, is_active_turn: true, took_turn: false },
    { participant_id: 'w1', entity_id: 'g1', name: 'Timberwolf', is_pc: false, initiative: 9, hp_current: 19, hp_max: 19, ac: 13, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false },
  ],
} as unknown as CombatState;

const tray = (c: HTMLElement) => c.querySelector('[data-tenant="diceTray"]');
const roll = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-roll-control]');
const moment = (c: HTMLElement) => c.querySelector('[data-layout-resolved]')?.getAttribute('data-moment');

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  (dnd.getSession as jest.Mock).mockResolvedValue(SESSION);
  (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
  (dnd.getGrounding as jest.Mock).mockResolvedValue(GROUNDING);
  (dnd.getCombatState as jest.Mock).mockResolvedValue(null);
  (dnd.combatFromScene as jest.Mock).mockResolvedValue({ combat_id: 'combat-flight', round: 1, monsters: [], terrain: {}, encounter_id: 'wolves' });
});

/** The fight starts: the combat state the page reads next is the active one. */
async function startFight() {
  (dnd.getCombatState as jest.Mock).mockResolvedValue(COMBAT);
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', { name: /Stand and fight/i }));
  });
}

describe('Story (desktop): the tray is the stage\'s while exploring and Roll\'s in a fight', () => {
  beforeEach(() => window.localStorage.setItem('tavern.layout', 'story'));

  it('exploring -> combat: the tray unmounts, Roll mounts in the composer, `advantage` survives, and focus that was on a die lands on the scene head', async () => {
    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('Test Table');
    await screen.findByRole('button', { name: /Stand and fight/i });

    // exploring: the tray is the stage's tenant, there is no Roll control
    expect(moment(container)).toBe('exploring');
    expect(tray(container)).not.toBeNull();
    expect(tray(container)!.closest('[data-region-slot]')).toHaveAttribute('data-region-slot', 'sceneStage');
    expect(roll(container)).toBeNull();
    expect(container.querySelector('[data-region="composer"]')).toHaveAttribute('data-variant', 'full');

    // a modifier and a focused die, before the fight
    fireEvent.click(screen.getByRole('button', { name: 'advantage' }));
    expect(screen.getByRole('button', { name: 'advantage' })).toHaveAttribute('aria-pressed', 'true');
    const d20 = screen.getByRole('button', { name: 'Roll d20' });
    act(() => d20.focus());
    expect(d20).toHaveFocus();

    await startFight();
    await waitFor(() => expect(moment(container)).toBe('combat'));

    // the die the user was on left with the tray; focus must not be stranded on <body>: the begin-encounter rescue lands it on the scene head
    const head = container.querySelector('[aria-label^="Scene:"]');
    expect(head).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(head));

    // combat: the stage is a hero and hosts no tenant; the dice are behind Roll, in the composer
    expect(container.querySelector('[data-region="sceneStage"]')).toHaveAttribute('data-variant', 'hero');
    expect(tray(container)).toBeNull();
    expect(d20.isConnected).toBe(false);
    expect(container.querySelector('[data-region="composer"]')).toHaveAttribute('data-variant', 'roll');
    expect(roll(container)).not.toBeNull();
    expect(roll(container)!.closest('[data-region-slot]')).toHaveAttribute('data-region-slot', 'composer');
    // `advantage` lives in the page: Roll says so in text and in its name, and the tray it opens has it pressed
    expect(roll(container)).toHaveTextContent('Roll · Adv');
    expect(roll(container)).toHaveAccessibleName('Roll · Advantage');
    fireEvent.click(roll(container)!);
    expect(screen.getByRole('dialog', { name: 'Roll dice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'advantage' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a page that LOADS in a fight has no tray anywhere until Roll opens it', async () => {
    (dnd.getSession as jest.Mock).mockResolvedValue({ ...SESSION, active_combat_id: 'combat-flight' });
    (dnd.getCombatState as jest.Mock).mockResolvedValue(COMBAT);
    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('Test Table');
    await waitFor(() => expect(moment(container)).toBe('combat'));
    expect(roll(container)).not.toBeNull();
    expect(container.querySelector('[role="toolbar"][aria-label="Dice"]')).toBeNull();
    expect(tray(container)).toBeNull();
  });
});

describe('Table (desktop): the stage is a hero in both moments, so Roll is the dice\'s home in both', () => {
  beforeEach(() => window.localStorage.setItem('tavern.layout', 'table'));

  it('exploring and combat: Roll in the composer, no tray in the stage, and `advantage` (set through Roll) survives the combat edge', async () => {
    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('Test Table');
    await screen.findByRole('button', { name: /Stand and fight/i });
    expect(moment(container)).toBe('exploring');
    expect(container.querySelector('[data-region="sceneStage"]')).toHaveAttribute('data-variant', 'hero');
    expect(container.querySelector('[data-region="composer"]')).toHaveAttribute('data-variant', 'roll');
    expect(tray(container)).toBeNull();
    expect(roll(container)).not.toBeNull();

    fireEvent.click(roll(container)!);
    fireEvent.click(screen.getByRole('button', { name: 'disadvantage' }));
    expect(roll(container)).toHaveAccessibleName('Roll · Disadvantage');
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Roll dice' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Roll dice' })).toBeNull());

    await startFight();
    await waitFor(() => expect(moment(container)).toBe('combat'));
    expect(tray(container)).toBeNull();
    expect(roll(container)).toHaveAccessibleName('Roll · Disadvantage');
    expect(container.querySelector('[data-region="composer"]')).toHaveAttribute('data-variant', 'roll');
  });
});
