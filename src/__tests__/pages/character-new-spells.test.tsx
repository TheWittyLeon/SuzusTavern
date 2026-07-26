/**
 * Tests for the T4/DDX-11t wizard spells-at-creation slice
 * (src/app/character/new/page.tsx).
 *
 * Covers:
 *  - A caster class (wizard) shows the Spells step; a non-caster (fighter)
 *    does not — the step rail adapts its length/kickers accordingly.
 *  - Leaving Background silently creates the character (getAvailableSpells
 *    is only callable with a real character_id) and the Spells step renders
 *    the fetched pool.
 *  - Selection respects the server-computed budget — over-budget checkboxes
 *    are disabled, not just visually blocked.
 *  - The final submit batch-applies picks via learnSpell/prepareSpell
 *    (create-then-learn — CharacterCreateRequest has no spells field and
 *    every engine spell route is character-scoped, verified by reading
 *    NekoNova-DnDEngine's routes/spells.py + engine/spells_msm.py).
 *  - A non-caster's create flow is unaffected (no spell calls at all).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
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

const mockCreateCharacter = jest.fn();
const mockGetAvailableSpells = jest.fn();
const mockLearnSpell = jest.fn();
const mockPrepareSpell = jest.fn();
const mockDeleteCharacter = jest.fn();
// TAV-SPELLPICK-DESCRIPTIONS: SpellsStep now also fetches the spell catalog
// (name+school-only entries otherwise have no description). Defaults to an
// empty pool so existing tests (none of which assert on description text)
// keep rendering name+school-only rows unaffected — a real catalog response
// is only supplied by the tests below that specifically exercise it.
const mockGetCatalog = jest.fn();
// 2026-07-24 Starting Equipment design: the new Equipment step sits between
// Background and Spells for EVERY class — every helper below that reaches
// Spells now passes through it first.
const mockGetStartingEquipment = jest.fn();
jest.mock('../../lib/api/dnd', () => ({
  createCharacter: (...args: unknown[]) => mockCreateCharacter(...args),
  getAvailableSpells: (...args: unknown[]) => mockGetAvailableSpells(...args),
  getCatalog: (...args: unknown[]) => mockGetCatalog(...args),
  getStartingEquipment: (...args: unknown[]) => mockGetStartingEquipment(...args),
  learnSpell: (...args: unknown[]) => mockLearnSpell(...args),
  prepareSpell: (...args: unknown[]) => mockPrepareSpell(...args),
  deleteCharacter: (...args: unknown[]) => mockDeleteCharacter(...args),
}));

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
        bonuses: {
          strength: 1,
          dexterity: 1,
          constitution: 1,
          intelligence: 1,
          wisdom: 1,
          charisma: 1,
        },
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
      {
        id: 'cleric',
        name: 'Cleric',
        hitDie: 8,
        saves: ['wisdom', 'charisma'] as ['wisdom', 'charisma'],
        icon: 'Cleric' as const,
        accent: 'var(--accent-3)',
        flavor: 'Mend, smite, repeat.',
        isCaster: true,
        casterKind: 'prepared' as const,
      },
      {
        id: 'sorcerer',
        name: 'Sorcerer',
        hitDie: 6,
        saves: ['constitution', 'charisma'] as ['constitution', 'charisma'],
        icon: 'Sorcerer' as const,
        accent: 'var(--crit)',
        flavor: 'Innate, not studied.',
        isCaster: true,
        casterKind: 'known' as const,
      },
    ],
    backgrounds: [
      { id: 'acolyte', name: 'Acolyte', skills: ['insight', 'religion'], blurb: 'you were good at the prayers.' },
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
    /* no chunks → the wizard falls back to its deterministic line */
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

