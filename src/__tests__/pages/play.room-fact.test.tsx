/**
 * A10 step 11, S2a (Sora's build brief 3.2 / 7, Amendment F.4) — the fact channel. ZERO PIXELS: no row answers a fact yet (S2b's rows do), so this
 * commit is pinned at three seams and the harness's budget lines (identical to S1's) are the fourth.
 *   1. the page REPORTS `room`: not in a fight `none`; in a fight a usable `space` -> `board`, anything else -> `band` (one predicate, the map's own).
 *   2. the shell EMITS the row's values for a reported value, after `momentVars`, and THROWS on a value or a fact outside the vocabulary.
 *   3. the real page hands the shell the fact it computed (the seam between 1 and 2).
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { CombatSpace, CombatState, GroundingData, Participant, Session } from '@/lib/api/types';
import PlayShell from '@/app/play/[sessionId]/PlayShell';
import { roomFact } from '@/app/play/[sessionId]/hooks/usePlayLayout';
import { FACTS, LAYOUT_ROWS, factVarsFor, type Facts, type LayoutRow } from '@/app/play/[sessionId]/presets';

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

// The real shell, with the facts it was handed recorded (seam 3).
const seen: Array<Facts | undefined> = [];
jest.mock('../../app/play/[sessionId]/PlayShell', () => {
  const Actual = jest.requireActual('../../app/play/[sessionId]/PlayShell').default;
  return { __esModule: true, default: (props: { facts?: Facts }) => { seen.push(props.facts); return <Actual {...props} />; } };
});

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const SPACE: CombatSpace = { kind: 'square', width: 13, height: 7, cell: { value: 5, unit: 'ft' }, blocked: [], features: [] };

describe('roomFact: the room is the moment, the KEY\'s presence and the map\'s own predicate', () => {
  // A10 step 11 round 4 (named exception: it took the `space` and answered `band` for anything but a usable board): it takes the combat STATE, and a state body with no `space` KEY is `unserved`
  // (positioning is off); `space: null` is the encounter that authored no board (`band`). Key presence is what the engine's wire says (a fight is served when the key is there).
  it.each<[string, Parameters<typeof roomFact>, string]>([
    ['exploring, no fight', ['exploring', undefined], 'none'],
    ['exploring, even with a usable space left in the page', ['exploring', { space: SPACE }], 'none'],
    ['a fight with a usable space', ['combat', { space: SPACE }], 'board'],
    ['a fight whose state carries no `space` key (positioning off)', ['combat', {}], 'unserved'],
    ['a fight whose state has not arrived', ['combat', null], 'unserved'],
    ['a fight whose state is undefined', ['combat', undefined], 'unserved'],
    ['a fight with `space: null` (the encounter authored no board: theatre of mind)', ['combat', { space: null }], 'band'],
    // every one of these is a board the map refuses to draw (isSpaceUsable); the room must say `band`, or the map falls back inside a board's room
    ['a fight whose space has a null cell', ['combat', { space: { ...SPACE, cell: null } as unknown as CombatSpace }], 'band'],
    ['a fight whose cell value is a string', ['combat', { space: { ...SPACE, cell: { value: '5', unit: 'ft' } } as unknown as CombatSpace }], 'band'],
    ['a fight whose width is 0', ['combat', { space: { ...SPACE, width: 0 } }], 'band'],
    ['a fight whose width is 5.5', ['combat', { space: { ...SPACE, width: 5.5 } }], 'band'],
    ['a fight with an unknown kind', ['combat', { space: { ...SPACE, kind: 'hex?' } as unknown as CombatSpace }], 'band'],
  ])('%s -> %s', (_name, args, room) => {
    expect(roomFact(...args)).toBe(room);
  });

  it('every value it can answer is in the vocabulary, and it answers ALL of them (a typo here would be a value no row has; a value never answered is dead data)', () => {
    const answers = new Set([roomFact('exploring', null), roomFact('combat', { space: SPACE }), roomFact('combat', { space: null }), roomFact('combat', {})]);
    expect([...answers].sort()).toEqual([...FACTS.room].sort());
  });

  it('a state read off a real JSON body keeps the key: `space: null` parses to `band`, a body without the key to `unserved`', () => {
    expect(roomFact('combat', JSON.parse('{"state":"active","space":null}'))).toBe('band');
    expect(roomFact('combat', JSON.parse('{"state":"active"}'))).toBe('unserved');
  });
});

describe('the shell emits a row\'s values for the facts it is told, and refuses what it cannot place', () => {
  const base = LAYOUT_ROWS.find((r) => r.id === 'story')!;
  const row = {
    ...base,
    vars: undefined,
    momentVars: { combat: { '--play-x': 'moment', '--play-m': 'moment' } },
    factVars: {
      room: {
        board: { '--play-body': '238px', '--play-x': 'board' },
        band: { '--play-body': '102px' },
        none: { '--play-body': '0px' },
        unserved: { '--play-body': '0px' },
      },
    },
  } as LayoutRow;
  const grid = (r: LayoutRow, facts?: Facts, moment: 'exploring' | 'combat' = 'combat') =>
    render(<PlayShell row={r} moment={moment} facts={facts} regions={{}} tenants={{}} />).container.querySelector('[data-layout-resolved]') as HTMLElement;

  it('the value reported selects the set: board, band, none, unserved', () => {
    expect(grid(row, { room: 'board' }).style.getPropertyValue('--play-body')).toBe('238px');
    expect(grid(row, { room: 'band' }).style.getPropertyValue('--play-body')).toBe('102px');
    expect(grid(row, { room: 'none' }, 'exploring').style.getPropertyValue('--play-body')).toBe('0px');
    expect(grid(row, { room: 'unserved' }).style.getPropertyValue('--play-body')).toBe('0px');
  });

  it('a fact\'s values come AFTER the moment\'s (a fact wins a name both give), and a name only the moment gives is kept', () => {
    const el = grid(row, { room: 'board' });
    expect(el.style.getPropertyValue('--play-x')).toBe('board');
    expect(el.style.getPropertyValue('--play-m')).toBe('moment');
    expect(grid(row, { room: 'band' }).style.getPropertyValue('--play-x')).toBe('moment');
  });

  it('no facts reported, or a row with no table for the fact: nothing extra on the grid', () => {
    const lists = ['--play-areas', '--play-columns', '--play-rows'];
    const props = (el: HTMLElement) => Array.from({ length: el.style.length }, (_, i) => el.style.item(i)).sort();
    expect(props(grid({ ...row, momentVars: undefined }, undefined))).toEqual(lists);
    expect(props(grid({ ...row, momentVars: undefined, factVars: undefined }, { room: 'board' }))).toEqual(lists);
  });

  it('an unknown value throws, naming the row and the fact (never "no values")', () => {
    expect(() => factVarsFor(row, { room: 'boardd' } as unknown as Facts)).toThrow(/"boardd" is not a declared value of fact "room" \(row "story"\)/);
    expect(() => grid(row, { room: 'sea' } as unknown as Facts)).toThrow(/room/);
  });

  it('an unknown fact throws, and a value the row has no set for throws, naming both', () => {
    expect(() => factVarsFor(row, { weather: 'rain' } as unknown as Facts)).toThrow(/"weather" is not a declared fact \(row "story"\)/);
    const partial = { ...row, factVars: { room: { board: {}, none: {}, unserved: {} } } } as unknown as LayoutRow;
    expect(() => factVarsFor(partial, { room: 'band' })).toThrow(/row "story" has no values for fact "room" = "band"/);
  });
});

describe('facts are emitted in the vocabulary\'s DECLARED order, the last winning, whatever order the caller lists them (K3)', () => {
  // A10 fix round F7 (Kage A10 Tavern 3): with one fact (`room`) the order was inert. This is the row the mount will have: `room` sizes the body and a later `fold` can remove
  // it. The vocabulary is injected (`declared`): the real FACTS has one entry today, and the pin must run on two.
  const TWO = { room: ['board', 'band', 'none'], fold: ['open', 'folded'] } as const;
  const REVERSED = { fold: ['open', 'folded'], room: ['board', 'band', 'none'] } as const;
  const base = LAYOUT_ROWS.find((r) => r.id === 'story')!;
  const row = {
    ...base,
    factVars: {
      room: { board: { '--play-body': '238px', '--play-room': 'board' }, band: { '--play-body': '102px' }, none: { '--play-body': '0px' } },
      fold: { open: {}, folded: { '--play-body': '0px', '--play-fold': 'folded' } },
    },
  } as unknown as LayoutRow;
  const vars = (facts: Record<string, string>, declared: Record<string, readonly string[]>) => factVarsFor(row, facts as unknown as Facts, declared);

  it('a fact declared LATER wins a name both set, whichever key the caller lists first', () => {
    expect(vars({ room: 'board', fold: 'folded' }, TWO)['--play-body']).toBe('0px');
    expect(vars({ fold: 'folded', room: 'board' }, TWO)['--play-body']).toBe('0px');
    // names only one fact sets are kept from both
    expect(vars({ fold: 'folded', room: 'board' }, TWO)).toEqual({ '--play-body': '0px', '--play-room': 'board', '--play-fold': 'folded' });
  });

  it('and with the vocabulary the other way round the OTHER wins: the order is the vocabulary\'s, nothing else', () => {
    expect(vars({ room: 'board', fold: 'folded' }, REVERSED)['--play-body']).toBe('238px');
    expect(vars({ fold: 'folded', room: 'board' }, REVERSED)['--play-body']).toBe('238px');
  });

  it('a fold that is open adds nothing: the room\'s size stands', () => {
    expect(vars({ fold: 'open', room: 'board' }, TWO)['--play-body']).toBe('238px');
  });

  it('an undeclared key in the caller\'s object still throws (even with no value), and an unknown value still throws, with two facts declared', () => {
    expect(() => vars({ room: 'board', weather: 'rain' }, TWO)).toThrow(/"weather" is not a declared fact \(row "story"\)/);
    expect(() => factVarsFor(row, { weather: undefined } as unknown as Facts, TWO)).toThrow(/"weather" is not a declared fact/);
    expect(() => vars({ fold: 'half', room: 'board' }, TWO)).toThrow(/"half" is not a declared value of fact "fold"/);
  });

  it('the real vocabulary\'s first fact is `room`: what sizes a thing comes first (anything that can remove it is declared after it)', () => {
    expect(Object.keys(FACTS)[0]).toBe('room');
  });
});

describe('the real page reports the room it computed to the shell', () => {
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
  const combat = (space?: unknown) =>
    ({
      combat_id: 'combat-flight', session_id: 's1', round: 1, state: 'active', turn_index: 0, active_participant_id: 'p1', initiative: ['p1', 'w1'],
      participants: [
        { participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 10, hp_max: 10, ac: 13, conditions: [], is_alive: true, can_be_targeted: false, is_active_turn: true, took_turn: false },
        { participant_id: 'w1', entity_id: 'g1', name: 'Timberwolf', is_pc: false, initiative: 9, hp_current: 19, hp_max: 19, ac: 13, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false },
      ],
      ...(space === undefined ? {} : { space }),
    }) as unknown as CombatState;

  beforeEach(() => {
    jest.clearAllMocks();
    seen.length = 0;
    window.localStorage.clear();
    (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
    (dnd.getGrounding as jest.Mock).mockResolvedValue(GROUNDING);
  });

  async function load(state: CombatState | null) {
    (dnd.getSession as jest.Mock).mockResolvedValue(state ? { ...SESSION, active_combat_id: 'combat-flight' } : SESSION);
    (dnd.getCombatState as jest.Mock).mockResolvedValue(state);
    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('Test Table');
    await waitFor(() => expect(container.querySelector('[data-layout-resolved]')).toHaveAttribute('data-moment', state ? 'combat' : 'exploring'));
    return seen[seen.length - 1];
  }

  it('not in a fight: none', async () => expect(await load(null)).toEqual({ room: 'none' }));
  it('a fight with a usable space: board', async () => expect(await load(combat(SPACE))).toEqual({ room: 'board' }));
  it('a fight whose state has no `space` key: unserved (positioning off)', async () => expect(await load(combat())).toEqual({ room: 'unserved' }));
  it('a fight with `space: null`: band (the encounter authored no board)', async () => expect(await load(combat(null as unknown as CombatSpace))).toEqual({ room: 'band' }));
  it('a fight whose space the map refuses (a null cell): band, the map\'s own predicate', async () => {
    expect(await load(combat({ ...SPACE, cell: null }))).toEqual({ room: 'band' });
  });
});
