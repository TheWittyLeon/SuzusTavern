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
import { render, screen, fireEvent, act, within } from '@testing-library/react';
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

    expect(mockGetCatalog).toHaveBeenCalledWith('dnd5e', { type: 'subclass', limit: 500 }, expect.anything());
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
    // Both the class-catalog and subclass-catalog fetches (Kage-CR round 2:
    // resolved in parallel via Promise.all) reject — either one failing
    // fails the whole load.
    mockGetCatalog.mockImplementation(() => Promise.reject(new Error('network down')));
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
    // Kage-CR round 2: loadOptions now issues TWO concurrent getCatalog
    // calls per attempt (class, then subclass) — queue a once-rejection for
    // each so the FIRST attempt's pair both fail; the retry's pair falls
    // through to the default (successful) mock.
    mockGetCatalog.mockImplementationOnce(() => Promise.reject(new Error('network down')));
    mockGetCatalog.mockImplementationOnce(() => Promise.reject(new Error('network down')));
    renderPicker([SUBCLASS_CHOICE]);

    await screen.findByText(/couldn.?t load archetype options/i);
    expect(mockGetCatalog).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    // The retry uses the default (successful) mock — options render.
    expect(await screen.findByRole('radio', { name: 'Champion' })).toBeInTheDocument();
    expect(mockGetCatalog).toHaveBeenCalledTimes(4);
  });

  it('filters the class match case-insensitively (engine may send any casing)', async () => {
    // No class-catalog row resolves ('Fighter' isn't seeded there in this
    // fixture) — exercises subclassesForClass's own case-insensitive
    // fallback compare against the raw name.
    mockGetCatalog.mockImplementation((_s: string, opts: { type?: string }) => {
      if (opts?.type === 'class') return Promise.resolve(catalogResponse([]));
      if (opts?.type === 'subclass') {
        return Promise.resolve(
          catalogResponse([catalogItem('champion', 'Champion', { class: 'FIGHTER' })]),
        );
      }
      return Promise.resolve(catalogResponse([]));
    });
    renderPicker([SUBCLASS_CHOICE]);

    expect(await screen.findByRole('radio', { name: 'Champion' })).toBeInTheDocument();
  });

  it('REGRESSION (TAV-SUBCLASS-CLASSKEY-MISMATCH): a MULTI-WORD class name matches slug-keyed subclass rows', async () => {
    /* The live bug: `char_class` is a display name ("Ki Warrior"), a subclass
     * row's `data.class` is a slug ("ki-warrior"). The old filter lowercased
     * both and compared raw, so the space never met the hyphen, the filtered
     * set came back EMPTY, and the card told the player "No archetypes are
     * seeded for Ki Warrior yet" — for a class with six seeded schools.
     *
     * Every SRD class is a single word, which is the ONLY reason the old code
     * held; this is the first multi-word class. Reproduced in the browser on
     * dev as tav-test-1, 2026-08-21. No class-catalog row resolves here
     * either (Kage-CR round 2) — this exercises the raw-name FALLBACK path,
     * which still needs to bridge ordinary multi-word names correctly. */
    const KI_CHOICE: PendingLevelChoice = {
      id: 'subclass:1',
      type: 'subclass',
      level: 1,
      class: 'Ki Warrior',
      label: 'Choose your Ki Warrior archetype',
    };
    mockGetCatalog.mockImplementation((_s: string, opts: { type?: string }) => {
      if (opts?.type === 'class') return Promise.resolve(catalogResponse([]));
      if (opts?.type === 'subclass') {
        return Promise.resolve(
          catalogResponse([
            catalogItem('turtle-school', 'Turtle School', { class: 'ki-warrior' }),
            catalogItem('crane-school', 'Crane School', { class: 'ki-warrior' }),
            // A different class's row must still be excluded — without this the
            // test would also pass if the filter were simply removed.
            catalogItem('champion', 'Champion', { class: 'fighter' }),
          ]),
        );
      }
      return Promise.resolve(catalogResponse([]));
    });
    renderPicker([KI_CHOICE]);

    expect(await screen.findByRole('radio', { name: 'Turtle School' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Crane School' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Champion' })).not.toBeInTheDocument();
    expect(screen.queryByText(/no archetypes are seeded/i)).not.toBeInTheDocument();
  });

  it('shows "no archetypes seeded" and renders no confirm button when the filtered set is empty', async () => {
    mockGetCatalog.mockImplementation(() => Promise.resolve(catalogResponse([])));
    renderPicker([SUBCLASS_CHOICE]);

    expect(await screen.findByText(/no archetypes are seeded for fighter yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
  });

  // Kage-CR round 2: the fetch order is now class-first (resolve the real
  // slug before filtering), not name-first-with-a-conditional-fallback —
  // BOTH getCatalog calls fire on every card render, unconditionally. One
  // extra request per render is the accepted cost of never risking a
  // false-positive name match serving another class's archetypes.
  it('always fetches BOTH the class and subclass catalogs (class-row resolution first)', async () => {
    renderPicker([SUBCLASS_CHOICE]);
    expect(await screen.findByRole('radio', { name: 'Champion' })).toBeInTheDocument();
    expect(mockGetCatalog).toHaveBeenCalledTimes(2);
    expect(mockGetCatalog).toHaveBeenCalledWith('dnd5e', { type: 'class' }, expect.anything());
    expect(mockGetCatalog).toHaveBeenCalledWith('dnd5e', { type: 'subclass', limit: 500 }, expect.anything());
  });

  // Kage-CR round 2: catches the mutation "loadOptions just returns
  // subclassRes.items" — which survived all 80 pre-existing tests, since
  // none of them exercised "class row unresolved AND the subclass catalog
  // is non-empty but contains no match for this class". A private/scoped-
  // away class (its own row invisible to this session) must still fail
  // CLOSED to the empty state, never leak another class's unfiltered rows.
  it('FAIL-CLOSED: a class row that never resolves (private pack scoped away) renders the empty state, not an unfiltered subclass list', async () => {
    const KI_CHOICE: PendingLevelChoice = {
      id: 'subclass:1',
      type: 'subclass',
      level: 1,
      class: 'Ki Warrior',
      label: 'Choose your Ki Warrior archetype',
    };
    mockGetCatalog.mockImplementation((_s: string, opts: { type?: string }) => {
      // Scoped away — the class's own row never resolves.
      if (opts?.type === 'class') return Promise.resolve(catalogResponse([]));
      // Non-empty, but every row is Fighter/Wizard's — none tagged
      // 'ki-warrior'. A `return subclassRes.items` mutation would render
      // these; the correct fallback filter must exclude all of them.
      if (opts?.type === 'subclass') return Promise.resolve(catalogResponse(SUBCLASS_ITEMS));
      return Promise.resolve(catalogResponse([]));
    });
    renderPicker([KI_CHOICE]);

    expect(await screen.findByText(/no archetypes are seeded for ki warrior yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  // TAV-FT-SUBCLASS-SLUG-PREFIX (2026-09-07): the class's SLUG carries a
  // prefix its display NAME doesn't ("Speed Chassis (Sonic)" -> `sonic-
  // speed`, NekoNova-DnDEngine `scripts/seed_data/leon-sonic-5e/10-classes.
  // json`) — the same shape as the Fairy Tail casters, hit here at level 3
  // instead of level 1. `choice.class`/`sheet.char_class` are both display
  // names on the wire (this card has no slug in scope), so the class-row
  // lookup is the ONLY comparison that can resolve it.
  it('REGRESSION (TAV-FT-SUBCLASS-SLUG-PREFIX): a class slug with a prefix the name lacks resolves via the class-catalog lookup', async () => {
    const SONIC_CHOICE: PendingLevelChoice = {
      id: 'subclass:3',
      type: 'subclass',
      level: 3,
      class: 'Speed Chassis (Sonic)',
      label: 'Choose your Speed Chassis (Sonic) archetype',
    };
    mockGetCatalog.mockImplementation((_s: string, opts: { type?: string }) => {
      if (opts?.type === 'class') {
        return Promise.resolve(
          catalogResponse([
            { slug: 'sonic-speed', name: 'Speed Chassis (Sonic)', content_type: 'class', source_type: 'homebrew', data: {} },
          ]),
        );
      }
      if (opts?.type === 'subclass') {
        return Promise.resolve(
          catalogResponse([...SUBCLASS_ITEMS, catalogItem('blur-style', 'Blur Style', { class: 'sonic-speed' })]),
        );
      }
      return Promise.resolve(catalogResponse([]));
    });
    renderPicker([SONIC_CHOICE]);

    expect(await screen.findByRole('radio', { name: 'Blur Style' })).toBeInTheDocument();
    // Off-class rows (Fighter's Champion etc.) must still be excluded.
    expect(screen.queryByRole('radio', { name: 'Champion' })).not.toBeInTheDocument();
    expect(screen.queryByText(/no archetypes are seeded/i)).not.toBeInTheDocument();
    expect(mockGetCatalog).toHaveBeenCalledWith('dnd5e', { type: 'class' }, expect.anything());
  });
});

describe('LevelChoicePicker — R62/TAV-SUBCLASS-LEVEL-OVERRIDE: per-subclass gate on the level-up card', () => {
  // The engine now queues this choice at the class's EFFECTIVE level (1,
  // because two Re:Zero archetypes declare their own subclass_level:1),
  // even though the Rogue chassis's own plain subclass_level is 3 — exactly
  // what `PendingLevelChoice.level` carries per the engine contract.
  const ROGUE_RZ_CHOICE: PendingLevelChoice = {
    id: 'subclass:1',
    type: 'subclass',
    level: 1,
    class: 'Rogue',
    label: 'Choose your Rogue archetype',
  };

  // Kage-CR (2026-09-10): the wire ALSO carries effective_subclass_level:1
  // here (min-across-subclasses — two Re:Zero archetypes below declare 1) —
  // without it on this fixture, a mutation that swaps the card's per-option
  // fallback to `effective_subclass_level ?? subclass_level` would silently
  // land on the SAME 3 (since effective_subclass_level was absent) and every
  // test below would stay green regardless of which field the code actually
  // reads. Present here so that mutation is provably caught.
  const ROGUE_CLASS_ROW: CatalogItem = {
    slug: 'rogue',
    name: 'Rogue',
    content_type: 'class',
    source_type: 'srd',
    data: { subclass_level: 3, effective_subclass_level: 1 },
  };

  const ROGUE_SUBCLASS_ITEMS: CatalogItem[] = [
    catalogItem('thief', 'Thief', { class: 'rogue' }), // no override -> falls back to 3
    catalogItem('assassin', 'Assassin', { class: 'rogue' }),
    catalogItem('sloth', 'Sloth', { class: 'rogue', subclass_level: 1 }),
    catalogItem('gluttony', 'Gluttony', { class: 'rogue', subclass_level: 1 }),
  ];

  function mockRogueCatalog() {
    mockGetCatalog.mockImplementation((_s: string, opts: { type?: string }) => {
      if (opts?.type === 'class') return Promise.resolve(catalogResponse([ROGUE_CLASS_ROW]));
      if (opts?.type === 'subclass') return Promise.resolve(catalogResponse(ROGUE_SUBCLASS_ITEMS));
      return Promise.resolve(catalogResponse([]));
    });
  }

  // Kage-CR trap (2026-09-10): the per-option gate must read each row's OWN
  // subclass_level, falling back to the CLASS's PLAIN subclass_level (3),
  // NEVER the class's effective_subclass_level (1) — the wrong fallback
  // would render Thief/Assassin as pickable at level 1 too, and the engine
  // would refuse each one with subclass_level_not_reached.
  it('at level 1: only the Re:Zero archetypes (own subclass_level:1) are offered; the SRD ones are NOT selectable', async () => {
    mockRogueCatalog();
    renderPicker([ROGUE_RZ_CHOICE], { level: 1 });

    expect(await screen.findByRole('radio', { name: 'Sloth' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Gluttony' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Thief' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Assassin' })).not.toBeInTheDocument();
  });

  it('"unlocks at level N" copy names the SRD chassis\'s own plain gate (3), not the class\'s effective level (1)', async () => {
    mockRogueCatalog();
    renderPicker([ROGUE_RZ_CHOICE], { level: 1 });
    await screen.findByRole('radio', { name: 'Sloth' });

    expect(
      await screen.findByText(/more archetypes unlock at level 3/i),
    ).toBeInTheDocument();
  });

  it('at level 3: the SRD archetypes are now ALSO offered, alongside the already-unlocked Re:Zero ones', async () => {
    mockRogueCatalog();
    renderPicker([ROGUE_RZ_CHOICE], { level: 3 });

    expect(await screen.findByRole('radio', { name: 'Thief' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Assassin' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Sloth' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Gluttony' })).toBeInTheDocument();
    expect(screen.queryByText(/unlock at level/i)).not.toBeInTheDocument();
  });

  it('an enriched pending choice (choice.options already resolved server-side) is authoritative — no catalog fetch at all', async () => {
    const ENRICHED_CHOICE: PendingLevelChoice = {
      ...ROGUE_RZ_CHOICE,
      options: [
        { slug: 'sloth', name: 'Sloth', level: 1 },
        { slug: 'thief', name: 'Thief', level: 3 },
      ],
    };
    renderPicker([ENRICHED_CHOICE], { level: 1 });

    expect(await screen.findByRole('radio', { name: 'Sloth' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Thief' })).not.toBeInTheDocument();
    expect(mockGetCatalog).not.toHaveBeenCalled();
  });

  // Kage-CR (2026-09-10): the engine's OWN skills:1 enrichment shipped bare
  // strings in an earlier build (see normalizeSkillOption's doc comment) —
  // if a subclass enrichment ever does the same, every entry fails the
  // object-shape filter and `enriched` comes back empty even though
  // `choice.options` was non-empty. Treating that as "zero archetypes
  // exist" would render the false "No archetypes are seeded" content-bug
  // message this repo has hit three times already; it must fall through to
  // the ordinary fetch-and-derive path instead.
  it('an enriched choice.options of BARE STRINGS (no usable slug/name) falls through to the fetch path, not "no archetypes"', async () => {
    mockRogueCatalog();
    const BARE_STRING_CHOICE: PendingLevelChoice = {
      ...ROGUE_RZ_CHOICE,
      options: ['sloth', 'gluttony'] as unknown as PendingLevelChoice['options'],
    };
    renderPicker([BARE_STRING_CHOICE], { level: 1 });

    expect(await screen.findByRole('radio', { name: 'Sloth' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Gluttony' })).toBeInTheDocument();
    expect(screen.queryByText(/no archetypes are seeded/i)).not.toBeInTheDocument();
    expect(mockGetCatalog).toHaveBeenCalledWith('dnd5e', { type: 'class' }, expect.anything());
    expect(mockGetCatalog).toHaveBeenCalledWith(
      'dnd5e',
      { type: 'subclass', limit: 500 },
      expect.anything(),
    );
  });

  it('no override signal (choice.level === the class\'s plain subclass_level): every scoped option renders unfiltered, byte-identical to before this ruling', async () => {
    mockGetCatalog.mockImplementation((_s: string, opts: { type?: string }) => {
      if (opts?.type === 'class') return Promise.resolve(catalogResponse([ROGUE_CLASS_ROW]));
      if (opts?.type === 'subclass') return Promise.resolve(catalogResponse(ROGUE_SUBCLASS_ITEMS));
      return Promise.resolve(catalogResponse([]));
    });
    const NO_OVERRIDE_CHOICE: PendingLevelChoice = { ...ROGUE_RZ_CHOICE, level: 3 };
    renderPicker([NO_OVERRIDE_CHOICE], { level: 3 });

    expect(await screen.findByRole('radio', { name: 'Thief' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Assassin' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Sloth' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Gluttony' })).toBeInTheDocument();
  });
});

describe('LevelChoicePicker — subclass-scoped menus (ENGINE-SUBCLASS-SCOPED-MENUS)', () => {
  const FEATURE_CHOICE: PendingLevelChoice = {
    id: 'feature_choice:1',
    type: 'feature_choice',
    level: 1,
    class: 'Ki Warrior',
    menu_label: 'School Technique',
    count: 1,
    label: 'Choose 1 School Technique (level 1)',
    options: [],
  } as PendingLevelChoice;

  const SUBCLASS_PENDING: PendingLevelChoice = {
    id: 'subclass:1',
    type: 'subclass',
    level: 1,
    class: 'Ki Warrior',
    label: 'Choose your Ki Warrior archetype',
  };

  it('says "choose your archetype first" when the menu is empty AND an archetype is still owed', async () => {
    /* A fully subclass-scoped menu is legitimately EMPTY until a School is
     * chosen. The generic empty-state copy is "reload the sheet to try again"
     * — which never helps here, so the player loops forever. */
    renderPicker([SUBCLASS_PENDING, FEATURE_CHOICE]);

    expect(await screen.findByText(/choose your archetype first/i)).toBeInTheDocument();
    expect(screen.queryByText(/reload the sheet to try again/i)).not.toBeInTheDocument();
  });

  it('still shows the generic dead-end copy when the menu is empty and NO archetype is owed', () => {
    /* NEGATIVE CONTROL. Without this, "always say choose-your-archetype" would
     * pass the test above while hiding a genuinely broken menu on every class
     * that has no subclasses at all. */
    renderPicker([FEATURE_CHOICE]);

    expect(screen.getByText(/isn.t available right now/i)).toBeInTheDocument();
    expect(screen.queryByText(/choose your archetype first/i)).not.toBeInTheDocument();
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

describe('LevelChoicePicker — ENGINE-FEAT-ELIGIBILITY-DATA (Kage-CR, 2026-09-10): eligible/why_not off the wire, never re-evaluated', () => {
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

  // The engine's own eligibility verdict rides on the pending choice's
  // `options` (AsiFeatOption[]) — the SAME shape feature_choice/skills
  // choices already use. No catalog fetch, no re-derivation.
  const ASI_CHOICE_STR8_INELIGIBLE = {
    ...ASI_CHOICE,
    options: [
      { slug: 'grappler', name: 'Grappler', eligible: false, why_not: ['Requires Strength 13 or higher'] },
    ],
  };
  const ASI_CHOICE_STR13_ELIGIBLE = {
    ...ASI_CHOICE,
    options: [{ slug: 'grappler', name: 'Grappler', eligible: true, why_not: [] }],
  };
  // No `eligible`/`why_not` keys at all on this one entry — a malformed or
  // pre-migration individual row. Fallback default: eligible.
  const ASI_CHOICE_ABSENT_VERDICT = {
    ...ASI_CHOICE,
    options: [{ slug: 'grappler', name: 'Grappler' }],
  };

  it('STR-8: an ineligible feat renders disabled with its why_not reason as an ACCESSIBLE DESCRIPTION (not folded into the name), is never auto-selected, arrow-nav skips it, and Confirm stays disabled', async () => {
    renderPicker([ASI_CHOICE_STR8_INELIGIBLE], {
      ability_scores: { ...BASE_SHEET.ability_scores, strength: ability(8, -1) },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Take a feat' }));

    // The accessible NAME is just "Grappler" — WCAG 3.3.1: the reason is a
    // DESCRIPTION (aria-describedby), never smuggled into the option's name.
    const opt = await screen.findByRole('radio', { name: 'Grappler' });
    expect(opt).toBeDisabled();
    expect(opt).toHaveAttribute('aria-checked', 'false');
    expect(opt).toHaveAccessibleDescription(/Requires Strength 13 or higher/i);
    // No catalog fetch at all — the engine's own verdict is authoritative.
    expect(mockGetCatalog).not.toHaveBeenCalled();

    // Every offered feat ineligible → the steering hint renders.
    expect(
      screen.getByText(/doesn’t meet any offered feat’s prerequisites/i),
    ).toBeInTheDocument();

    // Arrow movement SELECTS in a radio group — it must skip ineligible
    // options rather than arm a pick the engine can only refuse.
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Feat (level 4)' }), {
      key: 'ArrowRight',
    });
    expect(opt).toHaveAttribute('aria-checked', 'false');

    expect(screen.getByRole('button', { name: /confirm feat/i })).toBeDisabled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('STR-13: the same feat, eligible:true off the wire, renders enabled, auto-selected, and resolvable', async () => {
    renderPicker([ASI_CHOICE_STR13_ELIGIBLE], {
      ability_scores: { ...BASE_SHEET.ability_scores, strength: ability(13, 1) },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Take a feat' }));
    const opt = await screen.findByRole('radio', { name: 'Grappler' });
    expect(opt).toBeEnabled();
    expect(opt).toHaveAttribute('aria-checked', 'true'); // auto-selected
    expect(opt).not.toHaveAttribute('aria-describedby');
    expect(mockGetCatalog).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /confirm feat/i }));
    await flush();
    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'asi:4', {
      mode: 'feat',
      feat: 'grappler',
    });
  });

  it('an option with NO eligible key at all renders enabled — never fail closed on an absent verdict', async () => {
    renderPicker([ASI_CHOICE_ABSENT_VERDICT], {
      ability_scores: { ...BASE_SHEET.ability_scores, strength: ability(8, -1) },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Take a feat' }));
    const opt = await screen.findByRole('radio', { name: 'Grappler' });
    expect(opt).toBeEnabled();
    expect(opt).toHaveAttribute('aria-checked', 'true');
  });

  it('FALLBACK (pre-flag engine, choice carries no options at all): a legacy prerequisites array is never re-evaluated client-side — renders enabled regardless of ability score', async () => {
    // The array-shape evaluator this fix retires used to disable Grappler
    // here for a STR-9 character; the durable fix is that NOTHING client-
    // side computes eligibility from a feat row's raw prerequisites at all
    // — the engine's own resolve is the real (and only) gate in this
    // degrade path.
    mockFeatCatalog();
    renderPicker([ASI_CHOICE], {
      ability_scores: { ...BASE_SHEET.ability_scores, strength: ability(9, -1) },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Take a feat' }));
    const opt = await screen.findByRole('radio', { name: 'Grappler' });
    expect(opt).toBeEnabled();
    expect(mockGetCatalog).toHaveBeenCalledWith('dnd5e', { type: 'feat', limit: 500 }, expect.anything());
  });

  it('FALLBACK: the same feat with the prereq met stays enabled, auto-selected, and resolvable', async () => {
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

describe('LevelChoicePicker — INVOC feature_choice card', () => {
  const INVOCATION_OPTIONS = [
    {
      slug: 'agonizing-blast',
      name: 'Agonizing Blast',
      level: 2,
      description: 'Add your Charisma modifier to eldritch blast damage.',
    },
    {
      slug: "devil's-sight",
      name: "Devil's Sight",
      level: 2,
      description: 'See normally in magical and nonmagical darkness.',
    },
    {
      slug: 'thirsting-blade',
      name: 'Thirsting Blade',
      level: 5,
      description: 'Attack twice with your pact weapon.',
    },
  ];

  function invocChoice(over: Partial<PendingLevelChoice> = {}): PendingLevelChoice {
    return {
      id: 'feature_choice:2',
      type: 'feature_choice',
      level: 2,
      class: 'Warlock',
      label: 'Choose 2 Eldritch Invocations (level 2)',
      menu_label: 'Eldritch Invocations',
      count: 2,
      options: INVOCATION_OPTIONS,
      ...over,
    };
  }

  it('renders the menu from the choice entry itself (no fetch), gates Confirm on exactly `count` picks, and resolves with {picks}', async () => {
    const { onResolved } = renderPicker([invocChoice()], { char_class: 'Warlock' });

    // No fetch — the options ride on the pending entry (sheet enrichment).
    expect(mockGetCatalog).not.toHaveBeenCalled();
    expect(mockGetAvailableSpells).not.toHaveBeenCalled();

    const confirm = screen.getByRole('button', { name: /confirm eldritch invocations/i });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Agonizing Blast' }));
    expect(confirm).toBeDisabled(); // 1 of 2
    fireEvent.click(screen.getByRole('button', { name: "Devil's Sight" }));
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    await flush();
    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'feature_choice:2', {
      picks: expect.arrayContaining(['agonizing-blast', "devil's-sight"]),
    });
    expect(onResolved).toHaveBeenCalled();
  });

  it('an option above the character level renders disabled with the requirement inline (BASE_SHEET is level 3; Thirsting Blade needs 5)', () => {
    renderPicker([invocChoice()], { char_class: 'Warlock' });
    const opt = screen.getByRole('button', { name: /Thirsting Blade — requires level 5/i });
    expect(opt).toBeDisabled();
  });

  it('enforces the pick cap — with count 1, the second option disables once one is chosen', () => {
    renderPicker([invocChoice({ count: 1, label: 'Choose 1 Eldritch Invocation (level 2)' })], {
      char_class: 'Warlock',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agonizing Blast' }));
    expect(screen.getByRole('button', { name: "Devil's Sight" })).toBeDisabled();
    // Toggle back off frees the cap.
    fireEvent.click(screen.getByRole('button', { name: 'Agonizing Blast' }));
    expect(screen.getByRole('button', { name: "Devil's Sight" })).toBeEnabled();
  });

  it('already-known picks leave the new-picks pool; the swap section offers drop-known + add-new and rides the same resolve', async () => {
    const knownPick = {
      slug: 'agonizing-blast',
      name: 'Agonizing Blast',
      level: 2,
      description: 'Add your Charisma modifier to eldritch blast damage.',
    };
    renderPicker(
      [invocChoice({ id: 'feature_choice:5', level: 5, count: 1, label: 'Choose 1 Eldritch Invocation (level 5)' })],
      {
        char_class: 'Warlock',
        level: 5, // Thirsting Blade (level 5) becomes takeable
        feature_choices: [{ label: 'Eldritch Invocations', picks: [knownPick] }],
      },
    );

    // Known pick is not offered as a NEW pick…
    const newPicks = screen.getByRole('group', { name: /new picks/i });
    expect(within(newPicks).queryByRole('button', { name: 'Agonizing Blast' })).not.toBeInTheDocument();
    // …but IS offered as the swap drop — behind the disclosure (Kage I3:
    // the drop/add lists only render, and only enter the tab order, once
    // the player opens the swap).
    fireEvent.click(screen.getByRole('button', { name: /swap a known pick/i }));
    const swapGroup = screen.getByRole('group', { name: /swap one known pick/i });
    expect(within(swapGroup).getByRole('button', { name: 'Agonizing Blast' })).toBeInTheDocument();

    // Required pick first.
    fireEvent.click(within(newPicks).getByRole('button', { name: "Devil's Sight" }));

    // Half a swap blocks Confirm (all-or-nothing).
    const confirm = screen.getByRole('button', { name: /confirm eldritch invocations/i });
    fireEvent.click(within(swapGroup).getByRole('button', { name: 'Agonizing Blast' }));
    expect(confirm).toBeDisabled();
    fireEvent.click(within(swapGroup).getByRole('button', { name: 'Thirsting Blade' }));
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    await flush();
    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'feature_choice:5', {
      picks: ["devil's-sight"],
      swap: { drop: 'agonizing-blast', add: 'thirsting-blade' },
    });
  });

  it('missing options (enrichment absent) is an honest dead-end — message shown, Confirm disabled', () => {
    renderPicker([invocChoice({ options: undefined })], { char_class: 'Warlock' });
    // Substring within one text node — the menu label is a separate JSX
    // interpolation, so a cross-node regex would never match.
    expect(screen.getByText(/menu isn’t available right now/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /confirm eldritch invocations/i }),
    ).toBeDisabled();
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe('Miko-QA adversarial — INVOC feature_choice card', () => {
  const INVOCATION_OPTIONS = [
    {
      slug: 'agonizing-blast',
      name: 'Agonizing Blast',
      level: 2,
      description: 'Add your Charisma modifier to eldritch blast damage.',
    },
    {
      slug: "devil's-sight",
      name: "Devil's Sight",
      level: 2,
      description: 'See normally in magical and nonmagical darkness.',
    },
    {
      slug: 'thirsting-blade',
      name: 'Thirsting Blade',
      level: 5,
      description: 'Attack twice with your pact weapon.',
    },
  ];

  function invocChoice(over: Partial<PendingLevelChoice> = {}): PendingLevelChoice {
    return {
      id: 'feature_choice:2',
      type: 'feature_choice',
      level: 2,
      class: 'Warlock',
      label: 'Choose 2 Eldritch Invocations (level 2)',
      menu_label: 'Eldritch Invocations',
      count: 2,
      options: INVOCATION_OPTIONS,
      ...over,
    };
  }

  it('Miko P2-2 FIXED: count > eligible-at-level options now says WHY Confirm can never enable', () => {
    // A level-2 character offered a choice that asks for 2 picks, but ALL
    // non-known options on the menu require a higher level. Unreachable
    // with the real 32-entry warlock catalog (always >=16 level-2-eligible
    // options) but reachable for a thin homebrew menu (the CONTENT-BREADTH
    // risk — see test_declared_empty_options_list_strands_the_menu on the
    // engine). Previously an UNMESSAGED dead end indistinguishable from
    // "hasn't clicked yet"; the card now names the shortfall.
    const allUnmetOptions = [
      { slug: 'a', name: 'Option A', level: 9, description: 'x' },
      { slug: 'b', name: 'Option B', level: 9, description: 'y' },
    ];
    renderPicker([invocChoice({ options: allUnmetOptions })], {
      char_class: 'Warlock',
      level: 2,
    });

    const confirm = screen.getByRole('button', { name: /confirm eldritch invocations/i });
    // Both options stay visible-but-disabled (the intended "plan ahead" UX)…
    expect(screen.getByRole('button', { name: /Option A — requires level 9/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Option B — requires level 9/i })).toBeDisabled();
    expect(confirm).toBeDisabled();
    // …and the shortfall copy explains the stuck state.
    expect(
      screen.getByText(/only 0 of the 2 required picks are available at level 2/i),
    ).toBeInTheDocument();
  });

  it('Miko P2-2 rider: no shortfall copy when enough options are eligible', () => {
    renderPicker([invocChoice()], { char_class: 'Warlock' });
    expect(screen.queryByText(/required picks .* available at level/i)).not.toBeInTheDocument();
  });

  it('FINDING (P3): a sheet feature_choices group label that drifts from choice.menu_label hides the swap section AND fails to exclude already-known picks from the new-picks pool', () => {
    // known matching is `sheet.feature_choices.find(g => g.label ===
    // choice.menu_label)` — an exact-string match with no normalization.
    // If the two ever diverge (e.g. a catalog label rename lands between an
    // earlier resolve and a later queue), the client silently treats the
    // character as knowing NOTHING from this menu.
    const knownPick = {
      slug: 'agonizing-blast',
      name: 'Agonizing Blast',
      level: 2,
      description: 'x',
    };
    renderPicker(
      [invocChoice({ id: 'feature_choice:5', level: 5, count: 1, menu_label: 'Eldritch Invocations' })],
      {
        char_class: 'Warlock',
        level: 5,
        // Label drifted ("Invocations" -> "Invocation") relative to the
        // pending choice's menu_label.
        feature_choices: [{ label: 'Eldritch Invocation', picks: [knownPick] }],
      },
    );

    // No swap section at all — the character's real known pick is invisible.
    expect(screen.queryByRole('group', { name: /swap one known pick/i })).not.toBeInTheDocument();
    // Worse: the ALREADY-KNOWN option is offered as a fresh new pick.
    const newPicks = screen.getByRole('group', { name: /new picks/i });
    expect(within(newPicks).getByRole('button', { name: 'Agonizing Blast' })).toBeInTheDocument();
    // A player who picks it will be refused server-side (duplicate_option)
    // — not a security issue (server re-validates), but a confusing,
    // entirely avoidable refusal for a state the client had the data to
    // prevent.
  });

  it('a same-tick double click on Confirm only calls resolveLevelChoice once', async () => {
    let releaseResolve: (() => void) | undefined;
    mockResolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseResolve = () => resolve({ message: 'ok' });
        }),
    );
    renderPicker([invocChoice()], { char_class: 'Warlock' });
    fireEvent.click(screen.getByRole('button', { name: 'Agonizing Blast' }));
    fireEvent.click(screen.getByRole('button', { name: "Devil's Sight" }));
    const confirm = screen.getByRole('button', { name: /confirm eldritch invocations/i });

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mockResolve).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseResolve?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('Miko P2-1 FIXED: picking a new-pick slug that is also the current swap-add withdraws the WHOLE swap — Confirm enables, resolve carries no swap', async () => {
    // The original defect: togglePick's cross-clear only cleared swapAdd,
    // leaving swapDrop pressed — the all-or-nothing invariant broke with no
    // user action on the swap section and no copy explaining the dead
    // Confirm. Fixed: the collision clears BOTH halves (picking the option
    // as a new pick withdraws the swap intent), and while a swap is
    // half-selected the card now says so ("Finish the swap … or clear it").
    const knownPick = {
      slug: 'agonizing-blast',
      name: 'Agonizing Blast',
      level: 2,
      description: 'x',
    };
    renderPicker(
      [invocChoice({ id: 'feature_choice:5', level: 5, count: 1, menu_label: 'Eldritch Invocations' })],
      {
        char_class: 'Warlock',
        level: 5,
        feature_choices: [{ label: 'Eldritch Invocations', picks: [knownPick] }],
      },
    );
    fireEvent.click(screen.getByRole('button', { name: /swap a known pick/i })); // Kage I3 disclosure
    const swapGroup = screen.getByRole('group', { name: /swap one known pick/i });
    const dropBtn = within(swapGroup).getByRole('button', { name: 'Agonizing Blast' });
    fireEvent.click(dropBtn); // swapDrop = 'agonizing-blast'
    // Half-swap state now has explanatory copy (the P2-1 rider).
    expect(screen.getByText(/finish the swap \(pick its replacement\)/i)).toBeInTheDocument();
    fireEvent.click(within(swapGroup).getByRole('button', { name: "Devil's Sight" })); // swapAdd
    expect(screen.queryByText(/finish the swap/i)).not.toBeInTheDocument();

    const newPicks = screen.getByRole('group', { name: /new picks/i });
    // Pick the SAME slug that is currently the swap-add, as a new pick.
    fireEvent.click(within(newPicks).getByRole('button', { name: "Devil's Sight" }));

    expect(screen.getByText(/new picks — 1 of 1 chosen/i)).toBeInTheDocument();
    // The WHOLE swap withdrew — drop is no longer pressed, no half-state.
    expect(dropBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/finish the swap/i)).not.toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: /confirm eldritch invocations/i });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await flush();
    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'feature_choice:5', {
      picks: ["devil's-sight"], // no swap key — the intent was withdrawn
    });
  });
});

describe('LevelChoicePicker — Kage I3 swap disclosure', () => {
  const knownPick = {
    slug: 'agonizing-blast',
    name: 'Agonizing Blast',
    level: 2,
    description: 'x',
  };
  const swapChoice = (): PendingLevelChoice => ({
    id: 'feature_choice:5',
    type: 'feature_choice',
    level: 5,
    class: 'Warlock',
    label: 'Choose 1 Eldritch Invocation (level 5)',
    menu_label: 'Eldritch Invocations',
    count: 1,
    options: [
      knownPick,
      { slug: "devil's-sight", name: "Devil's Sight", level: 2, description: 'y' },
      { slug: 'eldritch-spear', name: 'Eldritch Spear', level: 2, description: 'z' },
    ],
  });
  const swapSheet = (): Partial<CharacterSheet> => ({
    char_class: 'Warlock',
    level: 5,
    feature_choices: [{ label: 'Eldritch Invocations', picks: [knownPick] }],
  });

  it('the drop/add lists are OUT of the DOM until opened (the ~124-tab-stop fix)', () => {
    renderPicker([swapChoice()], swapSheet());
    expect(screen.queryByRole('group', { name: /swap one known pick/i })).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /swap a known pick/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('group', { name: /swap one known pick/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide swap/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('closing the disclosure clears a partial swap so a hidden half-selection cannot hold Confirm hostage', () => {
    renderPicker([swapChoice()], swapSheet());
    fireEvent.click(screen.getByRole('button', { name: /swap a known pick/i }));
    const swapGroup = screen.getByRole('group', { name: /swap one known pick/i });
    fireEvent.click(within(swapGroup).getByRole('button', { name: 'Agonizing Blast' })); // half a swap
    // Required pick.
    const newPicks = screen.getByRole('group', { name: /new picks/i });
    fireEvent.click(within(newPicks).getByRole('button', { name: "Devil's Sight" }));
    const confirm = screen.getByRole('button', { name: /confirm eldritch invocations/i });
    expect(confirm).toBeDisabled(); // half-swap blocks
    // Kage r2-7: with a selection present, the close button says what it
    // DOES — Cancel swap, not a neutral Hide.
    expect(screen.queryByRole('button', { name: /hide swap/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cancel swap/i }));
    expect(confirm).toBeEnabled(); // partial swap cleared with the close
  });

  it('m6: a count-less (malformed) entry is a dead end, not confirmable at zero picks', () => {
    const noCount = { ...swapChoice(), count: undefined, label: 'Corrupted entry' };
    renderPicker([noCount], swapSheet());
    expect(screen.getByText(/menu isn’t available right now/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm eldritch invocations/i })).toBeDisabled();
  });
});

describe('LevelChoicePicker — skills choice (ORACLE-CANDIDATE-1, 2026-09-08)', () => {
  function skillsChoice(over: Partial<PendingLevelChoice> = {}): PendingLevelChoice {
    return {
      id: 'skills:1',
      type: 'skills',
      level: 1,
      class: 'Fighter',
      label: 'Choose 2 class skills',
      count: 2,
      options: [
        { slug: 'athletics', name: 'Athletics' },
        { slug: 'perception', name: 'Perception' },
        { slug: 'stealth', name: 'Stealth' },
      ],
      ...over,
    };
  }

  it('renders the menu from the choice entry itself (no fetch), gates Confirm on exactly `count` picks, and resolves with {picks}', async () => {
    const { onResolved } = renderPicker([skillsChoice()]);

    // No fetch — the options ride on the pending entry (sheet enrichment).
    expect(mockGetCatalog).not.toHaveBeenCalled();
    expect(mockGetAvailableSpells).not.toHaveBeenCalled();

    const confirm = screen.getByRole('button', { name: /confirm choose 2 class skills/i });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Athletics' }));
    expect(confirm).toBeDisabled(); // 1 of 2
    fireEvent.click(screen.getByRole('button', { name: 'Perception' }));
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    await flush();
    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'skills:1', {
      picks: expect.arrayContaining(['athletics', 'perception']),
    });
    expect(onResolved).toHaveBeenCalled();
  });

  it('enforces the pick cap — the third option disables once two are chosen', () => {
    renderPicker([skillsChoice()]);
    fireEvent.click(screen.getByRole('button', { name: 'Athletics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Perception' }));
    expect(screen.getByRole('button', { name: 'Stealth' })).toBeDisabled();
    // Toggle one back off frees the cap.
    fireEvent.click(screen.getByRole('button', { name: 'Athletics' }));
    expect(screen.getByRole('button', { name: 'Stealth' })).toBeEnabled();
  });

  // Kage-CR follow-up (2026-09-08), suggestion 2: same TAV-A11Y-CAP-HINT
  // mechanism as the wizard's RungStep/SkillsStep (third instance) — a
  // capped, disabled option must reference a hidden hint explaining why,
  // since native `disabled` drops it from the Tab order.
  it('a capped option references the hidden cap hint; an unpicked option below cap does not', () => {
    renderPicker([skillsChoice()]);
    const athletics = screen.getByRole('button', { name: 'Athletics' });
    const stealth = screen.getByRole('button', { name: 'Stealth' });
    // Below cap: nothing is disabled, so nothing references the hint.
    expect(stealth).not.toHaveAttribute('aria-describedby');
    fireEvent.click(athletics);
    fireEvent.click(screen.getByRole('button', { name: 'Perception' }));
    // At cap: the now-disabled Stealth option references the hidden hint.
    expect(stealth).toHaveAttribute('aria-describedby', expect.stringContaining('cap-hint'));
    expect(
      document.getElementById(stealth.getAttribute('aria-describedby')!)?.textContent,
    ).toMatch(/You.ve chosen all 2 skills — deselect one to pick another/i);
  });

  it('TOLERANCE (coordinator note, 2026-09-08): a bare skill-slug string per option renders and resolves identically to {slug, name}', async () => {
    renderPicker([skillsChoice({ options: ['athletics', 'perception', 'stealth'] as never })]);
    // Bare string is humanized for display.
    const athletics = screen.getByRole('button', { name: 'Athletics' });
    fireEvent.click(athletics);
    fireEvent.click(screen.getByRole('button', { name: 'Perception' }));
    fireEvent.click(screen.getByRole('button', { name: /confirm choose 2 class skills/i }));
    await flush();
    expect(mockResolve).toHaveBeenCalledWith('cid-1', 'leon', 'skills:1', {
      picks: expect.arrayContaining(['athletics', 'perception']),
    });
  });

  it('missing options (enrichment absent) is an honest dead-end — message shown, Confirm disabled, resolve never attempted', () => {
    renderPicker([skillsChoice({ options: undefined })]);
    expect(
      screen.getByText(/no skill options are available right now/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /confirm choose 2 class skills/i }),
    ).toBeDisabled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('a count-less (malformed) entry is a dead end, not confirmable at zero picks (m6 precedent)', () => {
    renderPicker([skillsChoice({ count: undefined })]);
    expect(
      screen.getByText(/no skill options are available right now/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /confirm choose 2 class skills/i }),
    ).toBeDisabled();
  });

  it('a resolve failure surfaces the curated refusal copy and releases the busy latch', async () => {
    const err = Object.assign(new Error('[DnD] Bad shape.'), {
      status: 400,
      body: { data: { reason: 'invalid_skills_choice' } },
    });
    mockResolve.mockRejectedValueOnce(err);
    renderPicker([skillsChoice()]);
    fireEvent.click(screen.getByRole('button', { name: 'Athletics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Perception' }));
    const confirm = screen.getByRole('button', { name: /confirm choose 2 class skills/i });
    fireEvent.click(confirm);
    await flush();
    expect(
      screen.getByText(/that selection doesn.t match the expected shape/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\[DnD\]/)).not.toBeInTheDocument();
    // Busy latch released — Confirm is clickable again (still enabled, 2/2 picked).
    expect(confirm).toBeEnabled();
  });

  it('a same-tick double click only resolves once (busy latch)', async () => {
    renderPicker([skillsChoice()]);
    fireEvent.click(screen.getByRole('button', { name: 'Athletics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Perception' }));
    const confirm = screen.getByRole('button', { name: /confirm choose 2 class skills/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await flush();
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });
});
