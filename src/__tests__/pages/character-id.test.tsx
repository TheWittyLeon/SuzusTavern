/**
 * Tests for the character sheet (src/app/character/[id]/page.tsx, ST-054–058).
 * Renders from the structured getCharacterSheet payload.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useParams: () => ({ id: 'abc-123' }),
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
  getCharacterSheet: jest.fn(),
  levelUpCharacter: jest.fn(),
  equipItem: jest.fn(),
  unequipItem: jest.fn(),
  giveItem: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import CharacterPage from '../../app/character/[id]/page';
import type { CharacterSheet, User } from '../../lib/api/types';

const mockGet = dnd.getCharacterSheet as jest.MockedFunction<typeof dnd.getCharacterSheet>;
const ALICE: User = { id: 1, username: 'alice', email: null };

function ability(score: number, modifier: number) {
  return { score, modifier };
}

const ROGUE: CharacterSheet = {
  character_id: 'abc-123',
  owner_username: 'alice',
  name: 'Velka Nightquill',
  race: 'Human',
  subrace: '',
  char_class: 'Rogue',
  subclass: '',
  level: 1,
  background: 'Charlatan',
  alignment: '',
  ability_scores: {
    strength: ability(9, -1),
    dexterity: ability(16, 3),
    constitution: ability(13, 1),
    intelligence: ability(12, 1),
    wisdom: ability(10, 0),
    charisma: ability(14, 2),
  },
  hp: { current: 9, max: 9, temp: 0 },
  ac: 13,
  initiative: 3,
  proficiency_bonus: 2,
  speed: 30,
  xp: 0,
  xp_next: 300,
  hit_dice_remaining: 1,
  proficient_saves: ['dexterity', 'intelligence'],
  proficient_skills: ['deception', 'sleight_of_hand'],
  class_features: ['Sneak Attack', 'Thieves’ Cant'],
  conditions: [],
  spellcasting: null,
  spell_slots: {},
  is_spellcaster: false,
  inventory: [],
  inventory_weight: 0,
};

function renderPage() {
  return render(
    <ThemeProvider><AuthProvider initialUser={ALICE}>
      <ToastProvider>
        <CharacterPage />
      </ToastProvider>
    </AuthProvider></ThemeProvider>,
  );
}

beforeEach(() => {
  mockGet.mockReset();
});

describe('Character sheet', () => {
  it('renders identity, abilities, skills, and features (martial)', async () => {
    mockGet.mockResolvedValue(ROGUE);
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' })).toBeInTheDocument();
    // DEX score box + proficient skill modifier (DEX 16 → +3, +2 prof on sleight_of_hand → +5).
    expect(screen.getByText('16')).toBeInTheDocument();
    expect(screen.getByText('Sleight of Hand')).toBeInTheDocument();
    expect(screen.getByText('Sneak Attack')).toBeInTheDocument();
    // HP meter exposes the values.
    expect(screen.getByRole('meter', { name: /hit points 9 of 9/i })).toBeInTheDocument();
    // Non-caster: no Spells panel.
    expect(screen.queryByText('Spells')).not.toBeInTheDocument();
  });

  // ── TAV-20 ───────────────────────────────────────────────────────────────────
  it('TAV-20: proficiency dots resolve as accessible role="img" nodes — a role-less span with aria-label is invisible to getByRole', async () => {
    mockGet.mockResolvedValue(ROGUE);
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });

    // ROGUE is proficient in dexterity/intelligence saves and deception/sleight_of_hand
    // skills — both "proficient" and "not proficient" dots must be present and
    // resolvable via role="img" (this is exactly the axe aria-prohibited-attr
    // regression: on a bare <span> with no role, aria-label is not exposed as an
    // accessible name to getByRole at all, so this query would find nothing).
    expect(screen.getAllByRole('img', { name: 'proficient' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'not proficient' }).length).toBeGreaterThan(0);
  });

  it('shows the spells panel for a caster', async () => {
    mockGet.mockResolvedValue({
      ...ROGUE,
      name: 'Mira',
      char_class: 'Wizard',
      is_spellcaster: true,
      spellcasting: { ability: 'intelligence', save_dc: 12, attack_bonus: 4 },
      spell_slots: { '1': { max: 2, used: 0, remaining: 2 } },
    });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Mira' });
    expect(screen.getByText(/Spells/)).toBeInTheDocument();
    expect(screen.getByText('Level 1')).toBeInTheDocument();
  });

  // ── TAV-SHEET-HEADING-ORDER ────────────────────────────────────────────────
  it('TAV-SHEET-HEADING-ORDER: section headings are h2 (not h3) — no level skip after the page h1', async () => {
    mockGet.mockResolvedValue(ROGUE);
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });

    // Was h3 — a direct h1 -> h3 skip (axe heading-order, moderate).
    expect(
      screen.getByRole('heading', { level: 2, name: 'Ability scores' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Saving throws' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Skills' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Features' })).toBeInTheDocument();

    // Whole-document lock: no heading level ever increases by more than 1
    // step from the previous heading in DOM order (the actual axe
    // heading-order rule this violation tripped).
    const levels = screen
      .getAllByRole('heading')
      .map((h) => Number(h.tagName.slice(1)));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it('TAV-SHEET-HEADING-ORDER: Inventory (InventoryPanel) is h2 too', async () => {
    mockGet.mockResolvedValue(ROGUE);
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(
      screen.getByRole('heading', { level: 2, name: /^Inventory/ }),
    ).toBeInTheDocument();
  });

  it('shows a friendly error when the sheet cannot be loaded', async () => {
    mockGet.mockRejectedValue(new Error('not found'));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/can.?t find that one/i)).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// CHAR-LANG — Languages card. `languages` is optional on the wire (a
// pre-existing character/fixture created before this field existed has no
// key at all — ROGUE above is exactly that shape); the card must render the
// concrete language pills when present and a muted empty state when absent,
// never crash on `undefined`.
// ---------------------------------------------------------------------------
describe('Character sheet — CHAR-LANG languages card', () => {
  it('renders each language as a pill when the sheet has languages', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, languages: ['Common', 'Equestrian'] });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByRole('heading', { level: 2, name: 'Languages' })).toBeInTheDocument();
    expect(screen.getByText('Common')).toBeInTheDocument();
    expect(screen.getByText('Equestrian')).toBeInTheDocument();
  });

  it('back-compat: a sheet with no languages key at all renders the empty state, never crashes', async () => {
    expect('languages' in ROGUE).toBe(false);
    mockGet.mockResolvedValue(ROGUE);
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByRole('heading', { level: 2, name: 'Languages' })).toBeInTheDocument();
    expect(screen.getByText('No languages recorded.')).toBeInTheDocument();
  });

  it('an explicit empty languages array also renders the empty state', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, languages: [] });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByText('No languages recorded.')).toBeInTheDocument();
  });
});

describe('Character sheet — DDX-10 level-up button gating', () => {
  it('owner + xp >= xp_next: Level up is shown and enabled', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, xp: 300, xp_next: 300 });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByRole('button', { name: /^level up$/i })).toBeEnabled();
  });

  it('owner + xp < xp_next: Level up is shown but disabled with a reason', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, xp: 100, xp_next: 300 });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByRole('button', { name: /^level up$/i })).toBeDisabled();
    expect(screen.getByText('Needs 200 more XP.')).toBeInTheDocument();
  });

  it('level 20 (xp_next null): Level up is shown but disabled as max level', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, level: 20, xp: 355000, xp_next: null });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByRole('button', { name: /^level up$/i })).toBeDisabled();
    expect(screen.getByText('Max level reached.')).toBeInTheDocument();
  });

  it('non-owner viewing the sheet: Level up is not rendered at all', async () => {
    // ALICE (the logged-in user) is not this character's owner.
    mockGet.mockResolvedValue({ ...ROGUE, owner_username: 'someone-else', xp: 300, xp_next: 300 });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.queryByRole('button', { name: /level up/i })).not.toBeInTheDocument();
  });

  // LVL (AC-8, QA gap): the design's own §14 flags this explicitly — AC-8
  // is enforced by the character PAGE's owner-only mount
  // (`{username && isOwner && <LevelUpButton .../>}`), which is agnostic to
  // `sheet.levelup_policy`'s contents. The pre-existing DDX-10 test above
  // only exercises the pre-upgrade fallback shape (no levelup_policy on
  // ROGUE). Pinning the same absence explicitly for a WORKSHOP-mode and a
  // FLOOR-mode verdict closes the gap: a non-owner must never see the
  // button regardless of which of the four levelup_policy modes the SERVER
  // would otherwise grant.
  it('non-owner viewing a sheet in WORKSHOP mode: Level up is still not rendered at all', async () => {
    mockGet.mockResolvedValue({
      ...ROGUE,
      owner_username: 'someone-else',
      levelup_policy: {
        outcome: 'allowed_workshop',
        mode: 'workshop',
        can_level: true,
        xp_short: null,
        floor: null,
        next_level: 2,
      },
    });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    // No level-up AFFORDANCE of any kind (AC-8) — the identity card's own
    // informational "· workshop" XP marker is legitimately visible to any
    // viewer (it's sheet state, not an action), so this only asserts the
    // absence of the button and its flavor-reason copy, not every mention
    // of the word "workshop" on the page.
    expect(screen.queryByRole('button', { name: /level up/i })).not.toBeInTheDocument();
    expect(
      screen.queryByText('Workshop — level freely, no campaign yet.'),
    ).not.toBeInTheDocument();
  });

  it('non-owner viewing a sheet in FLOOR (catch-up) mode: Level up is still not rendered at all', async () => {
    mockGet.mockResolvedValue({
      ...ROGUE,
      owner_username: 'someone-else',
      levelup_policy: {
        outcome: 'allowed_floor',
        mode: 'floor',
        can_level: true,
        xp_short: null,
        floor: 5,
        next_level: 2,
      },
    });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.queryByRole('button', { name: /level up/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/catch up/i)).not.toBeInTheDocument();
  });

  // T13 (DDX-14t/15t) — LevelChoicePicker shares the exact same isOwner gate
  // (page.tsx: `username && isOwner && (sheet.pending_choices?.length ?? 0) > 0`).
  // dnd.ts is NOT mocked with getCatalog/resolveLevelChoice in this file's
  // jest.mock above — if the gate ever regressed and rendered the picker for
  // a non-owner, this test would fail loudly (undefined-is-not-a-function)
  // rather than silently passing, which is a stronger guarantee than just
  // checking for absent text.
  it('non-owner viewing a sheet WITH pending_choices: the level-choice picker is not rendered at all', async () => {
    mockGet.mockResolvedValue({
      ...ROGUE,
      owner_username: 'someone-else',
      pending_choices: [
        { id: 'subclass:3', type: 'subclass', level: 3, class: 'Rogue', label: 'Choose your Rogue archetype' },
      ],
    });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.queryByText(/pending choices/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Choose your Rogue archetype')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T5 / DDX-09 — inventory slice: equip → AC recomputes live on the sheet.
// End-to-end through the REAL page + InventoryPanel (not a component-isolation
// test — that's InventoryPanel.test.tsx). Proves the identity card's AC digit
// updates after an equip round-trip, driven entirely by the page's own
// onChanged={setSheet} wiring.
// ---------------------------------------------------------------------------
describe('Character sheet — T5 inventory: equip recomputes AC live', () => {
  // AC values chosen to not collide with any ability score digit already on
  // the page (9/16/13/12/10/14) or other rendered numbers (level 1, hp "9/9",
  // xp "300", init "+3", prof "+2", speed "30 ft") — getByText does exact
  // text-node matching, and a colliding value would make the query ambiguous.
  const UNARMORED_ROGUE: CharacterSheet = {
    ...ROGUE,
    ac: 19,
    inventory: [
      { name: 'Chain Mail', item_type: 'armor', sub: 'heavy', quantity: 1, equipped: false },
    ],
  };

  it('clicking Equip on an armor item updates the sheet AC without a page reload', async () => {
    mockGet.mockResolvedValueOnce(UNARMORED_ROGUE);
    const mockEquip = dnd.equipItem as jest.MockedFunction<typeof dnd.equipItem>;
    mockEquip.mockResolvedValue({ message: '[DnD] Equipped Chain Mail.' });
    // Second getCharacterSheet call is the panel's own refetch-after-mutate.
    mockGet.mockResolvedValueOnce({
      ...UNARMORED_ROGUE,
      ac: 22,
      inventory: [{ ...UNARMORED_ROGUE.inventory[0], equipped: true }],
    });

    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByText('19')).toBeInTheDocument(); // pre-equip AC

    fireEvent.click(screen.getByRole('button', { name: /^equip\b/i }));

    await waitFor(() => expect(screen.getByText('22')).toBeInTheDocument());
    expect(mockEquip).toHaveBeenCalledWith('abc-123', 'alice', 'Chain Mail');
    expect(screen.getByText('equipped')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T12 (DDX-23t) — CurrencyPurse mount, page-level. Unlike GrantCurrencyPanel
// (whose ENTIRE isDm gate lives in the play page's JSX, see
// play.grantcurrencypanel-gating.test.tsx), CurrencyPurse's own owner gate is
// INSIDE the component (`{isOwner && (...)}`) — its own component test file
// already proves that branch in isolation. What can only be proven by
// mounting the real page: (1) the page's `isOwner` computation — the SAME
// case-folding-prone variable already covered for Level-up/LevelChoicePicker
// in character-id.adversarial.test.tsx — also correctly reaches CurrencyPurse
// end to end, and (2) the `sheet.currency_gp ?? 0` fallback in page.tsx
// itself (CurrencyPurse's own prop type is a plain required `number`, so the
// optional-field-on-the-wire case can ONLY be exercised at this page-level
// seam, not inside CurrencyPurse.test.tsx).
// ---------------------------------------------------------------------------
describe('Character sheet — T12 CurrencyPurse mount (page-level)', () => {
  it('owner sees the Spend gold control', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, owner_username: 'alice', currency_gp: 40 });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByText('40 gp')).toBeInTheDocument();
    expect(screen.getByLabelText('Gold amount')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spend gold' })).toBeInTheDocument();
  });

  it('non-owner sees the purse read-only: no Spend control renders', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, owner_username: 'someone-else', currency_gp: 40 });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByText('40 gp')).toBeInTheDocument();
    expect(screen.queryByLabelText('Gold amount')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Spend gold' })).not.toBeInTheDocument();
  });

  it('a sheet with currency_gp undefined (optional field) renders "0 gp", never NaN, never a crash', async () => {
    // ROGUE itself has no currency_gp key at all — the exact real-world shape
    // named in the mandate (a pre-T12 fixture/snapshot with the field absent).
    expect('currency_gp' in ROGUE).toBe(false);
    mockGet.mockResolvedValue(ROGUE);
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByText('0 gp')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// F6 — MLP-SHEET-SPEED-CRASH (client half). Pre-fix, `<dd>{sheet.speed} ft</dd>`
// handed React a raw object whenever `speed` was a compound dict (MLP
// multi-mode movement, e.g. `{"walk": 25, "fly": 30}`) — a hard "Objects are
// not valid as a React child" crash straight to the ErrorBoundary. The fix
// routes through `raceSpeedLabel` (lib/dnd/codex.ts, DDX21-1 — same crash
// class, already fixed once for the /codex route) so a stray object can
// never reach JSX as a child. This is a belt-and-suspenders CLIENT fix that
// must hold even before the engine's own `_normalize_speed` change lands.
// ---------------------------------------------------------------------------
describe('Character sheet — F6/MLP-SHEET-SPEED-CRASH: defensive speed render', () => {
  it('regression pin: SRD scalar speed (30) still renders as "30 ft."', async () => {
    mockGet.mockResolvedValue(ROGUE);
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByText('30 ft.')).toBeInTheDocument();
  });

  it('MLP compound dict speed ({walk:25, fly:30}) renders a formatted compound string, no crash', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, speed: { walk: 25, fly: 30 } });
    renderPage();

    // Pre-fix this would throw during render ("Objects are not valid as a
    // React child") and never reach this heading at all.
    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByText('25 ft., fly 30 ft.')).toBeInTheDocument();
  });

  it('adversarial junk speed (string) never crashes and never renders "[object Object]"', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, speed: 'fast' as unknown as number });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });

  it('adversarial junk speed (null) never crashes and falls back to the em dash', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, speed: null as unknown as number });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });
});

describe('Character sheet — INVOC chosen feature choices (Kage I2/m8)', () => {
  it('renders each feature_choices group with its picks and Feature-details popover triggers', async () => {
    mockGet.mockResolvedValue({
      ...ROGUE,
      char_class: 'Warlock',
      feature_choices: [
        {
          label: 'Eldritch Invocations',
          picks: [
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
          ],
        },
      ],
    });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    // The group heading renders inside the Features card…
    expect(screen.getByRole('heading', { level: 3, name: 'Eldritch Invocations' })).toBeInTheDocument();
    // …with each chosen pick…
    expect(screen.getByText('Agonizing Blast')).toBeInTheDocument();
    expect(screen.getByText("Devil's Sight")).toBeInTheDocument();
    // …and the popover trigger announces FEATURE details, not spell details
    // (m8: the detailsLabel → aria-label wiring, previously unpinned).
    expect(
      screen.getByRole('button', { name: 'Feature details: Agonizing Blast' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /spell details: agonizing blast/i })).not.toBeInTheDocument();
  });

  it('empty/absent feature_choices renders no group headings (pre-INVOC backend)', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, feature_choices: [] });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.queryByRole('heading', { level: 3, name: /invocations/i })).not.toBeInTheDocument();
  });
});
