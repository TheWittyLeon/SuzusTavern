/**
 * A9c-2 D5 (R3, build brief 6/10) — the real-page render matrix. The REAL /play
 * page, mounted six times (story and table x exploring and combat on a desktop,
 * the phone row x exploring and combat), asserts that every variant-consuming
 * region's root carries `data-variant === variantFor(row, region, moment)`.
 * That is the page wiring half of the contract: the component half (each region
 * stamps what it is handed and renders differently per member) is
 * `region-variants.contract.test.tsx`. A page that passes `variant="full"` to
 * TopBar, or `variant="full"` to SuzuPresence, regardless of the row, is red
 * here and nowhere else.
 */
import React from 'react';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { Session, Participant } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'dm_alice', email: null } }),
}));
jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));
jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  // the table's characterBlock mounts MemberSheetPanel, which reads class feature text
  getCatalog: jest.fn(() => Promise.resolve({ items: [] })),
  postSessionEvent: jest.fn(() => Promise.resolve({ seq: 1 })),
  pauseSession: jest.fn(),
  resumeSession: jest.fn(),
  endSession: jest.fn(),
  awardSessionXp: jest.fn(),
  advanceScene: jest.fn(),
  resolveCheck: jest.fn(),
  npcAction: jest.fn(),
  combatFromScene: jest.fn(),
  rollInitiative: jest.fn(),
  monsterTurn: jest.fn(),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  endCombat: jest.fn(),
  setFlag: jest.fn(),
  submitOverride: jest.fn(),
  bindCharacter: jest.fn(),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));
jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' };
  }),
}));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';
import { PLAY_PHONE_QUERY } from '@/lib/breakpoints';
import {
  ANNOUNCING_REGIONS,
  FOLDABLE_REGIONS,
  LAYOUT_ROWS_BY_ID,
  REGION_TENANTS,
  REGION_VARIANTS,
  getPlacement,
  variantFor,
  type TenantId,
  type LayoutId,
  type Moment,
  type RegionId,
} from '@/app/play/[sessionId]/presets';
import type { CombatState } from '@/lib/api/types';

const SESSION: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'active',
  dm_username: 'dm_alice',
  name: 'The Hollow Tide',
  dm_mode: 'ai',
  ai_assist_level: 'full',
};
const PARTY: Participant[] = [
  { username: 'dm_alice', is_dm: true, character: null },
  {
    username: 'kes',
    is_dm: false,
    character: { character_id: 'c1', name: 'Kestrel', char_class: 'Ranger', level: 4, current_hp: 27, max_hp: 34, ac: 16 },
  },
];
/**
 * The combat cells need a CASTER at the table: `castSpellPanel` is the second actionBar
 * tenant, and "the X-card stays last" (below) says nothing unless something sits before
 * it. The viewer (`dm_alice`, AI table so not a human DM) is bound to the combatant
 * `c1`; her sheet is a spellcaster's.
 */
const CASTER_PARTY: Participant[] = [
  {
    username: 'dm_alice',
    is_dm: true,
    character: { character_id: 'c1', name: 'Kestrel', char_class: 'Wizard', level: 4, current_hp: 27, max_hp: 34, ac: 16 },
  },
  {
    username: 'kes',
    is_dm: false,
    character: { character_id: 'c2', name: 'Pip', char_class: 'Ranger', level: 4, current_hp: 30, max_hp: 30, ac: 15 },
  },
];
const CASTER_SHEET = {
  character_id: 'c1',
  owner_username: 'dm_alice',
  name: 'Kestrel',
  race: 'Human',
  subrace: '',
  char_class: 'Wizard',
  subclass: '',
  level: 4,
  background: 'Sage',
  alignment: '',
  ability_scores: {
    strength: { score: 8, modifier: -1 },
    dexterity: { score: 14, modifier: 2 },
    constitution: { score: 12, modifier: 1 },
    intelligence: { score: 16, modifier: 3 },
    wisdom: { score: 10, modifier: 0 },
    charisma: { score: 10, modifier: 0 },
  },
  hp: { current: 27, max: 34, temp: 0 },
  ac: 16,
  initiative: 2,
  proficiency_bonus: 2,
  speed: 30,
  xp: 2700,
  xp_next: 6500,
  hit_dice_remaining: 4,
  proficient_saves: ['intelligence', 'wisdom'],
  proficient_skills: [],
  skills: [],
  class_features: [],
  conditions: [],
  spellcasting: { ability: 'intelligence', save_dc: 13, attack_bonus: 5 },
  spell_slots: { '1': { max: 4, used: 0, remaining: 4 }, '2': { max: 3, used: 0, remaining: 3 } },
  is_spellcaster: true,
  inventory: [],
  inventory_weight: 0,
};
const COMBAT = {
  combat_id: 'combat-1',
  session_id: 's1',
  round: 1,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'p1',
  initiative: ['p1', 'm1'],
  participants: [
    { participant_id: 'p1', entity_id: 'c1', name: 'Kestrel', is_pc: true, initiative: 15, hp_current: 27, hp_max: 34, ac: 16, conditions: [], is_alive: true, can_be_targeted: false, is_active_turn: true, took_turn: false },
    { participant_id: 'm1', entity_id: 'g1', name: 'Goblin', is_pc: false, initiative: 9, hp_current: 7, hp_max: 7, ac: 13, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false },
  ],
} as unknown as CombatState;

