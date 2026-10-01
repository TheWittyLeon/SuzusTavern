/**
 * A9b QA (Miko) -- characterBlock singleton on the REAL page.
 *
 * page.tsx renders ONE member sheet node: docked in the grid when the row's
 * characterBlock placement is an area (Table), or inside the member-sheet
 * <Drawer> when it is a layer (Story / Phone). useMemberSheetDrawer's `open`
 * flag is shared by both. These tests drive the real page through the
 * transitions that expose what that sharing does.
 *
 * Pref is pinned via a mutable ThemeProvider mock so a row switch is a
 * rerender, not a viewport resize (jsdom has none).
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { CharacterSheet, CombatState, Participant, Session } from '@/lib/api/types';

let mockLayoutPref: 'auto' | 'story' | 'table' = 'table';

jest.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 's1' }) }));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', email: null } }),
}));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../lib/theme/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useTheme: () => ({ vibe: 'dusk-tavern', setVibe: jest.fn(), density: 'cozy', setDensity: jest.fn() }),
  useThemeOptional: () => ({
    vibe: 'dusk-tavern',
    layout: mockLayoutPref,
    setVibe: jest.fn(),
    density: 'cozy',
    setDensity: jest.fn(),
  }),
}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(),
  getCharacterSheet: jest.fn(),
  getCatalog: jest.fn(() => Promise.resolve({ system: 'dnd5e', content_type: 'class', items: [], total: 0, limit: 100, offset: 0 })),
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
  rollDeathSave: jest.fn(),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  bindCharacter: jest.fn(),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));
jest.mock('../../lib/stream', () => ({ streamDmNarration: jest.fn() }));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const SESSION: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  name: 'QA Table',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['alice', 'bob'],
  player_count: 2,
  active_combat_id: null,
  dm_mode: 'ai',
  ai_assist_level: 'off',
};
const PARTY: Participant[] = [
  { username: 'alice', is_dm: false, character: { character_id: 'c1', name: 'Torvin', char_class: 'Fighter', level: 5, current_hp: 30, max_hp: 30, ac: 17 } },
  { username: 'bob', is_dm: false, character: { character_id: 'c2', name: 'Wrenna', char_class: 'Wizard', level: 5, current_hp: 20, max_hp: 20, ac: 12 } },
];
// Distinct from any party-card text so a heading match proves the SHEET rendered.
const ab = (score: number, mod: number) => ({ score, modifier: mod });
const BOB_SHEET = {
  character_id: 'c2', owner_username: 'bob', name: 'Wrenna the Unmistakable', race: 'Elf', subrace: '',
  char_class: 'Wizard', subclass: '', level: 5, background: 'Sage', alignment: '',
  ability_scores: { strength: ab(8, -1), dexterity: ab(14, 2), constitution: ab(12, 1), intelligence: ab(18, 4), wisdom: ab(12, 1), charisma: ab(10, 0) },
  hp: { current: 20, max: 20, temp: 0 }, ac: 12, initiative: 2, proficiency_bonus: 3, speed: 30, xp: 0, xp_next: 300,
  hit_dice_remaining: 5, proficient_saves: [], proficient_skills: [], class_features: ['Arcane Recovery'],
  conditions: [], spellcasting: null, spell_slots: {}, is_spellcaster: false, inventory: [], inventory_weight: 0,
} as unknown as CharacterSheet;

const COMBAT: CombatState = {
  combat_id: 'combat-42', session_id: 's1', round: 1, state: 'active', turn_index: 0,
  active_participant_id: 'p_torvin', initiative: ['p_torvin', 'p_gob1'],
  participants: [
    { participant_id: 'p_torvin', entity_id: 'c1', name: 'Torvin', is_pc: true, initiative: 18, hp_current: 30, hp_max: 30, ac: 17, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: true, took_turn: false,
      death_saves: { successes: 0, failures: 0, is_downed: false, is_dying: false, is_stable: false, is_dead: false } },
    { participant_id: 'p_gob1', entity_id: 'goblin', name: 'Goblin', is_pc: false, initiative: 12, hp_current: 7, hp_max: 7, ac: 13, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false },
  ],
  terrain: { lighting: 'dim', cover: '', hazards: [] }, encounter_id: 'e', scene_id: 'cave_mouth', last_action: null, scene_advance: null,
};

const m = (f: unknown) => f as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockLayoutPref = 'table';
  m(dnd.getSession).mockResolvedValue({ ...SESSION, active_combat_id: 'combat-42' });
  m(dnd.getParticipants).mockResolvedValue(PARTY);
  m(dnd.getGrounding).mockResolvedValue({ scene_id: 'cave_mouth', scene_name: 'Cave Mouth', transitions: [] });
  m(dnd.getCombatState).mockResolvedValue(COMBAT);
  m(dnd.getCharacterSheet).mockResolvedValue(BOB_SHEET);
});

async function selectBob() {
  const card = await screen.findByRole('button', { name: /Wrenna/ });
  await act(async () => { fireEvent.click(card); });
  await waitFor(() => expect(dnd.getCharacterSheet).toHaveBeenCalled());
}

describe('characterBlock singleton -- docked (Table) vs Drawer (Story)', () => {
  it('positive control: Story pinned, selecting a member opens the sheet as a modal dialog', async () => {
    mockLayoutPref = 'story';
    render(<PlayPage />);
    await selectBob();
    const dlg = await screen.findByRole('dialog', { name: /Wrenna the Unmistakable|Character sheet/ });
    expect(within(dlg).getByRole('button', { name: /Close character sheet/i })).toBeInTheDocument();
  });

  it('Table pinned: the sheet is docked (heading present), and there is exactly ONE Close button and no dialog', async () => {
    render(<PlayPage />);
    await selectBob();
    expect(await screen.findByRole('heading', { name: /Wrenna the Unmistakable/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /character sheet|Wrenna/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Close character sheet/i })).toHaveLength(1);
  });

  /**
   * DEFECT A9b-1 (Important). Table: select a member (useMemberSheetDrawer
   * sets open=true), never touch Close. Then the layout flips to Story
   * (combat ends / the user picks the Story preset). The Drawer mounts with
   * open=true and the sheet pops up as a MODAL the player never asked for,
   * stealing focus. `test.failing`: green today, RED when fixed -> delete the
   * `.failing`.
   */
  test('DEFECT A9b-1: Table -> Story after a docked selection must not surface a modal dialog', async () => {
    const { rerender } = render(<PlayPage />);
    await selectBob();
    mockLayoutPref = 'story';
    // a fresh element makes PlayPage re-run usePlayLayout against the new pref
    await act(async () => { rerender(<PlayPage />); });
    // control: the layout really did switch (Story has no docked heading in the grid)
    expect(screen.queryByRole('dialog', { name: /character sheet|Wrenna/i })).not.toBeInTheDocument();
  });

  /**
   * DEFECT A9b-1b. The docked panel carries a Close button wired to
   * Drawer's onClose, which only flips `open`. In the docked row nothing
   * reads `open`, so the control does nothing observable. A visible control
   * with no effect is a dead control (a11y: a button that announces
   * "Close character sheet" and then leaves the sheet there).
   */
  test('DEFECT A9b-1b: the docked sheet\'s Close button visibly changes the panel', async () => {
    render(<PlayPage />);
    await selectBob();
    await screen.findByRole('heading', { name: /Wrenna the Unmistakable/ });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Close character sheet/i }));
    });
    expect(screen.queryByRole('heading', { name: /Wrenna the Unmistakable/ })).not.toBeInTheDocument();
  });
});

