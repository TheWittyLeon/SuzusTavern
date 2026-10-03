/**
 * A10 step 11, fix round F2 (Kage's Tavern 2, Miko's QA gap 5) — the room FOLLOWS the encounter's `space` while a fight is running.
 *
 * `play.room-fact.test.tsx` pins `roomFact` as a pure function and the page's FIRST hand-off to the shell. Nothing pinned the page following the board as the poll changes
 * it: computing the room once per moment passed all 8,173 tests. These are the real /play page, a desktop `matchMedia`, the combat poll answered by the mocked API, and
 * the poll interval shortened so a "poll" is a few milliseconds. Every case asserts, in BOTH layouts, the three things a stage must keep through a room change:
 *   - the BODY VALUE on the grid (`--play-body`), taken from the row's own `factVars` (never a literal here: the row says what a board is);
 *   - the stage's FORM (`data-variant`): a room change never changes the form (Table is `hero` in both moments; Story combat is `hero`);
 *   - the body node's IDENTITY: the same `[data-fold-body]` element before and after (a map mounted in it would lose its scroll and focus on a remount).
 * The browser legs (`room-gain`, `room-loss`, `room-malformed`, `combat-end-with-board`, `poll-fails` in the harness) judge the same changes in pixels.
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { CombatSpace, CombatState, GroundingData, Participant, Session } from '@/lib/api/types';
import { LAYOUT_ROWS_BY_ID, type LayoutId } from '@/app/play/[sessionId]/presets';

jest.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 's1' }) }));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }) }));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));
// One poll is 4s; the real page is driven here by shortening it (every poller shares the constant, and every mocked fetch resolves at once).
jest.mock('../../app/play/[sessionId]/format', () => ({ ...jest.requireActual('../../app/play/[sessionId]/format'), POLL_INTERVAL_MS: 25 }));
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

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const SPACE: CombatSpace = { kind: 'square', width: 13, height: 7, cell: { value: 5, unit: 'ft' }, blocked: [], features: [] };
const SESSION: Session = {
  session_id: 's1', channel: 'everfree_flight_channel', name: 'Test Table', status: 'active', dm_username: 'suzu',
  participant_usernames: ['leon'], player_count: 1, active_combat_id: 'combat-flight', dm_mode: 'ai', ai_assist_level: 'off',
};
const PARTY: Participant[] = [
  { username: 'leon', is_dm: false, character: { character_id: 'c1', name: 'Anomaly', char_class: 'Ranger', level: 1, current_hp: 10, max_hp: 10, ac: 13 } },
];
const GROUNDING: GroundingData = {
  scene_id: 'everfree_flight', scene_name: 'Flight Through the Everfree', boxed_text: 'The pack is closing in.',
  transitions: [], checks: [], flags: {}, encounter_state: {}, encounter: { kind: 'combat', trigger: 'manual' },
};
const fight = (over: Record<string, unknown> = {}) =>
  ({
    combat_id: 'combat-flight', session_id: 's1', round: 1, state: 'active', turn_index: 0, active_participant_id: 'p1', initiative: ['p1', 'w1'],
    participants: [
      { participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 10, hp_max: 10, ac: 13, conditions: [], is_alive: true, can_be_targeted: false, is_active_turn: true, took_turn: false },
      { participant_id: 'w1', entity_id: 'g1', name: 'Timberwolf', is_pc: false, initiative: 9, hp_current: 19, hp_max: 19, ac: 13, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false },
    ],
    ...over,
  }) as unknown as CombatState;

const grid = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-layout-resolved]')!;
const bodyNode = (c: HTMLElement) => c.querySelector('[data-region="sceneStage"] [data-fold-body]');
const stageForm = (c: HTMLElement) => c.querySelector('[data-region="sceneStage"]')?.getAttribute('data-variant');
const bodyValue = (c: HTMLElement) => grid(c).style.getPropertyValue('--play-body');
/** What the row says a room is: its `--play-body` for a value of the `room` fact (never a literal here). */
const roomBody = (layout: LayoutId, room: 'board' | 'band' | 'none' | 'unserved') => (LAYOUT_ROWS_BY_ID[layout].factVars!.room as Record<string, Record<string, string>>)[room]['--play-body'];

/** The combat poll answers with whatever `serve` returns next; a thrown value is a failed poll. */
let served: () => CombatState | Promise<CombatState>;
const serve = (fn: typeof served) => { served = fn; };

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  (dnd.getSession as jest.Mock).mockResolvedValue(SESSION);
  (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
  (dnd.getGrounding as jest.Mock).mockResolvedValue(GROUNDING);
  (dnd.getCombatState as jest.Mock).mockImplementation(() => Promise.resolve().then(() => served()));
});