const realMatchMedia = window.matchMedia;
function setPhone(isPhone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isPhone && query === PLAY_PHONE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-layout');
});
afterAll(() => {
  window.matchMedia = realMatchMedia;
});

/** Regions that consume a variant today (the contract test owns the list). */
// A9d-2 N5: the stage joins (it reads its row's variant: `inline` on the phone, `panel` / `hero` as before). N7: so does the composer (`roll` on
// the phone, `full` elsewhere).
const CONSUMING: readonly RegionId[] = ['topBar', 'suzuPresence', 'partyStrip', 'offers', 'actionBar', 'sceneStage', 'composer'] as const;

interface Cell {
  name: string;
  row: LayoutId;
  moment: Moment;
  /** `tavern.layout` stored before mount; null = Auto. */
  pref: 'story' | 'table' | null;
  phone: boolean;
}
const CELLS: Cell[] = [
  { name: 'story x exploring (desktop)', row: 'story', moment: 'exploring', pref: 'story', phone: false },
  { name: 'story x combat (desktop)', row: 'story', moment: 'combat', pref: 'story', phone: false },
  { name: 'table x exploring (desktop)', row: 'table', moment: 'exploring', pref: 'table', phone: false },
  { name: 'table x combat (desktop)', row: 'table', moment: 'combat', pref: 'table', phone: false },
  // A phone has one layout whatever the preference says (R16), so Auto here.
  { name: 'phone x exploring', row: 'phone', moment: 'exploring', pref: null, phone: true },
  { name: 'phone x combat', row: 'phone', moment: 'combat', pref: null, phone: true },
];

const LIVE = '[aria-live], [role="status"], [role="alert"], [role="log"]';
const checked: Record<string, number> = {};
const slotSets = new Map<string, Set<string>>();
const tenantsSeen = new Set<string>();
const foldChecked = { collapsible: 0, inert: 0 };

/**
 * Plan 4.1 / build brief section 4.1: the settled DOM order of the top-level slots,
 * as LITERALS (a hidden slot is `o°`, an overlay `o▲`). Pinned here on the real
 * page and in the registry test on `slotOrder` (A9d E2: every region, the phone's
 * partyStrip and suzuPresence included, is a top-level slot).
 */
const ORDER_LITERALS: Record<string, string> = {
  // A10 step 11 round 3 (named exception): the offers are last in both exploring rows (story, text box, X-card, offers)
  'story exploring': 'safetyBanner, topBar, partyStrip, suzuPresence, storyLog, sceneStage, composer, actionBar, offers',
  'story combat': 'safetyBanner, topBar, partyStrip, suzuPresence, sceneStage, storyLog, offers°, composer, actionBar',
  'table exploring': 'safetyBanner, partyStrip, topBar▲, sceneStage, characterBlock, suzuPresence, storyLog, composer, actionBar, offers',
  'table combat': 'safetyBanner, partyStrip, topBar▲, sceneStage, characterBlock, suzuPresence, storyLog, offers°, composer, actionBar',
  'phone exploring': 'safetyBanner, topBar, suzuPresence, partyStrip, sceneStage, storyLog, offers, composer, actionBar',
  'phone combat': 'safetyBanner, topBar, suzuPresence, partyStrip, sceneStage, storyLog, offers°, composer, actionBar',
};
const slotOf = (el: Element) => el.closest('[data-region-slot]');
const slotId = (el: Element) => slotOf(el)?.getAttribute('data-region-slot') ?? null;

