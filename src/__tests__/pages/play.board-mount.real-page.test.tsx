/**
 * B8c-3 M2 (Sora's mount brief 2.1, 2.2, 2.6, 4) — the tactical map as the desktop stage's body, READ-ONLY, on the real page.
 *   1. Flag off: a fight whose state body carries no `space` KEY is the step-11 page: the stand-in's text, no grid, no line node, no Move, no body role.
 *   2. `space: null` (served, no board): the band of combatant chips, no grid, no line, no name on the body.
 *   3. A served board: the grid, and the scene line: PLAIN text, the status node's NEXT SIBLING, no role / aria-live / aria-hidden on it or on any ancestor up to the stage; the
 *      status node unchanged and still in the tree; the body a named `group`; no new live region anywhere.
 *   4. The pair pin (2.6): for each malformed board the room is `band` and the body holds the band, never a grid.
 *   5. The sentinel pin (Kuro 1): a DM's payload (`tactics`, `position`, `terrain`) puts none of the three strings anywhere in the stage's DOM, text or attributes.
 *   6. The phone row has no stage body, so no map and no line, served or not (F-k).
 *
 * Mutations seen red (each one line): the page passes `false` for `null` -> 1 and 2 go red (the stand-in is gone); `served` read as `state.space != null` -> 2 goes red (the stand-in
 * comes back for `space: null`); a participant spread into the line -> 5 goes red; the child ungated from `stageHasBody` -> 6 goes red.
 */
import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { CombatSpace, CombatState, GroundingData, Participant, Session } from '@/lib/api/types';
import { PLAY_PHONE_QUERY } from '@/lib/breakpoints';

jest.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 's1' }) }));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }) }));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  getCatalog: jest.fn(() => Promise.resolve({ items: [] })),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));
jest.mock('../../lib/stream', () => ({ streamDmNarration: jest.fn(async function* () { yield { kind: 'done' }; }) }));

// The combat poll is every 4s; this suite shortens it so a poll that says the fight ENDED lands inside a test (nothing else reads it).
jest.mock('../../app/play/[sessionId]/format', () => ({ ...jest.requireActual('../../app/play/[sessionId]/format'), POLL_INTERVAL_MS: 60 }));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const SPACE: CombatSpace = { kind: 'square', width: 13, height: 7, cell: { value: 5, unit: 'ft' }, blocked: [], features: [] };
const STAND_IN = 'The tactical map arrives in a later sprint. Suzu narrates the scene above.';

const SESSION: Session = {
  session_id: 's1', channel: 'everfree_flight_channel', name: 'Test Table', status: 'active', dm_username: 'suzu',
  participant_usernames: ['leon'], player_count: 1, active_combat_id: null, dm_mode: 'ai', ai_assist_level: 'off',
};
const PARTY: Participant[] = [
  { username: 'leon', is_dm: false, character: { character_id: 'c1', name: 'Anomaly', char_class: 'Ranger', level: 1, current_hp: 10, max_hp: 10, ac: 13 } },
];
const GROUNDING: GroundingData = {
  scene_id: 'everfree_flight', scene_name: 'Flight Through the Everfree', boxed_text: 'The pack is closing in.',
  transitions: [], checks: [], flags: {}, encounter_state: {}, encounter: { kind: 'combat', trigger: 'manual' },
};

/** A fight, as the engine serves it: `space` is the KEY's presence (absent: positioning off), `null` (no board), or a board. `at` / `movement_remaining` are the positions. */
function combat(space?: unknown, extra: Record<string, unknown> = {}): CombatState {
  const base = {
    combat_id: 'combat-flight', session_id: 's1', round: 1, state: 'active', turn_index: 0, active_participant_id: 'p1', initiative: ['p1', 'w1'],
    participants: [
      { participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 10, hp_max: 10, ac: 13, conditions: [], is_alive: true, can_be_targeted: false, is_active_turn: true, took_turn: false, at: [1, 3], movement_remaining: 30, ...(extra.pc as object ?? {}) },
      { participant_id: 'w1', entity_id: 'g1', name: 'Timberwolf', is_pc: false, initiative: 9, hp_current: 19, hp_max: 19, ac: 13, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false, at: [9, 3], movement_remaining: 30, ...(extra.foe as object ?? {}) },
    ],
    ...(extra.state as object ?? {}),
  };
  return (space === undefined ? base : { ...base, space }) as unknown as CombatState;
}

