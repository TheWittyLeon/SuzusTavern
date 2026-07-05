/**
 * DDX-10 — LevelUpButton: threshold-gated affordance, confirm -> levelUpCharacter
 * -> refetch sheet -> diff -> surface what was gained, all via a live region.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  levelUpCharacter: jest.fn(),
  getCharacterSheet: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import LevelUpButton, { summarizeLevelUpGain } from '../../components/LevelUpButton';
import type { CharacterSheet } from '../../lib/api/types';

const mockLevelUp = dnd.levelUpCharacter as jest.Mock;
const mockGetSheet = dnd.getCharacterSheet as jest.Mock;

function ability(score: number, modifier: number) {
  return { score, modifier };
}

const BASE: CharacterSheet = {
  character_id: 'cid-1',
  owner_username: 'leon',
  name: 'Aria',
  race: 'Human',
  subrace: '',
  char_class: 'Fighter',
  subclass: '',
  level: 4,
  background: 'Soldier',
  alignment: '',
  ability_scores: {
    strength: ability(16, 3),
    dexterity: ability(12, 1),
    constitution: ability(14, 2),
    intelligence: ability(10, 0),
    wisdom: ability(10, 0),
    charisma: ability(8, -1),
  },
  hp: { current: 38, max: 38, temp: 0 },
  ac: 16,
  initiative: 1,
  proficiency_bonus: 2,
  speed: 30,
  xp: 6500,
  xp_next: 6500,
  hit_dice_remaining: 4,
  proficient_saves: ['strength', 'constitution'],
  proficient_skills: ['athletics'],
  class_features: ['Second Wind', 'Fighting Style'],
  conditions: [],
  spellcasting: null,
  spell_slots: {},
  is_spellcaster: false,
  inventory: [],
  inventory_weight: 0,
};

function renderButton(overrides?: Partial<CharacterSheet>, onLeveledUp = jest.fn()) {
  render(
    <ToastProvider>
      <LevelUpButton
        characterId="cid-1"
        username="leon"
        sheet={{ ...BASE, ...overrides }}
        onLeveledUp={onLeveledUp}
      />
    </ToastProvider>,
  );
  return { onLeveledUp };
}

beforeEach(() => {
  mockLevelUp.mockReset();
  mockGetSheet.mockReset();
});

describe('LevelUpButton — threshold + max-level gating', () => {
  it('is enabled when xp >= xp_next', () => {
    renderButton();
    expect(screen.getByRole('button', { name: /level up/i })).toBeEnabled();
    expect(screen.queryByText(/more xp/i)).not.toBeInTheDocument();
  });

  it('is disabled with a visible reason when below threshold', () => {
    renderButton({ xp: 6000, xp_next: 6500 });
    expect(screen.getByRole('button', { name: /level up/i })).toBeDisabled();
    expect(screen.getByText('Needs 500 more XP.')).toBeInTheDocument();
  });

  it('is disabled with "Max level reached" at level 20 (xp_next null)', () => {
    renderButton({ level: 20, xp: 355000, xp_next: null });
    expect(screen.getByRole('button', { name: /level up/i })).toBeDisabled();
    expect(screen.getByText('Max level reached.')).toBeInTheDocument();
  });

  it('a disabled button does not open the confirm dialog on click', () => {
    renderButton({ xp: 0, xp_next: 6500 });
    fireEvent.click(screen.getByRole('button', { name: /level up/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockLevelUp).not.toHaveBeenCalled();
  });
});

describe('LevelUpButton — confirm -> levelUpCharacter -> refetch flow', () => {
  it('confirms, calls the wrapper + refetches, surfaces the gain, and bubbles the fresh sheet up', async () => {
    mockLevelUp.mockResolvedValue({ message: '[DnD] Aria leveled up!' });
    const after: CharacterSheet = {
      ...BASE,
      level: 5,
      xp_next: 14000,
      hp: { current: 45, max: 45, temp: 0 },
      hit_dice_remaining: 5,
      class_features: ['Second Wind', 'Fighting Style', 'Extra Attack'],
    };
    mockGetSheet.mockResolvedValue(after);
    const { onLeveledUp } = renderButton();

    fireEvent.click(screen.getByRole('button', { name: /level up/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    fireEvent.click(screen.getByRole('button', { name: /^yes, level up$/i }));

    await waitFor(() => expect(mockLevelUp).toHaveBeenCalledWith('cid-1', 'leon'));
    expect(mockGetSheet).toHaveBeenCalledWith('cid-1', 'leon');
    expect(await screen.findByText(/leveled up! lv\.4 → lv\.5\./i)).toBeInTheDocument();
    expect(screen.getByText(/\+7 hp \(now 45\)/i)).toBeInTheDocument();
    expect(screen.getByText(/new: extra attack/i)).toBeInTheDocument();
    expect(onLeveledUp).toHaveBeenCalledWith(after);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('surfaces new spell slots for a caster', async () => {
    mockLevelUp.mockResolvedValue({ message: 'ok' });
    const before: CharacterSheet = {
      ...BASE,
      char_class: 'Wizard',
      is_spellcaster: true,
      spell_slots: { '1': { max: 3, used: 0, remaining: 3 }, '2': { max: 0, used: 0, remaining: 0 } },
    };
    const after: CharacterSheet = {
      ...before,
      level: 5,
      xp_next: 14000,
      spell_slots: { '1': { max: 4, used: 0, remaining: 4 }, '2': { max: 2, used: 0, remaining: 2 } },
    };
    mockGetSheet.mockResolvedValue(after);
    renderButton({ char_class: before.char_class, is_spellcaster: true, spell_slots: before.spell_slots });

    fireEvent.click(screen.getByRole('button', { name: /level up/i }));
    fireEvent.click(screen.getByRole('button', { name: /^yes, level up$/i }));

    expect(await screen.findByText(/new spell slots:/i)).toBeInTheDocument();
    expect(screen.getByText(/lv\.1 3→4/i)).toBeInTheDocument();
    expect(screen.getByText(/lv\.2 0→2/i)).toBeInTheDocument();
  });

  it('adds the DDX-14/15 ASI caveat when a gained feature is Ability Score Improvement', async () => {
    mockLevelUp.mockResolvedValue({ message: 'ok' });
    mockGetSheet.mockResolvedValue({
      ...BASE,
      level: 5,
      xp_next: 14000,
      class_features: [...BASE.class_features, 'Ability Score Improvement'],
    });
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: /level up/i }));
    fireEvent.click(screen.getByRole('button', { name: /^yes, level up$/i }));

    expect(await screen.findByText(/pickable yet/i)).toBeInTheDocument();
  });

  it('Cancel closes the dialog without calling the API', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /level up/i }));
    fireEvent.click(screen.getByRole('button', { name: /not yet/i }));

    expect(mockLevelUp).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a rejected levelUpCharacter call surfaces an error toast and closes the dialog', async () => {
    mockLevelUp.mockRejectedValue(new Error('network'));
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: /level up/i }));
    fireEvent.click(screen.getByRole('button', { name: /^yes, level up$/i }));

    expect(await screen.findByText(/could not level up/i)).toBeInTheDocument();
    expect(mockGetSheet).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not report a level-up when the refetched level did not move (engine "not enough XP" 200)', async () => {
    // Defends the dnd.ts contract note: a resolved levelUpCharacter promise is
    // not proof of success — the engine's insufficient-XP refusal is also a 200.
    mockLevelUp.mockResolvedValue({ message: '[DnD] Aria needs 500 more XP to reach level 5 (has 6000/6500).' });
    mockGetSheet.mockResolvedValue({ ...BASE, xp: 6000 }); // level unchanged
    const { onLeveledUp } = renderButton();

    fireEvent.click(screen.getByRole('button', { name: /level up/i }));
    fireEvent.click(screen.getByRole('button', { name: /^yes, level up$/i }));

    expect(await screen.findByText(/not quite enough xp yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/leveled up!/i)).not.toBeInTheDocument();
    expect(onLeveledUp).toHaveBeenCalled();
  });
});

describe('summarizeLevelUpGain (pure diff helper)', () => {
  it('computes level/HP/slot/feature deltas from two sheets', () => {
    const before = BASE;
    const after: CharacterSheet = {
      ...BASE,
      level: 5,
      hp: { current: 45, max: 45, temp: 0 },
      class_features: [...BASE.class_features, 'Extra Attack'],
    };
    const gain = summarizeLevelUpGain(before, after);
    expect(gain).toMatchObject({
      fromLevel: 4,
      toLevel: 5,
      hpGain: 7,
      hpMax: 45,
      newFeatures: ['Extra Attack'],
      hasAsiFeature: false,
    });
  });
});