describe('/play real-page render matrix (4 desktop + 2 phone)', () => {
  it.each(CELLS)('$name: every variant-consuming region carries its row\'s variant', async (cell) => {
    setPhone(cell.phone);
    if (cell.pref) window.localStorage.setItem('tavern.layout', cell.pref);
    const combat = cell.moment === 'combat';
    (dnd.getSession as jest.Mock).mockResolvedValue({ ...SESSION, ...(combat ? { active_combat_id: 'combat-1' } : {}) });
    (dnd.getParticipants as jest.Mock).mockResolvedValue(combat ? CASTER_PARTY : PARTY);
    (dnd.getCharacterSheet as jest.Mock).mockResolvedValue(combat ? CASTER_SHEET : null);
    (dnd.getCombatState as jest.Mock).mockResolvedValue(combat ? COMBAT : null);

    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    const root = container.querySelector('[data-layout-resolved]') as HTMLElement;
    await waitFor(() => {
      expect(root).toHaveAttribute('data-layout-resolved', cell.row);
      expect(root).toHaveAttribute('data-moment', cell.moment);
    });
    if (combat) await waitFor(() => expect(container.querySelector('[data-region="actionBar"]')).not.toBeNull());

    const row = LAYOUT_ROWS_BY_ID[cell.row];
    for (const region of CONSUMING) {
      const el = container.querySelector(`[data-region="${region}"]`);
      // actionBar mounts in combat only, by design (page.tsx): absent while exploring.
      if (!el) {
        expect(region === 'actionBar' && !combat).toBe(true);
        continue;
      }
      const want = variantFor(row, region as keyof typeof REGION_VARIANTS, cell.moment);
      const got = el.getAttribute('data-variant');
      if (want !== undefined) expect([region, got]).toEqual([region, want]);
      // the row declares nothing here (offers in combat): the region's own default,
      // which must still be a member of its registry union.
      else expect(REGION_VARIANTS[region as keyof typeof REGION_VARIANTS] as readonly string[]).toContain(got);
      checked[region] = (checked[region] ?? 0) + (want !== undefined ? 1 : 0);
    }

    // D5 (1): the slot-id set per row, compared across moments in its own test below.
    const slots = Array.from(container.querySelectorAll('[data-region-slot]'));
    const rowSet = slotSets.get(cell.row) ?? new Set<string>();
    rowSet.add(slots.map((n) => n.getAttribute('data-region-slot')).sort().join(','));
    slotSets.set(cell.row, rowSet);

    // D5 (4): the DOM order of the top-level slots is the settled literal.
    const order = slots
      .map((n) => {
        const id = n.getAttribute('data-region-slot');
        return id + (n.getAttribute('data-visible') === 'false' ? '°' : '') + (n.hasAttribute('data-anchor') ? '▲' : '');
      })
      .join(', ');
    expect([cell.name, order]).toEqual([cell.name, ORDER_LITERALS[`${cell.row} ${cell.moment}`]]);

    // D5 (3): every tenant renders inside the slot of its declared host.
    for (const el of Array.from(container.querySelectorAll('[data-tenant]'))) {
      const id = el.getAttribute('data-tenant') as TenantId;
      expect([cell.name, id, slotId(el)]).toEqual([cell.name, id, REGION_TENANTS[id].host]);
      tenantsSeen.add(id);
    }

    // A9d-2 N7 (Amendment E.4): the dice have ONE home, chosen by the row. A `roll` composer row has the Roll control (in the composer's mode row)
    // and NO tray in the stage; a `full` row has the stage's tray and NO Roll control; never both, never neither.
    const rollRow = variantFor(row, 'composer', cell.moment) === 'roll';
    const roll = container.querySelector('[data-roll-control]');
    const tray = container.querySelector('[data-tenant="diceTray"]');
    expect([cell.name, 'roll', roll !== null, 'tray', tray !== null]).toEqual([cell.name, 'roll', rollRow, 'tray', !rollRow]);
    if (roll) expect([cell.name, roll.closest('[data-region-slot]')?.getAttribute('data-region-slot')]).toEqual([cell.name, 'composer']);

    // Kage A9c-2 S2: the X-card stays LAST in its bar: the last tenant of its host slot, and
    // the last tab stop in that slot, so a sighted or keyboard user finds it at the same end in
    // every cell. Moving `safetyControls` ahead of another actionBar tenant in TENANT_IDS, or a
    // control after it, is the regression.
    const xcard = container.querySelector('[data-tenant="safetyControls"]');
    expect([cell.name, xcard !== null]).toEqual([cell.name, true]);
    const xhost = xcard!.closest('[data-region-slot]')!;
    const hostTenants = Array.from(xhost.querySelectorAll('[data-tenant]'));
    expect([cell.name, hostTenants[hostTenants.length - 1]?.getAttribute('data-tenant')]).toEqual([cell.name, 'safetyControls']);
    const stops = Array.from(xhost.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'));
    expect([cell.name, xcard!.contains(stops[stops.length - 1])]).toEqual([cell.name, true]);

    // D5 (2): every live region sits in a slot that is visible in this cell (an announcer
    // in a hidden slot says nothing). A node outside every slot is a layer's.
    for (const el of Array.from(container.querySelectorAll(LIVE))) {
      const slot = slotOf(el);
      if (!slot) continue;
      const id = slot.getAttribute('data-region-slot') as RegionId;
      expect([cell.name, id, slot.getAttribute('data-visible')]).toEqual([cell.name, id, 'true']);
      expect([cell.name, id, ANNOUNCING_REGIONS.has(id)]).toEqual([cell.name, id, true]);
    }

    // D5 (6): a region is collapsible in this cell exactly when its dock shows a handle.
    // A collapsible placement with no FoldSpec has no dock at all: red here.
    for (const id of FOLDABLE_REGIONS) {
      const slot = container.querySelector(`[data-region-slot="${id}"]`);
      if (!slot) continue; // a layer: no slot, no dock of its own
      const dock = slot.querySelector('[data-foldable]');
      const collapsible = getPlacement(row, id, cell.moment).collapsible === true;
      expect([cell.name, id, dock?.getAttribute('data-foldable')]).toEqual([cell.name, id, String(collapsible)]);
      const handle = dock?.querySelector(':scope > button[aria-expanded]') ?? null;
      expect([cell.name, id, handle !== null]).toEqual([cell.name, id, collapsible]);
      foldChecked[collapsible ? 'collapsible' : 'inert'] += 1;
    }
  });

  it('D5 (1): within a row the slot-id set is identical across moments (a preset hides, never unmounts)', () => {
    expect(slotSets.size).toBe(3);
    for (const [row, sets] of slotSets) expect([row, sets.size]).toEqual([row, 1]);
  });

  // A9d-2 N5 (named exception): the stage's dock was the one that sat INERT on every row but the phone. With the stage no longer collapsible
  // anywhere, the only foldable region left is Table's docked sheet, which a Story or phone row does not place at all (a layer: no slot, no
  // dock), so no cell renders an inert dock any more. The inert MODE is still pinned by FoldDock's own `foldable={false}` case and by
  // playshell.fold's mode-across-row-switch cases; this guard keeps the real page honest about the handle, which it still sees.
  it('D5 is not vacuous: tenants were checked, and the fold check saw a handle (the inert mode is FoldDock\'s own case: no region sits inert on any row now)', () => {
    expect(tenantsSeen.size).toBeGreaterThanOrEqual(3);
    expect(foldChecked.collapsible).toBeGreaterThan(0);
    expect(foldChecked.inert).toBeGreaterThanOrEqual(0);
  });

  it('is not vacuous: every consuming region was compared against a row-declared variant at least once', () => {
    for (const region of CONSUMING) expect([region, checked[region] ?? 0]).not.toEqual([region, 0]);
  });
});


/**
 * R10 / A9d F-2: with `ai_assist_level: 'off'` Suzu's presence is absent, in every cell
 * (the DM is a human; a figure beside the log says a persona is narrating). The slot
 * stays mounted so a later toggle needs no remount. The AI-on mounts above carry the
 * positive control: the same cells DO render `[data-region="suzuPresence"]`.
 */
describe('/play real-page: AI assist off renders no Suzu presence (R10)', () => {
  it.each(CELLS.filter((c) => c.moment === 'exploring'))('$name: no suzuPresence region; the log still renders', async (cell) => {
    setPhone(cell.phone);
    if (cell.pref) window.localStorage.setItem('tavern.layout', cell.pref);
    (dnd.getSession as jest.Mock).mockResolvedValue({ ...SESSION, dm_mode: 'human', ai_assist_level: 'off' });
    (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => expect(container.querySelector('[data-layout-resolved]')).toHaveAttribute('data-layout-resolved', cell.row));
    expect(container.querySelector('[data-region="suzuPresence"]')).toBeNull();
    expect(container.querySelector('[role="log"]')).not.toBeNull();
  });

  it('positive control: the same page with AI assist full DOES render it (desktop story)', async () => {
    setPhone(false);
    window.localStorage.setItem('tavern.layout', 'story');
    (dnd.getSession as jest.Mock).mockResolvedValue(SESSION);
    (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => expect(container.querySelector('[data-region="suzuPresence"]')).not.toBeNull());
  });
});

/**
 * Kage A9c-2 IMPORTANT-5: a live region that REMOUNTS across a layout flip is
 * re-announced by a screen reader, and the unit tests of a region in isolation cannot
 * see it (the AI-off status pill used to sit at a different tree position in the
 * `full` and `compact` TopBar, so every Story <-> Table switch destroyed and recreated
 * it). One real-page assertion, over EVERY live region the page mounts, in both
 * directions of the flip: the same DOM nodes before and after.
 */
describe('/play real-page: live regions survive a layout flip (never remount)', () => {
  it.each([
    ['AI assist off (the pill is the announcer)', 'off'],
    ['AI assist full (NarratorStrip is the announcer)', 'full'],
  ] as const)('%s: every live region is the same node after Story -> Table -> Auto', async (_n, level) => {
    setPhone(false);
    (dnd.getSession as jest.Mock).mockResolvedValue({ ...SESSION, ai_assist_level: level });
    (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    const root = () => container.querySelector('[data-layout-resolved]') as HTMLElement;
    await waitFor(() => expect(root()).toHaveAttribute('data-layout-resolved', 'story'));
    const before = Array.from(container.querySelectorAll(LIVE));
    // non-vacuous: the page really has live regions, and with AI off the pill is one of them
    expect(before.length).toBeGreaterThan(3);
    if (level === 'off') expect(before.some((n) => n.className.includes('aiOffStatus'))).toBe(true);

    const flipTo = async (name: string, resolved: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'Appearance settings' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('radio', { name }));
      });
      await waitFor(() => expect(root()).toHaveAttribute('data-layout-resolved', resolved));
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Appearance' }), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Appearance' })).toBeNull());
    };
    // As a SET: a flip reorders the slots (Table puts the stage before the log), and a
    // keyed reorder MOVES a node, which is not a remount. Index-for-index would be wrong.
    const sameNodes = () => {
      const now = new Set(Array.from(container.querySelectorAll(LIVE)));
      expect(now.size).toBe(before.length);
      before.forEach((node, i) => {
        const label = `${i} ${node.getAttribute('role') ?? 'aria-live'} ${String(node.className)}`;
        expect([label, node.isConnected, now.has(node)]).toEqual([label, true, true]);
      });
    };

    await flipTo('Table', 'table');
    expect(container.querySelector('[data-region="topBar"]')).toHaveAttribute('data-variant', 'compact');
    sameNodes();
    await flipTo('Auto', 'story');
    expect(container.querySelector('[data-region="topBar"]')).toHaveAttribute('data-variant', 'full');
    sameNodes();
  });
});
