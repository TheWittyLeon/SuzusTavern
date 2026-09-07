/**
 * Tests for TAV-WIZARD-HOMEBREW-CASTERS — the Subclass/Rung steps and the
 * post-create Subclass/Rung apply sequence (src/app/character/new/page.tsx).
 *
 * Covers:
 *  - Subclass step present iff WizardClass.subclassLevel === 1; absent
 *    (byte-identical) for a class without it.
 *  - Rung step present iff WizardClass.rungMenu.knownAtLevel1 > 0; options
 *    filtered to the chosen archetype tag (or untagged); exact pick count
 *    enforced.
 *  - Content-bug empty state: subclassLevel:1 but zero seeded subclass rows.
 *  - Non-freeform Rung menu: read-only, no learnFeaturePick call attempted.
 *  - Call ORDER on silent create: createCharacter -> resolveLevelChoice
 *    ('subclass:1', …) -> getFeaturePicks -> learnFeaturePick, asserted via
 *    a shared call-order log (not just toHaveBeenCalledWith in isolation).
 *  - setupIssues "resume, not dead-end": a resolveLevelChoice rejection
 *    still lets the player reach Spells/Review with a persistent callout;
 *    Retry re-attempts and clears it once it succeeds.
 *  - Keyboard/focus: entering Subclass/Rung moves focus to the step heading
 *    (the existing generic headingRef effect, exercised per-step here).
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

// Shared call-order log — every mock below pushes its own tag onto this
// array the moment it's invoked, so ordering assertions don't rely on
// jest's per-mock call-index bookkeeping alone.
let callLog: string[] = [];

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
  createCharacter: (...args: unknown[]) => {
    callLog.push('createCharacter');
    return mockCreateCharacter(...args);
  },
  getStartingEquipment: (...args: unknown[]) => mockGetStartingEquipment(...args),
  getCatalog: (...args: unknown[]) => mockGetCatalog(...args),
  resolveLevelChoice: (...args: unknown[]) => {
    callLog.push('resolveLevelChoice');
    return mockResolveLevelChoice(...args);
  },
  getFeaturePicks: (...args: unknown[]) => {
    callLog.push('getFeaturePicks');
    return mockGetFeaturePicks(...args);
  },
  learnFeaturePick: (...args: unknown[]) => {
    callLog.push('learnFeaturePick');
    return mockLearnFeaturePick(...args);
  },
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

const FIGHTER = {
  id: 'fighter',
  name: 'Fighter',
  hitDie: 10,
  saves: ['strength', 'constitution'] as ['strength', 'constitution'],
  icon: 'Fighter' as const,
  accent: 'var(--cool)',
  flavor: 'Hit it until it stops.',
  isCaster: false,
  primary: ['strength', 'dexterity'] as ['strength', 'dexterity'],
  // No subclassLevel — SRD fighter's is 3, out of scope for creation.
};

// TAV-WIZARD-HOMEBREW-CASTERS fixture: Naruto-shaped homebrew points caster
// with BOTH a Subclass step (subclassLevel:1) and a freeform Rung menu
// (knownAtLevel1:1), two archetype-tagged options.
const SHINOBI = {
  id: 'shinobi',
  name: 'Shinobi',
  hitDie: 8,
  saves: ['dexterity', 'wisdom'] as ['dexterity', 'wisdom'],
  icon: 'Rogue' as const,
  accent: 'var(--good)',
  flavor: 'Chakra is a budget.',
  isCaster: true,
  casterKind: 'known' as const,
  castingModel: 'points' as const,
  pointsLabel: 'Chakra',
  primary: ['wisdom', 'dexterity'] as ['wisdom', 'dexterity'],
  spellcastingAbility: 'wisdom' as const,
  subclassLevel: 1,
  rungMenu: {
    label: 'Path Technique',
    freeform: true,
    knownAtLevel1: 1,
    options: [
      {
        slug: 'flame-bullet',
        name: 'Flame Bullet',
        level: 1,
        subclass: 'ninjutsu-specialist',
        description: 'Rung I · D-rank (2 CP) · a cone of chakra-fed flame.',
      },
      { slug: 'gale-palm', name: 'Gale Palm', level: 1, subclass: 'ninjutsu-specialist' },
      { slug: 'iron-fist', name: 'Iron Fist', level: 1, subclass: 'taijutsu-specialist' },
      // Kage-CR BLOCKING-1: a level-3 option, archetype-matched but ABOVE
      // creation's fixed level 1 — must never render as a pickable
      // checkbox even though its subclass tag matches.
      {
        slug: 'great-fireball',
        name: 'Great Fireball',
        level: 3,
        subclass: 'ninjutsu-specialist',
      },
    ],
  },
};

// A subclassLevel:1 class with NO rung menu — Subclass without Rung.
const CLERIC = {
  id: 'cleric',
  name: 'Cleric',
  hitDie: 8,
  saves: ['wisdom', 'charisma'] as ['wisdom', 'charisma'],
  icon: 'Cleric' as const,
  accent: 'var(--accent-3)',
  flavor: 'Mend, smite, repeat.',
  isCaster: true,
  casterKind: 'prepared' as const,
  castingModel: 'slots' as const,
  primary: ['wisdom'] as ['wisdom'],
  spellcastingAbility: 'wisdom' as const,
  subclassLevel: 1,
};

// A subclassLevel:1 class whose Rung menu is NOT freeform (level-up-only).
const LEGACY_CASTER = {
  id: 'legacy-caster',
  name: 'Legacy Caster',
  hitDie: 8,
  saves: ['intelligence', 'wisdom'] as ['intelligence', 'wisdom'],
  icon: 'Wizard' as const,
  accent: 'var(--cool)',
  flavor: 'An older menu.',
  isCaster: true,
  casterKind: 'known' as const,
  castingModel: 'slots' as const,
  primary: ['intelligence'] as ['intelligence'],
  spellcastingAbility: 'intelligence' as const,
  subclassLevel: 1,
  rungMenu: {
    label: 'Old Menu',
    freeform: false,
    knownAtLevel1: 2,
    options: [{ slug: 'old-trick', name: 'Old Trick', level: 1 }],
  },
};

const defaultCatalog = {
  status: 'ok' as const,
  retry: jest.fn(),
  data: {
    races: [HUMAN],
    classes: [FIGHTER, SHINOBI, CLERIC, LEGACY_CASTER],
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
    /* no chunks -> deterministic fallback line */
  }),
}));

