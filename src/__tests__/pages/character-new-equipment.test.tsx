/**
 * Tests for the 2026-07-24 Starting Equipment wizard slice
 * (src/app/character/new/page.tsx's EquipmentStep + createNow wiring).
 *
 * Covers:
 *  - The Equipment step renders fixed grants (read-only) + one radio group
 *    per choice group, from a mocked getStartingEquipment.
 *  - Selections default to each choice's first option and update on pick.
 *  - equipment_selections reach the createCharacter payload (non-caster path,
 *    submitted at Review).
 *  - Graceful degradation when the fetch fails: Continue is never blocked,
 *    and equipment_selections is OMITTED entirely from the create payload
 *    (the engine's own no-selections-sent no-op gate — not sent as `[]`).
 *
 * Uses a non-caster (Fighter) fixture throughout — the Equipment step applies
 * to every class, and a non-caster keeps the flow (Background -> Equipment ->
 * Review) short and avoids needing to also mock the Spells-step hops.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush }),
}));

jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(),
  verify2FA: jest.fn(),
  logout: jest.fn(),
  refresh: jest.fn(),
  me: jest.fn(),
  register: jest.fn(),
}));

const mockCreateCharacter = jest.fn();
const mockGetStartingEquipment = jest.fn();
jest.mock('../../lib/api/dnd', () => ({
  createCharacter: (...args: unknown[]) => mockCreateCharacter(...args),
  getStartingEquipment: (...args: unknown[]) => mockGetStartingEquipment(...args),
}));

const defaultCatalog = {
  status: 'ok' as const,
  retry: jest.fn(),
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
        subraces: [],
        needsAsiChoice: false,
      },
    ],
    classes: [
      {
        id: 'fighter',
        name: 'Fighter',
        hitDie: 10,
        saves: ['strength', 'constitution'] as ['strength', 'constitution'],
        icon: 'Fighter' as const,
        accent: 'var(--cool)',
        flavor: 'Hit it until it stops.',
        isCaster: false,
      },
    ],
    backgrounds: [
      { id: 'soldier', name: 'Soldier', skills: ['athletics', 'intimidation'], blurb: 'you served.' },
    ],
  },
};

import type { UseCatalogResult } from '../../lib/dnd/useCatalog';
let catalogOverride: UseCatalogResult = { ...defaultCatalog };

jest.mock('../../lib/dnd/useCatalog', () => ({
  useCatalog: () => catalogOverride,
}));

jest.mock('../../lib/stream', () => ({
  streamNarration: jest.fn(async function* () {
    /* no chunks -> deterministic fallback line */
  }),
}));

import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import CharacterNewPage from '../../app/character/new/page';
import type { User } from '../../lib/api/types';

const ALICE: User = { id: 1, username: 'alice', email: null };

function renderWizard() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider initialUser={ALICE}>
          <CharacterNewPage />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

const PACKAGE_WITH_CHOICE = {
  class: 'fighter',
  background: 'soldier',
  class_package: {
    fixed: [{ slug: 'explorer-pack', qty: 1, name: "Explorer's Pack", description: 'Basic travel gear.' }],
    choices: [
      {
        id: 'class:armor',
        prompt: '(a) chain mail or (b) leather armor, longbow, and 20 arrows',
        options: [
          {
            id: 'a',
            label: 'chain mail',
            grants: [{ slug: 'chain-mail', qty: 1, name: 'Chain Mail', description: 'Heavy armor, AC 16.' }],
          },
          {
            id: 'b',
            label: 'leather armor, longbow, 20 arrows',
            grants: [
              { slug: 'leather-armor', qty: 1, name: 'Leather Armor', description: 'Light armor, AC 11 + Dex.' },
              { slug: 'longbow', qty: 1, name: 'Longbow', description: 'A ranged weapon.' },
              { slug: 'arrow', qty: 20, name: 'Arrow', description: '' },
            ],
          },
        ],
      },
    ],
  },
  background_package: {
    fixed: [{ slug: 'insignia-of-rank', qty: 1, name: 'Insignia of Rank', description: 'Marks your service.' }],
    choices: [
      {
        id: 'background:trinket',
        prompt: 'Choose a memento',
        options: [
          { id: 'a', label: 'a faded letter', grants: [{ slug: 'letter', qty: 1, name: 'Faded Letter', description: '' }] },
          { id: 'b', label: 'a broken medal', grants: [{ slug: 'medal', qty: 1, name: 'Broken Medal', description: '' }] },
        ],
      },
    ],
  },
};

const EMPTY_EQUIPMENT = {
  class: '',
  background: '',
  class_package: { fixed: [], choices: [] },
  background_package: { fixed: [], choices: [] },
};

beforeEach(() => {
  mockPush.mockReset();
  mockCreateCharacter.mockReset();
  mockGetStartingEquipment.mockReset();
  mockGetStartingEquipment.mockResolvedValue(EMPTY_EQUIPMENT);
  catalogOverride = { ...defaultCatalog };
});

