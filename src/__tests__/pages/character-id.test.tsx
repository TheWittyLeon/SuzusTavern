/**
 * Tests for the character sheet (src/app/character/[id]/page.tsx, ST-054–058).
 * Renders from the structured getCharacterSheet payload.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useParams: () => ({ id: 'abc-123' }),
}));

jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(),
  verify2FA: jest.fn(),
  logout: jest.fn(),
  refresh: jest.fn(),
  me: jest.fn(),
  register: jest.fn(),
}));

jest.mock('../../lib/api/dnd', () => ({
  getCharacterSheet: jest.fn(),
  levelUpCharacter: jest.fn(),
  equipItem: jest.fn(),
  unequipItem: jest.fn(),
  giveItem: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import CharacterPage from '../../app/character/[id]/page';
import type { CharacterSheet, User } from '../../lib/api/types';

const mockGet = dnd.getCharacterSheet as jest.MockedFunction<typeof dnd.getCharacterSheet>;
const ALICE: User = { id: 1, username: 'alice', email: null };

function ability(score: number, modifier: number) {
  return { score, modifier };
}

const ROGUE: CharacterSheet = {
  character_id: 'abc-123',
  owner_username: 'alice',
  name: 'Velka Nightquill',
  race: 'Human',
  subrace: '',
  char_class: 'Rogue',
  subclass: '',
  level: 1,
  background: 'Charlatan',
  alignment: '',
  ability_scores: {
    strength: ability(9, -1),
    dexterity: ability(16, 3),
    constitution: ability(13, 1),
    intelligence: ability(12, 1),
    wisdom: ability(10, 0),
    charisma: ability(14, 2),
  },
  hp: { current: 9, max: 9, temp: 0 },
  ac: 13,
  initiative: 3,
  proficiency_bonus: 2,
  speed: 30,
  xp: 0,
  xp_next: 300,
  hit_dice_remaining: 1,
  proficient_saves: ['dexterity', 'intelligence'],
  proficient_skills: ['deception', 'sleight_of_hand'],
  class_features: ['Sneak Attack', 'Thieves’ Cant'],
  conditions: [],
  spellcasting: null,
  spell_slots: {},
  is_spellcaster: false,
  inventory: [],
  inventory_weight: 0,
};

function renderPage() {
  return render(
    <ThemeProvider><AuthProvider initialUser={ALICE}>
      <ToastProvider>
        <CharacterPage />
      </ToastProvider>
    </AuthProvider></ThemeProvider>,
  );
}

beforeEach(() => {
  mockGet.mockReset();
});

describe('Character sheet', () => {
  it('renders identity, abilities, skills, and features (martial)', async () => {
    mockGet.mockResolvedValue(ROGUE);
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' })).toBeInTheDocument();
    // DEX score box + proficient skill modifier (DEX 16 → +3, +2 prof on sleight_of_hand → +5).
    expect(screen.getByText('16')).toBeInTheDocument();
    expect(screen.getByText('Sleight of Hand')).toBeInTheDocument();
    expect(screen.getByText('Sneak Attack')).toBeInTheDocument();
    // HP meter exposes the values.
    expect(screen.getByRole('meter', { name: /hit points 9 of 9/i })).toBeInTheDocument();
    // Non-caster: no Spells panel.
    expect(screen.queryByText('Spells')).not.toBeInTheDocument();
  });

  it('shows the spells panel for a caster', async () => {
    mockGet.mockResolvedValue({
      ...ROGUE,
      name: 'Mira',
      char_class: 'Wizard',
      is_spellcaster: true,
      spellcasting: { ability: 'intelligence', save_dc: 12, attack_bonus: 4 },
      spell_slots: { '1': { max: 2, used: 0, remaining: 2 } },
    });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Mira' });
    expect(screen.getByText(/Spells/)).toBeInTheDocument();
    expect(screen.getByText('Level 1')).toBeInTheDocument();
  });

  it('shows a friendly error when the sheet cannot be loaded', async () => {
    mockGet.mockRejectedValue(new Error('not found'));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/can.?t find that one/i)).toBeInTheDocument(),
    );
  });
});

describe('Character sheet — DDX-10 level-up button gating', () => {
  it('owner + xp >= xp_next: Level up is shown and enabled', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, xp: 300, xp_next: 300 });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByRole('button', { name: /^level up$/i })).toBeEnabled();
  });

  it('owner + xp < xp_next: Level up is shown but disabled with a reason', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, xp: 100, xp_next: 300 });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByRole('button', { name: /^level up$/i })).toBeDisabled();
    expect(screen.getByText('Needs 200 more XP.')).toBeInTheDocument();
  });

  it('level 20 (xp_next null): Level up is shown but disabled as max level', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, level: 20, xp: 355000, xp_next: null });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByRole('button', { name: /^level up$/i })).toBeDisabled();
    expect(screen.getByText('Max level reached.')).toBeInTheDocument();
  });

  it('non-owner viewing the sheet: Level up is not rendered at all', async () => {
    // ALICE (the logged-in user) is not this character's owner.
    mockGet.mockResolvedValue({ ...ROGUE, owner_username: 'someone-else', xp: 300, xp_next: 300 });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.queryByRole('button', { name: /level up/i })).not.toBeInTheDocument();
  });

  // T13 (DDX-14t/15t) — LevelChoicePicker shares the exact same isOwner gate
  // (page.tsx: `username && isOwner && (sheet.pending_choices?.length ?? 0) > 0`).
  // dnd.ts is NOT mocked with getCatalog/resolveLevelChoice in this file's
  // jest.mock above — if the gate ever regressed and rendered the picker for
  // a non-owner, this test would fail loudly (undefined-is-not-a-function)
  // rather than silently passing, which is a stronger guarantee than just
  // checking for absent text.
  it('non-owner viewing a sheet WITH pending_choices: the level-choice picker is not rendered at all', async () => {
    mockGet.mockResolvedValue({
      ...ROGUE,
      owner_username: 'someone-else',
      pending_choices: [
        { id: 'subclass:3', type: 'subclass', level: 3, class: 'Rogue', label: 'Choose your Rogue archetype' },
      ],
    });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.queryByText(/pending choices/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Choose your Rogue archetype')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T5 / DDX-09 — inventory slice: equip → AC recomputes live on the sheet.
// End-to-end through the REAL page + InventoryPanel (not a component-isolation
// test — that's InventoryPanel.test.tsx). Proves the identity card's AC digit
// updates after an equip round-trip, driven entirely by the page's own
// onChanged={setSheet} wiring.
// ---------------------------------------------------------------------------
describe('Character sheet — T5 inventory: equip recomputes AC live', () => {
  // AC values chosen to not collide with any ability score digit already on
  // the page (9/16/13/12/10/14) or other rendered numbers (level 1, hp "9/9",
  // xp "300", init "+3", prof "+2", speed "30 ft") — getByText does exact
  // text-node matching, and a colliding value would make the query ambiguous.
  const UNARMORED_ROGUE: CharacterSheet = {
    ...ROGUE,
    ac: 19,
    inventory: [
      { name: 'Chain Mail', item_type: 'armor', sub: 'heavy', quantity: 1, equipped: false },
    ],
  };

  it('clicking Equip on an armor item updates the sheet AC without a page reload', async () => {
    mockGet.mockResolvedValueOnce(UNARMORED_ROGUE);
    const mockEquip = dnd.equipItem as jest.MockedFunction<typeof dnd.equipItem>;
    mockEquip.mockResolvedValue({ message: '[DnD] Equipped Chain Mail.' });
    // Second getCharacterSheet call is the panel's own refetch-after-mutate.
    mockGet.mockResolvedValueOnce({
      ...UNARMORED_ROGUE,
      ac: 22,
      inventory: [{ ...UNARMORED_ROGUE.inventory[0], equipped: true }],
    });

    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByText('19')).toBeInTheDocument(); // pre-equip AC

    fireEvent.click(screen.getByRole('button', { name: /^equip\b/i }));

    await waitFor(() => expect(screen.getByText('22')).toBeInTheDocument());
    expect(mockEquip).toHaveBeenCalledWith('abc-123', 'alice', 'Chain Mail');
    expect(screen.getByText('equipped')).toBeInTheDocument();
  });
});
