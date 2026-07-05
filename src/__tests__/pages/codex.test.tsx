/**
 * Tests for src/app/codex/page.tsx — the in-app 5e compendium (DDX-21).
 *
 * Covers:
 *   - Rail renders all 7 content-type tabs with counts from the manifest fetch
 *   - Loading / error / empty / retry states for the active tab's list
 *   - Spell rows + detail render real catalog fields (level/school/components/
 *     duration/description/higher levels)
 *   - Monster rows + detail render a full stat block (AC/HP/CR/abilities/actions)
 *   - Client-side search filters the loaded list by name
 *   - Switching tabs calls getCatalog with the new type and resets selection
 *   - Rail keyboard navigation (ArrowDown moves the active tab)
 *   - Listbox keyboard navigation (ArrowDown + Enter selects a row)
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
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
  getCatalog: jest.fn(),
  getCatalogCounts: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import CodexPage from '../../app/codex/page';
import type { CatalogItem, User } from '../../lib/api/types';

const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;
const mockGetCatalogCounts = dnd.getCatalogCounts as jest.MockedFunction<typeof dnd.getCatalogCounts>;

const LEON: User = { id: 1, username: 'leon', email: null };

const COUNTS = {
  system: 'dnd5e',
  packs: null,
  content_type: null,
  counts: {
    spell: 2,
    monster: 1,
    item: 0,
    race: 0,
    class: 0,
    background: 0,
    condition: 0,
  },
} as unknown as Awaited<ReturnType<typeof dnd.getCatalogCounts>>;

const FIREBALL: CatalogItem = {
  slug: 'fireball',
  name: 'Fireball',
  content_type: 'spell',
  source_type: 'srd',
  public_id: 'dnd5e:spell:fireball',
  pack_id: 'srd-5e',
  data: {
    level: 3,
    school: 'evocation',
    casting_time: '1 action',
    range: '150 feet',
    components: { V: true, S: true, M: true },
    duration: 'Instantaneous',
    concentration: false,
    ritual: false,
    description: 'A bright streak flashes into an explosion of flame.',
    higher_levels: 'The damage increases by 1d6 for each slot level above 3rd.',
    classes: ['sorcerer', 'wizard'],
  },
};

const MAGE_HAND: CatalogItem = {
  slug: 'mage-hand',
  name: 'Mage Hand',
  content_type: 'spell',
  source_type: 'srd',
  public_id: 'dnd5e:spell:mage-hand',
  pack_id: 'srd-5e',
  data: {
    level: 0,
    school: 'conjuration',
    casting_time: '1 action',
    range: '30 feet',
    components: { V: true, S: true },
    duration: '1 minute',
    concentration: false,
    ritual: false,
    description: 'A spectral hand appears.',
    higher_levels: null,
    classes: ['wizard'],
  },
};

const GOBLIN: CatalogItem = {
  slug: 'goblin',
  name: 'Goblin',
  content_type: 'monster',
  source_type: 'srd',
  public_id: 'dnd5e:monster:goblin',
  pack_id: 'srd-5e',
  data: {
    size: 'Small',
    monster_type: 'humanoid',
    alignment: 'neutral evil',
    ac: 15,
    ac_note: 'leather armor, shield',
    hp_formula: '2d6',
    speed: { walk: 30 },
    senses: { passive_perception: 9 },
    ability_scores: {
      strength: 8,
      dexterity: 14,
      constitution: 10,
      intelligence: 10,
      wisdom: 8,
      charisma: 8,
    },
    cr: 0.25,
    xp: 50,
    languages: ['Common', 'Goblin'],
    actions: [
      {
        name: 'Scimitar',
        description: 'Melee Weapon Attack: +4 to hit. Hit: 5 (1d6 + 2) slashing damage.',
        attack_bonus: 4,
        damage_dice: '1d6+2',
        damage_type: 'slashing',
        is_legendary: false,
      },
    ],
    legendary_actions: [],
    damage_resistances: [],
    damage_immunities: [],
    condition_immunities: [],
  },
};

const SPELL_RESPONSE = {
  system: 'dnd5e',
  content_type: 'spell',
  items: [FIREBALL, MAGE_HAND],
  total: 2,
  limit: 500,
  offset: 0,
};

const MONSTER_RESPONSE = {
  system: 'dnd5e',
  content_type: 'monster',
  items: [GOBLIN],
  total: 1,
  limit: 500,
  offset: 0,
};

function renderCodex() {
  return render(
    <ToastProvider>
      <ThemeProvider>
        <AuthProvider initialUser={LEON} initialMaybeAuthed={false}>
          <CodexPage />
        </AuthProvider>
      </ThemeProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockGetCatalogCounts.mockReset().mockResolvedValue(COUNTS);
  mockGetCatalog.mockReset().mockImplementation((_system, opts) => {
    if (opts?.type === 'monster') return Promise.resolve(MONSTER_RESPONSE as never);
    if (opts?.type === 'spell') return Promise.resolve(SPELL_RESPONSE as never);
    return Promise.resolve({ system: 'dnd5e', content_type: opts?.type ?? null, items: [], total: 0, limit: 500, offset: 0 } as never);
  });
});

// ── Rail / tabs ───────────────────────────────────────────────────────────────

it('renders all 7 content-type tabs with counts from the manifest', async () => {
  renderCodex();
  const tabs = await screen.findAllByRole('tab');
  expect(tabs).toHaveLength(7);
  expect(screen.getByRole('tab', { name: /spells/i })).toHaveAttribute('aria-selected', 'true');
  await waitFor(() => {
    expect(within(screen.getByRole('tab', { name: /spells/i })).getByText('2')).toBeInTheDocument();
  });
  expect(within(screen.getByRole('tab', { name: /monsters/i })).getByText('1')).toBeInTheDocument();
});

it('the heading is the page h1 inside TavernShell', async () => {
  renderCodex();
  expect(await screen.findByRole('heading', { level: 1, name: /codex/i })).toBeInTheDocument();
});

// ── Loading / error / empty ───────────────────────────────────────────────────

it('shows a loading skeleton while the active kind is fetching', () => {
  mockGetCatalog.mockReturnValue(new Promise(() => {}));
  renderCodex();
  expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
});

it('shows the error state and retry button when the catalog fetch fails', async () => {
  mockGetCatalog.mockRejectedValue(new Error('network error'));
  renderCodex();
  expect(await screen.findByText(/can.t reach the codex/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
});

it('retry re-fetches the active kind and shows the list on success', async () => {
  mockGetCatalog
    .mockRejectedValueOnce(new Error('timeout'))
    .mockImplementation((_system, opts) =>
      opts?.type === 'spell' ? Promise.resolve(SPELL_RESPONSE as never) : Promise.resolve(MONSTER_RESPONSE as never),
    );
  renderCodex();
  const retryBtn = await screen.findByRole('button', { name: /try again/i });
  fireEvent.click(retryBtn);
  expect(await screen.findByRole('option', { name: /fireball/i })).toBeInTheDocument();
});

it('shows the empty state when the catalog returns no items for a kind', async () => {
  mockGetCatalog.mockResolvedValue({ system: 'dnd5e', content_type: 'spell', items: [], total: 0, limit: 500, offset: 0 } as never);
  renderCodex();
  expect(await screen.findByText(/no spells are in the catalog yet/i)).toBeInTheDocument();
});

// ── Spell list + detail ───────────────────────────────────────────────────────

it('renders spell rows with level/school meta from the catalog', async () => {
  renderCodex();
  const row = await screen.findByRole('option', { name: /fireball/i });
  expect(within(row).getByText(/level 3/i)).toBeInTheDocument();
  expect(within(row).getByText(/evocation/i)).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /mage hand/i })).toBeInTheDocument();
});

it('selecting a spell shows its full detail card', async () => {
  renderCodex();
  const row = await screen.findByRole('option', { name: /fireball/i });
  fireEvent.click(row);

  // Detail heading
  expect(await screen.findByRole('heading', { level: 2, name: /fireball/i })).toBeInTheDocument();
  // Stat tiles
  expect(screen.getByText('150 feet', { selector: '.statV' })).toBeInTheDocument();
  expect(screen.getByText('1 action', { selector: '.statV' })).toBeInTheDocument();
  // Components + description + at-higher-levels
  expect(screen.getByText('V, S, M')).toBeInTheDocument();
  expect(screen.getByText(/explosion of flame/i)).toBeInTheDocument();
  expect(screen.getByText(/damage increases by 1d6/i)).toBeInTheDocument();
});

it('a cantrip renders "Cantrip" instead of "Level 0"', async () => {
  renderCodex();
  const row = await screen.findByRole('option', { name: /mage hand/i });
  expect(within(row).getByText(/cantrip/i)).toBeInTheDocument();
});

// ── Search ────────────────────────────────────────────────────────────────────

it('search filters the loaded list by name (client-side)', async () => {
  renderCodex();
  await screen.findByRole('option', { name: /fireball/i });
  const search = screen.getByRole('searchbox', { name: /search spells/i });
  fireEvent.change(search, { target: { value: 'mage' } });
  expect(screen.queryByRole('option', { name: /fireball/i })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: /mage hand/i })).toBeInTheDocument();
});

// ── Tab switching → monster stat block ───────────────────────────────────────

it('switching to Monsters fetches type=monster and renders a full stat block', async () => {
  renderCodex();
  await screen.findByRole('option', { name: /fireball/i });

  fireEvent.click(screen.getByRole('tab', { name: /monsters/i }));

  const row = await screen.findByRole('option', { name: /goblin/i });
  expect(within(row).getByText(/cr 1\/4/i)).toBeInTheDocument();
  fireEvent.click(row);

  expect(await screen.findByRole('heading', { level: 2, name: /goblin/i })).toBeInTheDocument();
  // AC / HP / CR stats
  expect(screen.getByText(/15 \(leather armor, shield\)/i)).toBeInTheDocument();
  expect(screen.getByText('2d6')).toBeInTheDocument();
  // Ability score with modifier
  expect(screen.getByText(/14 \(\+2\)/)).toBeInTheDocument();
  // Actions
  expect(screen.getByText(/scimitar/i)).toBeInTheDocument();

  expect(mockGetCatalog).toHaveBeenCalledWith('dnd5e', { type: 'monster', limit: 500 }, expect.anything());
});

it('switching tabs clears the previously selected entry', async () => {
  renderCodex();
  const row = await screen.findByRole('option', { name: /fireball/i });
  fireEvent.click(row);
  expect(await screen.findByRole('heading', { level: 2, name: /fireball/i })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: /monsters/i }));
  await screen.findByRole('option', { name: /goblin/i });
  expect(screen.queryByRole('heading', { level: 2, name: /fireball/i })).not.toBeInTheDocument();
  expect(screen.getByText(/pick a monster/i)).toBeInTheDocument();
});

// ── Keyboard navigation ───────────────────────────────────────────────────────

it('ArrowDown on the rail moves the active tab (roving tabindex)', async () => {
  renderCodex();
  await screen.findAllByRole('tab');
  const spellsTab = screen.getByRole('tab', { name: /spells/i });
  expect(spellsTab).toHaveAttribute('tabindex', '0');
  fireEvent.keyDown(spellsTab, { key: 'ArrowDown' });
  const monstersTab = screen.getByRole('tab', { name: /monsters/i });
  expect(monstersTab).toHaveAttribute('aria-selected', 'true');
  expect(monstersTab).toHaveAttribute('tabindex', '0');
  expect(spellsTab).toHaveAttribute('tabindex', '-1');
  // Let the monster-tab fetch this triggered settle before the test ends.
  await screen.findByRole('option', { name: /goblin/i });
});

it('ArrowDown + Enter in the listbox selects the focused row', async () => {
  renderCodex();
  await screen.findByRole('option', { name: /fireball/i });
  const listbox = screen.getByRole('listbox', { name: /spells results/i });
  fireEvent.keyDown(listbox, { key: 'ArrowDown' }); // focus moves to Mage Hand (index 1)
  fireEvent.keyDown(listbox, { key: 'Enter' });
  expect(await screen.findByRole('heading', { level: 2, name: /mage hand/i })).toBeInTheDocument();
});