import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import CharacterNewPage from '../../app/character/new/page';
import { makeApiError } from '../../lib/api/client';
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

const SHINOBI_SUBCLASSES = {
  system: 'dnd5e',
  content_type: 'subclass',
  total: 2,
  limit: 500,
  offset: 0,
  items: [
    {
      slug: 'ninjutsu-specialist',
      name: 'Ninjutsu Specialist',
      content_type: 'subclass',
      source_type: 'homebrew',
      data: { class: 'shinobi', description: 'Chakra shaped into technique.' },
    },
    {
      slug: 'taijutsu-specialist',
      name: 'Taijutsu Specialist',
      content_type: 'subclass',
      source_type: 'homebrew',
      data: { class: 'shinobi', description: 'The body IS the weapon.' },
    },
  ],
};

const SHINOBI_AVAILABLE = {
  cantrips: [],
  by_level: { '1': [] },
  can_learn: true,
  can_prepare: false,
  budget: {
    cantrips_known: 0,
    cantrips_max: 0,
    spells_known: 0,
    spells_max: 0,
    prepared_used: 0,
    prepared_max: 0,
  },
};

beforeEach(() => {
  callLog = [];
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
  mockGetCatalog.mockResolvedValue(SHINOBI_SUBCLASSES);
  mockGetAvailableSpells.mockResolvedValue(SHINOBI_AVAILABLE);
  mockResolveLevelChoice.mockResolvedValue({ message: 'ok' });
  mockGetFeaturePicks.mockResolvedValue({
    menu_label: 'Path Technique',
    freeform: true,
    budget: { known: 0, cap: 1 },
    known: [],
    // Kage-CR #8: eligible is the server-authoritative reconciliation set —
    // must include whatever the fixture's default flow actually picks
    // (Flame Bullet) or applyPendingSetup would correctly refuse to attempt it.
    eligible: [{ slug: 'flame-bullet', name: 'Flame Bullet', level: 1 }],
  });
  mockLearnFeaturePick.mockResolvedValue({ learned: 'flame-bullet', menu_label: 'Path Technique', known: ['flame-bullet'] });
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
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Velka' } });
  fireEvent.click(screen.getByRole('radio', { name: /Acolyte/i }));
}

describe('Subclass step presence (TAV-WIZARD-HOMEBREW-CASTERS)', () => {
  it('is ABSENT for a class without subclassLevel:1 (fighter) — byte-identical to before', () => {
    renderWizard();
    pickRace();
    pickClass(/Fighter/i);
    // Straight to Abilities — "Archetype" never appears as a rail step.
    expect(screen.queryByText('Archetype')).not.toBeInTheDocument();
    expect(screen.getByText(/How are you wired/i)).toBeInTheDocument();
  });

  it('is PRESENT for a class with subclassLevel:1 (cleric) even with no Rung menu', async () => {
    // The shared subclass-catalog mock only tags rows to 'shinobi', so
    // Cleric legitimately renders the content-bug empty state here — this
    // test's assertion is purely about the STEP existing at all (gated on
    // subclassLevel===1), not about a successful pick.
    renderWizard();
    pickRace();
    pickClass(/Cleric/i);
    expect(await screen.findByText(/And which path do you follow/i)).toBeInTheDocument();
  });

  it('moves focus to the Subclass step heading on entry (a11y)', async () => {
    renderWizard();
    pickRace();
    pickClass(/Shinobi/i);
    const heading = await screen.findByRole('heading', { name: /And which path do you follow/i });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('content-bug empty state: subclassLevel:1 but zero seeded subclass rows — Continue stays disabled', async () => {
    mockGetCatalog.mockResolvedValue({ ...SHINOBI_SUBCLASSES, items: [], total: 0 });
    renderWizard();
    pickRace();
    pickClass(/Shinobi/i);
    expect(await screen.findByText(/No archetypes are seeded for Shinobi yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('a failed subclass fetch offers a REAL Retry (Kage-CR IMPORTANT-2, not "go back and forward")', async () => {
    mockGetCatalog.mockRejectedValueOnce(new Error('network down'));
    renderWizard();
    pickRace();
    pickClass(/Shinobi/i);
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();

    mockGetCatalog.mockResolvedValue(SHINOBI_SUBCLASSES);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('radio', { name: /Ninjutsu Specialist/i })).toBeInTheDocument();
  });

  it('fetches with limit:500 (Kage-CR IMPORTANT-2 — the 69-row catalog must not silently truncate against a smaller default)', async () => {
    renderWizard();
    pickRace();
    pickClass(/Shinobi/i);
    await screen.findByText(/And which path do you follow/i);
    expect(mockGetCatalog).toHaveBeenCalledWith(
      'dnd5e',
      { type: 'subclass', limit: 500 },
      expect.anything(),
    );
  });
});

describe('Rung step (TAV-WIZARD-HOMEBREW-CASTERS)', () => {
  async function advanceToRung() {
    renderWizard();
    pickRace();
    pickClass(/Shinobi/i);
    await screen.findByText(/And which path do you follow/i);
    fireEvent.click(screen.getByRole('radio', { name: /Ninjutsu Specialist/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: /What do you already know how to do/i });
  }

  it('options are filtered to the chosen archetype tag (untagged always shown, other tags hidden)', async () => {
    await advanceToRung();
    expect(screen.getByRole('checkbox', { name: /Flame Bullet/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Gale Palm/i })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Iron Fist/i })).not.toBeInTheDocument();
  });

  // Kage-CR BLOCKING-1: the engine refuses any option whose declared level
  // exceeds the character's (always 1 at creation) level — archetype
  // scoping alone isn't the whole gate.
  it('excludes an archetype-matched option above level 1 (engine refuses it with option_level_unmet)', async () => {
    await advanceToRung();
    expect(screen.queryByRole('checkbox', { name: /Great Fireball/i })).not.toBeInTheDocument();
  });

  it('moves focus to the Rung step heading on entry (a11y)', async () => {
    await advanceToRung();
    const heading = screen.getByRole('heading', { name: /What do you already know how to do/i });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('enforces the exact pick count (cap 1) — a second pick is disabled, Continue gates on it', async () => {
    await advanceToRung();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Flame Bullet/i }));
    expect(screen.getByLabelText('1 of 1 Path Technique chosen')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Gale Palm/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  // Iro-A11y CRITICAL-1/MAJOR-1: mirrors SpellsStep.renderRow's own
  // TAV-A11Y-CAP-HINT pattern exactly.
  it('associates a description as the checkbox\'s accessible description', async () => {
    await advanceToRung();
    const flameBullet = screen.getByRole('checkbox', { name: /Flame Bullet/i });
    expect(flameBullet).toHaveAccessibleDescription(/cone of chakra-fed flame/i);
  });

  it('references the hidden cap hint when a checkbox is disabled at cap, not when enabled', async () => {
    await advanceToRung();
    const flameBullet = screen.getByRole('checkbox', { name: /Flame Bullet/i });
    const galePalm = screen.getByRole('checkbox', { name: /Gale Palm/i });
    // Below cap: neither checkbox is disabled, so neither references the
    // cap hint (Gale Palm has no description either, so its describedby is
    // entirely absent at this point).
    expect(flameBullet).not.toHaveAttribute('aria-describedby', expect.stringContaining('rung-cap-hint'));
    fireEvent.click(flameBullet);
    // At cap: the now-disabled Gale Palm checkbox must reference the hidden
    // hint — WCAG 4.1.2/3.3.2, the whole point of the fix (native `disabled`
    // drops a row from the Tab order, so the reason has to be discoverable
    // another way).
    expect(galePalm).toHaveAttribute('aria-describedby', expect.stringContaining('rung-cap-hint'));
    // The hint text is split across a fragment ({menuLabelPlural(cap)} sits
    // between two literal text nodes) — read the element directly rather
    // than pattern-matching a single text node.
    expect(document.getElementById('rung-cap-hint')?.textContent).toMatch(
      /You.ve chosen all 1 Path Technique — deselect one to pick another/i,
    );
  });

  it('a non-freeform menu renders read-only with no pickable options', async () => {
    mockGetCatalog.mockResolvedValue({
      ...SHINOBI_SUBCLASSES,
      items: [
        {
          slug: 'old-school',
          name: 'Old School',
          content_type: 'subclass',
          source_type: 'homebrew',
          data: { class: 'legacy-caster', description: 'Pre-freeform.' },
        },
      ],
    });
    renderWizard();
    pickRace();
    pickClass(/Legacy Caster/i);
    await screen.findByText(/And which path do you follow/i);
    fireEvent.click(screen.getByRole('radio', { name: /Old School/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByText(/isn.t ready to pick here yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    // Read-only step never blocks Continue.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});

describe('Silent-create call order (TAV-WIZARD-HOMEBREW-CASTERS)', () => {
  async function advanceToEquipmentContinue() {
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-1' });
    renderWizard();
    pickRace();
    pickClass(/Shinobi/i);
    await screen.findByText(/And which path do you follow/i);
    fireEvent.click(screen.getByRole('radio', { name: /Ninjutsu Specialist/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Rung
    await screen.findByRole('heading', { name: /What do you already know how to do/i });
    fireEvent.click(screen.getByRole('checkbox', { name: /Flame Bullet/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Abilities
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
  }

  it('resolves the archetype BEFORE fetching feature picks, and learns the picked technique after', async () => {
    await advanceToEquipmentContinue();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // creates!
    });

    await waitFor(() => expect(mockLearnFeaturePick).toHaveBeenCalled());
    expect(callLog).toEqual([
      'createCharacter',
      'resolveLevelChoice',
      'getFeaturePicks',
      'learnFeaturePick',
    ]);
    expect(mockResolveLevelChoice).toHaveBeenCalledWith('char-1', 'alice', 'subclass:1', {
      subclass: 'ninjutsu-specialist',
    });
    expect(mockGetFeaturePicks).toHaveBeenCalledWith('char-1', 'alice');
    expect(mockLearnFeaturePick).toHaveBeenCalledWith('char-1', 'alice', 'flame-bullet');
  });

  it('a pick already known server-side (per getFeaturePicks) is NOT re-submitted to learnFeaturePick', async () => {
    mockGetFeaturePicks.mockResolvedValue({
      menu_label: 'Path Technique',
      freeform: true,
      budget: { known: 1, cap: 1 },
      known: [{ slug: 'flame-bullet', name: 'Flame Bullet', level: 1 }],
      eligible: [],
    });
    await advanceToEquipmentContinue();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    await waitFor(() => expect(mockGetFeaturePicks).toHaveBeenCalled());
    expect(mockLearnFeaturePick).not.toHaveBeenCalled();
  });

  it('a picked technique NOT in the server-authoritative eligible list is never attempted and counts as a real failure (Kage-CR #8)', async () => {
    mockGetFeaturePicks.mockResolvedValue({
      menu_label: 'Path Technique',
      freeform: true,
      budget: { known: 0, cap: 1 },
      known: [],
      // flame-bullet picked client-side but NOT server-eligible (e.g. a
      // stale catalog vs. a since-changed subclass) — must be refused
      // without ever calling learnFeaturePick.
      eligible: [],
    });
    await advanceToEquipmentContinue();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    await waitFor(() => expect(mockGetFeaturePicks).toHaveBeenCalled());
    expect(mockLearnFeaturePick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review
    expect(await screen.findByText('Setup incomplete')).toBeInTheDocument();
    expect(screen.getByText(/1 starting technique couldn.t be learned/i)).toBeInTheDocument();
  });

  it('already_chosen on resolveLevelChoice is treated as success, not a failure to retry forever (Kage-CR #3)', async () => {
    mockResolveLevelChoice.mockRejectedValueOnce(
      makeApiError(400, '400', { message: 'Already chosen', data: { reason: 'already_chosen' } }),
    );
    await advanceToEquipmentContinue();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // creates!
    });

    // The rung apply still runs — subclassOk flips true on already_chosen —
    // and no setupIssues callout is raised for the archetype at all.
    await waitFor(() => expect(mockLearnFeaturePick).toHaveBeenCalledWith('char-1', 'alice', 'flame-bullet'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review
    expect(screen.queryByText('Setup incomplete')).not.toBeInTheDocument();
  });

  it('duplicate_option on learnFeaturePick is treated as success, not a real failure (Kage-CR #3)', async () => {
    mockLearnFeaturePick.mockRejectedValueOnce(
      makeApiError(400, '400', { message: 'Already known', data: { reason: 'duplicate_option' } }),
    );
    await advanceToEquipmentContinue();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // creates!
    });
    await waitFor(() => expect(mockLearnFeaturePick).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review
    expect(screen.queryByText('Setup incomplete')).not.toBeInTheDocument();
  });
});

describe('setupIssues — resume, not dead-end (TAV-WIZARD-HOMEBREW-CASTERS)', () => {
  async function advanceToEquipmentContinue() {
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-2' });
    renderWizard();
    pickRace();
    pickClass(/Shinobi/i);
    await screen.findByText(/And which path do you follow/i);
    fireEvent.click(screen.getByRole('radio', { name: /Ninjutsu Specialist/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: /What do you already know how to do/i });
    fireEvent.click(screen.getByRole('checkbox', { name: /Flame Bullet/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
  }

  it('a resolveLevelChoice failure never strands the player — character exists, Spells is still reachable, Review shows a callout', async () => {
    mockResolveLevelChoice.mockRejectedValueOnce(new Error('boom'));
    await advanceToEquipmentContinue();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // creates!
    });

    // Character exists (createCharacter WAS called) and the rung apply is
    // correctly SKIPPED this pass (scoping would be wrong without a resolved
    // archetype) — getFeaturePicks/learnFeaturePick never fire.
    await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(1));
    expect(mockGetFeaturePicks).not.toHaveBeenCalled();
    expect(mockLearnFeaturePick).not.toHaveBeenCalled();

    // Never a dead end: Spells step (isCaster) is still reached.
    expect(await screen.findByText(/Runs on Chakra/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review
    expect(await screen.findByText('Setup incomplete')).toBeInTheDocument();
    expect(screen.getByText(/archetype couldn.t be saved/i)).toBeInTheDocument();
    expect(screen.getByText(/starting techniques couldn.t be picked/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry setup' })).toBeInTheDocument();
  });

  it('Retry setup re-attempts and clears the callout once it succeeds', async () => {
    mockResolveLevelChoice.mockRejectedValueOnce(new Error('boom'));
    await advanceToEquipmentContinue();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review
    await screen.findByText('Setup incomplete');

    // Iro-A11y MINOR-2: the retry button's accessible description is the
    // outstanding-issues list, not just its own label.
    expect(screen.getByRole('button', { name: 'Retry setup' })).toHaveAccessibleDescription(
      /archetype couldn.t be saved/i,
    );

    // Retry succeeds this time (mockResolveLevelChoice's default resolved
    // value from beforeEach applies to every subsequent call).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }));
    });

    await waitFor(() => expect(mockLearnFeaturePick).toHaveBeenCalledWith('char-2', 'alice', 'flame-bullet'));
    expect(screen.queryByText('Setup incomplete')).not.toBeInTheDocument();
    // Iro-A11y MINOR-3: a successful retry fires the existing role="status"
    // Toast — the callout unmounting alone gives AT no confirmation.
    // The warn-toned "needs a follow-up" toast from the earlier failure may
    // still be visible (role="status" too — only 'error' tone gets 'alert')
    // — assert the success message rendered, not a single ambiguous role.
    expect(await screen.findByText(/Setup finished/i)).toBeInTheDocument();
    // Both the rail summary AND the Review "Archetype"/"Techniques" pills
    // render this text — assert at least one instance exists rather than
    // picking a single (ambiguous) element.
    expect(screen.getAllByText('Ninjutsu Specialist').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Flame Bullet').length).toBeGreaterThan(0);
  });

  it('a repeated identical failure re-announces via an attempt counter (MINOR-4)', async () => {
    mockResolveLevelChoice.mockRejectedValue(new Error('boom'));
    await advanceToEquipmentContinue();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review
    await screen.findByText('Setup incomplete');
    expect(screen.queryByText(/attempt 2/i)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }));
    });

    // Same failure again — the callout's own text now differs (the attempt
    // counter), which is what makes role="alert" re-announce it at all.
    expect(await screen.findByText(/Setup incomplete \(attempt 2\)/i)).toBeInTheDocument();
  });
});
