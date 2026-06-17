/**
 * Tests for the character creation wizard (src/app/character/new/page.tsx).
 *
 * Covers ST-047 step gating, ST-050 point-buy budget enforcement, and the
 * ST-052 submission contract (base scores + canonical names POSTed, then route
 * to /character/:id).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
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
  createCharacter: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import CharacterNewPage from '../../app/character/new/page';
import type { User } from '../../lib/api/types';

const mockCreate = dnd.createCharacter as jest.MockedFunction<typeof dnd.createCharacter>;
const ALICE: User = { id: 1, username: 'alice', email: null };

function renderWizard() {
  return render(
    <AuthProvider initialUser={ALICE}>
      <CharacterNewPage />
    </AuthProvider>,
  );
}

beforeEach(() => {
  mockCreate.mockReset();
  mockPush.mockReset();
});

describe('Character creation wizard', () => {
  it('renders the page heading', () => {
    renderWizard();
    expect(screen.getByRole('heading', { level: 1, name: /new character/i })).toBeInTheDocument();
  });

  it('disables Continue until a race is selected (ST-047)', () => {
    renderWizard();
    const cont = screen.getByRole('button', { name: 'Continue' });
    expect(cont).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Human/i }));
    expect(cont).toBeEnabled();
  });

  // Walk forward to a given step index via Continue (the rail only jumps to
  // already-visited steps now). Selects valid defaults along the way.
  function advanceToAbilities() {
    fireEvent.click(screen.getByRole('radio', { name: /Human/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('radio', { name: /Rogue/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  it('enforces the 27-point buy budget (ST-050)', () => {
    renderWizard();
    advanceToAbilities();

    const inc = screen.getByRole('button', { name: /Increase Strength/i });
    // 8 → 15 is seven steps; after that the + is disabled (max reached).
    for (let i = 0; i < 7; i++) fireEvent.click(inc);

    const strength = screen.getByRole('group', { name: 'Strength' });
    expect(within(strength).getByText('15')).toBeInTheDocument();
    expect(inc).toBeDisabled();
  });

  it('submits base scores + canonical names, then routes to the new sheet (ST-052)', async () => {
    mockCreate.mockResolvedValue({ character_id: 'abc-123' });
    renderWizard();

    // Race
    fireEvent.click(screen.getByRole('radio', { name: /Human/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // Class
    fireEvent.click(screen.getByRole('radio', { name: /Rogue/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // Abilities — leave defaults (all 8)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // Background + name
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Velka' } });
    fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // Review → submit
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'alice',
        name: 'Velka',
        race: 'Human',
        char_class: 'Rogue',
        background: 'Charlatan',
        ability_scores: {
          strength: 8,
          dexterity: 8,
          constitution: 8,
          intelligence: 8,
          wisdom: 8,
          charisma: 8,
        },
      }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/abc-123'));
  });

  it('keeps Continue disabled on the background step until a name is entered (ST-051)', () => {
    renderWizard();
    advanceToAbilities();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Background
    const cont = screen.getByRole('button', { name: 'Continue' });
    fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
    expect(cont).toBeDisabled(); // background chosen but no name yet
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Velka' } });
    expect(cont).toBeEnabled();
  });

  async function walkToReviewAndSubmit() {
    advanceToAbilities();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // abilities → background
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Velka' } });
    fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → review
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });
  }

  it('shows an alert and does not navigate when create fails', async () => {
    mockCreate.mockRejectedValue(new Error('500'));
    renderWizard();
    await walkToReviewAndSubmit();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows an alert when the response lacks a character_id', async () => {
    mockCreate.mockResolvedValue({} as never);
    renderWizard();
    await walkToReviewAndSubmit();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
  });
});