function desktop() {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() }));
}
function phone() {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({ matches: query === PLAY_PHONE_QUERY, media: query, onchange: null, addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() }));
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  desktop();
  (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
  (dnd.getGrounding as jest.Mock).mockResolvedValue(GROUNDING);
});

async function load(state: CombatState) {
  (dnd.getSession as jest.Mock).mockResolvedValue({ ...SESSION, active_combat_id: 'combat-flight' });
  (dnd.getCombatState as jest.Mock).mockResolvedValue(state);
  const { container } = renderPlay(<PlayPage />);
  await screen.findByText('Test Table');
  await waitFor(() => expect(container.querySelector('[data-layout-resolved]')).toHaveAttribute('data-moment', 'combat'));
  // the state has arrived once the status node is there (the stage is in a fight)
  await screen.findByText(/In combat · use the action bar/);
  return container;
}

const stage = (c: HTMLElement) => c.querySelector('[data-region="sceneStage"]') as HTMLElement;
const body = (c: HTMLElement) => stage(c).querySelector('[data-fold-body]') as HTMLElement;
const statusNode = (c: HTMLElement) => within(stage(c)).getByText(/In combat · use the action bar/).closest('[role="status"]') as HTMLElement;
const lineNode = (c: HTMLElement) => stage(c).querySelector('[data-stage-line]') as HTMLElement | null;
/** Every live region the page has, by role / aria-live, as a count (the harness's census, in jsdom). */
const liveRegions = (c: HTMLElement) => c.querySelectorAll('[role="status"],[role="alert"],[role="log"],[aria-live]:not([aria-live="off"]),output').length;

describe('flag off: a fight whose state body has no `space` key is the step-11 page', () => {
  it('the stand-in\'s exact text, no grid, no band, no line node, no Move, no name or role on the body', async () => {
    const c = await load(combat());
    expect(within(body(c)).getByText(STAND_IN)).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(within(body(c)).queryByRole('list')).toBeNull();
    expect(lineNode(c)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Move\b/ })).toBeNull();
    expect(body(c)).not.toHaveAttribute('role');
    expect(body(c)).not.toHaveAttribute('aria-label');
  });
});

