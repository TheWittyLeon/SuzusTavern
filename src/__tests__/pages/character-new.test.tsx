/**
 * Tests for the character creation wizard (src/app/character/new/page.tsx).
 *
 * S2.4: Race/class/background now come from useCatalog (live catalog fetch),
 * not the hardcoded srd.ts. Tests mock useCatalog to inject fixture data.
 *
 * Covers:
 *  - ST-047 step gating (race/class required before Continue)
 *  - ST-050 point-buy budget enforcement
 *  - ST-051 background step requires name + background
 *  - ST-052 submission contract (base scores + canonical names POSTed)
 *  - S2.4 catalog error state — retry UI shown, no crash
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

// Mock useCatalog so tests don't need a live engine.
// Default: catalog loaded with 2 races, 2 classes, 2 backgrounds.
const mockRetry = jest.fn();
const defaultCatalog = {
  status: 'ok' as const,
  retry: mockRetry,
  data: {
    races: [
      {
        id: 'human',
        name: 'Human',
        sub: 'ambitious · versatile',
        bonusLabel: '+1 to all',
        bonuses: { strength: 1, dexterity: 1, constitution: 1, intelligence: 1, wisdom: 1, charisma: 1 },
        speed: 30,
        icon: 'Users' as const,
      },
      {
        id: 'elf',
        name: 'Elf',
        sub: 'graceful · keen-sighted',
        bonusLabel: '+2 DEX',
        bonuses: { dexterity: 2 },
        speed: 30,
        icon: 'Druid' as const,
      },
    ],
    classes: [
      {
        id: 'rogue',
        name: 'Rogue',
        hitDie: 8,
        saves: ['dexterity', 'intelligence'] as ['dexterity', 'intelligence'],
        icon: 'Rogue' as const,
        accent: 'var(--accent)',
        flavor: 'Sneak, stab, vanish.',
      },
      {
        id: 'wizard',
        name: 'Wizard',
        hitDie: 6,
        saves: ['intelligence', 'wisdom'] as ['intelligence', 'wisdom'],
        icon: 'Wizard' as const,
        accent: 'var(--cool)',
        flavor: 'A spell for every problem.',
      },
    ],
    backgrounds: [
      { id: 'acolyte', name: 'Acolyte', skills: ['insight', 'religion'], blurb: 'you were good at the prayers.' },
      { id: 'charlatan', name: 'Charlatan', skills: ['deception', 'sleight_of_hand'], blurb: "you've lied your way out." },
    ],
  },
};

// Typed to allow status override in individual tests.
import type { UseCatalogResult } from '../../lib/dnd/useCatalog';
let catalogOverride: UseCatalogResult = { ...defaultCatalog };

jest.mock('../../lib/dnd/useCatalog', () => ({
  useCatalog: () => catalogOverride,
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
  mockRetry.mockReset();
  // Reset to default (loaded) catalog state before each test.
  catalogOverride = { ...defaultCatalog };
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

  // Walk forward to the Abilities step via Continue.
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
    // 8 → 15 is seven increments; + is disabled at max.
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
    // Abilities — leave defaults
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

// ── S2.4: catalog loading / error states ──────────────────────────────────────

describe('Catalog loading and error states (S2.4)', () => {
  it('shows a loading skeleton while the catalog is fetching', () => {
    catalogOverride = { ...defaultCatalog, status: 'loading' };
    renderWizard();
    // Loading state: the option grid is not rendered yet.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    // Accessible loading indicator is present.
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('shows a friendly error message and retry button when the catalog fails (S2.4)', () => {
    catalogOverride = { ...defaultCatalog, status: 'error' };
    renderWizard();
    // No option radio inputs — the grid is not rendered.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    // Error message is shown in an alert role.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/can.?t reach the catalog/i);
    // Retry button is present and calls retry().
    const retryBtn = screen.getByRole('button', { name: /try again/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('does not crash or show a hardcoded fallback when catalog errors (S2.4)', () => {
    catalogOverride = { ...defaultCatalog, status: 'error' };
    renderWizard();
    // None of the hardcoded race/class names from the old srd.ts should appear.
    expect(screen.queryByText('Dragonborn')).not.toBeInTheDocument();
    expect(screen.queryByText('Barbarian')).not.toBeInTheDocument();
    expect(screen.queryByText('Sage')).not.toBeInTheDocument();
  });

  it('renders catalog items from the mock, not hardcoded values (S2.4)', () => {
    renderWizard();
    // Only our 2 mock races are shown, not the full 9-race hardcoded list.
    expect(screen.getByRole('radio', { name: /Human/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Elf/i })).toBeInTheDocument();
    // Items outside the mock fixture should NOT appear.
    expect(screen.queryByRole('radio', { name: /Dragonborn/i })).not.toBeInTheDocument();
  });
});