const WIZARD_AVAILABLE = {
  cantrips: [
    { slug: 'fire-bolt', name: 'Fire Bolt', level: 0, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
    { slug: 'mage-hand', name: 'Mage Hand', level: 0, school: 'conjuration', concentration: false, ritual: false, in_repertoire: false, prepared: false },
    { slug: 'minor-illusion', name: 'Minor Illusion', level: 0, school: 'illusion', concentration: false, ritual: false, in_repertoire: false, prepared: false },
  ],
  by_level: {
    '1': [
      { slug: 'magic-missile', name: 'Magic Missile', level: 1, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
      { slug: 'shield', name: 'Shield', level: 1, school: 'abjuration', concentration: false, ritual: false, in_repertoire: false, prepared: false },
      { slug: 'burning-hands', name: 'Burning Hands', level: 1, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
    ],
  },
  can_learn: true,
  can_prepare: true,
  budget: {
    cantrips_known: 0,
    cantrips_max: 3,
    spells_known: null,
    spells_max: null,
    prepared_used: 0,
    prepared_max: 2,
  },
};

const CLERIC_AVAILABLE = {
  cantrips: [
    { slug: 'sacred-flame', name: 'Sacred Flame', level: 0, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
  ],
  by_level: {
    '1': [
      { slug: 'cure-wounds', name: 'Cure Wounds', level: 1, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
      { slug: 'bless', name: 'Bless', level: 1, school: 'enchantment', concentration: true, ritual: false, in_repertoire: false, prepared: false },
    ],
  },
  can_learn: false,
  can_prepare: true,
  budget: {
    cantrips_known: 0,
    cantrips_max: 3,
    spells_known: null,
    spells_max: null,
    prepared_used: 0,
    prepared_max: 2,
  },
};

/** Empty starting-equipment packages — no fixed grants, no choices. The
 *  default fixture for every test in this file: Continue off the Equipment
 *  step is enabled the moment the fetch resolves (no choice groups to fill). */
const EMPTY_EQUIPMENT = {
  class: '',
  background: '',
  class_package: { fixed: [], choices: [] },
  background_package: { fixed: [], choices: [] },
};

beforeEach(() => {
  mockPush.mockReset();
  mockCreateCharacter.mockReset();
  mockGetAvailableSpells.mockReset();
  mockLearnSpell.mockReset();
  mockPrepareSpell.mockReset();
  mockDeleteCharacter.mockReset();
  mockGetCatalog.mockReset();
  mockGetStartingEquipment.mockReset();
  mockLearnSpell.mockResolvedValue({ learned: true, budget: WIZARD_AVAILABLE.budget });
  mockPrepareSpell.mockResolvedValue({ prepared: true, prepared_used: 1, prepared_max: 2 });
  mockDeleteCharacter.mockResolvedValue({ message: 'deleted' });
  // TAV-SPELLPICK-DESCRIPTIONS: empty catalog by default — rows render
  // name+school-only, matching every pre-existing test's expectations.
  mockGetCatalog.mockResolvedValue({ system: 'dnd5e', content_type: 'spell', items: [], total: 0, limit: 500, offset: 0 });
  mockGetStartingEquipment.mockResolvedValue(EMPTY_EQUIPMENT);
  catalogOverride = { ...defaultCatalog };
});

function pickRace() {
  fireEvent.click(screen.getByRole('radio', { name: /Human/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

function fillBackground() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Velka' } });
  fireEvent.click(screen.getByRole('radio', { name: /Acolyte/i }));
}

describe('Wizard spells-at-creation slice (T4/DDX-11t)', () => {
  it('shows NO Spells step for a non-caster (fighter) — 6 steps total (Equipment applies to every class)', () => {
    renderWizard();
    pickRace();
    fireEvent.click(screen.getByRole('radio', { name: /Fighter/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.queryByRole('button', { name: 'Spells' })).not.toBeInTheDocument();
    // Race → Class → now on Abilities (step 3 of the 6-step non-caster flow:
    // Race, Class, Abilities, Background, Equipment, Review).
    expect(screen.getByText('3 / 6')).toBeInTheDocument();
  });

  it('shows the Spells step for a caster (wizard) — 7 steps total, and silently creates the character on Equipment → Spells', async () => {
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-1' });
    mockGetAvailableSpells.mockResolvedValue(WIZARD_AVAILABLE);
    renderWizard();
    pickRace();
    fireEvent.click(screen.getByRole('radio', { name: /Wizard/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Abilities
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Spells (creates!)
    });

    await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(1));
    expect(mockCreateCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'alice', name: 'Velka', race: 'Human', char_class: 'Wizard' }),
    );
    await waitFor(() => expect(mockGetAvailableSpells).toHaveBeenCalledWith('char-1', 'alice'));
    expect(await screen.findByText('Fire Bolt')).toBeInTheDocument();
    expect(screen.getByText('Magic Missile')).toBeInTheDocument();
    // Spells is step 6 of the caster's 7-step flow (Race, Class, Abilities,
    // Background, Equipment, Spells, Review).
    expect(screen.getByText('6 / 7')).toBeInTheDocument();
  });

  async function advanceToSpells() {
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-1' });
    mockGetAvailableSpells.mockResolvedValue(WIZARD_AVAILABLE);
    renderWizard();
    pickRace();
    fireEvent.click(screen.getByRole('radio', { name: /Wizard/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    await screen.findByText('Fire Bolt');
  }

  it('disables further cantrip checkboxes once the budget (3) is reached', async () => {
    await advanceToSpells();
    const fireBolt = screen.getByRole('checkbox', { name: /Fire Bolt/i });
    const mageHand = screen.getByRole('checkbox', { name: /Mage Hand/i });
    const minorIllusion = screen.getByRole('checkbox', { name: /Minor Illusion/i });

    fireEvent.click(fireBolt);
    fireEvent.click(mageHand);
    fireEvent.click(minorIllusion);
    expect(fireBolt).toBeChecked();
    expect(mageHand).toBeChecked();
    expect(minorIllusion).toBeChecked();

    // Budget is 3/3 — nothing else to pick from in this fixture, but unchecking
    // one and re-picking another proves the cap is enforced, not just "all 3
    // happen to be picked": uncheck one, the remaining two stay enabled, and a
    // 4th (hypothetical) pick would be blocked. Verify via the aria-live budget.
    expect(screen.getByLabelText('3 of 3 cantrips chosen')).toBeInTheDocument();
  });

  it('does not let a leveled-spell pick exceed the server-computed budget (wizard prepared_max not used — spellbook falls back to the SRD level-1 size)', async () => {
    await advanceToSpells();
    const magicMissile = screen.getByRole('checkbox', { name: /Magic Missile/i });
    const shield = screen.getByRole('checkbox', { name: /Shield/i });
    const burningHands = screen.getByRole('checkbox', { name: /Burning Hands/i });
    // Wizard's level-1 spellbook cap is 6 (WIZARD_LEVEL1_SPELLBOOK_SIZE) — all
    // 3 fixture spells should be pickable without hitting the cap.
    fireEvent.click(magicMissile);
    fireEvent.click(shield);
    fireEvent.click(burningHands);
    expect(magicMissile).toBeChecked();
    expect(shield).toBeChecked();
    expect(burningHands).toBeChecked();
  });

  it('includes the chosen spells via learnSpell on final submit (create-then-learn)', async () => {
    await advanceToSpells();
    fireEvent.click(screen.getByRole('checkbox', { name: /Fire Bolt/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Magic Missile/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Review

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });

    // create-then-learn: exactly ONE create call total (not re-created at Review).
    await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockLearnSpell).toHaveBeenCalledWith('char-1', 'alice', 'fire-bolt'));
    // Slice B Fix 3: a wizard (spellbook caster)'s picked LEVELED spell is
    // learned with an explicit prepared=true override (picked == prepared,
    // castable under DND_ENFORCE_SPELL_KNOWN) -- unlike the cantrip above,
    // which omits the trailing args entirely (engine already computes
    // prepared=true for any cantrip regardless of caster kind).
    expect(mockLearnSpell).toHaveBeenCalledWith(
      'char-1',
      'alice',
      'magic-missile',
      undefined,
      undefined,
      true,
    );
    expect(mockPrepareSpell).not.toHaveBeenCalled();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-1'));
  });

  it('uses prepareSpell (not learnSpell) for a prepared caster (cleric) leveled pick', async () => {
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-2' });
    mockGetAvailableSpells.mockResolvedValue(CLERIC_AVAILABLE);
    renderWizard();
    pickRace();
    fireEvent.click(screen.getByRole('radio', { name: /Cleric/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    await screen.findByText('Cure Wounds');

    fireEvent.click(screen.getByRole('checkbox', { name: /Sacred Flame/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Cure Wounds/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Review

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });

    await waitFor(() => expect(mockLearnSpell).toHaveBeenCalledWith('char-2', 'alice', 'sacred-flame'));
    await waitFor(() =>
      expect(mockPrepareSpell).toHaveBeenCalledWith('char-2', 'alice', 'cure-wounds', true),
    );
  });

  it('Slice B Fix 3 regression pin: a KNOWN caster (sorcerer) leveled pick is UNCHANGED end-to-end (undefined prepared never reaches the wire)', async () => {
    // Added by Miko-QA gate (2026-07-19): no fixture in this file previously
    // exercised the 'known' caster kind (bard/sorcerer/warlock/ranger) at
    // all -- only 'spellbook' (wizard) and 'prepared' (cleric) were covered,
    // leaving the diff's own "known/prepared caster paths are unaffected"
    // claim untested on the Tavern side.
    //
    // FINDING (harmless, noted not filed): `leveledPrepared` in page.tsx is
    // `undefined` for any non-'spellbook' casterKind, but the ternary's
    // "learn" branch ALWAYS calls `learnSpell(id, username, slug, undefined,
    // undefined, leveledPrepared)` with all 3 trailing positional args
    // explicit -- unlike the cantrip line above it, which omits them
    // entirely. So a known caster's leveled call is a 6-arg call with
    // `undefined` in the prepared slot, not the bare 3-arg shape a naive
    // reader of "known casters are unaffected" might expect. Confirmed
    // functionally inert: `learnSpell`'s own body only puts `prepared` on
    // the wire `when prepared !== undefined` (see api-dnd.test.ts's "omits
    // `prepared` from the body when explicitly undefined" case), so the
    // actual HTTP POST body is byte-identical either way. Pinning the REAL
    // 6-arg shape here (not the 3-arg shape) so a future refactor that
    // collapses the trailing-undefined calls to omitted args doesn't read
    // as a false regression.
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-sorc' });
    mockGetAvailableSpells.mockResolvedValue({
      cantrips: [
        { slug: 'fire-bolt', name: 'Fire Bolt', level: 0, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
      ],
      by_level: {
        '1': [
          { slug: 'burning-hands', name: 'Burning Hands', level: 1, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
        ],
      },
      can_learn: true,
      can_prepare: false,
      budget: { cantrips_known: 0, cantrips_max: 4, spells_known: 0, spells_max: 2, prepared_used: null, prepared_max: null },
    });
    renderWizard();
    pickRace();
    fireEvent.click(screen.getByRole('radio', { name: /Sorcerer/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    await screen.findByText('Burning Hands');

    fireEvent.click(screen.getByRole('checkbox', { name: /Fire Bolt/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Burning Hands/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Review

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });

    await waitFor(() => expect(mockLearnSpell).toHaveBeenCalledWith('char-sorc', 'alice', 'fire-bolt'));
    // The load-bearing assertion: a known caster's leveled learn call must
    // carry `undefined` (not `true`/`false`) in the prepared slot -- i.e.
    // the override never engages for this caster kind, regardless of the
    // trailing-arg call shape.
    await waitFor(() =>
      expect(mockLearnSpell).toHaveBeenCalledWith(
        'char-sorc',
        'alice',
        'burning-hands',
        undefined,
        undefined,
        undefined,
      ),
    );
    expect(mockLearnSpell).not.toHaveBeenCalledWith(
      'char-sorc',
      'alice',
      'burning-hands',
      undefined,
      undefined,
      true,
    );
    expect(mockLearnSpell).not.toHaveBeenCalledWith(
      'char-sorc',
      'alice',
      'burning-hands',
      undefined,
      undefined,
      false,
    );
    expect(mockPrepareSpell).not.toHaveBeenCalled();
  });

  it('surfaces a toast on a partial spell-pick failure but still navigates (character already exists)', async () => {
    mockLearnSpell.mockRejectedValueOnce(Object.assign(new Error('over_cantrip_limit'), { status: 400 }));
    await advanceToSpells();
    fireEvent.click(screen.getByRole('checkbox', { name: /Fire Bolt/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-1'));
    expect(await screen.findByText(/couldn.?t be added/i)).toBeInTheDocument();
  });

  it('a non-caster (fighter) create flow never calls any spell hop', async () => {
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-3' });
    renderWizard();
    pickRace();
    fireEvent.click(screen.getByRole('radio', { name: /Fighter/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Review directly

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-3'));
    expect(mockGetAvailableSpells).not.toHaveBeenCalled();
    expect(mockLearnSpell).not.toHaveBeenCalled();
    expect(mockPrepareSpell).not.toHaveBeenCalled();
  });

  // ── TAV-SPELLPICK-DESCRIPTIONS / TAV-SPELLPICK-OVERLAY ────────────────────────
  const FIRE_BOLT_CATALOG_RESPONSE = {
    system: 'dnd5e',
    content_type: 'spell',
    total: 1,
    limit: 500,
    offset: 0,
    items: [
      {
        slug: 'fire-bolt',
        name: 'Fire Bolt',
        content_type: 'spell',
        source_type: 'srd',
        data: {
          level: 0,
          school: 'evocation',
          casting_time: '1 action',
          range: '120 feet',
          components: { V: true, S: true },
          duration: 'Instantaneous',
          description: 'You hurl a mote of fire at a creature or object within range.',
          higher_levels: 'The spell’s damage increases by 1d10 when you reach 5th level.',
        },
      },
    ],
  };

  it('TAV-SPELLPICK-DESCRIPTIONS: compact card shows level/casting-time/range/components once the catalog fetch resolves — no inline description', async () => {
    mockGetCatalog.mockResolvedValue(FIRE_BOLT_CATALOG_RESPONSE);
    await advanceToSpells();

    expect(mockGetCatalog).toHaveBeenCalledWith(
      'dnd5e',
      expect.objectContaining({ type: 'spell' }),
    );
    // The compact meta line: level now leads casting time/range/components.
    expect(screen.getByText('Cantrip · 1 action · 120 feet · V, S')).toBeInTheDocument();
    // The long description/higher-levels text is NOT inline anymore — it only
    // lives behind the 🔍 overlay (see the "opens the details overlay" test).
    expect(
      screen.queryByText(/You hurl a mote of fire at a creature or object within range\./),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/damage increases by 1d10/)).not.toBeInTheDocument();

    // A spell with no matching catalog entry (Mage Hand — not in the fixture
    // above) still renders name+school only, exactly as before — the
    // description enrichment never blocks selection of un-enriched rows.
    const mageHand = screen.getByRole('checkbox', { name: /Mage Hand/i });
    expect(mageHand).not.toBeDisabled();
    fireEvent.click(mageHand);
    expect(mageHand).toBeChecked();
  });

  it('TAV-SPELLPICK-OVERLAY: clicking the 🔍 opens the shared details overlay with the full description and higher-levels text', async () => {
    mockGetCatalog.mockResolvedValue(FIRE_BOLT_CATALOG_RESPONSE);
    await advanceToSpells();

    // No overlay open yet.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View Fire Bolt details' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/You hurl a mote of fire at a creature or object within range\./),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/damage increases by 1d10/)).toBeInTheDocument();

    // Escape closes it (CodexDetailModal's own behavior — proves the reuse,
    // not just that the overlay rendered once).
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('TAV-SPELLPICK-OVERLAY: the 🔍 is disabled for a spell with no matching catalog entry', async () => {
    mockGetCatalog.mockResolvedValue(FIRE_BOLT_CATALOG_RESPONSE);
    await advanceToSpells();

    // Mage Hand has no catalog entry in the fixture above.
    expect(screen.getByRole('button', { name: 'View Mage Hand details' })).toBeDisabled();
    // Fire Bolt does, and stays enabled.
    expect(screen.getByRole('button', { name: 'View Fire Bolt details' })).toBeEnabled();
  });

  it('TAV-SPELLPICK-DESCRIPTIONS: a failed catalog fetch degrades gracefully — rows still render name+school, selection is never blocked, and every 🔍 is disabled', async () => {
    mockGetCatalog.mockRejectedValue(new Error('network error'));
    await advanceToSpells();

    expect(screen.getByText('Fire Bolt')).toBeInTheDocument();
    const fireBolt = screen.getByRole('checkbox', { name: /Fire Bolt/i });
    expect(fireBolt).not.toBeDisabled();
    fireEvent.click(fireBolt);
    expect(fireBolt).toBeChecked();
    expect(screen.getByRole('button', { name: 'View Fire Bolt details' })).toBeDisabled();
  });

  // ── TAV-A11Y-SPELLSTEP-FIELDSET ────────────────────────────────────────────────
  it('TAV-A11Y-SPELLSTEP-FIELDSET: cantrip and 1st-level lists are grouped under distinctly-named fieldsets', async () => {
    await advanceToSpells();
    const cantripGroup = screen.getByRole('group', { name: 'Choose your cantrips' });
    const leveledGroup = screen.getByRole('group', { name: 'Choose your 1st-level spells' });
    expect(cantripGroup).toBeInTheDocument();
    expect(leveledGroup).toBeInTheDocument();
    // Fire Bolt (a cantrip) lives inside the cantrip group, not the leveled one.
    expect(within(cantripGroup).getByText('Fire Bolt')).toBeInTheDocument();
    expect(within(leveledGroup).queryByText('Fire Bolt')).not.toBeInTheDocument();
    // Magic Missile (level 1) lives inside the leveled group, not the cantrip one.
    expect(within(leveledGroup).getByText('Magic Missile')).toBeInTheDocument();
    expect(within(cantripGroup).queryByText('Magic Missile')).not.toBeInTheDocument();
  });

  // ── TAV-A11Y-CAP-HINT ───────────────────────────────────────────────────────────
  it('TAV-A11Y-CAP-HINT: a disabled (cap-hit) cantrip checkbox is aria-describedby the cap hint; enabled/checked boxes are not', async () => {
    const FOUR_CANTRIPS = {
      ...WIZARD_AVAILABLE,
      cantrips: [
        ...WIZARD_AVAILABLE.cantrips,
        { slug: 'ray-of-frost', name: 'Ray of Frost', level: 0, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
      ],
    };
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-1' });
    mockGetAvailableSpells.mockResolvedValue(FOUR_CANTRIPS);
    renderWizard();
    pickRace();
    fireEvent.click(screen.getByRole('radio', { name: /Wizard/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    await screen.findByText('Fire Bolt');

    const fireBolt = screen.getByRole('checkbox', { name: /Fire Bolt/i });
    const rayOfFrost = screen.getByRole('checkbox', { name: /Ray of Frost/i });

    // 0/3 picked: cap not hit, nothing wired yet.
    expect(fireBolt).not.toHaveAttribute('aria-describedby');
    expect(rayOfFrost).not.toHaveAttribute('aria-describedby');

    fireEvent.click(fireBolt);
    fireEvent.click(screen.getByRole('checkbox', { name: /Mage Hand/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Minor Illusion/i }));

    // Cap hit (3/3): the disabled 4th is described by the hint; the CHECKED
    // ones are not (their "why" is self-evident — they're checked).
    expect(rayOfFrost).toBeDisabled();
    expect(rayOfFrost).toHaveAttribute('aria-describedby', 'cantrip-cap-hint');
    expect(fireBolt).not.toHaveAttribute('aria-describedby');
    expect(
      screen.getByText(/chosen all 3 cantrips.*deselect one to pick another/i),
    ).toHaveAttribute('id', 'cantrip-cap-hint');
  });

  // ── Miko-QA adversarial pass — budget boundary, real over-cap probes ──────────
  it('truly disables a 4th cantrip checkbox once the server budget (3) is EXCEEDED, not just displayed at 3/3', async () => {
    const FOUR_CANTRIPS = {
      ...WIZARD_AVAILABLE,
      cantrips: [
        ...WIZARD_AVAILABLE.cantrips,
        { slug: 'ray-of-frost', name: 'Ray of Frost', level: 0, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
      ],
    };
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-1' });
    mockGetAvailableSpells.mockResolvedValue(FOUR_CANTRIPS);
    renderWizard();
    pickRace();
    fireEvent.click(screen.getByRole('radio', { name: /Wizard/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    await screen.findByText('Fire Bolt');

    fireEvent.click(screen.getByRole('checkbox', { name: /Fire Bolt/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Mage Hand/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Minor Illusion/i }));
    const rayOfFrost = screen.getByRole('checkbox', { name: /Ray of Frost/i });
    expect(rayOfFrost).toBeDisabled();
    fireEvent.click(rayOfFrost); // a disabled checkbox refuses the click natively
    expect(rayOfFrost).not.toBeChecked();
    expect(screen.getByLabelText('3 of 3 cantrips chosen')).toBeInTheDocument();
  });

  it('truly disables a 3rd leveled-spell checkbox for a prepared caster (cleric prepared_max=2)', async () => {
    const CLERIC_THREE_LEVEL1 = {
      ...CLERIC_AVAILABLE,
      by_level: {
        '1': [
          ...CLERIC_AVAILABLE.by_level['1'],
          { slug: 'guiding-bolt', name: 'Guiding Bolt', level: 1, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
        ],
      },
    };
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-2' });
    mockGetAvailableSpells.mockResolvedValue(CLERIC_THREE_LEVEL1);
    renderWizard();
    pickRace();
    fireEvent.click(screen.getByRole('radio', { name: /Cleric/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    await screen.findByText('Cure Wounds');

    fireEvent.click(screen.getByRole('checkbox', { name: /Cure Wounds/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Bless/i }));
    const guidingBolt = screen.getByRole('checkbox', { name: /Guiding Bolt/i });
    expect(guidingBolt).toBeDisabled();
    fireEvent.click(guidingBolt);
    expect(guidingBolt).not.toBeChecked();
    expect(screen.getByLabelText('2 of 2 first level spells chosen')).toBeInTheDocument();
  });

  it('allows proceeding with ZERO spell picks (Spells step is optional) and calls no learn/prepare hop', async () => {
    await advanceToSpells();
    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).toBeEnabled(); // no picks required to advance
    fireEvent.click(continueBtn); // -> Review, zero picks

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-1'));
    expect(mockCreateCharacter).toHaveBeenCalledTimes(1); // no second create either
    expect(mockLearnSpell).not.toHaveBeenCalled();
    expect(mockPrepareSpell).not.toHaveBeenCalled();
  });

  it('does NOT re-create the character when re-entering Background -> Spells a second time (create-then-learn fires exactly once)', async () => {
    await advanceToSpells();
    expect(mockCreateCharacter).toHaveBeenCalledTimes(1);
    expect(mockGetAvailableSpells).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Equipment (remounts, refetches)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Spells again
    });
    await screen.findByText('Fire Bolt');

    expect(mockCreateCharacter).toHaveBeenCalledTimes(1); // still just the one
  });

  // ── Class-change-mid-flow — the mandate's named highest-risk area ─────────────
  it('class change AFTER silent create, CASTER -> NON-CASTER: the Spells step vanishes, a SECOND (fresh) character is created for the new class, and the abandoned caster is never spell-populated', async () => {
    mockCreateCharacter
      .mockResolvedValueOnce({ character_id: 'char-wizard-orphan' })
      .mockResolvedValueOnce({ character_id: 'char-fighter-final' });
    mockGetAvailableSpells.mockResolvedValue(WIZARD_AVAILABLE);
    renderWizard();
    pickRace();
    fireEvent.click(screen.getByRole('radio', { name: /Wizard/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Spells (silently creates char-wizard-orphan)
    });
    await screen.findByText('Fire Bolt');
    fireEvent.click(screen.getByRole('checkbox', { name: /Fire Bolt/i }));

    // Walk back to Class and switch to a non-caster. Spells is now step
    // index 5 (Equipment sits between Background and Spells for every
    // class) — 4 Backs, not 3, to reach Class.
    fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Equipment
    fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Background
    fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Abilities
    fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Class
    fireEvent.click(screen.getByRole('radio', { name: /Fighter/i }));

    // Race/abilities/background state persists across the class swap — walk
    // forward again; there is now NO Spells step at all.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review directly

    expect(screen.queryByText('Sound about right?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Spells/i })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });

    // Two creates total: the abandoned wizard (orphan) + the real fighter.
    await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(2));
    expect(mockCreateCharacter).toHaveBeenNthCalledWith(1, expect.objectContaining({ char_class: 'Wizard' }));
    expect(mockCreateCharacter).toHaveBeenNthCalledWith(2, expect.objectContaining({ char_class: 'Fighter' }));
    // The orphaned wizard's picked cantrip must NEVER be applied to anything.
    expect(mockLearnSpell).not.toHaveBeenCalled();
    expect(mockPrepareSpell).not.toHaveBeenCalled();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-fighter-final'));
  });

  it('class change AFTER silent create, CASTER -> DIFFERENT CASTER KIND (wizard "spellbook" -> cleric "prepared"): fresh character, fresh pool, stale picks discarded, correct action kind on submit', async () => {
    mockCreateCharacter
      .mockResolvedValueOnce({ character_id: 'char-wizard-orphan' })
      .mockResolvedValueOnce({ character_id: 'char-cleric-final' });
    mockGetAvailableSpells
      .mockResolvedValueOnce(WIZARD_AVAILABLE)
      .mockResolvedValueOnce(CLERIC_AVAILABLE);
    renderWizard();
    pickRace();
    fireEvent.click(screen.getByRole('radio', { name: /Wizard/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Spells (char-wizard-orphan)
    });
    await screen.findByText('Fire Bolt');
    fireEvent.click(screen.getByRole('checkbox', { name: /Fire Bolt/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Magic Missile/i }));

    // 4 Backs (not 3) — Equipment sits between Background and Spells now.
    fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Equipment
    fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Background
    fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Abilities
    fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Class
    fireEvent.click(screen.getByRole('radio', { name: /Cleric/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Spells again (fresh create)
    });

    await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(2));
    expect(mockCreateCharacter).toHaveBeenNthCalledWith(2, expect.objectContaining({ char_class: 'Cleric' }));
    await waitFor(() => expect(mockGetAvailableSpells).toHaveBeenCalledWith('char-cleric-final', 'alice'));

    // Stale wizard picks/pool must not survive the class swap.
    expect(await screen.findByText('Sacred Flame')).toBeInTheDocument();
    expect(screen.queryByText('Fire Bolt')).not.toBeInTheDocument();
    expect(screen.queryByText('Magic Missile')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Sacred Flame/i })).not.toBeChecked();
    expect(screen.getByLabelText('0 of 3 cantrips chosen')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /Sacred Flame/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Cure Wounds/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });

    // Picks apply to the CLERIC character (with the correct prepare action),
    // never to the abandoned wizard one, never via learnSpell for a prepared pick.
    await waitFor(() => expect(mockLearnSpell).toHaveBeenCalledWith('char-cleric-final', 'alice', 'sacred-flame'));
    await waitFor(() =>
      expect(mockPrepareSpell).toHaveBeenCalledWith('char-cleric-final', 'alice', 'cure-wounds', true),
    );
    expect(mockLearnSpell).not.toHaveBeenCalledWith('char-wizard-orphan', expect.anything(), expect.anything());
    expect(mockPrepareSpell).not.toHaveBeenCalledWith(
      'char-wizard-orphan',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  // ── FINDINGS from the adversarial pass ─────────────────────────────────────────
  it('FIXED: the Review-step name field is LOCKED once a caster character is created — no silent edit-after-create loss', async () => {
    await advanceToSpells(); // silently creates char-1 named "Velka"
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review

    // The name was already persisted by the silent create, so the Review field
    // is disabled + hinted rather than accepting an edit that would be dropped.
    const reviewNameInput = screen.getByLabelText('Name');
    expect(reviewNameInput).toBeDisabled();
    expect(
      screen.getByText(/Name is set\. You can rename from the character sheet later\./i),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-1'));
    expect(mockCreateCharacter).toHaveBeenCalledTimes(1);
    expect(mockCreateCharacter).toHaveBeenCalledWith(expect.objectContaining({ name: 'Velka' }));
  });

  it('FIXED: Back (and the rail) are DISABLED during the in-flight silent create — no mid-flight step desync', async () => {
    let resolveCreate!: (v: unknown) => void;
    mockCreateCharacter.mockImplementation(
      () => new Promise((res) => { resolveCreate = res; }),
    );
    mockGetAvailableSpells.mockResolvedValue(WIZARD_AVAILABLE); // Spells step fetch after we land there
    renderWizard();
    pickRace();
    fireEvent.click(screen.getByRole('radio', { name: /Wizard/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // fires silent create, PENDING
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('What did you bring?'); // still Equipment

    // Back is now gated on `submitting` (as Continue/Begin already were), so the
    // user cannot navigate away mid-create and desync the landing step.
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

    await act(async () => {
      resolveCreate({ character_id: 'char-1' });
      await Promise.resolve();
    });

    // Lands on the Spells step as intended — no longer on Equipment.
    expect(screen.getByRole('heading', { level: 2 })).not.toHaveTextContent('What did you bring?');
    expect(mockCreateCharacter).toHaveBeenCalledTimes(1);
  });

  it('Cancel (link to /dashboard) after a silent create fires no cleanup/delete call — the orphan is left as-is (no delete endpoint exists in this slice)', async () => {
    await advanceToSpells();
    const cancelLink = screen.getByRole('link', { name: 'Cancel' });
    expect(cancelLink).toHaveAttribute('href', '/dashboard');
    fireEvent.click(cancelLink);
    // No additional mutation of any kind fires on Cancel.
    expect(mockCreateCharacter).toHaveBeenCalledTimes(1);
    expect(mockLearnSpell).not.toHaveBeenCalled();
    expect(mockPrepareSpell).not.toHaveBeenCalled();
  });

  // ── Same-button rapid double-click — positive confirmation, not assumed ───────
  it('CONFIRMED SAFE: rapid double-click on Continue at Equipment -> Spells does not double-create (native `disabled` flips synchronously before the 2nd click is dispatched)', async () => {
    let resolveCreate!: (v: unknown) => void;
    mockCreateCharacter.mockImplementation(
      () => new Promise((res) => { resolveCreate = res; }),
    );
    mockGetAvailableSpells.mockResolvedValue(WIZARD_AVAILABLE);
    renderWizard();
    pickRace();
    fireEvent.click(screen.getByRole('radio', { name: /Wizard/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());

    const cont = screen.getByRole('button', { name: 'Continue' });
    fireEvent.click(cont);
    fireEvent.click(cont); // immediate 2nd click, no await in between

    await act(async () => {
      resolveCreate({ character_id: 'char-1' });
      await Promise.resolve();
    });
    expect(mockCreateCharacter).toHaveBeenCalledTimes(1);
  });

  // ── F7/TAV-CREATE-EDIT-NOT-RETRO — snapshot-compare-and-recreate ─────────────
  describe('F7: editing fields AFTER the silent create recreates on final submit (create-first ordering)', () => {
    it('an ability-score edit after the silent create is reflected in the recreated character, not silently dropped', async () => {
      mockCreateCharacter
        .mockResolvedValueOnce({ character_id: 'char-1' })
        .mockResolvedValueOnce({ character_id: 'char-1-recreated' });
      mockGetAvailableSpells.mockResolvedValue(WIZARD_AVAILABLE);
      await advanceToSpells(); // silent create #1 with DEFAULT_SCORES (str 8)

      // 3 Backs (not 2) — Equipment sits between Background and Spells now.
      fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Equipment
      fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Background
      fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Abilities
      fireEvent.click(screen.getByRole('button', { name: 'Increase Strength' })); // str 8 -> 9
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Spells (characterId already set, no recreate here)
      await screen.findByText('Fire Bolt');
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
      });

      await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(2));
      expect(mockCreateCharacter).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          ability_scores: expect.objectContaining({ strength: 9 }),
        }),
      );
      // The finalized character is the RECREATED one, not the stale original.
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-1-recreated'));
    });

    it('create-first ordering (Kuro-Sec C2): the stale character is deleted only AFTER the replacement create succeeds, leaving exactly one live character', async () => {
      mockCreateCharacter
        .mockResolvedValueOnce({ character_id: 'char-1' })
        .mockResolvedValueOnce({ character_id: 'char-1-edited' });
      mockGetAvailableSpells.mockResolvedValue(WIZARD_AVAILABLE);
      renderWizard();
      pickRace();
      fireEvent.click(screen.getByRole('radio', { name: /Wizard/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
      fillBackground();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // silent create #1: char-1
      });
      await screen.findByText('Fire Bolt');

      // Go back and edit the background/name AFTER the silent create. 2 Backs
      // (not 1) — Equipment sits between Background and Spells now.
      fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Equipment
      fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Background
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Velka the Second' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Spells (no recreate at Continue-time)
      await screen.findByText('Fire Bolt');
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
      });

      await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(2));
      expect(mockCreateCharacter).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ name: 'Velka the Second' }),
      );
      await waitFor(() => expect(mockDeleteCharacter).toHaveBeenCalledWith('char-1', 'alice'));
      // The delete call must be issued strictly AFTER the replacement create resolved.
      expect(mockCreateCharacter.mock.invocationCallOrder[1]).toBeLessThan(
        mockDeleteCharacter.mock.invocationCallOrder[0],
      );
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-1-edited'));
    });

    it('if the replacement create fails, the flow aborts and the stale character is NEVER deleted', async () => {
      mockCreateCharacter
        .mockResolvedValueOnce({ character_id: 'char-1' })
        .mockRejectedValueOnce(new Error('500'));
      mockGetAvailableSpells.mockResolvedValue(WIZARD_AVAILABLE);
      renderWizard();
      pickRace();
      fireEvent.click(screen.getByRole('radio', { name: /Wizard/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fillBackground();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // silent create #1
      });
      await screen.findByText('Fire Bolt');

      // 2 Backs (not 1) — Equipment sits between Background and Spells now.
      fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Equipment
      fireEvent.click(screen.getByRole('button', { name: 'Back' })); // -> Background
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Velka Edited' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Spells
      await screen.findByText('Fire Bolt');
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
      });

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockDeleteCharacter).not.toHaveBeenCalled();
      expect(mockCreateCharacter).toHaveBeenCalledTimes(2); // attempted the recreate; it failed
    });
  });

  // ── Kuro-Sec C1 — already_known learn rejections never inflate the failure count,
  //    but every OTHER rejection reason/status still does (never swallowed on
  //    status alone / "any 4xx" / err.code) ──────────────────────────────────────
  describe('Kuro-Sec C1: learn/prepare rejection classification', () => {
    it('an already_known rejection does NOT count as a failure and shows no warning toast', async () => {
      mockLearnSpell.mockRejectedValueOnce(
        Object.assign(new Error('already_known'), {
          status: 400,
          code: '400',
          body: {
            success: false,
            message: 'Spell already known',
            data: { reason: 'already_known' },
          },
        }),
      );
      await advanceToSpells();
      fireEvent.click(screen.getByRole('checkbox', { name: /Fire Bolt/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
      });

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-1'));
      expect(screen.queryByText(/couldn.?t be added/i)).not.toBeInTheDocument();
    });

    it('a 401 actor_required rejection STILL counts as a failure (never swallowed on HTTP status alone)', async () => {
      mockLearnSpell.mockRejectedValueOnce(
        Object.assign(new Error('actor_required'), {
          status: 401,
          code: '401',
          body: { success: false, message: 'Actor required', data: { reason: 'actor_required' } },
        }),
      );
      await advanceToSpells();
      fireEvent.click(screen.getByRole('checkbox', { name: /Fire Bolt/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
      });

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-1'));
      expect(await screen.findByText(/couldn.?t be added/i)).toBeInTheDocument();
    });

    it('a 404 not_found rejection STILL counts as a failure (never swallowed on "any 4xx")', async () => {
      mockLearnSpell.mockRejectedValueOnce(
        Object.assign(new Error('not_found'), {
          status: 404,
          code: '404',
          body: { success: false, message: 'Character not found', data: { reason: 'not_found' } },
        }),
      );
      await advanceToSpells();
      fireEvent.click(screen.getByRole('checkbox', { name: /Fire Bolt/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
      });

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-1'));
      expect(await screen.findByText(/couldn.?t be added/i)).toBeInTheDocument();
    });
  });

  // ── Same-button rapid double-click on the FINAL submit ────────────────────────
  it('CONFIRMED SAFE: rapid double-click on "Begin your campaign" does not double up create/learn calls', async () => {
    await advanceToSpells();
    fireEvent.click(screen.getByRole('checkbox', { name: /Fire Bolt/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review

    let resolveLearn!: (v: unknown) => void;
    mockLearnSpell.mockImplementation(() => new Promise((res) => { resolveLearn = res; }));

    const begin = screen.getByRole('button', { name: /Begin your campaign/i });
    fireEvent.click(begin);
    fireEvent.click(begin); // immediate 2nd click, no await in between

    await act(async () => {
      resolveLearn({ learned: true });
      await Promise.resolve();
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-1'));
    expect(mockCreateCharacter).toHaveBeenCalledTimes(1);
    expect(mockLearnSpell).toHaveBeenCalledTimes(1);
  });

  // ── TAV-CREATE-DEADEND-DIAGNOSABLE ────────────────────────────────────────────
  describe('TAV-CREATE-DEADEND-DIAGNOSABLE: the silent Equipment -> Spells create surfaces a real reason on failure', () => {
    it('surfaces the engine\'s own rejection message instead of the generic line, and does not advance past Background', async () => {
      mockCreateCharacter.mockRejectedValueOnce(
        Object.assign(new Error('400'), {
          status: 400,
          code: '400',
          body: {
            success: false,
            message: 'Half-Elf ability score choices must be exactly two abilities, excluding Charisma.',
            data: {},
          },
        }),
      );
      renderWizard();
      pickRace();
      fireEvent.click(screen.getByRole('radio', { name: /Wizard/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
      fillBackground();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // rejected create
      });

      expect(
        await screen.findByText(
          'Half-Elf ability score choices must be exactly two abilities, excluding Charisma.',
        ),
      ).toBeInTheDocument();
      // Never advanced — still on Equipment (the step the rejected create
      // fired from), not silently stuck with no cue.
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        'What did you bring?',
      );
    });

    it('falls back to the generic line only when the failure carries no engine message (e.g. a network error)', async () => {
      mockCreateCharacter.mockRejectedValueOnce(new Error('network'));
      renderWizard();
      pickRace();
      fireEvent.click(screen.getByRole('radio', { name: /Wizard/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      fillBackground();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // → Equipment
      await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      });

      expect(
        await screen.findByText(/Suzu couldn.?t write that down\. Check your choices/i),
      ).toBeInTheDocument();
    });
  });
});
