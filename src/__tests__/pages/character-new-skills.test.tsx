/**
 * Tests for ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP — the Skills step and the
 * post-create `skills:1` apply sequence (src/app/character/new/page.tsx).
 *
 * Covers:
 *  - Skills step presence: gated on WizardClass.skillCount > 0 && the
 *    class declares a non-empty skillChoices pool; absent (byte-identical
 *    to before) for a class with neither.
 *  - Options exclude whatever the CHOSEN background already grants, even
 *    though the skill is in the class's own pool (mirrors the engine's own
 *    exclusion rule client-side).
 *  - Count comes from the class row (skillCount); Continue gates on exactly
 *    that many picks.
 *  - Fail-closed: a class whose entire pool the background already covers
 *    renders an empty state and Continue stays disabled with a reason.
 *  - The apply sequence resolves `skills:1` — both via the SLOW path (a
 *    class with no other reason to silent-create, resolved at Review's
 *    final submit) and the FAST path (a class that already silent-creates
 *    early for another reason, e.g. isCaster).
 *  - Coordinator note (2026-09-08): the choice's absence from the real
 *    sheet post-create (the engine queued nothing — e.g. a homebrew class
 *    row lacking skill_count server-side) is NOT a failure — never assumed
 *    from the wizard's own pre-render catalog copy.
 *  - A resolveLevelChoice(skills:1) refusal surfaces a setup-issues
 *    callout; already_chosen is treated as an idempotent success.
 *  - Review renders the picked skills under "Skills (class)".
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
const mockGetCharacterSheet = jest.fn();
const mockGetAvailableSpells = jest.fn();
const mockLearnSpell = jest.fn();
const mockPrepareSpell = jest.fn();
const mockDeleteCharacter = jest.fn();

jest.mock('../../lib/api/dnd', () => ({
  createCharacter: (...args: unknown[]) => mockCreateCharacter(...args),
  getStartingEquipment: (...args: unknown[]) => mockGetStartingEquipment(...args),
  getCatalog: (...args: unknown[]) => mockGetCatalog(...args),
  resolveLevelChoice: (...args: unknown[]) => mockResolveLevelChoice(...args),
  getCharacterSheet: (...args: unknown[]) => mockGetCharacterSheet(...args),
  getFeaturePicks: jest.fn(),
  learnFeaturePick: jest.fn(),
  getAvailableSpells: (...args: unknown[]) => mockGetAvailableSpells(...args),
  learnSpell: (...args: unknown[]) => mockLearnSpell(...args),
  prepareSpell: (...args: unknown[]) => mockPrepareSpell(...args),
  deleteCharacter: (...args: unknown[]) => mockDeleteCharacter(...args),
}));

// A non-caster, non-subclass, non-rung class — ONLY a skill_choices pool.
// Isolates the Skills step's own apply sequence from Subclass/Rung/Spells
// entirely. `insight` deliberately overlaps the Acolyte background's own
// skills (see defaultCatalog below) so exclusion is exercised by default.
const SCOUT = {
  id: 'scout',
  name: 'Scout',
  hitDie: 8,
  saves: ['dexterity', 'wisdom'] as ['dexterity', 'wisdom'],
  icon: 'Rogue' as const,
  accent: 'var(--good)',
  flavor: 'Sees it before it sees you.',
  isCaster: false,
  primary: ['dexterity', 'wisdom'] as ['dexterity', 'wisdom'],
  // 'animal_handling' is deliberately in the pool (unused by the default
  // athletics+perception flow) so a single test can pin the wire-shape-
  // normalization case (Kage-CR pin, 2026-09-08) without a new fixture.
  skillChoices: ['acrobatics', 'athletics', 'animal_handling', 'insight', 'perception', 'stealth', 'survival'],
  skillCount: 2,
};

// A class whose ENTIRE skill pool is already granted by the (only) seeded
// background — the fail-closed case: nothing is left to pick.
const DEVOTEE = {
  id: 'devotee',
  name: 'Devotee',
  hitDie: 8,
  saves: ['wisdom', 'charisma'] as ['wisdom', 'charisma'],
  icon: 'Cleric' as const,
  accent: 'var(--accent-3)',
  flavor: 'Already knows what the Acolyte knows.',
  isCaster: false,
  primary: ['wisdom'] as ['wisdom'],
  skillChoices: ['insight', 'religion'],
  skillCount: 2,
};

// A class with NEITHER skillChoices nor skillCount — the Skills step must
// be absent, byte-identical to pre-ORACLE-CANDIDATE-1 behaviour.
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
};

// A CASTER with a skill pool too — proves the EARLY silent-create path
// (Equipment -> next) resolves skills:1 as part of the SAME sequence as
// spells, not just the late Review-submit path SCOUT exercises.
const SORCERER = {
  id: 'sorcerer',
  name: 'Sorcerer',
  hitDie: 6,
  saves: ['constitution', 'charisma'] as ['constitution', 'charisma'],
  icon: 'Sorcerer' as const,
  accent: 'var(--crit)',
  flavor: 'Magic in the blood.',
  isCaster: true,
  casterKind: 'known' as const,
  castingModel: 'slots' as const,
  primary: ['charisma'] as ['charisma'],
  spellcastingAbility: 'charisma' as const,
  skillChoices: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'],
  skillCount: 2,
};

// Kage-CR follow-up (2026-09-08), pin #1: a class row that declares a
// skill_choices POOL but skill_count: 0 — hasSkillsStep must gate on BOTH
// (`skillCount > 0 && skillChoices.length > 0`), not skillChoices alone.
const NO_PICKS_CLASS = {
  id: 'no-picks',
  name: 'Herald',
  hitDie: 8,
  saves: ['wisdom', 'charisma'] as ['wisdom', 'charisma'],
  icon: 'Cleric' as const,
  accent: 'var(--accent-3)',
  flavor: 'Knows everything already, apparently.',
  isCaster: false,
  primary: ['wisdom'] as ['wisdom'],
  skillChoices: ['insight', 'religion', 'persuasion'],
  skillCount: 0,
};

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
  skillProficiencies: [] as string[],
};

// RACE-SKILLS-STAMP / Iro live-walk follow-up (2026-09-09) — SRD Elf's
// Keen Senses grants Perception at the RACE level (verified against
// NekoNova-DnDEngine engine/races.py: skill_proficiencies=["perception"]
// on the base race, no subrace involvement). No subraces here — kept
// minimal so these tests isolate the race-exclusion mirror from the
// subrace picker entirely.
const ELF = {
  id: 'elf',
  name: 'Elf',
  sub: 'keen-eyed · quick',
  bonusLabel: '+2 DEX',
  bonuses: { dexterity: 2 },
  speed: 30,
  icon: 'Users' as const,
  subraces: [],
  needsAsiChoice: false,
  skillProficiencies: ['perception'],
};

// leon-fairytail-5e's ft-human row (verified live, 2026-09-08):
// skill_proficiencies: ['persuasion'] — the exact repro from Iro's live
// walk (an FT Caster's Persuasion pick was excluded server-side by this
// grant, not by the class's own list).
// Named to avoid colliding with pickRace()'s `/Human/i` radio matcher
// (same discipline as the class-name collisions elsewhere in this file).
const FT_HUMAN = {
  id: 'ft-human',
  name: 'Fiore Native',
  sub: 'ordinary · determined',
  bonusLabel: '+1 to all',
  bonuses: { strength: 1, dexterity: 1, constitution: 1, intelligence: 1, wisdom: 1, charisma: 1 },
  speed: 30,
  icon: 'Users' as const,
  subraces: [],
  needsAsiChoice: false,
  skillProficiencies: ['persuasion'],
};

const defaultCatalog = {
  status: 'ok' as const,
  retry: jest.fn(),
  data: {
    races: [HUMAN, ELF, FT_HUMAN],
    classes: [SCOUT, DEVOTEE, FIGHTER, SORCERER, NO_PICKS_CLASS],
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

const SORCERER_AVAILABLE = {
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

// Default sheet a `getCharacterSheet` call returns post-create — carries the
// `skills:1` pending choice (the engine's normal case) unless a test
// overrides it (e.g. to prove the "absence is not a failure" behaviour).
// `options` defaults to Scout's own pool (Kage-CR follow-up, 2026-09-08:
// applyPendingSetup now validates picks against THIS authoritative,
// server-enriched list before resolving) — a test exercising a different
// class's picks (e.g. Sorcerer) passes its own pool explicitly.
const SCOUT_POOL = ['acrobatics', 'athletics', 'insight', 'perception', 'stealth', 'survival'];
function sheetWithPendingSkills(count = 2, options: string[] = SCOUT_POOL) {
  return {
    name: 'Velka',
    pending_choices: [
      { id: 'skills:1', type: 'skills', level: 1, class: 'Scout', count, label: `Choose ${count} class skills`, options },
    ],
  };
}

beforeEach(() => {
  mockPush.mockReset();
  mockCreateCharacter.mockReset();
  mockGetStartingEquipment.mockReset();
  mockGetCatalog.mockReset();
  mockResolveLevelChoice.mockReset();
  mockGetCharacterSheet.mockReset();
  mockGetAvailableSpells.mockReset();
  mockLearnSpell.mockReset();
  mockPrepareSpell.mockReset();
  mockDeleteCharacter.mockReset();
  mockGetStartingEquipment.mockResolvedValue(EMPTY_EQUIPMENT);
  mockGetAvailableSpells.mockResolvedValue(SORCERER_AVAILABLE);
  mockResolveLevelChoice.mockResolvedValue({ message: 'ok' });
  mockGetCharacterSheet.mockResolvedValue(sheetWithPendingSkills());
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

describe('Skills step presence (ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP)', () => {
  it('is ABSENT for a class with no skill_choices/skill_count (fighter) — byte-identical to before, and resolveLevelChoice is never called at submit', async () => {
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-fighter' });
    renderWizard();
    pickRace();
    pickClass(/Fighter/i);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment directly
    expect(screen.queryByText('What are you actually good at?')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/What did you bring/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Begin your campaign/i }));
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-fighter'));
    // No skills:1 (or any) resolve was ever attempted for a class with
    // nothing to resolve — getCharacterSheet's presence-check is the
    // absence-tolerant path (see the "coordinator note" test below); a
    // class that never even RENDERS the step must not reach that path at
    // all, since hasSubclassStep/hasRungStep/hasSkillsStep are all false.
    expect(mockGetCharacterSheet).not.toHaveBeenCalled();
    expect(mockResolveLevelChoice).not.toHaveBeenCalled();
  });

  // Kage-CR follow-up (2026-09-08), pin #1: skill_choices PRESENT but
  // skill_count: 0 — hasSkillsStep must gate on BOTH fields, not the pool
  // alone (a mutation dropping the `skillCount > 0` half of that AND would
  // otherwise still show a Skills step, and worse, still attempt a resolve
  // with cap 0).
  it('is ABSENT for a class whose skill_choices pool is non-empty but skill_count is 0', async () => {
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-herald' });
    renderWizard();
    pickRace();
    pickClass(/Herald/i);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment directly
    expect(screen.queryByText('What are you actually good at?')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/What did you bring/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Begin your campaign/i }));
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-herald'));
    expect(mockGetCharacterSheet).not.toHaveBeenCalled();
    expect(mockResolveLevelChoice).not.toHaveBeenCalled();
  });

  it('is PRESENT for a class with a declared skill pool (scout)', async () => {
    renderWizard();
    pickRace();
    pickClass(/Scout/i);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Skills
    expect(await screen.findByText('What are you actually good at?')).toBeInTheDocument();
  });
});

describe('Skills step derivation (ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP)', () => {
  async function advanceToSkills(className: RegExp) {
    renderWizard();
    pickRace();
    pickClass(className);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Skills
    await screen.findByText('What are you actually good at?');
  }

  it("options exclude the chosen background's skills even though they overlap the class pool", async () => {
    await advanceToSkills(/Scout/i);
    // insight is BOTH in Scout's pool and Acolyte's background skills.
    expect(screen.queryByRole('checkbox', { name: /^Insight$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Athletics/i })).toBeInTheDocument();
  });

  it('count comes from the class row (skillCount)', async () => {
    await advanceToSkills(/Scout/i);
    expect(screen.getByLabelText('0 of 2 skills chosen')).toBeInTheDocument();
  });

  it('Continue is disabled until exactly skillCount picks are made', async () => {
    await advanceToSkills(/Scout/i);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Athletics/i }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Perception/i }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('a third pick is disabled once the cap is reached', async () => {
    await advanceToSkills(/Scout/i);
    fireEvent.click(screen.getByRole('checkbox', { name: /Athletics/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Perception/i }));
    expect(screen.getByRole('checkbox', { name: /Stealth/i })).toBeDisabled();
  });

  it('fail-closed: a class whose entire pool is already granted by the background renders an empty state and disables Continue', async () => {
    await advanceToSkills(/Devotee/i);
    expect(screen.getByText(/No class skills left to choose/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

// RACE-SKILLS-STAMP / Iro live-walk follow-up (2026-09-09): the engine now
// stamps the chosen race's + subrace's own skill_proficiencies into
// proficient_skills at creation, BEFORE the class's skills:1 choice is
// queued (NekoNova-DnDEngine engine/commands/character_msm.py's
// build_level1_character) — so its authoritative options pool already
// excludes a race grant. The Skills step's own options must mirror that,
// or the player is offered a guaranteed-wasted (Elf Ranger/Perception) or
// outright refusable (FT Human/Persuasion) pick.
describe('Skills step — race/subrace exclusion (RACE-SKILLS-STAMP follow-up)', () => {
  async function advanceToSkillsWithRace(raceName: RegExp, className: RegExp) {
    renderWizard();
    fireEvent.click(screen.getByRole('radio', { name: raceName }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Class
    pickClass(className);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Skills
    await screen.findByText('What are you actually good at?');
  }

  it('Elf Ranger: Perception is absent from options — already granted by Keen Senses (race-level skill_proficiencies)', async () => {
    await advanceToSkillsWithRace(/Elf/i, /Scout/i);
    expect(screen.queryByRole('checkbox', { name: /^Perception$/i })).not.toBeInTheDocument();
    // The rest of Scout's pool (unaffected by the race grant) still renders.
    expect(screen.getByRole('checkbox', { name: /Athletics/i })).toBeInTheDocument();
  });

  it('FT Fiore human: Persuasion is absent from options — already granted by the race (Iro live-walk exact repro)', async () => {
    await advanceToSkillsWithRace(/Fiore Native/i, /Sorcerer/i);
    expect(screen.queryByRole('checkbox', { name: /^Persuasion$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Arcana/i })).toBeInTheDocument();
  });

  it('Review shows the race-granted skill under "Skills (race)"', async () => {
    await advanceToSkillsWithRace(/Elf/i, /Scout/i);
    fireEvent.click(screen.getByRole('checkbox', { name: /Athletics/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Stealth/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review
    expect(await screen.findByText('Skills (race)')).toBeInTheDocument();
    expect(screen.getAllByText('Perception').length).toBeGreaterThan(0);
  });

  // Iro live-walk follow-up (2026-09-09), pin #3: the MESSAGE the player
  // sees when a rejected pick is a race grant. `Perception` is picked while
  // Elf's OWN grant is (deliberately, for this one test) temporarily
  // emptied so the real checkbox UI still offers it — mirrors the drift
  // the server-side authoritative check exists to catch in the first
  // place (the client's picture of race grants disagreeing with the
  // engine's, e.g. a stale catalog fetch) — then the grant is restored
  // and the sheet's authoritative pending.options is set to match
  // (excluding Perception, same as the engine would once it knows about
  // the grant) before the resolve is attempted. Read-before-green: on
  // main (round-4 code), an invalid pick ALWAYS got the generic "isn't on
  // this class's skill list anymore" wording, blaming the wrong thing.
  it('a rejected pick that IS a race grant gets "already granted by your race", not the generic wording', async () => {
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-elf' });
    const elfFixture = { ...ELF, skillProficiencies: [] as string[] };
    catalogOverride = {
      ...defaultCatalog,
      data: { ...defaultCatalog.data, races: [HUMAN, elfFixture, FT_HUMAN] },
    };
    await advanceToSkillsWithRace(/Elf/i, /Scout/i);
    fireEvent.click(screen.getByRole('checkbox', { name: /Perception/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Athletics/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review

    // The grant "arrives" (drift resolved) right before submit — the
    // sheet's authoritative options already reflect it.
    elfFixture.skillProficiencies = ['perception'];
    mockGetCharacterSheet.mockResolvedValue(sheetWithPendingSkills(2, ['athletics']));

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Begin your campaign/i }));
    });
    expect(mockResolveLevelChoice).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Perception is already granted by your race — pick another/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/isn.t on Scout.s skill list anymore/i)).not.toBeInTheDocument();
  });
});

describe('Skills apply sequence — slow path (no other silent-create trigger)', () => {
  async function advanceToReview() {
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-scout' });
    renderWizard();
    pickRace();
    pickClass(/Scout/i);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Skills
    await screen.findByText('What are you actually good at?');
    fireEvent.click(screen.getByRole('checkbox', { name: /Athletics/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Perception/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    // Scout has no reason to silent-create early — createCharacter must NOT
    // have been called yet reaching Equipment.
    expect(mockCreateCharacter).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review
    await screen.findByRole('button', { name: /Begin your campaign/i });
  }

  it('resolves skills:1 with the picked skills only at final submit, checking presence via the real sheet first', async () => {
    await advanceToReview();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });
    await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(1));
    expect(mockGetCharacterSheet).toHaveBeenCalledWith('char-scout', 'alice');
    expect(mockResolveLevelChoice).toHaveBeenCalledWith('char-scout', 'alice', 'skills:1', {
      picks: expect.arrayContaining(['athletics', 'perception']),
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-scout'));
  });

  it('Review shows the picked skills under "Skills (class)" before submit', async () => {
    await advanceToReview();
    expect(screen.getByText('Skills (class)')).toBeInTheDocument();
    expect(screen.getAllByText('Athletics').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Perception').length).toBeGreaterThan(0);
  });

  // Kage-CR follow-up (2026-09-08), pin #2: `cap = pending.count ??
  // clsObj?.skillCount ?? 0` — the SHEET's authoritative count must win over
  // the class row's own copy when they disagree. Scout's catalog row says
  // skillCount: 2 (the real UI lets the player pick exactly 2, no more), but
  // the SHEET's real pending choice says 3 — a genuine client/server
  // disagreement (e.g. a catalog edit landed between page load and create).
  // A mutation that flips the `??` precedence to prefer clsObj.skillCount
  // would see 2 === 2 and wrongly resolve; the correct code sees 2 !== 3
  // and refuses instead.
  it("uses the SHEET's authoritative pending.count over the class row's skillCount when they disagree", async () => {
    mockGetCharacterSheet.mockResolvedValue(sheetWithPendingSkills(3));
    await advanceToReview();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });
    await waitFor(() => expect(mockGetCharacterSheet).toHaveBeenCalled());
    expect(mockResolveLevelChoice).not.toHaveBeenCalled();
    expect(await screen.findByText('Setup incomplete')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  // Kage-CR follow-up (2026-09-08), suggestion 1: validate picks against
  // the AUTHORITATIVE `pending.options` (server-enriched, already excludes
  // proficient_skills) before ever attempting the resolve — closes obs #168
  // without re-deriving the exclusion rule. 'perception' is a real pick
  // (offered by the wizard's own client-side skillOptions mirror) but the
  // SERVER's enrichment doesn't offer it this time — a genuine drift the
  // client-side mirror alone can't catch.
  it("blocks the resolve when a pick isn't on the sheet's authoritative options, even though the wizard's own mirror offered it, and NAMES the offending skill in the callout (Kage-CR follow-up #3)", async () => {
    mockGetCharacterSheet.mockResolvedValue(
      sheetWithPendingSkills(2, ['acrobatics', 'athletics', 'insight', 'stealth', 'survival']),
    );
    await advanceToReview();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });
    await waitFor(() => expect(mockGetCharacterSheet).toHaveBeenCalled());
    expect(mockResolveLevelChoice).not.toHaveBeenCalled();
    // 'perception' is the pick NOT on the authoritative list — named, not a
    // generic "one of the picks" message.
    expect(await screen.findByText(/Perception isn.t on Scout.s skill list anymore/i)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  // Kage-CR follow-up #1 (CRITICAL): the engine's own enrichment
  // (`get_character_sheet_data`'s pending_choices loop) degrades to an
  // EMPTY pool on any exception ("display enrichment only") — an empty or
  // absent `pending.options` is NOT a refusal signal, since
  // `_resolve_skills_choice` re-derives the real pool server-side
  // regardless of what shipped on the sheet. Without the fail-open guard,
  // probes A1/A2 below permanently blocked creation: resolveLevelChoice was
  // never attempted, the callout never cleared, and "Retry setup" looped
  // forever against the same empty list.
  it('FAIL OPEN — probe A1: an EMPTY pending.options array is not a refusal signal, resolve IS attempted', async () => {
    mockGetCharacterSheet.mockResolvedValue({
      name: 'Velka',
      pending_choices: [
        { id: 'skills:1', type: 'skills', level: 1, class: 'Scout', count: 2, label: 'Choose 2 class skills', options: [] },
      ],
    });
    await advanceToReview();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });
    await waitFor(() =>
      expect(mockResolveLevelChoice).toHaveBeenCalledWith('char-scout', 'alice', 'skills:1', {
        picks: expect.arrayContaining(['athletics', 'perception']),
      }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-scout'));
    expect(screen.queryByText('Setup incomplete')).not.toBeInTheDocument();
  });

  it('FAIL OPEN — probe A2: pending.options ABSENT ENTIRELY (no key at all) is not a refusal signal, resolve IS attempted', async () => {
    mockGetCharacterSheet.mockResolvedValue({
      name: 'Velka',
      pending_choices: [
        { id: 'skills:1', type: 'skills', level: 1, class: 'Scout', count: 2, label: 'Choose 2 class skills' },
      ],
    });
    await advanceToReview();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });
    await waitFor(() =>
      expect(mockResolveLevelChoice).toHaveBeenCalledWith('char-scout', 'alice', 'skills:1', {
        picks: expect.arrayContaining(['athletics', 'perception']),
      }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-scout'));
    expect(screen.queryByText('Setup incomplete')).not.toBeInTheDocument();
  });

  // Kage-CR pin (2026-09-08): a wire-shape-mismatched entry on the
  // AUTHORITATIVE sheet ("Animal-Handling" — mixed case, a hyphen instead
  // of underscore) must still match the wizard's own picked slug
  // ("animal_handling") once both sides run through normalizeSkillSlug —
  // the exact normalization _resolve_skills_choice applies server-side.
  // Without it, this pick would falsely refuse despite being genuinely
  // valid.
  it('normalizes a wire-shape-mismatched pending.options entry before comparing — "Animal-Handling" matches a picked "animal_handling"', async () => {
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-scout' });
    mockGetCharacterSheet.mockResolvedValue(sheetWithPendingSkills(2, ['athletics', 'Animal-Handling']));
    renderWizard();
    pickRace();
    pickClass(/Scout/i);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Skills
    await screen.findByText('What are you actually good at?');
    fireEvent.click(screen.getByRole('checkbox', { name: /Athletics/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Animal Handling/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Begin your campaign/i }));
    });
    await waitFor(() =>
      expect(mockResolveLevelChoice).toHaveBeenCalledWith('char-scout', 'alice', 'skills:1', {
        picks: expect.arrayContaining(['athletics', 'animal_handling']),
      }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-scout'));
    expect(screen.queryByText('Setup incomplete')).not.toBeInTheDocument();
  });

  it('coordinator note: the choice being ABSENT from the real sheet after create is NOT a failure', async () => {
    mockGetCharacterSheet.mockResolvedValue({ name: 'Velka', pending_choices: [] });
    await advanceToReview();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });
    await waitFor(() => expect(mockGetCharacterSheet).toHaveBeenCalled());
    expect(mockResolveLevelChoice).not.toHaveBeenCalled();
    // No error surfaced, navigation still happens — genuinely nothing to do.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-scout'));
    expect(screen.queryByText('Setup incomplete')).not.toBeInTheDocument();
  });

  it('a resolveLevelChoice(skills:1) refusal on final submit STAYS on Review with the callout + Retry — never navigates away (Kage-CR follow-up, 2026-09-08)', async () => {
    mockResolveLevelChoice.mockRejectedValueOnce(new Error('boom'));
    await advanceToReview();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });

    // Character exists (createCharacter succeeded) but the apply failed —
    // the wizard must NOT navigate away and strand the player on a sheet
    // that never saw the callout/retry.
    await waitFor(() =>
      expect(mockResolveLevelChoice).toHaveBeenCalledWith('char-scout', 'alice', 'skills:1', {
        picks: expect.arrayContaining(['athletics', 'perception']),
      }),
    );
    expect(await screen.findByText('Setup incomplete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry setup' })).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();

    // A successful Retry finishes the submit the player already tried —
    // navigates straight to the sheet, no second "Begin your campaign" click.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }));
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-scout'));
  });

  // Kage-CR round-4 pin (2026-09-08): the delegated retry (handleSubmit
  // called again) must still bump retryAttempt on a REPEATED failure, or
  // the callout's text content never changes between attempts and
  // role="alert" silently fails to re-announce it (Iro-A11y MINOR-4's own
  // mechanism, otherwise bypassed on this now-majority final-submit path —
  // probe D). First failure: no "(attempt N)" suffix (retryAttempt starts
  // at 0). Second failure (via Retry, still rejecting): "(attempt 2)".
  it('a repeated failure on the final-submit path bumps retryAttempt so the callout text differs between attempts', async () => {
    mockResolveLevelChoice.mockRejectedValue(new Error('boom')); // fails EVERY call, not just once
    await advanceToReview();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });
    expect(await screen.findByText('Setup incomplete')).toBeInTheDocument();
    expect(screen.queryByText(/attempt 2/i)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }));
    });
    expect(await screen.findByText(/Setup incomplete \(attempt 2\)/i)).toBeInTheDocument();
  });

  // Kage-CR follow-up #5: pin no-duplicate-create directly — a second
  // "Begin your campaign" click (rather than "Retry setup") after a
  // blocked submit, with NOTHING changed since, must resume the SAME
  // character (characterId/createdSnapshot were stamped after the first
  // createNow(), see handleSubmit's own doc comment) rather than creating
  // a second one.
  it('a second "Begin your campaign" click after a blocked submit (no rename/drift) does NOT create a duplicate character', async () => {
    mockResolveLevelChoice.mockRejectedValueOnce(new Error('boom'));
    await advanceToReview();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });
    expect(await screen.findByText('Setup incomplete')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-scout'));
    expect(mockCreateCharacter).toHaveBeenCalledTimes(1);
  });

  // Kage-CR follow-up #2 (IMPORTANT): the old retry shortcut (bare
  // applyPendingSetup + a direct router.push) bypassed handleSubmit's own
  // F7 drift check entirely — a rename made AFTER a blocked submit was
  // silently discarded (probe B2). Retry must now resume the FULL submit
  // (handleSubmit itself), so the drift IS caught, a fresh character is
  // created with the new name, and the pre-rename character is cleaned up
  // (no orphan — same family as the F7 abandoned-wizard case).
  it('blocked submit -> Back -> rename -> Retry runs the F7 drift/recreate path: the NEW name lands and the stale character is deleted', async () => {
    mockCreateCharacter
      .mockResolvedValueOnce({ character_id: 'char-scout' })
      .mockResolvedValueOnce({ character_id: 'char-scout-2' });
    mockResolveLevelChoice.mockRejectedValueOnce(new Error('boom')); // blocks the FIRST submit only
    await advanceToReview();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });
    expect(await screen.findByText('Setup incomplete')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();

    // Back to Background via the rail (only already-visited steps are
    // clickable), rename, walk forward again to Review.
    fireEvent.click(screen.getByRole('button', { name: /Background/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Skills
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
    // Re-entering Equipment re-fetches (own fetch-on-mount effect) — same
    // wait advanceToReview's own first pass through this step needs.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review
    await screen.findByRole('button', { name: /Begin your campaign/i });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }));
    });

    await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(2));
    expect(mockCreateCharacter.mock.calls[1][0]).toEqual(expect.objectContaining({ name: 'Renamed' }));
    await waitFor(() => expect(mockDeleteCharacter).toHaveBeenCalledWith('char-scout', 'alice'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-scout-2'));
  });

  it('already_chosen on resolveLevelChoice(skills:1) is treated as success', async () => {
    mockResolveLevelChoice.mockRejectedValueOnce(
      makeApiError(400, '400', { message: 'Already chosen', data: { reason: 'already_chosen' } }),
    );
    await advanceToReview();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-scout'));
  });
});

describe('Skills apply sequence — fast path (a class that already silent-creates early)', () => {
  it('resolveLevelChoice(skills:1) fires as part of the SAME early silent-create sequence as spells (Equipment -> next)', async () => {
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-sorc' });
    mockGetCharacterSheet.mockResolvedValue(
      sheetWithPendingSkills(2, ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion']),
    );
    renderWizard();
    pickRace();
    pickClass(/Sorcerer/i);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Skills
    await screen.findByText('What are you actually good at?');
    fireEvent.click(screen.getByRole('checkbox', { name: /Arcana/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Deception/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // creates! -> Spells
    });

    // Character exists NOW (early silent create, unlike Scout's late path).
    await waitFor(() => expect(mockCreateCharacter).toHaveBeenCalledTimes(1));
    expect(mockGetCharacterSheet).toHaveBeenCalledWith('char-sorc', 'alice');
    expect(mockResolveLevelChoice).toHaveBeenCalledWith('char-sorc', 'alice', 'skills:1', {
      picks: expect.arrayContaining(['arcana', 'deception']),
    });
  });

  // Kage-CR follow-up #2 (IMPORTANT): the old retry shortcut never reached
  // handleSubmit's caster spell batch at all — a retried caster navigated
  // to their new sheet with an EMPTY spellbook despite having picked
  // cantrips/spells on the Spells step. Sequence: the early silent-create
  // apply fails (issues surfaced, but "resume, not dead-end" lets the
  // player continue to Spells anyway); the FIRST "Begin your campaign"
  // click re-attempts and fails again -> blocked, spell batch never
  // reached; "Retry setup" (now delegating to handleSubmit itself) succeeds
  // this time and DOES run the spell batch.
  it('a blocked submit-retry for a caster ALSO runs the spell batch (previously skipped by the old shortcut)', async () => {
    mockCreateCharacter.mockResolvedValue({ character_id: 'char-sorc' });
    mockGetCharacterSheet.mockResolvedValue(
      sheetWithPendingSkills(2, ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion']),
    );
    mockGetAvailableSpells.mockResolvedValue({
      cantrips: [
        { slug: 'fire-bolt', name: 'Fire Bolt', level: 0, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
      ],
      by_level: {
        '1': [
          { slug: 'magic-missile', name: 'Magic Missile', level: 1, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
        ],
      },
      can_learn: true,
      can_prepare: false,
      budget: {
        cantrips_known: 0,
        cantrips_max: 1,
        spells_known: 0,
        spells_max: 1,
        prepared_used: 0,
        prepared_max: 0,
      },
    });
    // 1st resolveLevelChoice call = the early silent-create apply (fails);
    // 2nd = handleSubmit's own re-attempt on the first "Begin your
    // campaign" click (fails again -> blocks); 3rd = the Retry-driven
    // handleSubmit rerun (succeeds — default mocked value from beforeEach).
    mockResolveLevelChoice
      .mockRejectedValueOnce(new Error('early apply failed'))
      .mockRejectedValueOnce(new Error('submit apply failed too'));

    renderWizard();
    pickRace();
    pickClass(/Sorcerer/i);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Background
    fillBackground();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Skills
    await screen.findByText('What are you actually good at?');
    fireEvent.click(screen.getByRole('checkbox', { name: /Arcana/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Deception/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // creates! early apply fails
    });
    await screen.findByRole('heading', { name: /What do you already know/i });
    fireEvent.click(screen.getByRole('checkbox', { name: /Fire Bolt/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Magic Missile/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Review
    await screen.findByRole('button', { name: /Begin your campaign/i });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i })); // 2nd resolve fails -> blocked
    });
    expect(await screen.findByText('Setup incomplete')).toBeInTheDocument();
    expect(mockLearnSpell).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry setup' })); // 3rd resolve succeeds
    });
    await waitFor(() =>
      expect(mockLearnSpell).toHaveBeenCalledWith('char-sorc', 'alice', 'fire-bolt'),
    );
    expect(mockLearnSpell).toHaveBeenCalledWith(
      'char-sorc',
      'alice',
      'magic-missile',
      undefined,
      undefined,
      undefined,
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/character/char-sorc'));
    // No drift here (only the resolve outcome changed) — no recreate, no orphan.
    expect(mockCreateCharacter).toHaveBeenCalledTimes(1);
    expect(mockDeleteCharacter).not.toHaveBeenCalled();
  });
});