describe('`space: null` (served, no board): the band, nothing else', () => {
  it('the combatant chips in the body, no grid, no stand-in, no line, no name on the body', async () => {
    const c = await load(combat(null));
    expect(within(body(c)).getByRole('list', { name: 'Combatants' })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(within(body(c)).queryByText(STAND_IN)).toBeNull();
    expect(lineNode(c)).toBeNull();
    expect(body(c)).not.toHaveAttribute('role');
  });
});

describe('a served board: the grid and the scene line', () => {
  it('the grid is in the body, which is a named group; the stand-in is gone', async () => {
    const c = await load(combat(SPACE));
    const grid = within(body(c)).getByRole('grid');
    expect(grid).toBeInTheDocument();
    expect(body(c)).toHaveAttribute('role', 'group');
    expect(body(c)).toHaveAccessibleName('Tactical map');
    expect(within(body(c)).queryByText(STAND_IN)).toBeNull();
  });

  it('the line is the status node\'s NEXT SIBLING, plain readable text: no role, no aria-live, no aria-hidden on it or any ancestor up to the stage; never inside the status node', async () => {
    const c = await load(combat(SPACE));
    const status = statusNode(c);
    await waitFor(() => expect(lineNode(c)).not.toBeNull());
    const line = lineNode(c) as HTMLElement;
    expect(status.nextElementSibling).toBe(line);
    expect(status.contains(line)).toBe(false);
    for (let el: HTMLElement | null = line; el && el !== stage(c).parentElement; el = el.parentElement) {
      expect(el).not.toHaveAttribute('role');
      expect(el).not.toHaveAttribute('aria-live');
      expect(el).not.toHaveAttribute('aria-hidden');
    }
    // the mover has a square and a budget: the rest line says whose turn and how far
    expect(line).toHaveTextContent('In combat · round 1 · Anomaly: 30 ft left');
  });

  it('the status node is unchanged (text, role, live) and stays in the tree, only its sibling is new', async () => {
    const off = await load(combat());
    const before = statusNode(off).textContent;
    off.remove();
    const c = await load(combat(SPACE));
    await waitFor(() => expect(lineNode(c)).not.toBeNull());
    expect(statusNode(c).textContent).toBe(before);
    expect(statusNode(c)).toHaveAttribute('role', 'status');
    expect(statusNode(c)).toHaveAttribute('aria-live', 'polite');
  });

  it('no new live region: the page has exactly the live regions it has with the flag off', async () => {
    const off = await load(combat());
    const withFlagOff = liveRegions(off);
    off.remove();
    const on = await load(combat(SPACE));
    await waitFor(() => expect(lineNode(on)).not.toBeNull());
    expect(liveRegions(on)).toBe(withFlagOff);
    expect(body(on).querySelectorAll('[role="status"],[role="alert"],[aria-live]').length).toBe(0);
  });

  it('a mover with no budget (`null`) or no square has the rest line with no feet; one at 0 ft says so', async () => {
    const none = await load(combat(SPACE, { pc: { movement_remaining: null } }));
    await waitFor(() => expect(lineNode(none)).not.toBeNull());
    expect(lineNode(none)).toHaveTextContent(/^In combat · round 1$/);
    none.remove();
    const unplaced = await load(combat(SPACE, { pc: { at: null } }));
    await waitFor(() => expect(lineNode(unplaced)).not.toBeNull());
    expect(lineNode(unplaced)).toHaveTextContent(/^In combat · round 1$/);
    unplaced.remove();
    const spent = await load(combat(SPACE, { pc: { movement_remaining: 0 } }));
    await waitFor(() => expect(lineNode(spent)).not.toBeNull());
    expect(lineNode(spent)).toHaveTextContent('In combat · round 1 · Anomaly: 0 ft left');
  });
});

describe('the pair pin (brief 2.6): for each malformed board the room is `band` and the body holds the band, never a grid (and the page does not fall over)', () => {
  const MALFORMED: Array<[string, unknown]> = [
    ['a null cell', { ...SPACE, cell: null }],
    ['a string cell value', { ...SPACE, cell: { value: '5', unit: 'ft' } }],
    ['a zero cell value', { ...SPACE, cell: { value: 0, unit: 'ft' } }],
    ['width 0', { ...SPACE, width: 0 }],
    ['a fractional width', { ...SPACE, width: 5.5 }],
    ['height 0', { ...SPACE, height: 0 }],
    ['a negative height', { ...SPACE, height: -2 }],
    ['an unknown kind', { ...SPACE, kind: 'hex?' }],
    ['a string width', { ...SPACE, width: '13' }],
    // B8c-3 run 2, Miko MF1: a present-but-malformed list used to throw in the render and take the whole page down
    ['blocked: {}', { ...SPACE, blocked: {} }],
    ['blocked: "x"', { ...SPACE, blocked: 'x' }],
    ['blocked: 5', { ...SPACE, blocked: 5 }],
    ['blocked: [null]', { ...SPACE, blocked: [null] }],
    ['features: {}', { ...SPACE, features: {} }],
    ['features: "x"', { ...SPACE, features: 'x' }],
    ['features: [null]', { ...SPACE, features: [null] }],
    ['features: [{}]', { ...SPACE, features: [{}] }],
    ['features: [{ at: null }]', { ...SPACE, features: [{ id: 'a', kind: 'prop', label: 'A', at: null }] }],
    ['features: [{ at: "x" }]', { ...SPACE, features: [{ id: 'a', kind: 'prop', label: 'A', at: 'x' }] }],
  ];
  it.each(MALFORMED)('%s', async (_name, space) => {
    const c = await load(combat(space));
    expect(within(body(c)).getByRole('list', { name: 'Combatants' })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(lineNode(c)).toBeNull();
    expect(body(c)).not.toHaveAttribute('role');
  });
});

describe('the sentinel pin (Kuro 1): a DM\'s payload puts no DM-only string anywhere in the stage\'s DOM', () => {
  const SENTINELS = ['SENTINEL-TACTICS-falls-back-to-the-tunnel', 'SENTINEL-POSITION-behind-the-bar', 'SENTINEL-SOURCE-REF-the-real-npc', 'SENTINEL-TERRAIN-rising-water-at-round-six'];
  const dm = { tactics: SENTINELS[0], position: SENTINELS[1], source_ref: SENTINELS[2] };
  const payload = (space: unknown) => combat(space, { pc: dm, foe: dm, state: { terrain: SENTINELS[3] } });

  /** The control: the page really HELD the secrets (the mocked answer carried them on both participants and the state); only the stage's DOM may not. Awaited: an un-awaited `resolves` asserts nothing. */
  async function carried() {
    const first = await (dnd.getCombatState as jest.Mock).mock.results[0].value;
    expect(first.terrain).toBe(SENTINELS[3]);
    for (const p of first.participants) {
      expect(p.tactics).toBe(SENTINELS[0]);
      expect(p.position).toBe(SENTINELS[1]);
      expect(p.source_ref).toBe(SENTINELS[2]);
    }
  }
  const clean = (c: HTMLElement) => { const html = stage(c).outerHTML; for (const s of SENTINELS) expect(html).not.toContain(s); };

  it('a usable board at rest: none of tactics, position, source_ref or terrain, in text or in any attribute', async () => {
    const c = await load(payload(SPACE));
    // the map\'s own report has landed in the line (the rest line is written first, then the mover\'s)
    await waitFor(() => expect(lineNode(c)).toHaveTextContent('Anomaly: 30 ft left'));
    await carried();
    clean(c);
  });

  it('after the user chooses a FOE\'s square: the `cell` line names the foe and still carries none of them', async () => {
    const c = await load(payload(SPACE));
    await waitFor(() => expect(lineNode(c)).not.toBeNull());
    const foe = screen.getAllByRole('gridcell').find((cell) => (cell.getAttribute('aria-label') ?? '').includes('Timberwolf')) as HTMLElement;
    expect(foe).toBeDefined();
    fireEvent.click(foe);
    await waitFor(() => expect(lineNode(c)).toHaveTextContent(/^Timberwolf · Foe/));
    await carried();
    clean(c);
  });

  it.each<[string, unknown]>([
    ['`space: null` (served, no board)', null],
    ['a malformed board (a null cell)', { ...SPACE, cell: null }],
    ['a malformed list (blocked: "x")', { ...SPACE, blocked: 'x' }],
  ])('the band, %s: none of the four', async (_n, space) => {
    const c = await load(payload(space));
    expect(within(body(c)).getByRole('list', { name: 'Combatants' })).toBeInTheDocument();
    await carried();
    clean(c);
  });
});

describe('the phone row has no stage body: served or not, no map and no line (F-k)', () => {
  it('a served board on a phone: no grid, no line node, no body to name', async () => {
    phone();
    (dnd.getSession as jest.Mock).mockResolvedValue({ ...SESSION, active_combat_id: 'combat-flight' });
    (dnd.getCombatState as jest.Mock).mockResolvedValue(combat(SPACE));
    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('Test Table');
    await screen.findByText(/In combat · use the action bar/);
    expect(screen.queryByRole('grid')).toBeNull();
    expect(lineNode(container)).toBeNull();
    expect(stage(container).querySelector('[data-fold-body]')).toBeNull();
  });
});

describe('the page\'s stranded-focus wiring (`rescueStrandedFocus` -> the scene head)', () => {
  it('the fight ending (a poll says `ended`) with focus in the grid lands focus on the scene head, never <body>, and the line goes with the board', async () => {
    const c = await load(combat(SPACE));
    await waitFor(() => expect(lineNode(c)).not.toBeNull());
    const stop = screen.getAllByRole('gridcell').find((cell) => cell.getAttribute('tabindex') === '0') as HTMLElement;
    act(() => stop.focus());
    expect(document.activeElement).toBe(stop);
    (dnd.getCombatState as jest.Mock).mockResolvedValue({ ...combat(SPACE), state: 'ended' });
    await waitFor(() => expect(c.querySelector('[data-layout-resolved]')).toHaveAttribute('data-moment', 'exploring'), { timeout: 3000 });
    await waitFor(() => expect(document.activeElement).toBe(stage(c).querySelector('[data-focus-fallback]')));
    expect(screen.queryByRole('grid')).toBeNull();
    expect(lineNode(c)).toBeNull();
  });
});
