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
  // 2026-07-24 Starting Equipment design: EVERY class now passes through the
  // Equipment step (unlike Spells, which is caster-only) — every test in this
  // file that advances past Background needs this mocked.
  getStartingEquipment: jest.fn(),
}));

/** Empty starting-equipment packages — no fixed grants, no choices. The
 *  default fixture for every test in this file: Continue is immediately
 *  enabled once the fetch resolves (equipmentChoiceIds is [], so the
 *  every()-over-choices gate is vacuously true). */
const EMPTY_EQUIPMENT = {
  class: '',
  background: '',
  class_package: { fixed: [], choices: [] },
  background_package: { fixed: [], choices: [] },
};

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
        primary: ['dexterity'] as ['dexterity'],
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
        primary: ['intelligence'] as ['intelligence'],
        spellcastingAbility: 'intelligence' as const,
      },
      {
        // TAV-CLASS-STAT-GUIDANCE fixture: carries the Unarmored Defense
        // ability so the point-buy hint's UD line has an integration path.
        id: 'monk',
        name: 'Monk',
        hitDie: 8,
        saves: ['strength', 'dexterity'] as ['strength', 'dexterity'],
        icon: 'Monk' as const,
        accent: 'var(--accent-2)',
        flavor: 'Fists, focus, ki.',
        isCaster: false,
        primary: ['dexterity', 'wisdom'] as ['dexterity', 'wisdom'],
        unarmoredDefenseAbility: 'wisdom' as const,
      },
      {
        // TAV-CLASS-STAT-GUIDANCE negative control: a class with NO declared
        // guidance anywhere must render NO chip and NO point-buy hint — the
        // engine withheld a recommendation, so the client shows nothing
        // (never a fabricated one).
        id: 'mystic',
        name: 'Mystic',
        hitDie: 8,
        saves: ['wisdom', 'charisma'] as ['wisdom', 'charisma'],
        icon: 'Wizard' as const,
        accent: 'var(--accent)',
        flavor: 'Homebrew, undeclared.',
        isCaster: false,
        primary: [],
      },
      {
        // TAV-CLASS-STAT-GUIDANCE ADVERSARIAL fixture (Miko-QA): a caster
        // whose catalog entry declares spellcasting_ability but NOT
        // primary_ability (a plausible partial-data/homebrew catalog gap).
        // Must show the spellcasting line with NO "Suggested focus" line and
        // NO card chip — the two fields are independent, not a package deal.
        id: 'oracle',
        name: 'Oracle',
        hitDie: 6,
        saves: ['wisdom', 'charisma'] as ['wisdom', 'charisma'],
        icon: 'Wizard' as const,
        accent: 'var(--accent)',
        flavor: 'Fate, spoken aloud.',
        isCaster: true,
        casterKind: 'known' as const,
        primary: [],
        spellcastingAbility: 'wisdom' as const,
      },
      {
        // TAV-WIZARD-UD-PREVIEW ADVERSARIAL fixture (Miko-QA): a HOMEBREW
        // class id — never 'barbarian'/'monk' — that still declares its own
        // Unarmored Defense ability. This is the actual regression class the
        // rider closes: a test using the 'monk' id alone can't distinguish
        // "derives UD from the declared field" from "still hardcoded on the
        // id", because monk matches both. This id doesn't exist in the old
        // hardcoded set, so it only previews UD AC if the field genuinely
        // drives it end-to-end (Kage IMPORTANT-3).
        id: 'chakra-adept',
        name: 'Chakra Adept',
        hitDie: 8,
        saves: ['wisdom', 'dexterity'] as ['wisdom', 'dexterity'],
        icon: 'Monk' as const,
        accent: 'var(--accent-2)',
        flavor: 'Homebrew: ki without the id literal.',
        isCaster: false,
        primary: ['wisdom'] as ['wisdom'],
        unarmoredDefenseAbility: 'wisdom' as const,
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
const mockGetStartingEquipment = dnd.getStartingEquipment as jest.MockedFunction<
  typeof dnd.getStartingEquipment
>;
const ALICE: User = { id: 1, username: 'alice', email: null };

/**
 * Advance off the Equipment step. Must run AFTER landing on it (i.e. right
 * after the Background step's Continue click) and BEFORE the next Continue
 * click that leaves it — the fetch resolves on a microtask, so Continue
 * starts disabled ('loading') and only becomes clickable once the mocked
 * getStartingEquipment promise settles.
 */
async function advancePastEquipment() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

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
  mockGetStartingEquipment.mockReset();
  mockGetStartingEquipment.mockResolvedValue(EMPTY_EQUIPMENT);
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

  // ── TAV-28 ───────────────────────────────────────────────────────────────────
  it('TAV-28: rail sub-label pluralizes "pt" only for exactly one point spent', () => {
    renderWizard();
    advanceToAbilities();

    // 0 spent at the outset — plural, not "0 pt spent".
    expect(screen.getByText('0 pts spent')).toBeInTheDocument();

    // 8 → 9 costs exactly 1 point on the SRD point-buy table — singular.
    fireEvent.click(screen.getByRole('button', { name: 'Increase Strength' }));
    expect(screen.getByText('1 pt spent')).toBeInTheDocument();
    expect(screen.queryByText('1 pts spent')).not.toBeInTheDocument();

    // 9 → 10 costs 1 more (2 total) — plural again.
    fireEvent.click(screen.getByRole('button', { name: 'Increase Strength' }));
    expect(screen.getByText('2 pts spent')).toBeInTheDocument();
    expect(screen.queryByText('1 pt spent')).not.toBeInTheDocument();

    // Spending back down to exactly 1 returns to the singular form (not a
    // one-way "spent >= 1 ever" flag).
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Strength' }));
    expect(screen.getByText('1 pt spent')).toBeInTheDocument();
  });

  // ── TAV-CLASS-STAT-GUIDANCE ──────────────────────────────────────────────────
  describe('TAV-CLASS-STAT-GUIDANCE', () => {
    function advanceToClass() {
      fireEvent.click(screen.getByRole('radio', { name: /Human/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    }

    it('renders a Suggested-focus chip on class cards with declared guidance', () => {
      renderWizard();
      advanceToClass();
      expect(screen.getByText('Suggested focus: DEX')).toBeInTheDocument(); // rogue
      expect(screen.getByText('Suggested focus: INT')).toBeInTheDocument(); // wizard
      expect(screen.getByText('Suggested focus: DEX · WIS')).toBeInTheDocument(); // monk
    });

    it('renders NO chip for a class with no declared guidance (no fiction)', () => {
      renderWizard();
      advanceToClass();
      const mystic = screen.getByRole('radio', { name: /Mystic/i }).closest('label');
      expect(mystic).not.toBeNull();
      expect(within(mystic as HTMLElement).queryByText(/Suggested focus/i)).not.toBeInTheDocument();
    });

    it('shows the point-buy hint naming the spellcasting ability for a caster', () => {
      renderWizard();
      advanceToClass();
      fireEvent.click(screen.getByRole('radio', { name: /Wizard/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(
        screen.getByText(
          /Suggested focus for your Wizard: INT\. Spellcasting runs off Intelligence\./,
        ),
      ).toBeInTheDocument();
    });

    it('shows the Unarmored Defense ability in the point-buy hint', () => {
      renderWizard();
      advanceToClass();
      fireEvent.click(screen.getByRole('radio', { name: /Monk/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(
        screen.getByText(/Unarmored Defense adds your Wisdom modifier to AC\./),
      ).toBeInTheDocument();
    });

    it('shows NO point-buy hint for a guidance-less class', () => {
      renderWizard();
      advanceToClass();
      fireEvent.click(screen.getByRole('radio', { name: /Mystic/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      // On the Abilities step now — nothing guidance-shaped anywhere.
      expect(screen.getByRole('group', { name: 'Strength' })).toBeInTheDocument();
      expect(screen.queryByText(/Suggested focus/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/runs off/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Unarmored Defense/i)).not.toBeInTheDocument();
    });

    // ── ADVERSARIAL (Miko-QA) ────────────────────────────────────────────────
    it('a caster with a declared spellcastingAbility but NO declared primary renders the spellcasting line with no focus line or chip', () => {
      renderWizard();
      advanceToClass();
      // No card chip for Oracle (primary is [] even though it IS a caster).
      const oracleLabel = screen.getByRole('radio', { name: /Oracle/i }).closest('label');
      expect(oracleLabel).not.toBeNull();
      expect(
        within(oracleLabel as HTMLElement).queryByText(/Suggested focus/i),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('radio', { name: /Oracle/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities

      // The spellcasting line renders standalone — no "Suggested focus for
      // your Oracle" prefix, because that line is gated on primary.length.
      expect(screen.getByText('Spellcasting runs off Wisdom.')).toBeInTheDocument();
      expect(screen.queryByText(/Suggested focus/i)).not.toBeInTheDocument();
    });

    it('updates the point-buy hint after Back + reselect — no stale guidance from the previously chosen class', () => {
      renderWizard();
      advanceToClass();
      fireEvent.click(screen.getByRole('radio', { name: /Wizard/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
      expect(screen.getByText(/Suggested focus for your Wizard: INT\./)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Class
      fireEvent.click(screen.getByRole('radio', { name: /Mystic/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities

      // Mystic has no declared guidance — the Wizard hint must NOT linger.
      // (Kage: scoped to the hint copy, not a whole-document /Wizard/ negative
      // — a future header/breadcrumb containing "Wizard" must not redden this.)
      expect(screen.queryByText(/Suggested focus for your Wizard/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Suggested focus/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/runs off/i)).not.toBeInTheDocument();
    });

    it('updates the point-buy hint from guidance-less to guidance-bearing after Back + reselect (not just the clearing direction)', () => {
      renderWizard();
      advanceToClass();
      fireEvent.click(screen.getByRole('radio', { name: /Mystic/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
      expect(screen.queryByText(/Suggested focus/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Class
      fireEvent.click(screen.getByRole('radio', { name: /Monk/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities

      expect(screen.getByText(/Suggested focus for your Monk: DEX · WIS\./)).toBeInTheDocument();
      expect(
        screen.getByText(/Unarmored Defense adds your Wisdom modifier to AC\./),
      ).toBeInTheDocument();
    });

    it('clicking a Suggested-focus chip selects its own class card, not a different one with overlapping ability text (label click-delegation preserved)', () => {
      renderWizard();
      advanceToClass();
      const rogueRadio = screen.getByRole('radio', { name: /^Rogue/i });
      const monkRadio = screen.getByRole('radio', { name: /^Monk/i });
      expect(rogueRadio).not.toBeChecked();
      expect(monkRadio).not.toBeChecked();

      // Rogue's chip text is "Suggested focus: DEX" — a strict substring of
      // Monk's "Suggested focus: DEX · WIS". Clicking IT must select Rogue,
      // never Monk, and the radio's accessible name must still resolve
      // unambiguously despite the shared "DEX" text.
      fireEvent.click(screen.getByText('Suggested focus: DEX'));
      expect(rogueRadio).toBeChecked();
      expect(monkRadio).not.toBeChecked();
    });
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
    await advancePastEquipment(); // → Review
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

  // ── TAV-WIZARD-UD-PREVIEW ───────────────────────────────────────────────────
  describe('TAV-WIZARD-UD-PREVIEW (Review-step AC preview)', () => {
    // Before this rider, only the point-buy hint (TAV-CLASS-STAT-GUIDANCE,
    // "Unarmored Defense adds your X modifier to AC.") read
    // clsObj.unarmoredDefenseAbility — the Review step's AC number came from
    // derivedStats(), which still branched on the 'monk'/'barbarian' id
    // literal. Kage IMPORTANT-3: a homebrew class could show the correct
    // HINT copy while the Review AC preview silently lied and showed plain
    // 10+DEX. These walk the WHOLE wizard (no direct derivedStats() call) to
    // prove the field reaches page.tsx:492's memo, not just the hint.
    function advanceToAbilitiesAsClass(classNamePattern: RegExp) {
      fireEvent.click(screen.getByRole('radio', { name: /Human/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Class
      fireEvent.click(screen.getByRole('radio', { name: classNamePattern }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Abilities
    }

    async function finishToReview() {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Background
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kaida' } });
      fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
      await advancePastEquipment(); // → Review
    }

    it('Review AC preview includes the Monk WIS bonus end-to-end (not just the point-buy hint)', async () => {
      renderWizard();
      advanceToAbilitiesAsClass(/^Monk/i);
      // 8 → 14 WIS pre-racial (6 increments), 15 after Human's +1 → +2 mod;
      // DEX stays 8 → 9 after the +1 → -1 mod. Both racial bumps land inside
      // the same modifier bucket, so UD strictly beats plain 10+DEX (Kage:
      // name the racial step — retuned increments can cross a mod boundary).
      const incWis = screen.getByRole('button', { name: 'Increase Wisdom' });
      for (let i = 0; i < 6; i++) fireEvent.click(incWis);
      await finishToReview();

      // 10 - 1 DEX + 2 WIS = 11 beats plain 10 - 1 DEX = 9 — proves the UD
      // branch actually fired in the full wizard, not a coincidental match
      // with plain AC.
      const acLabel = screen.getByText('AC');
      expect(within(acLabel.closest('div') as HTMLElement).getByText('11')).toBeInTheDocument();
    });

    it('a penalty UD ability never drags Review AC below plain 10+DEX (RAW better-of, full-wizard level)', async () => {
      renderWizard();
      advanceToAbilitiesAsClass(/^Monk/i);
      // Leave every score at the point-buy default: 8 pre-racial → 9 after
      // Human's +1 → -1 mod everywhere. A naive "always add the UD mod"
      // implementation would show AC 8 (10 - 1 DEX - 1 WIS); the RAW
      // better-of must hold at 9 (DEX alone).
      await finishToReview();

      const acLabel = screen.getByText('AC');
      expect(within(acLabel.closest('div') as HTMLElement).getByText('9')).toBeInTheDocument();
    });

    // ── ADVERSARIAL (Miko-QA) — the actual regression class the rider closes.
    // A test that only ever picks 'monk' can't tell "derives UD from the
    // declared wire field" apart from "still hardcoded on the class id",
    // because monk satisfies both. 'chakra-adept' is not in the old
    // hardcoded set — it only previews UD AC if the field genuinely drives
    // it (verified by reverting src/lib/dnd/helpers.ts to the pre-rider
    // id-branch locally: this test goes red — plain AC 9, not 11 — while the
    // Monk tests above stay green, confirming they were NOT discriminating).
    it('a HOMEBREW class id (never hardcoded) still previews UD AC at Review — proves the field drives it, not the id', async () => {
      renderWizard();
      advanceToAbilitiesAsClass(/^Chakra Adept/i);
      // Kage: pin BOTH halves of the IMPORTANT-3 defect shape for the
      // homebrew id in one walk — the point-buy hint promises UD-based AC…
      expect(
        screen.getByText(/Unarmored Defense adds your Wisdom modifier to AC\./),
      ).toBeInTheDocument();
      const incWis = screen.getByRole('button', { name: 'Increase Wisdom' });
      for (let i = 0; i < 6; i++) fireEvent.click(incWis);
      await finishToReview();

      // …and the Review AC preview honours the same promise.
      const acLabel = screen.getByText('AC');
      expect(within(acLabel.closest('div') as HTMLElement).getByText('11')).toBeInTheDocument();
    });
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

    // ── Grammar (indefiniteArticle) ─────────────────────────────────────────────
    it('subrace group legend says "an Elf" (vowel-leading race name), not "a Elf"', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /^Elf\b/i }));
      expect(screen.getByRole('group', { name: 'Choose an Elf subrace' })).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Choose a Elf subrace' })).not.toBeInTheDocument();
    });

    it('subrace group legend says "a Dwarf" (consonant-leading race name), not "an Dwarf"', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /^Dwarf/i }));
      expect(screen.getByRole('group', { name: 'Choose a Dwarf subrace' })).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Choose an Dwarf subrace' })).not.toBeInTheDocument();
    });

    // ── "none" suppression ──────────────────────────────────────────────────────
    it('does not render the literal bonus-label "none" for a cosmetic subrace with no ability bonus (Svirfneblin)', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /^Gnome/i }));
      expect(screen.getByRole('radio', { name: /Svirfneblin/i })).toBeInTheDocument();
      expect(screen.queryByText('none')).not.toBeInTheDocument();
      expect(screen.queryByText(/none ·/)).not.toBeInTheDocument();
    });

    it('clears a chosen subrace when the race changes', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /^Elf\b/i }));
      fireEvent.click(screen.getByRole('radio', { name: /Wood Elf/i }));
      fireEvent.click(screen.getByRole('radio', { name: /^Human/i }));
      expect(screen.queryByRole('radio', { name: /Wood Elf/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    });

    it('reflects the chosen subrace bonus + speed override in the Review preview', async () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /^Elf\b/i }));
      fireEvent.click(screen.getByRole('radio', { name: /Wood Elf/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Class
      fireEvent.click(screen.getByRole('radio', { name: /Rogue/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Abilities
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Background
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Velka' } });
      fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
      await advancePastEquipment(); // → Review

      // Elf: +2 DEX (base). Wood Elf: +1 WIS, 35ft speed.
      const wisLabel = screen.getByText('WIS');
      expect(within(wisLabel.closest('div') as HTMLElement).getByText('9')).toBeInTheDocument();
      // F6b: the SPD row now renders via raceSpeedLabel ("35 ft.", trailing
      // period) rather than a bare template-literal "35 ft".
      expect(screen.getByText('35 ft.')).toBeInTheDocument();
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

    // ── TAV-A11Y-CAP-HINT ────────────────────────────────────────────────────────
    it('TAV-A11Y-CAP-HINT: Half-Elf ASI checkboxes only gain aria-describedby once the 2-pick cap is hit, and it resolves to the visible reason', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /Half-Elf/i }));
      const con = screen.getByRole('checkbox', { name: /^Constitution/i });

      // Before the cap: enabled, no describedby wired at all.
      expect(con).toBeEnabled();
      expect(con).not.toHaveAttribute('aria-describedby');

      fireEvent.click(screen.getByRole('checkbox', { name: /^Strength/i }));
      // 1 of 2 picked — still not capped, still no hint.
      expect(con).not.toHaveAttribute('aria-describedby');

      fireEvent.click(screen.getByRole('checkbox', { name: /^Dexterity/i }));
      // 2 of 2 — the now-disabled Constitution checkbox is described by the hint.
      expect(con).toBeDisabled();
      expect(con).toHaveAttribute('aria-describedby', 'halfelf-asi-cap-hint');
      expect(
        screen.getByText(/deselect one to change your picks/i),
      ).toHaveAttribute('id', 'halfelf-asi-cap-hint');

      // Un-picking drops back below the cap — describedby is removed, not just hidden.
      fireEvent.click(screen.getByRole('checkbox', { name: /^Strength/i }));
      expect(con).not.toHaveAttribute('aria-describedby');
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
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
      await advancePastEquipment(); // → Review
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
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
      await advancePastEquipment(); // → Review
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
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
      await advancePastEquipment(); // → Review
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
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
      await advancePastEquipment(); // → Review
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
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
      await advancePastEquipment(); // → Review
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
      });

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      const body = mockCreate.mock.calls[0][0];
      expect(body.race).toBe('Elf');
      expect(body.subrace).toBe('Wood Elf');
      expect(body.half_elf_asi).toBeUndefined();
    });

    it('preview matrix: Mountain Dwarf sums +2 STR (subrace) on top of +2 CON (base race) — not one or the other', async () => {
      renderWizard();
      fireEvent.click(screen.getByRole('radio', { name: /^Dwarf/i }));
      fireEvent.click(screen.getByRole('radio', { name: /Mountain Dwarf/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Class
      fireEvent.click(screen.getByRole('radio', { name: /Rogue/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Borin' } });
      fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
      await advancePastEquipment(); // -> Review

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
      expect(screen.getByText('25 ft.')).toBeInTheDocument();
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
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
      await advancePastEquipment(); // -> Review

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
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
    await advancePastEquipment(); // → review
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

  // ── F6b/MLP-SHEET-SPEED-CRASH (review-card half) ────────────────────────────
  it('F6b: a dict-shaped race speed renders as a formatted string on the review card, never "[object Object] ft" (DDX21-1 precedent)', async () => {
    catalogOverride = {
      ...defaultCatalog,
      data: {
        ...defaultCatalog.data,
        races: [
          {
            ...defaultCatalog.data.races[0],
            id: 'pegasus',
            name: 'Pegasus',
            // WizardRace.speed is typed `number`, but (per the MLP-SHEET-
            // SPEED-CRASH root cause) the wire can still send a compound
            // multi-mode object for a race with fly/swim speeds — the type
            // doesn't guarantee the runtime shape.
            speed: { walk: 30, fly: 60 } as unknown as number,
          },
        ],
      },
    };
    renderWizard();
    fireEvent.click(screen.getByRole('radio', { name: /^Pegasus/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Class
    fireEvent.click(screen.getByRole('radio', { name: /Rogue/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Abilities
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Background
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Skyla' } });
    fireEvent.click(screen.getByRole('radio', { name: /Charlatan/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
    await advancePastEquipment(); // → Review

    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
    expect(screen.getByText('30 ft., fly 60 ft.')).toBeInTheDocument();
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
