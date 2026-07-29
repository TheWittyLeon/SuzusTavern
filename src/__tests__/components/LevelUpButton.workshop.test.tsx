/**
 * LVL — LevelUpButton workshop/floor states (adversarial, design §14 P1).
 *
 * The button renders the SERVER's verdict (`sheet.levelup_policy`) and does
 * NO xp/xp_next arithmetic when the policy block is present — the client-
 * side math survives ONLY as the pre-upgrade-backend fallback. These tests
 * pin:
 *   - workshop → enabled, flavor reason, NO "Needs N more XP" in the DOM
 *   - allowed_floor → enabled with the catch-up copy (OQ-1)
 *   - denied_xp → disabled with aria-describedby still wired
 *   - denied_max_level in WORKSHOP mode → disabled with max-level copy
 *     (the xp_next==null ambiguity the outcome discriminator exists to kill)
 *   - policy ignores contradictory xp/xp_next numbers (server verdict wins)
 *   - absent levelup_policy → today's fallback behavior byte-for-byte
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  levelUpCharacter: jest.fn(),
  getCharacterSheet: jest.fn(),
}));

import { ToastProvider } from '../../components/Toast';
import LevelUpButton from '../../components/LevelUpButton';
import type { CharacterSheet, LevelUpPolicy } from '../../lib/api/types';

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
  level: 1,
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
  hp: { current: 12, max: 12, temp: 0 },
  ac: 16,
  initiative: 1,
  proficiency_bonus: 2,
  speed: 30,
  xp: 0,
  xp_next: 300,
  hit_dice_remaining: 1,
  proficient_saves: ['strength', 'constitution'],
  proficient_skills: ['athletics'],
  class_features: ['Second Wind'],
  conditions: [],
  spellcasting: null,
  spell_slots: {},
  is_spellcaster: false,
  inventory: [],
  inventory_weight: 0,
};

function policyOf(overrides: Partial<LevelUpPolicy>): LevelUpPolicy {
  return {
    outcome: 'allowed_xp',
    mode: 'xp',
    can_level: true,
    xp_short: null,
    floor: null,
    next_level: 2,
    ...overrides,
  };
}

function renderButton(sheet: Partial<CharacterSheet>) {
  render(
    <ToastProvider>
      <LevelUpButton
        characterId="cid-1"
        username="leon"
        sheet={{ ...BASE, ...sheet }}
        onLeveledUp={jest.fn()}
      />
    </ToastProvider>,
  );
}

describe('workshop mode (LVL-2)', () => {
  it('enabled with the workshop flavor reason — no XP-shortage copy anywhere', () => {
    renderButton({
      xp: 0,
      xp_next: 300, // contradictory client numbers — the verdict must win
      levelup_policy: policyOf({
        outcome: 'allowed_workshop',
        mode: 'workshop',
        can_level: true,
      }),
    });
    const btn = screen.getByRole('button', { name: 'Level up' });
    expect(btn).toBeEnabled();
    expect(
      screen.getByText('Workshop — level freely, no campaign yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/more XP/i)).not.toBeInTheDocument();
  });

  it('workshop reason stays aria-describedby-associated while ENABLED', () => {
    renderButton({
      levelup_policy: policyOf({
        outcome: 'allowed_workshop',
        mode: 'workshop',
        can_level: true,
      }),
    });
    const btn = screen.getByRole('button', { name: 'Level up' });
    const describedBy = btn.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const reason = document.getElementById(describedBy!);
    expect(reason).toHaveTextContent('Workshop — level freely, no campaign yet.');
  });

  it('level-20 workshop piece: outcome discriminator beats the null-xp_next ambiguity', () => {
    renderButton({
      level: 20,
      xp_next: null,
      levelup_policy: policyOf({
        outcome: 'denied_max_level',
        mode: 'workshop',
        can_level: false,
        next_level: null,
      }),
    });
    const btn = screen.getByRole('button', { name: 'Level up' });
    expect(btn).toBeDisabled();
    expect(screen.getByText('Max level reached.')).toBeInTheDocument();
    expect(screen.queryByText(/Workshop — level freely/)).not.toBeInTheDocument();
  });
});

describe('floor catch-up (LVL-1 / OQ-1)', () => {
  it('allowed_floor is enabled with the catch-up copy', () => {
    renderButton({
      xp: 0,
      xp_next: 300,
      levelup_policy: policyOf({
        outcome: 'allowed_floor',
        mode: 'floor',
        can_level: true,
        floor: 5,
      }),
    });
    const btn = screen.getByRole('button', { name: 'Level up' });
    expect(btn).toBeEnabled();
    expect(screen.getByText('Catch up to table level 5.')).toBeInTheDocument();
    expect(screen.queryByText(/more XP/i)).not.toBeInTheDocument();
  });
});

describe('xp-gated via the verdict', () => {
  it('denied_xp disables with the shortage copy from xp_short (not client math)', () => {
    renderButton({
      xp: 250,
      xp_next: 300,
      levelup_policy: policyOf({
        outcome: 'denied_xp',
        mode: 'xp',
        can_level: false,
        xp_short: 50,
      }),
    });
    const btn = screen.getByRole('button', { name: 'Level up' });
    expect(btn).toBeDisabled();
    expect(screen.getByText('Needs 50 more XP.')).toBeInTheDocument();
    const describedBy = btn.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
  });

  it('server verdict WINS over contradictory client numbers (no client gating math)', () => {
    // Client numbers say "can level" (xp >= xp_next); the server says no.
    renderButton({
      xp: 99999,
      xp_next: 300,
      levelup_policy: policyOf({
        outcome: 'denied_xp',
        mode: 'xp',
        can_level: false,
        xp_short: 1,
      }),
    });
    expect(screen.getByRole('button', { name: 'Level up' })).toBeDisabled();
  });

  it('allowed_xp is enabled with no reason text rendered', () => {
    renderButton({
      xp: 300,
      xp_next: 300,
      levelup_policy: policyOf({ outcome: 'allowed_xp', can_level: true }),
    });
    const btn = screen.getByRole('button', { name: 'Level up' });
    expect(btn).toBeEnabled();
    expect(btn).not.toHaveAttribute('aria-describedby');
  });
});

describe('pre-upgrade backend fallback (levelup_policy absent)', () => {
  it('falls back to xp/xp_next math — insufficient XP disables', () => {
    renderButton({ xp: 100, xp_next: 300, levelup_policy: undefined });
    expect(screen.getByRole('button', { name: 'Level up' })).toBeDisabled();
    expect(screen.getByText('Needs 200 more XP.')).toBeInTheDocument();
  });

  it('falls back to xp/xp_next math — met threshold enables', () => {
    renderButton({ xp: 300, xp_next: 300, levelup_policy: undefined });
    expect(screen.getByRole('button', { name: 'Level up' })).toBeEnabled();
  });

  it('falls back to xp_next==null as max level (the pre-LVL contract)', () => {
    renderButton({ level: 20, xp_next: null, levelup_policy: undefined });
    expect(screen.getByRole('button', { name: 'Level up' })).toBeDisabled();
    expect(screen.getByText('Max level reached.')).toBeInTheDocument();
  });
});
