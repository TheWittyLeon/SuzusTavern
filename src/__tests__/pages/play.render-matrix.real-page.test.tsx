/**
 * A9c-2 D5 (R3, build brief 6/10) — the real-page render matrix. The REAL /play
 * page, mounted six times (story and table x exploring and combat on a desktop,
 * the phone row x exploring and combat), asserts that every variant-consuming
 * region's root carries `data-variant === variantFor(row, region, moment)`.
 * That is the page wiring half of the contract: the component half (each region
 * stamps what it is handed and renders differently per member) is
 * `region-variants.contract.test.tsx`. A page that passes `variant="band"` to
 * TopBar, or `variant="full"` to SuzuPresence, regardless of the row, is red
 * here and nowhere else.
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
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
  LAYOUT_ROWS_BY_ID,
  REGION_VARIANTS,
  variantFor,
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
const CONSUMING: readonly RegionId[] = ['topBar', 'suzuPresence', 'partyStrip', 'offers', 'actionBar'] as const;

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

const checked: Record<string, number> = {};

describe('/play real-page render matrix (4 desktop + 2 phone)', () => {
  it.each(CELLS)('$name: every variant-consuming region carries its row\'s variant', async (cell) => {
    setPhone(cell.phone);
    if (cell.pref) window.localStorage.setItem('tavern.layout', cell.pref);
    const combat = cell.moment === 'combat';
    (dnd.getSession as jest.Mock).mockResolvedValue({ ...SESSION, ...(combat ? { active_combat_id: 'combat-1' } : {}) });
    (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
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
  });

  it('is not vacuous: every consuming region was compared against a row-declared variant at least once', () => {
    for (const region of CONSUMING) expect([region, checked[region] ?? 0]).not.toEqual([region, 0]);
  });
});