/**
 * A9b fix round 1 (Miko Imp-1 / Aoi B1) -- the docked sheet is its own
 * presentation: default = the viewer's OWN sheet, Close FOLDS the rail
 * (never a no-op), nothing here is ever a modal, and the Drawer stays
 * mounted across a placement switch (A5).
 */
describe('docked member sheet (Table) -- A9b fix round 1', () => {
  const ALICE_SHEET = { ...BOB_SHEET, character_id: 'c1', owner_username: 'alice', name: 'Torvin the Undaunted' } as CharacterSheet;
  beforeEach(() => {
    m(dnd.getCharacterSheet).mockImplementation((id: string) =>
      Promise.resolve(id === 'c1' ? ALICE_SHEET : BOB_SHEET),
    );
  });

  it('Imp-1: with nobody picked, the dock shows the viewer\'s OWN sheet (not an empty header)', async () => {
    render(<PlayPage />);
    expect(await screen.findByRole('heading', { name: /Torvin the Undaunted/ })).toBeInTheDocument();
  });

  it('Imp-1: the Drawer is mounted but inert while docked -- no dialog, no panel inside it', async () => {
    render(<PlayPage />);
    await screen.findByRole('heading', { name: /Torvin the Undaunted/ });
    const drawer = document.getElementById('play-pane-member-sheet');
    expect(drawer).not.toBeNull();
    expect(within(drawer as HTMLElement).queryByRole('heading', { hidden: true })).toBeNull();
    expect(screen.queryByRole('dialog', { name: /character sheet|Torvin|Wrenna/i })).not.toBeInTheDocument();
  });

  it('B1: Close folds the rail to a strip; the strip gets focus; re-opening returns the sheet and focuses Close', async () => {
    render(<PlayPage />);
    await screen.findByRole('heading', { name: /Torvin the Undaunted/ });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Close character sheet/i })); });
    expect(screen.queryByRole('heading', { name: /Torvin the Undaunted/ })).not.toBeInTheDocument();
    const strip = screen.getByRole('button', { name: /Open character sheet/i });
    expect(strip).toHaveFocus();
    await act(async () => { fireEvent.click(strip); });
    expect(await screen.findByRole('heading', { name: /Torvin the Undaunted/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close character sheet/i })).toHaveFocus();
    expect(screen.queryByRole('button', { name: /Open character sheet/i })).not.toBeInTheDocument();
  });

  it('B1: picking a party member while the rail is folded unfolds it onto that member', async () => {
    render(<PlayPage />);
    await screen.findByRole('heading', { name: /Torvin the Undaunted/ });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Close character sheet/i })); });
    await selectBob();
    expect(await screen.findByRole('heading', { name: /Wrenna the Unmistakable/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open character sheet/i })).not.toBeInTheDocument();
  });

  it('A5: Story drawer open -> Table keeps the SAME drawer node mounted, closed, and docks the sheet; back to Story it does NOT reopen', async () => {
    mockLayoutPref = 'story';
    const { rerender } = render(<PlayPage />);
    await selectBob();
    await screen.findByRole('dialog', { name: /Wrenna the Unmistakable|Character sheet/ });
    const drawerBefore = document.getElementById('play-pane-member-sheet');

    mockLayoutPref = 'table';
    await act(async () => { rerender(<PlayPage />); });
    expect(document.getElementById('play-pane-member-sheet')).toBe(drawerBefore);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Close character sheet/i })).toHaveLength(1);

    mockLayoutPref = 'story';
    await act(async () => { rerender(<PlayPage />); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
