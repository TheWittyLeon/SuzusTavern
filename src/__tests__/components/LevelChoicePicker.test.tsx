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
  getCatalog: jest.fn(),
  getCharacterSheet: jest.fn(),
  resolveLevelChoice: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import LevelChoicePicker from '../../components/LevelChoicePicker';
import type { CatalogItem, CatalogResponse, CharacterSheet, PendingLevelChoice } from '../../lib/api/types';

const mockGetCatalog = dnd.getCatalog as jest.Mock;
const mockGetSheet = dnd.getCharacterSheet as jest.Mock;
const mockResolve = dnd.resolveLevelChoice as jest.Mock;

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
