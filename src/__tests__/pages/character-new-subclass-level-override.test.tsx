/**
 * R62/TAV-SUBCLASS-LEVEL-OVERRIDE — the creation wizard's Subclass step gated
 * on the class catalog's `effective_subclass_level`, distinct from its plain
 * `subclass_level`. Engine half: NekoNova-DnDEngine `feature/subclass-level-
 * override` @ f94fe41 (`rules_catalog.class_effective_subclass_level_for_wire`
 * / `routes/catalog.py`) — NOT YET deployed to dev at the time this landed;
 * every fixture below exercises the CLIENT contract against a hand-shaped
 * wire response, same discipline every other catalog-derivation test file in
 * this repo uses.
 *
 * Covers:
 *  - Re:Zero-shaped fixture: an SRD-chassis class (`subclass_level:3`) whose
 *    catalog row now also carries `effective_subclass_level:1` (because two
 *    Re:Zero archetypes declare their own `subclass_level:1`) gets a
 *    creation-time Subclass step whose options are ONLY the level-1
 *    archetypes — the SRD ones (no override, fall back to the class's own
 *    plain subclass_level:3) never render as pickable.
 *  - Regression control: the SAME class with NO effective_subclass_level on
 *    the wire renders NO Subclass step at all — byte-identical to before
 *    this ruling.
 *  - Defensive "unlocks at level N" state: effective_subclass_level:1 fires
 *    the step, but every subclass this session's own fetch can see falls
 *    back to the class's plain level (3) — nothing qualifies at 1 yet. The
 *    step still renders (never silently skipped), explains when archetypes
 *    unlock, and Continue is enabled without a pick.
 *  - Apply sequence: resolveLevelChoice('subclass:1', …) is attempted ONLY
 *    when a pick was made — the "unlocks at N" case creates the character
 *    without ever calling it and without raising a setupIssues callout.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
const mockGetCatalog = jest.fn();
const mockResolveLevelChoice = jest.fn();
const mockGetFeaturePicks = jest.fn();
const mockLearnFeaturePick = jest.fn();
const mockGetAvailableSpells = jest.fn();
const mockLearnSpell = jest.fn();
const mockPrepareSpell = jest.fn();
const mockDeleteCharacter = jest.fn();

jest.mock('../../lib/api/dnd', () => ({
  createCharacter: (...args: unknown[]) => mockCreateCharacter(...args),
  getStartingEquipment: (...args: unknown[]) => mockGetStartingEquipment(...args),
  getCatalog: (...args: unknown[]) => mockGetCatalog(...args),
  resolveLevelChoice: (...args: unknown[]) => mockResolveLevelChoice(...args),
  getFeaturePicks: (...args: unknown[]) => mockGetFeaturePicks(...args),
  learnFeaturePick: (...args: unknown[]) => mockLearnFeaturePick(...args),
  getAvailableSpells: (...args: unknown[]) => mockGetAvailableSpells(...args),
  learnSpell: (...args: unknown[]) => mockLearnSpell(...args),
  prepareSpell: (...args: unknown[]) => mockPrepareSpell(...args),
  deleteCharacter: (...args: unknown[]) => mockDeleteCharacter(...args),
}));

const HUMAN = {
  id: 'human',
  name: 'Human',
  sub: 'ambitious · versatile',
  bonusLabel: '+1 to all',
  bonuses: { strength: 1, dexterity: 1, constitution: 1, intelligence: 1, wisdom: 1, charisma: 1 },
  speed: 30,
  icon: 'Users' as const,
  subraces: [],
  needsAsiChoice: false,
};

// SRD-shaped rogue chassis, no override at all — regression control. No
// `effectiveSubclassLevel` on the wire (undefined), matching what
// catalogItemToClass produces for a class row that omits
// `effective_subclass_level` entirely.
const ROGUE_NO_OVERRIDE = {
  id: 'rogue',
  name: 'Rogue',
  hitDie: 8,
  saves: ['dexterity', 'intelligence'] as ['dexterity', 'intelligence'],
  icon: 'Rogue' as const,
  accent: 'var(--good)',
  flavor: 'Skulk, strike, vanish.',
  isCaster: false,
  primary: ['dexterity'] as ['dexterity'],
  subclassLevel: 3,
  // effectiveSubclassLevel intentionally omitted.
};

// The SAME SRD chassis, but the catalog now also carries
// `effective_subclass_level:1` — two Re:Zero archetypes (declared
// subclass_level:1 on their own rows) pulled the class's effective gate
// down from its plain 3. subclassLevel itself is UNCHANGED.
const ROGUE_RZ = {
  ...ROGUE_NO_OVERRIDE,
  effectiveSubclassLevel: 1,
};

const SRD_ARCHETYPES = [
  {
    slug: 'thief',
    name: 'Thief',
    content_type: 'subclass',
    source_type: 'srd',
    data: { class: 'rogue', description: 'Hands quicker than the eye.' }, // no override -> falls back to 3
  },
  {
    slug: 'assassin',
    name: 'Assassin',
    content_type: 'subclass',
    source_type: 'srd',
    data: { class: 'rogue', description: 'One shot, one kill.' },
  },
];

const RZ_ARCHETYPES = [
  {
    slug: 'sloth',
    name: 'Sloth',
    content_type: 'subclass',
    source_type: 'homebrew',
    data: { class: 'rogue', subclass_level: 1, description: 'Authority of Sloth, from the start.' },
  },
  {
    slug: 'gluttony',
    name: 'Gluttony',
    content_type: 'subclass',
    source_type: 'homebrew',
    data: { class: 'rogue', subclass_level: 1, description: 'Authority of Gluttony, from the start.' },
  },
];

const ROGUE_SUBCLASSES_MIXED = {
  system: 'dnd5e',
  content_type: 'subclass',
  total: 4,
  limit: 500,
  offset: 0,
  items: [...SRD_ARCHETYPES, ...RZ_ARCHETYPES],
};

// Defensive fixture: the class's effective gate says 1, but this session's
// OWN subclass fetch can only see the SRD-shaped rows (no RZ ones) — every
// row it sees falls back to the class's plain level (3). Nothing qualifies.
const ROGUE_SUBCLASSES_ALL_LOCKED = {
  system: 'dnd5e',
  content_type: 'subclass',
  total: 2,
  limit: 500,
  offset: 0,
  items: SRD_ARCHETYPES,
};

const defaultCatalog = {
  status: 'ok' as const,
  retry: jest.fn(),
  data: {
    races: [HUMAN],
    classes: [ROGUE_NO_OVERRIDE],
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

// TAV-JEST-FLAKE-WIZARD-COMMENTARY (Kage-CR, 2026-09-10): a SYNCHRONOUS-
// throw mock, not an async generator — see character-new-spells.test.tsx's
// own mock for the full root-cause writeup. useWizardCommentary's detached
// async IIFE calls setStreaming(false) after `for await` drains the stream;
// even an EMPTY async generator takes >=1 microtask tick to settle, landing
// outside any act() boundary this file's fireEvent calls establish, which
// this shape's sibling files proved flaky under worker contention. A plain
// function that throws synchronously fails the for-await loop's iterable
// expression BEFORE any `await` is reached, so the hook's try/catch +
// setStreaming(false) complete on the SAME synchronous tick — no dangling
// microtask, ever. Observably identical (the hook's own catch{} swallows
// either shape; text stays '', streaming ends false).
jest.mock('../../lib/stream', () => ({
  streamNarration: jest.fn(() => {
    throw new Error('streamNarration disabled in this test file — deterministic fallback only');
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
  mockGetCatalog.mockReset();
  mockResolveLevelChoice.mockReset();
  mockGetFeaturePicks.mockReset();
  mockLearnFeaturePick.mockReset();
  mockGetAvailableSpells.mockReset();
  mockLearnSpell.mockReset();
  mockPrepareSpell.mockReset();
  mockDeleteCharacter.mockReset();
  mockGetStartingEquipment.mockResolvedValue(EMPTY_EQUIPMENT);
  mockGetCatalog.mockResolvedValue(ROGUE_SUBCLASSES_MIXED);
  mockResolveLevelChoice.mockResolvedValue({ message: 'ok' });
  catalogOverride = { ...defaultCatalog };
});

function pickRace() {
  fireEvent.click(screen.getByRole('radio', { name: /Human/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

function pickClass(name: RegExp) {
  fireEvent.click(screen.getByRole('radio', { name }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

function fillBackground() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Subaru' } });
  fireEvent.click(screen.getByRole('radio', { name: /Acolyte/i }));
}

describe('R62 — Subclass step presence tracks effective_subclass_level, not subclass_level', () => {
  it('REGRESSION: an SRD rogue with NO override renders no Subclass step at all — byte-identical to before this ruling', () => {
    renderWizard();
    pickRace();
    pickClass(/Rogue/i);
    // Straight to Abilities — "Archetype" never appears as a rail step.
    expect(screen.queryByText('Archetype')).not.toBeInTheDocument();
    expect(mockGetCatalog).not.toHaveBeenCalled();
  });

  it('Re:Zero-shaped fixture: effective_subclass_level:1 fires the Subclass step, options are ONLY the level-1 archetypes', async () => {
    catalogOverride = { ...defaultCatalog, data: { ...defaultCatalog.data, classes: [ROGUE_RZ] } };
    renderWizard();
    pickRace();
    pickClass(/Rogue/i);

    expect(await screen.findByRole('radio', { name: /Sloth/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Gluttony/i })).toBeInTheDocument();
    // The SRD chassis's own archetypes still gate at 3 — never offered here.
    expect(screen.queryByRole('radio', { name: /^Thief$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Assassin/i })).not.toBeInTheDocument();

    expect(mockGetCatalog).toHaveBeenCalledWith(
      'dnd5e',
      { type: 'subclass', limit: 500 },
      expect.anything(),
    );
  });

  it('Kage-CR: the mixed case (RZ pickable at 1, SRD chassis still locked at 3) names the locked ones too — the grid must not read as the full roster', async () => {
    catalogOverride = { ...defaultCatalog, data: { ...defaultCatalog.data, classes: [ROGUE_RZ] } };
    renderWizard();
    pickRace();
    pickClass(/Rogue/i);

    await screen.findByRole('radio', { name: /Sloth/i });
    // Only 2 radios render (Sloth/Gluttony) — Thief/Assassin are excluded
    // from the DOM (not disabled radios), per the a11y approach the
    // LevelChoicePicker card already uses for the same trade-off.
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(await screen.findByText(/more archetypes unlock at level 3/i)).toBeInTheDocument();
  });

  it('a pick is required when qualifying archetypes exist — Continue stays disabled until one is chosen', async () => {
    catalogOverride = { ...defaultCatalog, data: { ...defaultCatalog.data, classes: [ROGUE_RZ] } };
    renderWizard();
    pickRace();
    pickClass(/Rogue/i);
    await screen.findByRole('radio', { name: /Sloth/i });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Sloth/i }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('"unlocks at level N": nothing qualifies at 1 (this session only sees the SRD-gated rows) — step still renders, Continue is enabled without a pick', async () => {
    mockGetCatalog.mockResolvedValue(ROGUE_SUBCLASSES_ALL_LOCKED);
    catalogOverride = { ...defaultCatalog, data: { ...defaultCatalog.data, classes: [ROGUE_RZ] } };
    renderWizard();
    pickRace();
    pickClass(/Rogue/i);

    expect(await screen.findByText(/Rogue.s archetypes unlock at level 3/i)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});

describe('R62 — apply sequence resolves subclass:1 ONLY when a pick was made', () => {
  it('the "unlocks at N" case creates the character WITHOUT ever calling resolveLevelChoice, and raises no setup callout', async () => {
    mockGetCatalog.mockResolvedValue(ROGUE_SUBCLASSES_ALL_LOCKED);
    catalogOverride = { ...defaultCatalog, data: { ...defaultCatalog.data, classes: [ROGUE_RZ] } };
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-locked' });
    renderWizard();
    pickRace();
    pickClass(/Rogue/i);
    await screen.findByText(/Rogue.s archetypes unlock at level 3/i);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // creates!
    });

    await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(1));
    expect(mockResolveLevelChoice).not.toHaveBeenCalled();

    // Rogue isn't a caster — Equipment -> Review directly, no Spells step.
    expect(await screen.findByText('Begin your campaign')).toBeInTheDocument();
    expect(screen.queryByText('Setup incomplete')).not.toBeInTheDocument();
  });

  it('the Re:Zero pick DOES resolve subclass:1 once made — positive control for the branch above', async () => {
    catalogOverride = { ...defaultCatalog, data: { ...defaultCatalog.data, classes: [ROGUE_RZ] } };
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-picked' });
    renderWizard();
    pickRace();
    pickClass(/Rogue/i);
    await screen.findByRole('radio', { name: /Sloth/i });
    fireEvent.click(screen.getByRole('radio', { name: /Sloth/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // creates!
    });

    await waitFor(() =>
      expect(mockResolveLevelChoice).toHaveBeenCalledWith('char-picked', 'alice', 'subclass:1', {
        subclass: 'sloth',
      }),
    );
  });
});
