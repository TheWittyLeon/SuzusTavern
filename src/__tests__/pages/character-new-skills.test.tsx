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
  skillChoices: ['acrobatics', 'athletics', 'insight', 'perception', 'stealth', 'survival'],
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
  it("blocks the resolve when a pick isn't on the sheet's authoritative options, even though the wizard's own mirror offered it", async () => {
    mockGetCharacterSheet.mockResolvedValue(
      sheetWithPendingSkills(2, ['acrobatics', 'athletics', 'insight', 'stealth', 'survival']),
    );
    await advanceToReview();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin your campaign/i }));
    });
    await waitFor(() => expect(mockGetCharacterSheet).toHaveBeenCalled());
    expect(mockResolveLevelChoice).not.toHaveBeenCalled();
    expect(await screen.findByText('Setup incomplete')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
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
});
