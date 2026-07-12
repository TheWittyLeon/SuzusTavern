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
        subraces: [],
        needsAsiChoice: false,
      },
      {
        id: 'elf',
        name: 'Elf',
        sub: 'graceful · keen-sighted',
        bonusLabel: '+2 DEX',
        bonuses: { dexterity: 2 },
        speed: 30,
        icon: 'Druid' as const,
        // TAV-CREATE-SUBRACE-ASI-PICKER fixture: Elf carries named subraces.
        subraces: [
          { name: 'High Elf', bonuses: { intelligence: 1 }, bonusLabel: '+1 INT' },
          { name: 'Wood Elf', bonuses: { wisdom: 1 }, bonusLabel: '+1 WIS', speed: 35 },
        ],
        needsAsiChoice: false,
      },
      {
        id: 'half-elf',
        name: 'Half-Elf',
        sub: 'diplomatic · between worlds',
        bonusLabel: '+2 CHA',
        bonuses: { charisma: 2 },
        speed: 30,
        icon: 'Bard' as const,
        subraces: [],
        needsAsiChoice: true,
      },
      {
        id: 'dwarf',
        name: 'Dwarf',
        sub: 'stoic · stonecunning',
        bonusLabel: '+2 CON',
        bonuses: { constitution: 2 },
        speed: 25,
        icon: 'Shield' as const,
        // ADVERSARIAL fixture (Miko-QA): mirrors the real engine registry
        // (NekoNova-DnDEngine engine/races.py) so the preview matrix (base +
        // subrace summed before one clamp) is exercised on real numbers.
        subraces: [
          { name: 'Hill Dwarf', bonuses: { wisdom: 1 }, bonusLabel: '+1 WIS' },
          { name: 'Mountain Dwarf', bonuses: { strength: 2 }, bonusLabel: '+2 STR' },
        ],
        needsAsiChoice: false,
      },
      {
        id: 'gnome',
        name: 'Gnome',
        sub: 'clever · curious',
        bonusLabel: '+2 INT',
        bonuses: { intelligence: 2 },
        speed: 25,
        icon: 'Wizard' as const,
        // ADVERSARIAL fixture (Miko-QA): synthetic — NOT a mirror of the real
        // engine's Gnome subraces (which both carry an ability_bonus). Added
        // here purely so a COSMETIC subrace (empty ability_bonus map, e.g.
        // the real engine's Dragonborn draconic-ancestry entries) has a
        // full-wizard integration path to exercise: selectable, gates
        // Continue, POSTs the name, no stat change in the Review preview.
        // NB: Dragonborn itself is intentionally NOT added to this fixture —
        // it's the negative control for "renders catalog items from the
        // mock, not hardcoded values" and "no hardcoded fallback on error"
        // below; adding it here would silently defang both.
        subraces: [{ name: 'Svirfneblin', bonuses: {}, bonusLabel: 'none' }],
        needsAsiChoice: false,
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
        isCaster: false,
      },
      {
        id: 'wizard',
        name: 'Wizard',
        hitDie: 6,
        saves: ['intelligence', 'wisdom'] as ['intelligence', 'wisdom'],
        icon: 'Wizard' as const,
        accent: 'var(--cool)',
        flavor: 'A spell for every problem.',
        isCaster: true,
        casterKind: 'spellbook' as const,
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

// The wizard's live Suzu commentary (ST-053) streams via streamNarration on
// mount. Mock it to an empty stream so tests don't hit the real network.
jest.mock('../../lib/stream', () => ({
  streamNarration: jest.fn(async function* () {
    /* no chunks → the wizard falls back to its deterministic line */
  }),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import CharacterNewPage from '../../app/character/new/page';
import type { User } from '../../lib/api/types';

const mockCreate = dnd.createCharacter as jest.MockedFunction<typeof dnd.createCharacter>;
const ALICE: User = { id: 1, username: 'alice', email: null };

function renderWizard() {
  return render(
    <ThemeProvider><ToastProvider><AuthProvider initialUser={ALICE}>
      <CharacterNewPage />
    </AuthProvider></ToastProvider></ThemeProvider>,
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

  // ── TAV-CREATE-SUBRACE-ASI-PICKER ───────────────────────────────────────────
  describe('subrace + Half-Elf ASI pickers', () => {
    it('requires a subrace before Continue when the chosen race has named subraces', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /^Elf\b/i }));
      const cont = screen.getByRole('button', { name: 'Continue' });
      expect(cont).toBeDisabled();
      fireEvent.click(screen.getByRole('radio', { name: /Wood Elf/i }));
      expect(cont).toBeEnabled();
    });

    it('shows no subrace picker for a race with none (Human)', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /^Human/i }));
      expect(screen.queryByText('Subrace')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    });

    it('clears a chosen subrace when the race changes', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /^Elf\b/i }));
      fireEvent.click(screen.getByRole('radio', { name: /Wood Elf/i }));
      fireEvent.click(screen.getByRole('radio', { name: /^Human/i }));
      expect(screen.queryByRole('radio', { name: /Wood Elf/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    });

    it('reflects the chosen subrace bonus + speed override in the Review preview', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /^Elf\b/i }));
      fireEvent.click(screen.getByRole('radio', { name: /Wood Elf/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Class
      fireEvent.click(screen.getByRole('radio', { name: /Rogue/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Abilities
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Background
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Velka' } });
      fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Review

      // Elf: +2 DEX (base). Wood Elf: +1 WIS, 35ft speed.
      const wisLabel = screen.getByText('WIS');
      expect(within(wisLabel.closest('div') as HTMLElement).getByText('9')).toBeInTheDocument();
      expect(screen.getByText('35 ft')).toBeInTheDocument();
    });

    it('requires exactly two non-Charisma ability picks for Half-Elf before Continue, and never offers Charisma', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /Half-Elf/i }));
      const cont = screen.getByRole('button', { name: 'Continue' });
      expect(cont).toBeDisabled();
      expect(screen.queryByRole('checkbox', { name: /Charisma/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('checkbox', { name: /^Strength/i }));
      expect(cont).toBeDisabled(); // only one picked
      fireEvent.click(screen.getByRole('checkbox', { name: /^Dexterity/i }));
      expect(cont).toBeEnabled();
    });

    it('disables further ability checkboxes once two are picked, re-enabling when one is unpicked', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /Half-Elf/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: /^Strength/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: /^Dexterity/i }));
      expect(screen.getByRole('checkbox', { name: /^Constitution/i })).toBeDisabled();

      fireEvent.click(screen.getByRole('checkbox', { name: /^Strength/i })); // uncheck
      expect(screen.getByRole('checkbox', { name: /^Constitution/i })).toBeEnabled();
    });

    it('POSTs subrace (not half_elf_asi) for a race with subraces', async () => {
      mockCreate.mockResolvedValue({ character_id: 'e-1' });
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /^Elf\b/i }));
      fireEvent.click(screen.getByRole('radio', { name: /Wood Elf/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.click(screen.getByRole('radio', { name: /Rogue/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Velka' } });
      fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
      });

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ race: 'Elf', subrace: 'Wood Elf' }),
      );
      expect(mockCreate.mock.calls[0][0].half_elf_asi).toBeUndefined();
    });

    it('POSTs half_elf_asi (not subrace) for Half-Elf', async () => {
      mockCreate.mockResolvedValue({ character_id: 'he-1' });
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /Half-Elf/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: /^Strength/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: /^Dexterity/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.click(screen.getByRole('radio', { name: /Rogue/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Velka' } });
      fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
      });

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ race: 'Half-Elf', half_elf_asi: ['strength', 'dexterity'] }),
      );
      expect(mockCreate.mock.calls[0][0].subrace).toBeUndefined();
    });

    // ── ADVERSARIAL (Miko-QA) ──────────────────────────────────────────────

    it('re-disables Continue after unchecking one of two Half-Elf ASI picks (not just re-enabling checkboxes)', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /Half-Elf/i }));
      const cont = screen.getByRole('button', { name: 'Continue' });
      fireEvent.click(screen.getByRole('checkbox', { name: /^Strength/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: /^Dexterity/i }));
      expect(cont).toBeEnabled();
      fireEvent.click(screen.getByRole('checkbox', { name: /^Strength/i })); // uncheck
      expect(cont).toBeDisabled();
    });

    it('does not offer Charisma even after two other abilities are already picked (disabled, not just unchecked)', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /Half-Elf/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: /^Strength/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: /^Dexterity/i }));
      expect(screen.queryByRole('checkbox', { name: /Charisma/i })).not.toBeInTheDocument();
    });

    it('resets a chosen subrace to a stale value NOT surviving into the POST when race is switched before submit', async () => {
      mockCreate.mockResolvedValue({ character_id: 'reset-1' });
      renderWizard();
      // Pick Elf -> Wood Elf, then switch away to a subrace-less race (Human)
      // WITHOUT ever advancing past the Race step.
      fireEvent.click(screen.getByRole('radio', { name: /^Elf\b/i }));
      fireEvent.click(screen.getByRole('radio', { name: /Wood Elf/i }));
      fireEvent.click(screen.getByRole('radio', { name: /^Human/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.click(screen.getByRole('radio', { name: /Rogue/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Grok' } });
      fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
      });

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      const body = mockCreate.mock.calls[0][0];
      expect(body.race).toBe('Human');
      expect(body.subrace).toBeUndefined();
      expect(body.half_elf_asi).toBeUndefined();
    });

    it('resets a chosen half_elf_asi to a stale value NOT surviving into the POST when race is switched before submit', async () => {
      mockCreate.mockResolvedValue({ character_id: 'reset-2' });
      renderWizard();
      // Pick Half-Elf, choose both ASI abilities, then switch away WITHOUT
      // ever advancing past the Race step.
      fireEvent.click(screen.getByRole('radio', { name: /Half-Elf/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: /^Strength/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: /^Dexterity/i }));
      fireEvent.click(screen.getByRole('radio', { name: /^Human/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.click(screen.getByRole('radio', { name: /Rogue/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Grok' } });
      fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
      });

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      const body = mockCreate.mock.calls[0][0];
      expect(body.race).toBe('Human');
      expect(body.half_elf_asi).toBeUndefined();
      expect(body.subrace).toBeUndefined();
    });

    it('cross-contamination: switching Half-Elf(+ASI picks) -> Elf clears the ASI AND still gates on picking a fresh subrace', async () => {
      mockCreate.mockResolvedValue({ character_id: 'cross-1' });
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /Half-Elf/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: /^Strength/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: /^Dexterity/i }));
      fireEvent.click(screen.getByRole('radio', { name: /^Elf\b/i }));
      const cont = screen.getByRole('button', { name: 'Continue' });
      // Elf requires a subrace; the stale Half-Elf ASI picks must not
      // substitute for that gate.
      expect(cont).toBeDisabled();
      expect(screen.queryByRole('checkbox', { name: /^Strength/i })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('radio', { name: /Wood Elf/i }));
      expect(cont).toBeEnabled();
      fireEvent.click(cont);
      fireEvent.click(screen.getByRole('radio', { name: /Rogue/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Velka' } });
      fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
      });

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      const body = mockCreate.mock.calls[0][0];
      expect(body.race).toBe('Elf');
      expect(body.subrace).toBe('Wood Elf');
      expect(body.half_elf_asi).toBeUndefined();
    });

    it('preview matrix: Mountain Dwarf sums +2 STR (subrace) on top of +2 CON (base race) — not one or the other', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /^Dwarf/i }));
      fireEvent.click(screen.getByRole('radio', { name: /Mountain Dwarf/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Class
      fireEvent.click(screen.getByRole('radio', { name: /Rogue/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Borin' } });
      fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review

      // Base scores are all 8. Dwarf +2 CON (base) + Mountain Dwarf +2 STR
      // (subrace) => STR 10, CON 10. Speed is the Dwarf's own 25ft (no
      // subrace override on Mountain Dwarf).
      // Scoped to the "Ability scores" panel — Rogue's saves ("DEX"/"INT"
      // proficiency pills) live in a sibling "Proficiencies" panel and would
      // otherwise collide with an unscoped getByText for any shared abbr.
      const scorePanel = screen.getByText('Ability scores').parentElement as HTMLElement;
      const strBox = within(scorePanel).getByText('STR').closest('div') as HTMLElement;
      const conBox = within(scorePanel).getByText('CON').closest('div') as HTMLElement;
      expect(within(strBox).getByText('10')).toBeInTheDocument();
      expect(within(conBox).getByText('10')).toBeInTheDocument();
      expect(screen.getByText('25 ft')).toBeInTheDocument();
    });

    it('cosmetic subrace (no ability_bonus): selectable, gates Continue, POSTs the name, no stat change in preview', async () => {
      mockCreate.mockResolvedValue({ character_id: 'cosmetic-1' });
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /^Gnome/i }));
      const cont = screen.getByRole('button', { name: 'Continue' });
      expect(cont).toBeDisabled(); // Gnome has a (synthetic) subrace — still gates
      fireEvent.click(screen.getByRole('radio', { name: /Svirfneblin/i }));
      expect(cont).toBeEnabled();
      fireEvent.click(cont); // -> Class
      fireEvent.click(screen.getByRole('radio', { name: /Rogue/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pip' } });
      fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review

      // Only the base Gnome +2 INT applies; the cosmetic subrace adds nothing.
      // Scoped to the "Ability scores" panel (see Dwarf preview test above
      // for why: Rogue's saves render an "INT" proficiency pill elsewhere).
      const scorePanel = screen.getByText('Ability scores').parentElement as HTMLElement;
      const intBox = within(scorePanel).getByText('INT').closest('div') as HTMLElement;
      expect(within(intBox).getByText('10')).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
      });
      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ race: 'Gnome', subrace: 'Svirfneblin' }),
      );
    });
  });

  // UIR2-TAV-22: a background with no flavor line (blurb: '') must render no
  // quote element at all — never a literal "" — while the rest of the card
  // (name, skills) still renders normally.
  it('never renders a literal "" for a background with no flavor line (UIR2-TAV-22)', () => {
    catalogOverride = {
      ...defaultCatalog,
      data: {
        ...defaultCatalog.data,
        backgrounds: [
          ...defaultCatalog.data.backgrounds,
          { id: 'city-watch', name: 'City Watch', skills: ['athletics', 'insight'], blurb: '' },
        ],
      },
    };
    renderWizard();
    advanceToAbilities();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Background

    expect(screen.getByRole('radio', { name: /City Watch/i })).toBeInTheDocument();
    // The curly-quote pair BackgroundStep wraps a real blurb in must never
    // appear on its own with nothing between the quotes.
    expect(screen.queryByText('“”')).not.toBeInTheDocument();
    // A background WITH a blurb (Acolyte, from the default fixture) still
    // renders its flavor line normally — the guard doesn't hide everything.
    expect(screen.getByText('“you were good at the prayers.”')).toBeInTheDocument();
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
    // Only our mock races are shown, not the full 9-race hardcoded list.
    expect(screen.getByRole('radio', { name: /^Human/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Elf\b/i })).toBeInTheDocument();
    // Items outside the mock fixture should NOT appear.
    expect(screen.queryByRole('radio', { name: /Dragonborn/i })).not.toBeInTheDocument();
  });
});