/** Load the page in a fight with `first` served, in `layout`; resolves once the stage shows that room. */
async function load(layout: LayoutId, first: CombatState, room: 'board' | 'band' | 'unserved') {
  window.localStorage.setItem('tavern.layout', layout);
  serve(() => first);
  const { container } = renderPlay(<PlayPage />);
  await screen.findByText('Test Table');
  await waitFor(() => expect(grid(container)).toHaveAttribute('data-moment', 'combat'));
  await waitFor(() => expect(bodyValue(container)).toBe(roomBody(layout, room)));
  const node = bodyNode(container);
  expect(node).not.toBeNull();
  return { container, node: node!, form: stageForm(container) };
}

/** After a change: the room's value is on the grid, the stage kept its form, and the body is the SAME node. */
async function expectRoom(c: HTMLElement, layout: LayoutId, room: 'board' | 'band' | 'none' | 'unserved', node: Element, form: string | null | undefined) {
  await waitFor(() => expect(bodyValue(c)).toBe(roomBody(layout, room)));
  expect(stageForm(c)).toBe(form);
  expect(bodyNode(c)).toBe(node);
}

describe.each<LayoutId>(['table', 'story'])('%s (desktop): the room follows the encounter\'s space while the fight runs', (layout) => {
  it('a space GAINED mid-fight: the unserved page (no `space` key: positioning off) becomes the board, in one poll, and the stage and its body node do not change', async () => {
    // (A10 step 11 round 4, named exception: a state with no `space` key was `band`; it is `unserved` now, the stage with no height, and `space: null` is the band)
    const { container, node, form } = await load(layout, fight(), 'unserved');
    expect(form).toBe('hero');
    serve(() => fight({ space: SPACE }));
    await expectRoom(container, layout, 'board', node, form);
  });

  it('a space LOST mid-fight: the board becomes the unserved page when the key goes, the band when it is `null`, in one poll, and the stage and its body node do not change', async () => {
    const { container, node, form } = await load(layout, fight({ space: SPACE }), 'board');
    serve(() => fight());
    await expectRoom(container, layout, 'unserved', node, form);
    serve(() => fight({ space: null }));
    await expectRoom(container, layout, 'band', node, form);
    serve(() => fight({ space: SPACE }));
    await expectRoom(container, layout, 'board', node, form);
  });

  it('a MALFORMED space mid-fight (a null cell, a width of 5.5, a hex kind, an array, a string): the band, the map\'s own predicate; the board comes back with a good one', async () => {
    const { container, node, form } = await load(layout, fight({ space: SPACE }), 'board');
    for (const bad of [{ ...SPACE, cell: null }, { ...SPACE, width: 5.5 }, { ...SPACE, kind: 'hex' }, [], 'oops']) {
      serve(() => fight({ space: bad }));
      await expectRoom(container, layout, 'band', node, form);
      serve(() => fight({ space: SPACE }));
      await expectRoom(container, layout, 'board', node, form);
    }
  });

  it('a failed poll keeps the room: the combat poll throws and the board, the stage and its body node all hold', async () => {
    const { container, node, form } = await load(layout, fight({ space: SPACE }), 'board');
    let polls = 0;
    serve(() => { polls += 1; throw new Error('boom'); });
    await waitFor(() => expect(polls).toBeGreaterThanOrEqual(3));
    await expectRoom(container, layout, 'board', node, form);
    expect(grid(container)).toHaveAttribute('data-moment', 'combat');
  });

  it('a fight that ENDS with a board shown: the room is none, and the stage is what the layout makes of a quiet table', async () => {
    const { container, node, form } = await load(layout, fight({ space: SPACE }), 'board');
    serve(() => fight({ space: SPACE, state: 'ended', active_participant_id: null }));
    await waitFor(() => expect(grid(container)).toHaveAttribute('data-moment', 'exploring'));
    await waitFor(() => expect(bodyValue(container)).toBe(roomBody(layout, 'none')));
    if (layout === 'table') {
      // Table is a hero in BOTH moments: the same stage, the same body node, now 0 high (its row says `none`)
      expect(stageForm(container)).toBe(form);
      expect(bodyNode(container)).toBe(node);
    } else {
      // Story's stage is the `panel` while exploring: no body at all, and the dice tray is back in the stage
      expect(stageForm(container)).toBe('panel');
      expect(bodyNode(container)).toBeNull();
      expect(container.querySelector('[data-tenant="diceTray"]')).not.toBeNull();
    }
  });
});