function advanceToEquipment() {
  fireEvent.click(screen.getByRole('radio', { name: /Human/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Class
  fireEvent.click(screen.getByRole('radio', { name: /Fighter/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
  fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Borin' } });
  fireEvent.click(screen.getByRole('radio', { name: /Soldier/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
}

describe('Equipment wizard step (2026-07-24 Starting Equipment design)', () => {
  it('renders fixed grants (read-only) from both packages plus one radio group per choice, defaulted to the first option', async () => {
    mockGetStartingEquipment.mockResolvedValue(PACKAGE_WITH_CHOICE);
    renderWizard();
    advanceToEquipment();

    // Fixed grants from BOTH the class and background packages, name + description.
    expect(await screen.findByText("Explorer's Pack")).toBeInTheDocument();
    expect(screen.getByText('Basic travel gear.')).toBeInTheDocument();
    expect(screen.getByText('Insignia of Rank')).toBeInTheDocument();
    expect(screen.getByText('Marks your service.')).toBeInTheDocument();

    // One radio group per choice, legend = the choice's prompt.
    const armorGroup = screen.getByRole('group', {
      name: '(a) chain mail or (b) leather armor, longbow, and 20 arrows',
    });
    const trinketGroup = screen.getByRole('group', { name: 'Choose a memento' });
    expect(armorGroup).toBeInTheDocument();
    expect(trinketGroup).toBeInTheDocument();

    // Each option shows its item name(s) + description(s).
    expect(within(armorGroup).getByText('Chain Mail')).toBeInTheDocument();
    expect(within(armorGroup).getByText('Heavy armor, AC 16.')).toBeInTheDocument();
    expect(within(armorGroup).getByText('Leather Armor, Longbow, Arrow ×20')).toBeInTheDocument();

    // Defaulted to each choice's FIRST option.
    const chainMailRadio = within(armorGroup).getByRole('radio', { name: 'chain mail' });
    const leatherRadio = within(armorGroup).getByRole('radio', { name: /leather armor/i });
    expect(chainMailRadio).toBeChecked();
    expect(leatherRadio).not.toBeChecked();

    const letterRadio = within(trinketGroup).getByRole('radio', { name: 'a faded letter' });
    expect(letterRadio).toBeChecked();

    // Continue is enabled — every choice already has a (defaulted) selection.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('picking a different option updates the selection (and the previous option un-checks)', async () => {
    mockGetStartingEquipment.mockResolvedValue(PACKAGE_WITH_CHOICE);
    renderWizard();
    advanceToEquipment();
    await screen.findByText("Explorer's Pack");

    const armorGroup = screen.getByRole('group', {
      name: '(a) chain mail or (b) leather armor, longbow, and 20 arrows',
    });
    const chainMailRadio = within(armorGroup).getByRole('radio', { name: 'chain mail' });
    const leatherRadio = within(armorGroup).getByRole('radio', { name: /leather armor/i });
    expect(chainMailRadio).toBeChecked();

    fireEvent.click(leatherRadio);
    expect(leatherRadio).toBeChecked();
    expect(chainMailRadio).not.toBeChecked();
  });

  it('equipment_selections (defaults + a changed pick) reach the createCharacter payload at Review', async () => {
    mockGetStartingEquipment.mockResolvedValue(PACKAGE_WITH_CHOICE);
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-1' });
    renderWizard();
    advanceToEquipment();
    await screen.findByText("Explorer's Pack");

    // Change the trinket pick away from its default; leave the armor pick
    // at its default — both should still reach the payload.
    const trinketGroup = screen.getByRole('group', { name: 'Choose a memento' });
    fireEvent.click(within(trinketGroup).getByRole('radio', { name: 'a broken medal' }));

    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });

    await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(1));
    const body = mockCreateCharacter.mock.calls[0][0];
    expect(body.equipment_selections).toEqual(
      expect.arrayContaining([
        { choice_id: 'class:armor', option_id: 'a' },
        { choice_id: 'background:trinket', option_id: 'b' },
      ]),
    );
    expect(body.equipment_selections).toHaveLength(2);
  });

  it('graceful degradation: a failed fetch never blocks Continue, and equipment_selections is OMITTED (not []) from the create payload', async () => {
    mockGetStartingEquipment.mockRejectedValue(new Error('network error'));
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-2' });
    renderWizard();
    advanceToEquipment();

    expect(
      await screen.findByText(/Suzu couldn.?t load your starting gear right now/i),
    ).toBeInTheDocument();
    const cont = screen.getByRole('button', { name: 'Continue' });
    expect(cont).toBeEnabled();

    fireEvent.click(cont); // -> Review
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });

    await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(1));
    const body = mockCreateCharacter.mock.calls[0][0] as Record<string, unknown>;
    // Omitted entirely (undefined), not sent as `[]` — mirrors the existing
    // subrace/half_elf_asi convention (see api-dnd.test.ts) where JSON.
    // stringify drops an undefined-valued key from the real wire body even
    // though the JS object literal still carries the key.
    expect(body.equipment_selections).toBeUndefined();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-2'));
  });

  it('an empty package (no fixed grants, no choices) shows a plain message instead of empty sections, and Continue is enabled immediately', async () => {
    renderWizard(); // default mock resolves EMPTY_EQUIPMENT
    advanceToEquipment();

    expect(
      await screen.findByText(/bring no starting gear of their own this time/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('Continue is disabled while the fetch is in flight, then enables once it resolves', async () => {
    let resolveFetch!: (v: unknown) => void;
    mockGetStartingEquipment.mockImplementation(
      () => new Promise((res) => { resolveFetch = res; }),
    );
    renderWizard();
    advanceToEquipment();

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await act(async () => {
      resolveFetch(EMPTY_EQUIPMENT);
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});
