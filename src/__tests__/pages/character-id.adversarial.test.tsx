/**
 * DDX-10 — Character sheet page: ADVERSARIAL pass (Miko-QA, break-it).
 *
 * Sibling to character-id.test.tsx (Ren's happy/AC-path suite for the
 * owner-only Level-Up gate). This file covers the one edge that suite
 * doesn't: `isOwner` in page.tsx compares
 * `sheet.owner_username.toLowerCase() === username.toLowerCase()` —
 * a deliberate case-insensitive match with no existing regression lock.
 *
 * SECURITY NOTE (handed to Kuro-Sec / flagged, not a DDX-10 defect): this
 * isOwner check is a CLIENT-SIDE UX GATE ONLY (see the code comment directly
 * above it in page.tsx). It does not, and was never meant to, enforce
 * authorization. Read the source, don't just trust the comment:
 *   - GET /api/dnd/characters/:id/sheet has no ownership check while the
 *     engine's DND_REQUIRE_ACTOR kill-switch is off (confirmed in
 *     NekoNova-DnDEngine routes/characters.py: `guard_owner` only runs
 *     `if enforcement_enabled()`, and `enforcement_enabled()` defaults to
 *     false — engine/authz.py). A non-owner really can load this page today.
 *   - POST /api/dnd/characters/:id/levelup goes one step further than a bare
 *     unauthenticated read: `cmd_levelup` has an ALWAYS-ON internal check
 *     (`character.owner_username != username` -> "[DnD] That's not your
 *     character.") that is independent of the kill-switch. But because Track
 *     A actor-stamping is ALSO inert while the switch is off, that `username`
 *     is whatever the CLIENT'S REQUEST BODY says, not a server-verified
 *     identity (the Tavern proxy only overwrites/verifies `username`/`actor`
 *     on `admin/*` paths — see src/app/api/dnd/[...path]/route.ts's
 *     SECURITY-1 comment; character routes are not admin paths). So the real
 *     guarantee today is "the caller must supply the correct owner username
 *     string", not "the caller must be authenticated as the owner" — the
 *     same trust model every other character-mutating route here already
 *     has (equip/unequip/delete/restore), not something DDX-10 introduces or
 *     worsens. This is a pre-existing, already-tracked (Track A rollout),
 *     cross-project (engine-side) condition, out of scope to fix from
 *     SuzusTavern alone and out of scope for this QA gate's hard rails (no
 *     engine changes, no live mutation) — flagging explicitly rather than
 *     silently treating the client-side button gate as if it were a real
 *     security boundary.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
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
  getCatalog: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import CharacterPage from '../../app/character/[id]/page';
import type { CharacterSheet, User } from '../../lib/api/types';

const mockGet = dnd.getCharacterSheet as jest.MockedFunction<typeof dnd.getCharacterSheet>;
const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;

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
  xp: 300,
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

function renderPageAs(user: User) {
  return render(
    <ThemeProvider><AuthProvider initialUser={user}>
      <ToastProvider>
        <CharacterPage />
      </ToastProvider>
    </AuthProvider></ThemeProvider>,
  );
}

beforeEach(() => {
  mockGet.mockReset();
  mockGetCatalog.mockReset();
  mockGetCatalog.mockResolvedValue({
    system: 'dnd5e',
    content_type: 'class',
    items: [],
    total: 0,
    limit: 100,
    offset: 0,
  });
});

describe('Character sheet — DDX-10 isOwner case-folding edge', () => {
  it('owner match is case-insensitive: sheet owner "alice", logged-in user "ALICE" still gets the button', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, owner_username: 'alice' });
    renderPageAs({ id: 1, username: 'ALICE', email: null });

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.getByRole('button', { name: /^level up$/i })).toBeInTheDocument();
  });

  it('a genuinely different user (differing by more than case) still gets no button', async () => {
    mockGet.mockResolvedValue({ ...ROGUE, owner_username: 'alice' });
    renderPageAs({ id: 2, username: 'Alicia', email: null });

    await screen.findByRole('heading', { level: 1, name: 'Velka Nightquill' });
    expect(screen.queryByRole('button', { name: /level up/i })).not.toBeInTheDocument();
  });
});
