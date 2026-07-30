/**
 * LevelChoicePicker — T13 (DDX-14t/15t level-choice picker UI).
 *
 * Covers: no-picker when pending_choices is empty; subclass choice renders
 * catalog-filtered options and resolves with the engine's exact
 * {subclass: slug} body; ASI choice enforces the +2-to-one /+1-to-two shapes
 * via the per-ability stepper and disables an option that would exceed the
 * 20 cap; the feat alternative resolves with {mode:'feat', feat: slug};
 * shared busy-latch (one call on a same-tick double click, released on
 * error); success toast + refetch-after-mutate.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  getAvailableSpells: jest.fn(),
  getCatalog: jest.fn(),
  getCharacterSheet: jest.fn(),
  learnSpell: jest.fn(),
  resolveLevelChoice: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import LevelChoicePicker from '../../components/LevelChoicePicker';
import type {
  AvailableSpellsResult,
  CatalogItem,
  CatalogResponse,
  CharacterSheet,
  PendingLevelChoice,
} from '../../lib/api/types';

const mockGetCatalog = dnd.getCatalog as jest.Mock;
const mockGetSheet = dnd.getCharacterSheet as jest.Mock;
const mockResolve = dnd.resolveLevelChoice as jest.Mock;
const mockGetAvailableSpells = dnd.getAvailableSpells as jest.Mock;
const mockLearnSpell = dnd.learnSpell as jest.Mock;

function ability(score: number, modifier: number) {
  return { score, modifier };
}

const BASE_SHEET: CharacterSheet = {
  character_id: 'cid-1',
  owner_username: 'leon',
  name: 'Ashwin',
  race: 'Human',
  subrace: '',
  char_class: 'Fighter',
  subclass: '',
  level: 3,
  background: 'Soldier',
  alignment: '',
  ability_scores: {
    strength: ability(16, 3),
    dexterity: ability(12, 1),
    constitution: ability(14, 2),
    intelligence: ability(10, 0),
    wisdom: ability(10, 0),
    charisma: ability(8, -1),
  },
  hp: { current: 24, max: 24, temp: 0 },
  ac: 11,
  initiative: 1,
  proficiency_bonus: 2,
  speed: 30,
  xp: 2700,
  xp_next: 6500,
  hit_dice_remaining: 3,
  proficient_saves: ['strength', 'constitution'],
  proficient_skills: ['athletics'],
  class_features: [],
  conditions: [],
  spellcasting: null,
  spell_slots: {},
  is_spellcaster: false,
  inventory: [],
  inventory_weight: 0,
  feats: [],
  pending_choices: [],
};

const SUBCLASS_CHOICE: PendingLevelChoice = {
  id: 'subclass:3',
  type: 'subclass',
  level: 3,
  class: 'Fighter',
  label: 'Choose your Fighter archetype',
};

const ASI_CHOICE: PendingLevelChoice = {
  id: 'asi:4',
  type: 'asi',
  level: 4,
  class: 'Fighter',
  label: 'Ability Score Improvement (level 4)',
};

const WIZARD_SPELL_CHOICE: PendingLevelChoice = {
  id: 'spell:2',
  type: 'spell',
  level: 2,
  class: 'Wizard',
  caster_kind: 'spellbook',
  cantrips: 1,
  spells: 2,
  label: 'Choose 1 new cantrip and 2 new spells (level 2)',
};

const SORCERER_SPELL_CHOICE: PendingLevelChoice = {
  id: 'spell:2',
  type: 'spell',
  level: 2,
  class: 'Sorcerer',
  caster_kind: 'known',
  cantrips: 0,
  spells: 1,
  label: 'Choose 1 new spell (level 2)',
};

const CLERIC_SPELL_CHOICE: PendingLevelChoice = {
  id: 'spell:4',
  type: 'spell',
  level: 4,
  class: 'Cleric',
  caster_kind: 'prepared',
  cantrips: 1,
  spells: 0,
  label: 'Choose 1 new cantrip (level 4)',
};

const WIZARD_SPELL_CHOICE_L4: PendingLevelChoice = {
  id: 'spell:4',
  type: 'spell',
  level: 4,
  class: 'Wizard',
  caster_kind: 'spellbook',
  cantrips: 1,
  spells: 2,
  label: 'Choose 1 new cantrip and 2 new spells (level 4)',
};

function availableSpellsFixture(overrides?: Partial<AvailableSpellsResult>): AvailableSpellsResult {
  return {
    cantrips: [
      { slug: 'fire-bolt', name: 'Fire Bolt', level: 0, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
      { slug: 'mage-hand', name: 'Mage Hand', level: 0, school: 'conjuration', concentration: false, ritual: false, in_repertoire: false, prepared: false },
      { slug: 'light', name: 'Light', level: 0, school: 'evocation', concentration: false, ritual: false, in_repertoire: true, prepared: true },
    ],
    by_level: {
      '1': [
        { slug: 'magic-missile', name: 'Magic Missile', level: 1, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
        { slug: 'shield', name: 'Shield', level: 1, school: 'abjuration', concentration: false, ritual: false, in_repertoire: false, prepared: false },
        { slug: 'burning-hands', name: 'Burning Hands', level: 1, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
      ],
    },
    can_learn: true,
    can_prepare: false,
    budget: {
      cantrips_known: 3,
      cantrips_max: 4,
      spells_known: 0,
      spells_max: 2,
      prepared_used: null,
      prepared_max: null,
    },
    ...overrides,
  };
}

function catalogItem(slug: string, name: string, data: Record<string, unknown>): CatalogItem {
  return { slug, name, content_type: 'subclass', source_type: 'srd', data };
}

const SUBCLASS_ITEMS: CatalogItem[] = [
  catalogItem('champion', 'Champion', { class: 'Fighter', subclass_flavor: 'Martial Archetype' }),
  catalogItem('battle-master', 'Battle Master', { class: 'Fighter', subclass_flavor: 'Martial Archetype' }),
  catalogItem('eldritch-knight', 'Eldritch Knight', { class: 'Fighter', subclass_flavor: 'Martial Archetype' }),
  catalogItem('evocation', 'School of Evocation', { class: 'Wizard', subclass_flavor: 'Arcane Tradition' }),
];

const FEAT_ITEMS: CatalogItem[] = [
  { slug: 'grappler', name: 'Grappler', content_type: 'feat', source_type: 'srd', data: {} },
  { slug: 'power-attack', name: 'Power Attack', content_type: 'feat', source_type: 'srd', data: {} },
];

function catalogResponse(items: CatalogItem[]): CatalogResponse {
  return { system: 'dnd5e', content_type: items[0]?.content_type ?? null, items, total: items.length, limit: 200, offset: 0 };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCatalog.mockImplementation((_system: string, opts: { type?: string }) => {
    if (opts?.type === 'subclass') return Promise.resolve(catalogResponse(SUBCLASS_ITEMS));
    if (opts?.type === 'feat') return Promise.resolve(catalogResponse(FEAT_ITEMS));
    return Promise.resolve(catalogResponse([]));
  });
  mockGetSheet.mockResolvedValue(BASE_SHEET);
  mockResolve.mockResolvedValue({ message: 'ok' });
  mockGetAvailableSpells.mockResolvedValue(availableSpellsFixture());
  mockLearnSpell.mockResolvedValue({ learned: true, budget: availableSpellsFixture().budget });
});

function renderPicker(pendingChoices: PendingLevelChoice[], sheetOverrides?: Partial<CharacterSheet>) {
  const onResolved = jest.fn();
  const sheet: CharacterSheet = { ...BASE_SHEET, ...sheetOverrides, pending_choices: pendingChoices };
  const utils = render(
    <ToastProvider>
      <LevelChoicePicker characterId="cid-1" username="leon" sheet={sheet} onResolved={onResolved} />
    </ToastProvider>,
  );
  return { onResolved, sheet, ...utils };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('LevelChoicePicker — no pending choices', () => {
  it('renders nothing when pending_choices is empty', () => {
    // T7 gotcha (Ren memory): ToastProvider always renders a non-empty
    // viewport div, so asserting the whole container is empty is wrong here
    // — assert the component's own known text is absent instead.
    renderPicker([]);
    expect(screen.queryByText(/pending choices/i)).not.toBeInTheDocument();
    expect(mockGetCatalog).not.toHaveBeenCalled();
  });

  it('renders nothing when pending_choices is undefined', () => {
    const onResolved = jest.fn();
    const sheet: CharacterSheet = { ...BASE_SHEET };
    delete (sheet as { pending_choices?: PendingLevelChoice[] }).pending_choices;
    render(
      <ToastProvider>
        <LevelChoicePicker characterId="cid-1" username="leon" sheet={sheet} onResolved={onResolved} />
      </ToastProvider>,
    );
    expect(screen.queryByText(/pending choices/i)).not.toBeInTheDocument();
  });
});

describe('LevelChoicePicker — subclass choice', () => {
  it('fetches subclass options filtered to the class and renders them', async () => {
    renderPicker([SUBCLASS_CHOICE]);

    expect(await screen.findByRole('radio', { name: 'Champion' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Battle Master' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Eldritch Knight' })).toBeInTheDocument();
    // Off-class options (Wizard's Evocation) must never appear for a Fighter.
    expect(screen.queryByRole('radio', { name: 'School of Evocation' })).not.toBeInTheDocument();

    expect(mockGetCatalog).toHaveBeenCalledWith('dnd5e', { type: 'subclass' }, expect.anything());
  });

  it('renders the card title as a real heading and labels the radiogroup by it (Iro MINOR-1/2)', async () => {
    renderPicker([SUBCLASS_CHOICE]);
    await screen.findByRole('radio', { name: 'Champion' });

    const heading = screen.getByRole('heading', {
      // TAV-SHEET-HEADING-ORDER: h3 (was h4) — nested under LevelChoicePicker's
      // own "Pending choices" h2 (was h3), one level deeper.
      level: 3,
      name: SUBCLASS_CHOICE.label,
    });
    expect(heading).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: SUBCLASS_CHOICE.label })).toBeInTheDocument();
    // The parent "Pending choices" heading is one level up (h2).
    expect(
      screen.getByRole('heading', { level: 2, name: 'Pending choices' }),
    ).toBeInTheDocument();
  });

  it('resolves with the exact {subclass: slug} body and refetches the sheet', async () => {
    const after: CharacterSheet = { ...BASE_SHEET, subclass: 'Champion', pending_choices: [] };
    mockGetSheet.mockResolvedValue(after);
    const { onResolved } = renderPicker([SUBCLASS_CHOICE]);

    fireEvent.click(await screen.findByRole('radio', { name: 'Battle Master' }));
    fireEvent.click(screen.getByRole('button', { name: /confirm archetype: battle master/i }));
    await flush();

    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'subclass:3', {
      subclass: 'battle-master',
    });
    expect(mockGetSheet).toHaveBeenCalledWith('cid-1', 'leon');
    expect(onResolved).toHaveBeenCalledWith(after);
    expect(await screen.findByText(/battle master chosen/i)).toBeInTheDocument();
  });

  it('Label-in-Name (Iro SERIOUS-1): Confirm archetype aria-label contains the visible button text', async () => {
    renderPicker([SUBCLASS_CHOICE]);
    fireEvent.click(await screen.findByRole('radio', { name: 'Champion' }));
    const confirm = screen.getByRole('button', { name: /confirm archetype: champion/i });
    // Visible text ("Confirm archetype") must be a leading substring of the
    // accessible name, per WCAG 2.5.3 Label in Name.
    expect(confirm.getAttribute('aria-label')).toMatch(/^Confirm archetype/);
    expect(confirm).toHaveTextContent('Confirm archetype');
  });

  it('ArrowRight/ArrowDown move focus AND select the next radio (Iro CRITICAL-1)', async () => {
    renderPicker([SUBCLASS_CHOICE]);
    const champion = await screen.findByRole('radio', { name: 'Champion' });
    const battleMaster = screen.getByRole('radio', { name: 'Battle Master' });
    const eldritchKnight = screen.getByRole('radio', { name: 'Eldritch Knight' });

    // Roving tabindex: only the checked radio is in the tab order.
    expect(champion).toHaveAttribute('tabIndex', '0');
    expect(battleMaster).toHaveAttribute('tabIndex', '-1');

    champion.focus();
    fireEvent.keyDown(champion, { key: 'ArrowRight' });
    expect(battleMaster).toHaveFocus();
    expect(battleMaster).toHaveAttribute('aria-checked', 'true');
    expect(champion).toHaveAttribute('aria-checked', 'false');

    // Wraps at the end.
    fireEvent.keyDown(battleMaster, { key: 'ArrowRight' });
    expect(eldritchKnight).toHaveFocus();
    fireEvent.keyDown(eldritchKnight, { key: 'ArrowRight' });
    expect(champion).toHaveFocus();
    expect(champion).toHaveAttribute('aria-checked', 'true');
  });
});

describe('LevelChoicePicker — ASI choice: ability increase', () => {
  function incBtn(name: string) {
    return screen.getByRole('button', { name: new RegExp(`increase ${name} allocation`, 'i') });
  }
  function decBtn(name: string) {
    return screen.getByRole('button', { name: new RegExp(`decrease ${name} allocation`, 'i') });
  }
  function confirmBtn() {
    return screen.getByRole('button', { name: /confirm ability score improvement/i });
  }

  it('supports +2 to one ability and resolves with that allocation', async () => {
    renderPicker([ASI_CHOICE]);

    expect(confirmBtn()).toBeDisabled();
    fireEvent.click(incBtn('strength'));
    fireEvent.click(incBtn('strength'));
    expect(confirmBtn()).toBeEnabled();

    fireEvent.click(confirmBtn());
    await flush();

    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'asi:4', {
      mode: 'increase',
      allocations: { strength: 2 },
    });
  });

  it('supports +1/+1 split across two abilities and resolves with both', async () => {
    renderPicker([ASI_CHOICE]);

    fireEvent.click(incBtn('strength'));
    fireEvent.click(incBtn('dexterity'));
    expect(confirmBtn()).toBeEnabled();

    fireEvent.click(confirmBtn());
    await flush();

    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'asi:4', {
      mode: 'increase',
      allocations: { strength: 1, dexterity: 1 },
    });
  });

  it('spends the 2-point budget — a third ability cannot be touched once two are allocated', () => {
    renderPicker([ASI_CHOICE]);

    fireEvent.click(incBtn('strength'));
    fireEvent.click(incBtn('dexterity'));
    // Budget exhausted: every remaining "+" (including on an untouched
    // ability) is now disabled.
    expect(incBtn('constitution')).toBeDisabled();
    // The allocated ones can still be walked back via "-".
    expect(decBtn('strength')).toBeEnabled();
  });

  it('disables the "+" the moment one more point would exceed the ability cap of 20', () => {
    // Strength already at 20 — a single further point would be 21, illegal.
    renderPicker([ASI_CHOICE], {
      ability_scores: { ...BASE_SHEET.ability_scores, strength: ability(20, 5) },
    });
    expect(incBtn('strength')).toBeDisabled();
  });

  it('disables "+" after the FIRST point once a second would exceed the cap (19 -> 20 ok, -> 21 not)', () => {
    renderPicker([ASI_CHOICE], {
      ability_scores: { ...BASE_SHEET.ability_scores, strength: ability(19, 4) },
    });
    expect(incBtn('strength')).toBeEnabled();
    fireEvent.click(incBtn('strength'));
    // Now at +1 (score would be 20 if confirmed) — a second point would be
    // 21, so the button must be disabled even though the 2-point BUDGET
    // itself isn't spent yet.
    expect(incBtn('strength')).toBeDisabled();
  });
});

describe('LevelChoicePicker — ASI stepper sr-only live status (Iro CRITICAL-3/MODERATE-2)', () => {
  it('announces the ability, resultant score, and points spent on increase/decrease', () => {
    renderPicker([ASI_CHOICE]);
    const region = () => document.querySelector('[aria-live="polite"][aria-atomic="true"].sr-only');

    fireEvent.click(screen.getByRole('button', { name: /increase strength allocation/i }));
    expect(region()).toHaveTextContent('Strength 17, 1 of 2 points spent.');

    fireEvent.click(screen.getByRole('button', { name: /decrease strength allocation/i }));
    expect(region()).toHaveTextContent('Strength 16, 0 of 2 points spent.');
  });

  it('announces a terminal budget-spent message when the second point is allocated', () => {
    renderPicker([ASI_CHOICE]);
    const region = () => document.querySelector('[aria-live="polite"][aria-atomic="true"].sr-only');

    fireEvent.click(screen.getByRole('button', { name: /increase strength allocation/i }));
    fireEvent.click(screen.getByRole('button', { name: /increase dexterity allocation/i }));
    expect(region()).toHaveTextContent(/budget spent.*increase disabled/i);
  });

  it('announces an at-maximum message when the next point would exceed the ability cap', () => {
    renderPicker([ASI_CHOICE], {
      ability_scores: { ...BASE_SHEET.ability_scores, strength: ability(19, 4) },
    });
    const region = () => document.querySelector('[aria-live="polite"][aria-atomic="true"].sr-only');

    fireEvent.click(screen.getByRole('button', { name: /increase strength allocation/i }));
    expect(region()).toHaveTextContent(/strength at maximum/i);
  });
});

describe('LevelChoicePicker — ASI mode-toggle radiogroup arrow-key nav (Iro CRITICAL-1)', () => {
  it('ArrowRight moves focus AND selects the next mode; DEFECT-1 reset still applies', async () => {
    renderPicker([ASI_CHOICE]);
    const increaseBtn = screen.getByRole('radio', { name: 'Increase abilities' });
    const featBtn = screen.getByRole('radio', { name: 'Take a feat' });

    fireEvent.click(screen.getByRole('button', { name: /increase strength allocation/i }));
    increaseBtn.focus();
    fireEvent.keyDown(increaseBtn, { key: 'ArrowRight' });

    expect(featBtn).toHaveFocus();
    expect(featBtn).toHaveAttribute('aria-checked', 'true');
    expect(increaseBtn).toHaveAttribute('aria-checked', 'false');
    expect(increaseBtn).toHaveAttribute('tabIndex', '-1');
    // Let the feat-mode catalog fetch this arrow-key switch just triggered
    // settle inside act() before moving on.
    await flush();

    // Arrow-driven mode change resets the stale allocation exactly like a
    // click would (DEFECT-1's fix is in the shared handleModeChange, not
    // duplicated per input method).
    fireEvent.keyDown(featBtn, { key: 'ArrowLeft' });
    expect(increaseBtn).toHaveFocus();
    expect(
      screen.getByRole('button', { name: /confirm ability score improvement/i }),
    ).toBeDisabled();
  });
});

describe('LevelChoicePicker — ASI choice: feat instead', () => {
  it('filters the feat catalog to the engine-eligible, not-already-taken set and resolves the pick', async () => {
    const after: CharacterSheet = {
      ...BASE_SHEET,
      feats: [{ slug: 'grappler', name: 'Grappler', description: '' }],
      pending_choices: [],
    };
    mockGetSheet.mockResolvedValue(after);
    const { onResolved } = renderPicker([ASI_CHOICE]);

    fireEvent.click(screen.getByRole('radio', { name: 'Take a feat' }));

    expect(await screen.findByRole('radio', { name: 'Grappler' })).toBeInTheDocument();
    // power-attack is a real catalog row but not a real 5e ASI feat mechanic
    // (see engine's _ASI_ELIGIBLE_FEATS docstring) — must never be offered.
    expect(screen.queryByRole('radio', { name: 'Power Attack' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Grappler' }));
    fireEvent.click(screen.getByRole('button', { name: /confirm feat/i }));
    await flush();

    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'asi:4', {
      mode: 'feat',
      feat: 'grappler',
    });
    expect(onResolved).toHaveBeenCalledWith(after);
  });

  it('hides a feat the character has already taken', async () => {
    renderPicker([ASI_CHOICE], {
      feats: [{ slug: 'grappler', name: 'Grappler', description: '' }],
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Take a feat' }));

    const empty = await screen.findByText(/no feats are available right now/i);
    expect(screen.queryByRole('radio', { name: 'Grappler' })).not.toBeInTheDocument();
    // A11Y (Iro SERIOUS-3): perceivable without visual polling.
    expect(empty).toHaveAttribute('aria-live', 'polite');
  });

  it('the feat radiogroup carries roving tabIndex and a level-scoped accessible name (Iro CRITICAL-1/MINOR-2)', async () => {
    // Only 'grappler' is in ASI_ELIGIBLE_FEAT_SLUGS today, so this fixture
    // can only exercise a single-option radiogroup — the cycling behavior
    // itself (radioStepIndex) is exercised by the subclass and mode-toggle
    // radiogroups above, which share the exact same handler.
    renderPicker([ASI_CHOICE]);
    fireEvent.click(screen.getByRole('radio', { name: 'Take a feat' }));
    const grappler = await screen.findByRole('radio', { name: 'Grappler' });

    expect(grappler).toHaveAttribute('aria-checked', 'true');
    expect(grappler).toHaveAttribute('tabIndex', '0');
    expect(
      screen.getByRole('radiogroup', { name: 'Feat (level 4)' }),
    ).toBeInTheDocument();
  });
});

describe('LevelChoicePicker — busy-latch + error handling', () => {
  it('a same-tick double click only calls resolveLevelChoice once', async () => {
    let releaseResolve: (() => void) | undefined;
    mockResolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseResolve = () => resolve({ message: 'ok' });
        }),
    );
    renderPicker([SUBCLASS_CHOICE]);
    fireEvent.click(await screen.findByRole('radio', { name: 'Champion' }));
    const confirm = screen.getByRole('button', { name: /confirm archetype: champion/i });

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mockResolve).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseResolve?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('releases the latch on a mutate failure so a retry can succeed', async () => {
    mockResolve.mockRejectedValueOnce(new Error('boom'));
    renderPicker([SUBCLASS_CHOICE]);
    fireEvent.click(await screen.findByRole('radio', { name: 'Champion' }));
    const confirm = screen.getByRole('button', { name: /confirm archetype: champion/i });

    fireEvent.click(confirm);
    await flush();
    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/could not save that choice/i)).toBeInTheDocument();

    fireEvent.click(confirm);
    await flush();
    expect(mockResolve).toHaveBeenCalledTimes(2);
  });

  it('maps a known refusal reason to specific copy', async () => {
    const err = Object.assign(new Error('refused'), {
      status: 400,
      body: { data: { reason: 'already_chosen' } },
    });
    mockResolve.mockRejectedValueOnce(err);
    renderPicker([SUBCLASS_CHOICE]);
    fireEvent.click(await screen.findByRole('radio', { name: 'Champion' }));
    fireEvent.click(screen.getByRole('button', { name: /confirm archetype: champion/i }));

    expect(await screen.findByText(/a subclass has already been chosen/i)).toBeInTheDocument();
  });

  it('falls back to the generic message for an unmapped/unknown refusal reason', async () => {
    const err = Object.assign(new Error('refused'), { status: 500, body: { data: { reason: 'server_exploded' } } });
    mockResolve.mockRejectedValueOnce(err);
    renderPicker([SUBCLASS_CHOICE]);
    fireEvent.click(await screen.findByRole('radio', { name: 'Champion' }));
    fireEvent.click(screen.getByRole('button', { name: /confirm archetype: champion/i }));

    expect(await screen.findByText(/could not save that choice\. try again in a moment\./i)).toBeInTheDocument();
  });
});

describe('LevelChoicePicker — unsupported choice type', () => {
  it('renders a "no picker yet" placeholder instead of crashing for a future choice type', () => {
    const FUTURE_CHOICE: PendingLevelChoice = {
      id: 'multiclass:5',
      type: 'multiclass',
      level: 5,
      class: 'Fighter',
      label: 'Pick a multiclass path',
    };
    renderPicker([FUTURE_CHOICE]);

    expect(screen.getByText('Pick a multiclass path')).toBeInTheDocument();
    expect(screen.getByText(/doesn.?t have a picker for this choice type yet/i)).toBeInTheDocument();
    // Never talks to the network for a type it can't handle.
    expect(mockGetCatalog).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe('LevelChoicePicker — ASI budget boundary: 0/1 point never enables confirm', () => {
  it('confirm stays disabled with zero points, and with exactly one point allocated', () => {
    renderPicker([ASI_CHOICE]);
    const confirmBtn = () => screen.getByRole('button', { name: /confirm ability score improvement/i });
    const incBtn = (name: string) =>
      screen.getByRole('button', { name: new RegExp(`increase ${name} allocation`, 'i') });

    expect(confirmBtn()).toBeDisabled(); // 0/2
    fireEvent.click(incBtn('strength'));
    expect(confirmBtn()).toBeDisabled(); // 1/2 — a single point is NOT a legal ASI, must stay blocked
  });

  it('allows +2 up to the exact cap (18 -> 20) without disabling early', () => {
    renderPicker([ASI_CHOICE], {
      ability_scores: { ...BASE_SHEET.ability_scores, strength: ability(18, 4) },
    });
    const incBtn = () => screen.getByRole('button', { name: /increase strength allocation/i });

    expect(incBtn()).toBeEnabled();
    fireEvent.click(incBtn()); // 18 -> 19 (would-be)
    expect(incBtn()).toBeEnabled(); // one more point lands exactly on the cap (20), still legal
    fireEvent.click(incBtn()); // 19 -> 20 (would-be)
    expect(incBtn()).toBeDisabled(); // budget spent AND at cap
  });
});

describe('LevelChoicePicker — ASI: mode toggle resets stale allocation/feat state (DEFECT-1 fix)', () => {
  it('switching to feat mode and back clears the prior ability allocation — confirm stays disabled, no stale allocation sent', async () => {
    // Was Miko-QA T13 finding DEFECT-1: AsiChoiceCard's `allocations` state
    // was never cleared on setMode(), so a player who allocated points,
    // previewed the feat option, then returned to "Increase abilities" could
    // silently confirm the STALE allocation with no further clicks. Fixed by
    // handleModeChange resetting allocations + selectedFeat on every toggle.
    renderPicker([ASI_CHOICE]);
    const confirmBtn = () => screen.getByRole('button', { name: /confirm ability score improvement/i });
    fireEvent.click(screen.getByRole('button', { name: /increase strength allocation/i }));
    fireEvent.click(screen.getByRole('button', { name: /increase dexterity allocation/i }));
    expect(confirmBtn()).toBeEnabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Take a feat' }));
    await flush();
    fireEvent.click(screen.getByRole('radio', { name: 'Increase abilities' }));

    // FIXED: no new clicks were made in this mode — confirm must stay
    // disabled since the round-trip cleared the allocation.
    expect(confirmBtn()).toBeDisabled();

    // Re-allocate from scratch and confirm — the resolved body must reflect
    // ONLY the fresh allocation, never the round-tripped stale one.
    fireEvent.click(screen.getByRole('button', { name: /increase constitution allocation/i }));
    fireEvent.click(screen.getByRole('button', { name: /increase constitution allocation/i }));
    expect(confirmBtn()).toBeEnabled();
    fireEvent.click(confirmBtn());
    await flush();
    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'asi:4', {
      mode: 'increase',
      allocations: { constitution: 2 },
    });
  });

  it('switching to increase mode and back to feat clears a prior feat selection', async () => {
    renderPicker([ASI_CHOICE]);
    fireEvent.click(screen.getByRole('radio', { name: 'Take a feat' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Grappler' }));
    const confirmFeat = () => screen.getByRole('button', { name: /confirm feat/i });
    expect(confirmFeat()).toBeEnabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Increase abilities' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Take a feat' }));

    // The feat catalog is already loaded (featLoadState stays 'ok'), so it
    // isn't re-fetched — but the SELECTION itself must not have survived the
    // round-trip.
    expect(confirmFeat()).toBeDisabled();
  });
});

describe('LevelChoicePicker — ASI: feat mode busy-latch + loading-state confirm gate', () => {
  it('a same-tick double click on the feat confirm only calls resolveLevelChoice once', async () => {
    let releaseResolve: (() => void) | undefined;
    mockResolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseResolve = () => resolve({ message: 'ok' });
        }),
    );
    renderPicker([ASI_CHOICE]);
    fireEvent.click(screen.getByRole('radio', { name: 'Take a feat' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Grappler' }));
    const confirm = screen.getByRole('button', { name: /confirm feat/i });

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mockResolve).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseResolve?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('confirm stays disabled while the feat catalog is still loading (no feat picked yet)', async () => {
    renderPicker([ASI_CHOICE]);
    fireEvent.click(screen.getByRole('radio', { name: 'Take a feat' }));

    // Synchronous assertion — before the mocked getCatalog promise's .then()
    // microtask has had a chance to run.
    expect(screen.getByText(/loading feats/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm feat/i })).toBeDisabled();

    // Let the pending getCatalog promise settle inside act() so React
    // doesn't warn about an update after the test body returns.
    await flush();
  });
});

describe('LevelChoicePicker — subclass: catalog failure, case-insensitive filter, empty seed set', () => {
  it('a catalog fetch failure shows an error and renders no confirm affordance — never crashes', async () => {
    mockGetCatalog.mockImplementationOnce(() => Promise.reject(new Error('network down')));
    renderPicker([SUBCLASS_CHOICE]);

    const errorMsg = await screen.findByText(/couldn.?t load archetype options/i);
    expect(errorMsg).toBeInTheDocument();
    // A11Y (Iro SERIOUS-2): the error text must be perceivable by AT without
    // visual polling.
    expect(errorMsg.closest('p')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('button', { name: /^confirm/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('FIXED (Iro SERIOUS-4/DEFECT-2): a catalog fetch failure offers a Retry that re-fetches', async () => {
    mockGetCatalog.mockImplementationOnce(() => Promise.reject(new Error('network down')));
    renderPicker([SUBCLASS_CHOICE]);

    await screen.findByText(/couldn.?t load archetype options/i);
    expect(mockGetCatalog).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    // The retry uses the default (successful) mock — options render.
    expect(await screen.findByRole('radio', { name: 'Champion' })).toBeInTheDocument();
    expect(mockGetCatalog).toHaveBeenCalledTimes(2);
  });

  it('filters the class match case-insensitively (engine may send any casing)', async () => {
    mockGetCatalog.mockImplementationOnce((_s: string, opts: { type?: string }) => {
      if (opts?.type !== 'subclass') return Promise.resolve(catalogResponse([]));
      return Promise.resolve(
        catalogResponse([catalogItem('champion', 'Champion', { class: 'FIGHTER' })]),
      );
    });
    renderPicker([SUBCLASS_CHOICE]);

    expect(await screen.findByRole('radio', { name: 'Champion' })).toBeInTheDocument();
  });

  it('shows "no archetypes seeded" and renders no confirm button when the filtered set is empty', async () => {
    mockGetCatalog.mockImplementationOnce(() => Promise.resolve(catalogResponse([])));
    renderPicker([SUBCLASS_CHOICE]);

    expect(await screen.findByText(/no archetypes are seeded for fighter yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
  });
});

describe('LevelChoicePicker — multiple pending choices: no cross-contamination', () => {
  it('renders one card per pending choice and resolving one leaves the other independently usable', async () => {
    const afterSubclassResolved: CharacterSheet = {
      ...BASE_SHEET,
      subclass: 'Champion',
      pending_choices: [ASI_CHOICE], // subclass choice removed server-side, asi still pending
    };
    mockGetSheet.mockResolvedValueOnce(afterSubclassResolved);
    const { onResolved, rerender, sheet } = renderPicker([SUBCLASS_CHOICE, ASI_CHOICE]);

    // Both cards present simultaneously.
    expect(await screen.findByRole('radio', { name: 'Champion' })).toBeInTheDocument();
    expect(screen.getByText('Ability Score Improvement (level 4)')).toBeInTheDocument();

    // Touch the ASI card's state before resolving the subclass card.
    fireEvent.click(screen.getByRole('button', { name: /increase strength allocation/i }));
    fireEvent.click(screen.getByRole('button', { name: /increase dexterity allocation/i }));

    fireEvent.click(screen.getByRole('button', { name: /confirm archetype: champion/i }));
    await flush();
    expect(onResolved).toHaveBeenCalledWith(afterSubclassResolved);
    // A11Y (Iro CRITICAL-4a): the resolved card's own Confirm button just
    // unmounted out from under focus — the "Pending choices" heading (still
    // mounted, since the ASI choice remains pending) is the restore target.
    expect(screen.getByRole('heading', { name: 'Pending choices' })).toHaveFocus();

    // Simulate the parent (page.tsx) re-rendering with the fresh sheet, as
    // onResolved's real wiring (setSheet) would.
    rerender(
      <ToastProvider>
        <LevelChoicePicker
          characterId="cid-1"
          username="leon"
          sheet={{ ...sheet, ...afterSubclassResolved }}
          onResolved={onResolved}
        />
      </ToastProvider>,
    );

    // Subclass card is gone; ASI card survived the rerender with ITS OWN
    // allocation state untouched by the sibling card's resolve.
    expect(screen.queryByRole('radio', { name: 'Champion' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm ability score improvement/i })).toBeEnabled();
  });

  it('FIXED (Iro MINOR-2/DEFECT-3): two simultaneously-pending ASI choices get distinct accessible names', () => {
    // Reachable in practice: cmd_levelup (engine) queues a new pending choice
    // on every level-up call and does NOT block further level-ups while a
    // choice is unresolved (no "resolve pending choices first" gate found in
    // engine/commands/character_msm.py::cmd_levelup) — a Fighter can go
    // 3->4 (ASI queued) then 5->6 (ASI queued again) without ever resolving
    // the level-4 one. AsiChoiceCard's mode-toggle radiogroup and Confirm
    // button now include the choice's own level in their accessible name, so
    // two pending ASI choices are distinguishable.
    const ASI_CHOICE_L6: PendingLevelChoice = {
      id: 'asi:6',
      type: 'asi',
      level: 6,
      class: 'Fighter',
      label: 'Ability Score Improvement (level 6)',
    };
    renderPicker([ASI_CHOICE, ASI_CHOICE_L6]);

    // Generic (unscoped) name matches must be gone entirely...
    expect(screen.queryByRole('radiogroup', { name: 'Choice type' })).not.toBeInTheDocument();
    // ...replaced by two DISTINCT, level-scoped names.
    expect(screen.getByRole('radiogroup', { name: 'Choice type (level 4)' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Choice type (level 6)' })).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: 'Confirm Ability Score Improvement (level 4)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Confirm Ability Score Improvement (level 6)' }),
    ).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TAV-1.0-SLICE-B-FIX-4 — the `spell` choice (level-up spell GAIN picker)
// ═══════════════════════════════════════════════════════════════════════════

describe('LevelChoicePicker — spell choice: renders both buckets sized to the entitlement', () => {
  it('renders a cantrip bucket capped at choice.cantrips and a leveled bucket capped at choice.spells', async () => {
    renderPicker([WIZARD_SPELL_CHOICE]);

    expect(await screen.findByText(/cantrips — 0 of 1 chosen/i)).toBeInTheDocument();
    expect(screen.getByText(/new spells — 0 of 2 chosen/i)).toBeInTheDocument();

    // Repertoire-filtered: 'light' is in_repertoire:true and must not appear.
    expect(screen.getByRole('button', { name: 'Fire Bolt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mage Hand' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Light' })).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Magic Missile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shield' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Burning Hands' })).toBeInTheDocument();

    expect(mockGetAvailableSpells).toHaveBeenCalledWith('cid-1', 'leon', expect.anything());
  });

  it('does not render the cantrip bucket at all when choice.cantrips is 0', async () => {
    renderPicker([SORCERER_SPELL_CHOICE]);

    await screen.findByText(/new spells — 0 of 1 chosen/i);
    expect(screen.queryByText(/cantrips —/i)).not.toBeInTheDocument();
  });

  it('shows an empty-pool message when a bucket has an allotment but nothing left to learn', async () => {
    mockGetAvailableSpells.mockResolvedValueOnce(
      availableSpellsFixture({ cantrips: [], by_level: { '1': [] } }),
    );
    renderPicker([WIZARD_SPELL_CHOICE]);

    expect(await screen.findByText(/no new cantrips available to learn right now/i)).toBeInTheDocument();
    expect(screen.getByText(/no new spells available to learn right now/i)).toBeInTheDocument();
  });
});

describe('LevelChoicePicker — spell choice: picks are allotment-capped', () => {
  it('mounts a spell-info popover trigger on every option (LEVELUP-UX, Kage m11)', async () => {
    renderPicker([WIZARD_SPELL_CHOICE]);
    await screen.findByRole('button', { name: 'Fire Bolt' });
    // One trigger per option — the wrapper is invisible to name queries, so
    // this is the assertion that fails if the popover mount is dropped.
    const options = screen
      .getAllByRole('button', { name: /spell details/i });
    expect(options.length).toBeGreaterThan(0);
  });

  it('disables further cantrip picks once the allotment is reached, leveled bucket independent', async () => {
    renderPicker([WIZARD_SPELL_CHOICE]);
    const fireBolt = await screen.findByRole('button', { name: 'Fire Bolt' });
    const mageHand = screen.getByRole('button', { name: 'Mage Hand' });

    fireEvent.click(fireBolt);
    expect(await screen.findByText(/cantrips — 1 of 1 chosen/i)).toBeInTheDocument();
    expect(mageHand).toBeDisabled();
    // The already-picked one stays clickable (to deselect).
    expect(fireBolt).toBeEnabled();

    // Leveled bucket is untouched by the cantrip cap.
    expect(screen.getByRole('button', { name: 'Magic Missile' })).toBeEnabled();
  });

  it('deselecting a picked cantrip frees the slot for another', async () => {
    renderPicker([WIZARD_SPELL_CHOICE]);
    const fireBolt = await screen.findByRole('button', { name: 'Fire Bolt' });
    const mageHand = screen.getByRole('button', { name: 'Mage Hand' });

    fireEvent.click(fireBolt);
    expect(mageHand).toBeDisabled();
    fireEvent.click(fireBolt);
    expect(await screen.findByText(/cantrips — 0 of 1 chosen/i)).toBeInTheDocument();
    expect(mageHand).toBeEnabled();
  });

  it('caps the leveled bucket at choice.spells (2) independently of the cantrip cap', async () => {
    renderPicker([WIZARD_SPELL_CHOICE]);
    const magicMissile = await screen.findByRole('button', { name: 'Magic Missile' });
    const shield = screen.getByRole('button', { name: 'Shield' });
    const burningHands = screen.getByRole('button', { name: 'Burning Hands' });

    fireEvent.click(magicMissile);
    fireEvent.click(shield);
    expect(await screen.findByText(/new spells — 2 of 2 chosen/i)).toBeInTheDocument();
    expect(burningHands).toBeDisabled();
    expect(magicMissile).toBeEnabled();
  });
});

describe('LevelChoicePicker — spell choice: TAV-SPELLPICK-POOL-GROUPING cross-group cap (Miko-QA adversarial)', () => {
  it('the leveled cap is a SINGLE cross-level budget: one pick from Level 1 plus one from Level 2 hits a cap of 2 and disables the remaining Level-1 AND Level-2 options', async () => {
    mockGetAvailableSpells.mockResolvedValueOnce(
      availableSpellsFixture({
        cantrips: [],
        by_level: {
          '1': [
            { slug: 'magic-missile', name: 'Magic Missile', level: 1, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
            { slug: 'shield', name: 'Shield', level: 1, school: 'abjuration', concentration: false, ritual: false, in_repertoire: false, prepared: false },
          ],
          '2': [
            { slug: 'scorching-ray', name: 'Scorching Ray', level: 2, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
            { slug: 'misty-step', name: 'Misty Step', level: 2, school: 'conjuration', concentration: false, ritual: false, in_repertoire: false, prepared: false },
          ],
        },
      }),
    );
    // WIZARD_SPELL_CHOICE.spells === 2 — the cap under test.
    renderPicker([{ ...WIZARD_SPELL_CHOICE, cantrips: 0 }]);

    const magicMissile = await screen.findByRole('button', { name: 'Magic Missile' });
    const shield = screen.getByRole('button', { name: 'Shield' });
    const scorchingRay = screen.getByRole('button', { name: 'Scorching Ray' });
    const mistyStep = screen.getByRole('button', { name: 'Misty Step' });

    // Both level groups render up front — the grouping is presentational.
    expect(screen.getByText('Level 1')).toBeInTheDocument();
    expect(screen.getByText('Level 2')).toBeInTheDocument();

    fireEvent.click(magicMissile); // Level-1 pick #1
    fireEvent.click(scorchingRay); // Level-2 pick #2 — cap now full CROSS-group

    expect(await screen.findByText(/new spells — 2 of 2 chosen/i)).toBeInTheDocument();

    // ADVERSARIAL: attempting to exceed the cap from the OTHER (untouched)
    // level-1 slot and the other level-2 slot must both be blocked — a
    // per-group cap bug would leave one or both of these enabled since
    // neither group individually hit "its own" cap of 2.
    expect(shield).toBeDisabled();
    expect(mistyStep).toBeDisabled();
    fireEvent.click(shield);
    fireEvent.click(mistyStep);
    // Still exactly 2 — the disabled buttons must not have toggled through.
    expect(screen.getByText(/new spells — 2 of 2 chosen/i)).toBeInTheDocument();

    // The already-picked buttons in EITHER group stay clickable (to deselect).
    expect(magicMissile).toBeEnabled();
    expect(scorchingRay).toBeEnabled();

    // Deselecting a Level-2 pick frees the budget for the Level-1 leftover —
    // proving the shared Set, not two independent ones.
    fireEvent.click(scorchingRay);
    expect(await screen.findByText(/new spells — 1 of 2 chosen/i)).toBeInTheDocument();
    expect(shield).toBeEnabled();
    fireEvent.click(shield);
    expect(await screen.findByText(/new spells — 2 of 2 chosen/i)).toBeInTheDocument();
    expect(mistyStep).toBeDisabled();
  });

  it('an empty spell-level group (all in_repertoire, or genuinely empty) is dropped from the render entirely, not shown as a headed empty group', async () => {
    mockGetAvailableSpells.mockResolvedValueOnce(
      availableSpellsFixture({
        cantrips: [],
        by_level: {
          '1': [
            { slug: 'magic-missile', name: 'Magic Missile', level: 1, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
          ],
          // Everything at level 2 is already in the repertoire — post-filter
          // this group is empty and must not render a bare "Level 2" heading.
          '2': [
            { slug: 'misty-step', name: 'Misty Step', level: 2, school: 'conjuration', concentration: false, ritual: false, in_repertoire: true, prepared: true },
          ],
        },
      }),
    );
    renderPicker([{ ...WIZARD_SPELL_CHOICE, cantrips: 0 }]);

    await screen.findByRole('button', { name: 'Magic Missile' });
    expect(screen.getByText('Level 1')).toBeInTheDocument();
    expect(screen.queryByText('Level 2')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Misty Step' })).not.toBeInTheDocument();
  });

  it('a11y: the leveled bucket is ONE role="group" spanning all levels, labelled by the single cross-level hint — not one group per level', async () => {
    mockGetAvailableSpells.mockResolvedValueOnce(
      availableSpellsFixture({
        cantrips: [],
        by_level: {
          '1': [
            { slug: 'magic-missile', name: 'Magic Missile', level: 1, school: 'evocation', concentration: false, ritual: false, in_repertoire: false, prepared: false },
          ],
          '2': [
            { slug: 'misty-step', name: 'Misty Step', level: 2, school: 'conjuration', concentration: false, ritual: false, in_repertoire: false, prepared: false },
          ],
        },
      }),
    );
    renderPicker([{ ...WIZARD_SPELL_CHOICE, cantrips: 0 }]);

    await screen.findByRole('button', { name: 'Magic Missile' });
    const groups = screen.getAllByRole('group');
    expect(groups).toHaveLength(1);
    const hint = screen.getByText(/new spells — 0 of 2 chosen/i);
    expect(groups[0]).toHaveAttribute('aria-labelledby', hint.id);
  });
});

describe('LevelChoicePicker — spell choice: Confirm batches learnSpell then resolves', () => {
  it('a wizard leveled spellbook caster: cantrip picks get no prepared arg, leveled picks get prepared:true', async () => {
    const after: CharacterSheet = { ...BASE_SHEET, char_class: 'Wizard', pending_choices: [] };
    mockGetSheet.mockResolvedValue(after);
    const { onResolved } = renderPicker([WIZARD_SPELL_CHOICE]);

    fireEvent.click(await screen.findByRole('button', { name: 'Fire Bolt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Magic Missile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Shield' }));

    fireEvent.click(screen.getByRole('button', { name: /confirm spell choices/i }));
    await flush();

    expect(mockLearnSpell).toHaveBeenCalledWith('cid-1', 'leon', 'fire-bolt');
    expect(mockLearnSpell).toHaveBeenCalledWith('cid-1', 'leon', 'magic-missile', undefined, undefined, true);
    expect(mockLearnSpell).toHaveBeenCalledWith('cid-1', 'leon', 'shield', undefined, undefined, true);
    expect(mockLearnSpell).toHaveBeenCalledTimes(3);

    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'spell:2', {});
    expect(mockGetSheet).toHaveBeenCalledWith('cid-1', 'leon');
    expect(onResolved).toHaveBeenCalledWith(after);
    expect(await screen.findByText(/spell choices confirmed for ashwin/i)).toBeInTheDocument();
  });

  it('a known caster (sorcerer): leveled picks are learned with no prepared override (undefined)', async () => {
    mockGetAvailableSpells.mockResolvedValueOnce(
      availableSpellsFixture({ cantrips: [], budget: { ...availableSpellsFixture().budget, spells_max: 1 } }),
    );
    renderPicker([SORCERER_SPELL_CHOICE]);

    fireEvent.click(await screen.findByRole('button', { name: 'Magic Missile' }));
    fireEvent.click(screen.getByRole('button', { name: /confirm spell choices/i }));
    await flush();

    expect(mockLearnSpell).toHaveBeenCalledWith('cid-1', 'leon', 'magic-missile', undefined, undefined, undefined);
  });

  it('allows Confirm with an empty selection — resolves and clears the prompt regardless', async () => {
    const after: CharacterSheet = { ...BASE_SHEET, pending_choices: [] };
    mockGetSheet.mockResolvedValue(after);
    renderPicker([WIZARD_SPELL_CHOICE]);

    await screen.findByRole('button', { name: 'Fire Bolt' });
    fireEvent.click(screen.getByRole('button', { name: /confirm spell choices/i }));
    await flush();

    expect(mockLearnSpell).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'spell:2', {});
  });

  it('a failed learn surfaces a warn toast but still resolves and clears the prompt', async () => {
    mockLearnSpell.mockImplementation((_cid: string, _u: string, slug: string) =>
      slug === 'fire-bolt' ? Promise.reject(new Error('over_cantrip_limit')) : Promise.resolve({ learned: true }),
    );
    const after: CharacterSheet = { ...BASE_SHEET, pending_choices: [] };
    mockGetSheet.mockResolvedValue(after);
    const { onResolved } = renderPicker([WIZARD_SPELL_CHOICE]);

    fireEvent.click(await screen.findByRole('button', { name: 'Fire Bolt' }));
    fireEvent.click(screen.getByRole('button', { name: /confirm spell choices/i }));
    await flush();

    expect(await screen.findByText(/1 spell pick couldn.?t be learned/i)).toBeInTheDocument();
    // The resolve still fires and clears the prompt — a failed pick never
    // blocks the finalize.
    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'spell:2', {});
    expect(onResolved).toHaveBeenCalledWith(after);
  });
});

describe('LevelChoicePicker — spell choice: busy-latch + fetch failure', () => {
  it('a same-tick double click only calls resolveLevelChoice once', async () => {
    let releaseResolve: (() => void) | undefined;
    mockResolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseResolve = () => resolve({ message: 'ok' });
        }),
    );
    renderPicker([WIZARD_SPELL_CHOICE]);
    await screen.findByRole('button', { name: 'Fire Bolt' });
    const confirm = screen.getByRole('button', { name: /confirm spell choices/i });

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mockResolve).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseResolve?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('a fetch failure shows an error with a Retry that re-fetches', async () => {
    mockGetAvailableSpells.mockImplementationOnce(() => Promise.reject(new Error('network down')));
    renderPicker([WIZARD_SPELL_CHOICE]);

    const errorMsg = await screen.findByText(/couldn.?t load spell options/i);
    expect(errorMsg).toBeInTheDocument();
    // Confirm is still offered — a fetch failure never blocks forgoing picks.
    expect(screen.getByRole('button', { name: /confirm spell choices/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('button', { name: 'Fire Bolt' })).toBeInTheDocument();
    expect(mockGetAvailableSpells).toHaveBeenCalledTimes(2);
  });
});

describe('LevelChoicePicker — spell choice: MUST-FIX loading-gate (Miko-QA irreversible-pick-loss lock)', () => {
  it('Confirm is disabled while getAvailableSpells is still in flight, and clicking it does NOT call resolveLevelChoice', async () => {
    // Never-resolving promise — pins the component in loadState:'loading'
    // for the lifetime of the test, simulating a slow tick.
    mockGetAvailableSpells.mockImplementation(() => new Promise(() => {}));
    renderPicker([WIZARD_SPELL_CHOICE]);

    const confirm = await screen.findByRole('button', { name: /confirm spell choices/i });
    expect(confirm).toBeDisabled();

    // An impatient tap (e.g. a mousedown that slips through a disabled
    // button in some test harnesses, or a stale ref) must never reach
    // resolveLevelChoice — the real regression was silent, irreversible
    // spell-pick loss (the choice is dedupe-by-id and never re-queued).
    fireEvent.click(confirm);
    await flush();
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockLearnSpell).not.toHaveBeenCalled();
  });
});

describe('LevelChoicePicker — spell choice: prepared caster_kind (cleric — cantrips only)', () => {
  it('leveled bucket stays unrendered, cantrip pick sends no prepared override', async () => {
    mockGetAvailableSpells.mockResolvedValue(
      availableSpellsFixture({
        budget: { ...availableSpellsFixture().budget, spells_max: null, prepared_max: 3, prepared_used: 1 },
      }),
    );
    const after: CharacterSheet = { ...BASE_SHEET, char_class: 'Cleric', pending_choices: [] };
    mockGetSheet.mockResolvedValue(after);
    renderPicker([CLERIC_SPELL_CHOICE]);

    expect(await screen.findByText(/cantrips — 0 of 1 chosen/i)).toBeInTheDocument();
    // spells:0 -> the leveled bucket must never render at all.
    expect(screen.queryByText(/new spells —/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Magic Missile' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fire Bolt' }));
    fireEvent.click(screen.getByRole('button', { name: /confirm spell choices/i }));
    await flush();

    // Cleric is caster_kind:'prepared', not 'spellbook' — the cantrip pick
    // must carry NO prepared override (undefined), same as a known caster.
    expect(mockLearnSpell).toHaveBeenCalledWith('cid-1', 'leon', 'fire-bolt');
    expect(mockLearnSpell).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'spell:4', {});
  });
});

describe('LevelChoicePicker — spell choice: two simultaneously-pending choices, no cross-contamination', () => {
  it('picking in one card never bleeds into the other card’s selection state', async () => {
    renderPicker([WIZARD_SPELL_CHOICE, WIZARD_SPELL_CHOICE_L4]);

    const fireBoltButtons = await screen.findAllByRole('button', { name: 'Fire Bolt' });
    expect(fireBoltButtons).toHaveLength(2); // one per card

    // Pick a cantrip ONLY in the first (spell:2) card.
    fireEvent.click(fireBoltButtons[0]);

    const counters = screen.getAllByText(/cantrips — \d of 1 chosen/i);
    expect(counters).toHaveLength(2);
    expect(counters[0]).toHaveTextContent('Cantrips — 1 of 1 chosen');
    // The SECOND card's own counter must be untouched by the first card's pick.
    expect(counters[1]).toHaveTextContent('Cantrips — 0 of 1 chosen');

    // The second card's Fire Bolt option is still selectable — proves the
    // cap-disable state is per-card, not shared.
    expect(fireBoltButtons[1]).toBeEnabled();

    const confirmButtons = screen.getAllByRole('button', { name: /confirm spell choices/i });
    fireEvent.click(confirmButtons[0]);
    await flush();

    // Only the FIRST card's pick (fire-bolt) was ever sent — the second
    // card's state was never touched, so resolving card 1 must not send
    // anything from card 2's (empty) selection.
    expect(mockLearnSpell).toHaveBeenCalledTimes(1);
    expect(mockLearnSpell).toHaveBeenCalledWith('cid-1', 'leon', 'fire-bolt');
    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'spell:2', {});
    expect(mockResolve).not.toHaveBeenCalledWith('cid-1', 'leon', 'spell:4', expect.anything());
  });
});

describe('LevelChoicePicker — spell choice: busy-latch during the learnSpell batch itself', () => {
  it('a same-tick double click on Confirm calls learnSpell exactly once per selected spell, not twice', async () => {
    let releaseLearn: (() => void) | undefined;
    mockLearnSpell.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseLearn = () => resolve({ learned: true });
        }),
    );
    renderPicker([WIZARD_SPELL_CHOICE]);

    fireEvent.click(await screen.findByRole('button', { name: 'Fire Bolt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Magic Missile' }));
    const confirm = screen.getByRole('button', { name: /confirm spell choices/i });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    // Exactly one learnSpell call per selected spell (1 cantrip + 1 leveled)
    // — the busy latch must block the SECOND click's whole handler
    // (including the learnSpell batch), not just the final resolve call.
    expect(mockLearnSpell).toHaveBeenCalledTimes(2);

    await act(async () => {
      releaseLearn?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});

// ── LVL (Kage m4): defensive ascending-by-level sort ─────────────────────────

describe('LVL: stacked-choice ordering', () => {
  it('renders cards ascending by level even when the wire order is shuffled', async () => {
    renderPicker([
      { ...ASI_CHOICE, id: 'asi:4', level: 4 },
      { ...SUBCLASS_CHOICE, id: 'subclass:3', level: 3 },
    ]);
    await flush();
    const headings = screen.getAllByRole('heading', { level: 3 });
    const text = headings.map((h) => h.textContent ?? '').join(' | ');
    // The level-3 subclass card must precede the level-4 ASI card in the DOM
    // regardless of wire order — "in the order they were earned".
    expect(text.toLowerCase().indexOf('archetype')).toBeGreaterThanOrEqual(0);
    expect(text.toLowerCase().indexOf('archetype')).toBeLessThan(
      text.toLowerCase().indexOf('ability score'),
    );
  });
});

// ── LVL-FEAT-SELF-ABORT regression (found live: "Loading feats…" stuck) ──────

describe('feat-mode fetch does not abort itself', () => {
  it("switching to feat mode fetches ONCE and the request's signal is never aborted", async () => {
    mockGetCatalog.mockResolvedValue({
      items: [
        { slug: 'grappler', name: 'Grappler', content_type: 'feat', data: {} },
      ],
    });
    renderPicker([{ ...ASI_CHOICE }]);
    await flush();
    fireEvent.click(screen.getByRole('radio', { name: /take a feat/i }));
    await flush();
    // The pre-fix effect kept featLoadState in its deps: setting 'loading'
    // re-fired it and the cleanup aborted the just-started request. The
    // real network always lost that race (both requests net::ERR_ABORTED,
    // state stuck on 'loading'); the jest mock always WON it, which is why
    // this suite stayed green. Pin the mechanism, not the race: the fetch's
    // AbortSignal must remain un-aborted after settle.
    const featCalls = mockGetCatalog.mock.calls.filter(
      (c) => (c[1] as { type?: string } | undefined)?.type === 'feat',
    );
    expect(featCalls).toHaveLength(1);
    const signal = featCalls[0][2] as AbortSignal;
    expect(signal.aborted).toBe(false);
    expect(screen.getByRole('radio', { name: /grappler/i })).toBeInTheDocument();
    expect(screen.queryByText(/loading feats/i)).not.toBeInTheDocument();
  });

  it('Retry after a failed feat fetch refetches (loadKey bump, not an idle reset)', async () => {
    mockGetCatalog.mockRejectedValueOnce(new Error('boom'));
    renderPicker([{ ...ASI_CHOICE }]);
    await flush();
    fireEvent.click(screen.getByRole('radio', { name: /take a feat/i }));
    await flush();
    expect(screen.getByText(/couldn.t load feats/i)).toBeInTheDocument();
    mockGetCatalog.mockResolvedValue({
      items: [
        { slug: 'grappler', name: 'Grappler', content_type: 'feat', data: {} },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await flush();
    expect(screen.getByRole('radio', { name: /grappler/i })).toBeInTheDocument();
  });
});

describe('LevelChoicePicker — FEAT-PREREQ-UX (prereq-unmet feats disabled inline)', () => {
  // The real wire Grappler row DOES carry prerequisites (5e-bits abbreviated
  // ability names — scripts/import_srd.py::transform_feat emits ["STR"]);
  // the base FEAT_ITEMS fixture's data:{} models a prereq-less feat, which is
  // why every earlier test keeps passing unchanged.
  const GRAPPLER_WITH_PREREQ: CatalogItem[] = [
    {
      slug: 'grappler',
      name: 'Grappler',
      content_type: 'feat',
      source_type: 'srd',
      data: { prerequisites: ['STR'], description: 'You are a grappler.' },
    },
  ];

  function mockFeatCatalog() {
    mockGetCatalog.mockImplementation((_system: string, opts: { type?: string }) => {
      if (opts?.type === 'feat') return Promise.resolve(catalogResponse(GRAPPLER_WITH_PREREQ));
      return Promise.resolve(catalogResponse(SUBCLASS_ITEMS));
    });
  }

  it('an unmet feat renders disabled with the requirement inline, is never auto-selected, arrow-nav skips it, and Confirm stays disabled', async () => {
    mockFeatCatalog();
    renderPicker([ASI_CHOICE], {
      ability_scores: { ...BASE_SHEET.ability_scores, strength: ability(9, -1) },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Take a feat' }));

    // Requirement is part of the option's own text — screen-reader users
    // hear the "why" with the name, not just "dimmed, unavailable".
    const opt = await screen.findByRole('radio', { name: /Grappler — requires STR 13/i });
    expect(opt).toBeDisabled();
    expect(opt).toHaveAttribute('aria-checked', 'false');

    // Every offered feat unmet → the steering hint renders.
    expect(
      screen.getByText(/doesn’t meet any offered feat’s prerequisites/i),
    ).toBeInTheDocument();

    // Arrow movement SELECTS in a radio group — it must skip unmet options
    // rather than arm a pick the engine can only refuse.
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Feat (level 4)' }), {
      key: 'ArrowRight',
    });
    expect(opt).toHaveAttribute('aria-checked', 'false');

    expect(screen.getByRole('button', { name: /confirm feat/i })).toBeDisabled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('the same feat with the prereq met stays enabled, auto-selected, and resolvable', async () => {
    mockFeatCatalog();
    renderPicker([ASI_CHOICE]); // BASE_SHEET: STR 16 — met

    fireEvent.click(screen.getByRole('radio', { name: 'Take a feat' }));
    const opt = await screen.findByRole('radio', { name: 'Grappler' });
    expect(opt).toBeEnabled();
    expect(opt).toHaveAttribute('aria-checked', 'true'); // auto-selected

    fireEvent.click(screen.getByRole('button', { name: /confirm feat/i }));
    await flush();
    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'asi:4', {
      mode: 'feat',
      feat: 'grappler',
    });
  });
});
