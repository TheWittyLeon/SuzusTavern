/**
 * Tests for the character sheet (src/app/character/[id]/page.tsx, ST-054–058).
 * Renders from the structured getCharacterSheet payload.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
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
    <AuthProvider initialUser={ALICE}>
      <ToastProvider>
        <CharacterPage />
      </ToastProvider>
    </AuthProvider>,
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
