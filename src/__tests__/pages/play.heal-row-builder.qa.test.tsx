/**
 * Lane G QA (Miko), item 2 -- TAV-HEAL-SHARES-MOUNT-ROW-BUILDER. Drives the REAL /play page with a
 * fake events wire (the raw reader is mocked at the dnd.ts seam, as the repo's other /play suites do;
 * the pager and the poll are real).
 *
 * Parity is the point: the same campaign must read the same whether the mount saw all of it or the
 * heal brought the tail.
 */
import { screen, act, waitFor, fireEvent } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, GroundingData, Participant, Session } from '@/lib/api/types';
import type { LogRow } from '@/components/ChatLog';
import { mergeHealedRows } from '@/app/play/[sessionId]/historyRows';

jest.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 's1' }) }));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', email: null } }),
}));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));

const mockRaw = jest.fn<Promise<EngineSessionEvent[] | null>, unknown[]>();
jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([{ event_type: 'narration', description: 'x' }])),
  getSessionEventsRaw: (...a: unknown[]) => mockRaw(...a),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  combatFromScene: jest.fn(), startCombat: jest.fn(), spawnMonster: jest.fn(), rollInitiative: jest.fn(),
  monsterTurn: jest.fn(), attack: jest.fn(), dodge: jest.fn(), dash: jest.fn(), endTurn: jest.fn(),
  endCombat: jest.fn(), advanceScene: jest.fn(), setFlag: jest.fn(),
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'alice', role: 'player', character_id: null })),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () { yield { kind: 'done' as const }; }),
}));

import * as dnd from '@/lib/api/dnd';
import * as stream from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;

const SESSION: Session = {
  session_id: 's1', channel: 'the_hollow_tide', status: 'active', dm_username: 'suzu',
  participant_usernames: ['alice'], player_count: 1, active_combat_id: null, dm_mode: 'ai', ai_assist_level: 'full',
};
const PARTY: Participant[] = [{ username: 'alice', is_dm: false, character: null }];
const GROUNDING = {
  scene_id: 'cave-mouth', scene_name: 'The Cave Mouth', boxed_text: 'Damp air rolls out of the darkness.',
  objective: 'Go in.', hook: 'A hook.', adventure_title: 'The Hollow Tide Cave', opening_lines: [], transitions: [], flags: {}, encounter_state: {},
} as unknown as GroundingData;

let campaign: EngineSessionEvent[] = [];
const fakeEngine = (...args: unknown[]) => {
  const since = (args[2] as number | undefined) ?? 0;
  return Promise.resolve(campaign.filter((e) => (e.seq ?? 0) > since).slice(0, 500));
};
/** Fail the Nth raw request (1-based); every other request is served. */
function failRequest(n: number) {
  let calls = 0;
  mockRaw.mockImplementation((...a: unknown[]) => (++calls === n ? Promise.resolve(null) : fakeEngine(...a)));
}

const nar = (seq: number, text: string): EngineSessionEvent => ({ seq, kind: 'narration', actor: 'suzu', data: { text } });
const act_ = (seq: number, text: string): EngineSessionEvent => ({ seq, kind: 'player_action', actor: 'alice', data: { text, who: 'alice' } });
const dice = (seq: number): EngineSessionEvent => ({
  seq, kind: 'dice_roll', actor: 'alice',
  data: { kind: 'skill', skill: 'stealth', modifier: 3, rolls: [14], total: 17, description: 'Stealth check' },
});
const filler = (n: number): EngineSessionEvent[] => Array.from({ length: n }, (_, i) => nar(i + 1, `old ${i + 1}.`));

async function tick(ms = 4000) {
  await act(async () => { jest.advanceTimersByTime(ms); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
}
const count = (t: string) => screen.queryAllByText(t).length;
const logText = () => screen.getByRole('log').textContent ?? '';
const before = (a: string, b: string) => {
  const x = screen.getByText(a); const y = screen.getByText(b);
  return !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
};
async function send(text: string) {
  const input = await screen.findByRole('textbox');
  fireEvent.change(input, { target: { value: text } });
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  campaign = [];
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetGrounding.mockResolvedValue(null as unknown as GroundingData);
  mockRaw.mockImplementation(fakeEngine);
});
afterEach(() => jest.useRealTimers());

describe('parity: a healed transcript reads like a mounted one', () => {
  // Mixed kinds, a duplicated line on purpose, and kinds the transcript deliberately omits.
  const MIXED = (): EngineSessionEvent[] => [
    ...filler(500),
    { seq: 501, kind: 'opening_narrated', data: { scene_id: 'cave-mouth' } },
    act_(502, 'I peer inside.'),
    nar(503, 'The wind howls.'),
    dice(504),
    { seq: 505, kind: 'scene_advance', data: { description: 'You step into the cave.' } },
    nar(506, 'The wind howls.'),
    { seq: 507, kind: 'x_card', actor: 'bob', data: {} },
    { seq: 508, kind: 'recap', data: { text: 'RECAP BODY', who: 'Suzu' } },
    { seq: 509, kind: 'rebind', data: {} },
    { seq: 510, kind: 'session_pause', data: {} },
    { seq: 511, kind: 'some_future_kind', data: { text: 'FUTURE BODY' } },
    nar(512, 'tail line.'),
  ];

  async function transcript(partialMount: boolean) {
    campaign = MIXED();
    mGetGrounding.mockResolvedValue(GROUNDING);
    if (partialMount) failRequest(2);
    const view = renderPlay(<PlayPage />);
    expect(await screen.findByText('old 500.')).toBeInTheDocument();
    if (partialMount) {
      expect(screen.queryByText('tail line.')).not.toBeInTheDocument(); // control: the mount really was cut
      await tick();
      await tick();
    }
    await waitFor(() => expect(count('tail line.')).toBe(1));
    const t = logText();
    view.unmount();
    return t;
  }

  it('same campaign: the log text after mount-then-heal equals the log text of a complete mount', async () => {
    const whole = await transcript(false);
    jest.clearAllMocks();
    const healed = await transcript(true);
    // timestamps are formatted per row; strip clock-like tokens so the comparison is about content/order
    const norm = (s: string) => s.replace(/\d{1,2}:\d{2}(\s?[AP]M)?/gi, '');
    expect(norm(healed)).toBe(norm(whole));
    expect(whole).toMatch(/The Hollow Tide Cave|Damp air/); // control: the opening block is in the comparison
    expect(whole).not.toMatch(/RECAP BODY|FUTURE BODY/);
  });
});

describe('the flag-before-watermark race', () => {
  // FINDING (P2, non-blocking, PRE-EXISTING -- the base has the same hole; the branch's claim "a first-page failure
  // heals from 0" is true only AFTER the mount's Promise.all joins): the flag is armed when grounding AND the
  // history read have both settled. A poll tick that lands before that (grounding / participants slower than the
  // 4 s tick -- likely exactly when the engine just failed the first page) sees flag=false and watermark=0, reads
  // the whole log as "live", draws only the dice row, and advances the watermark to the end. The mount then
  // arms the flag but there is nothing past the watermark: the story is never drawn until reload. Observed
  // requests: since_seq [0, 0, 3, 3, 3]; log = the dice row alone. Fix: arm the flag true at mount start and
  // let the mount clear it, or hold the events poll until the mount has seeded the watermark.
  test.failing('FIRST page fails and grounding is slow: a poll tick inside that window must not consume the history as live activity', async () => {
    campaign = [nar(1, 'first line.'), dice(2), nar(3, 'third line.')];
    let calls = 0;
    mockRaw.mockImplementation((...a: unknown[]) => (++calls === 1 ? Promise.resolve(null) : fakeEngine(...a)));
    let release: (g: GroundingData | null) => void = () => undefined;
    mGetGrounding.mockImplementation(() => new Promise((r) => { release = r as typeof release; }));
    renderPlay(<PlayPage />);
    await act(async () => { await Promise.resolve(); });
    await tick(); // a poll tick lands while grounding is pending
    await tick();
    await act(async () => { release(null); });
    await tick();
    await tick();
    await waitFor(() => expect(count('third line.')).toBe(1));
    expect(count('first line.')).toBe(1);
    expect(count('Stealth +3')).toBe(1);
  });

  it('second page fails and grounding is slow: every tail row is drawn exactly once', async () => {
    campaign = [...filler(500), nar(501, 'tail A.'), dice(502), nar(503, 'tail B.')];
    failRequest(2);
    let release: (g: GroundingData | null) => void = () => undefined;
    mGetGrounding.mockImplementation(() => new Promise((r) => { release = r as typeof release; }));
    renderPlay(<PlayPage />);
    await act(async () => { await Promise.resolve(); });
    await tick();
    await tick();
    await act(async () => { release(null); });
    await tick();
    await tick();
    await waitFor(() => expect(count('tail B.')).toBe(1));
    expect(count('tail A.')).toBe(1);
    expect(count('Stealth +3')).toBe(1);
  });

  // FINDING (new in this branch): the heal now AWAITS getGrounding between clearing the unread-history flag
  // and advancing the watermark (useSessionEvents.ts, heal branch). The poll has no re-entrancy guard, so a
  // second tick inside that await (grounding slower than the 4 s tick) reads the same rows past the
  // un-advanced watermark, sees healing === false, and draws the dice/X-card rows itself; the first tick
  // then merges the same rows again. Before this branch nothing awaited in that window. Trigger: an
  // opening_narrated in the healed tail AND grounding >4 s. Cosmetic (a doubled dice line), self-limiting,
  // so non-blocking; fix is to advance the watermark before the await or read grounding without awaiting.
  test.failing('opening_narrated in the healed tail + grounding slower than one tick: a dice row is drawn once', async () => {
    campaign = [...filler(500), { seq: 501, kind: 'opening_narrated', data: { scene_id: 'cave-mouth' } }, dice(502), nar(503, 'tail B.')];
    failRequest(2);
    let first = true;
    let release: (g: GroundingData | null) => void = () => undefined;
    mGetGrounding.mockImplementation(() => {
      if (first) { first = false; return Promise.resolve(GROUNDING); } // the mount's own read
      return new Promise((r) => { release = r as typeof release; }); // the heal's read hangs
    });
    renderPlay(<PlayPage />);
    expect(await screen.findByText('old 500.')).toBeInTheDocument();
    await tick(); // heal tick: clears the flag, awaits grounding
    await tick(); // next tick inside that await
    await act(async () => { release(GROUNDING); });
    await tick();
    expect(count('tail B.')).toBe(1);
    expect(count('Stealth +3')).toBe(1);
  });
});

describe('a partial mount healed while the player sends a turn', () => {
  async function partialMountThenTurn(opts: { persisted: EngineSessionEvent[]; line: string; narration: string }) {
    campaign = [...filler(500), nar(501, 'tail A.'), nar(502, 'tail B.')];
    failRequest(2);
    mStream.mockImplementation(async function* () {
      yield { kind: 'chunk' as const, text: opts.narration };
      yield { kind: 'done' as const };
    });
    renderPlay(<PlayPage />);
    expect(await screen.findByText('old 500.')).toBeInTheDocument();
    await send(opts.line); // the turn is taken BEFORE the first heal tick
    await waitFor(() => expect(count(opts.narration)).toBe(1));
    campaign = [...campaign, ...opts.persisted]; // the server has stored the turn by the time the heal reads
    await tick();
    await tick();
    await waitFor(() => expect(count('tail B.')).toBe(1));
  }

  it('the turn is drawn once, the healed history sits BEFORE it, and history keeps its order', async () => {
    await partialMountThenTurn({
      line: 'I hum a little tune and wait.',
      narration: 'The cave hums back.',
      persisted: [act_(503, 'I hum a little tune and wait.'), nar(504, 'The cave hums back.')],
    });
    expect(count('I hum a little tune and wait.')).toBe(1);
    expect(count('The cave hums back.')).toBe(1);
    expect(before('old 500.', 'tail A.')).toBe(true);
    expect(before('tail A.', 'tail B.')).toBe(true);
    expect(before('tail B.', 'I hum a little tune and wait.')).toBe(true);
    expect(before('I hum a little tune and wait.', 'The cave hums back.')).toBe(true);
    await tick();
    expect(count('The cave hums back.')).toBe(1); // a later tick does not draw it again
  });

  // PIN of the declared debt (historyRows.ts): a live row carries no seq, so a server copy stored with
  // different text (truncated / re-escaped) is not recognised and the turn is drawn twice.
  test.failing('DEBT: the server stored the narration truncated -> still drawn once', async () => {
    await partialMountThenTurn({
      line: 'I look around.',
      narration: 'A long reply that the server stores in a shortened form.',
      persisted: [act_(503, 'I look around.'), nar(504, 'A long reply that the server stores in a shortened…')],
    });
    expect(screen.queryAllByText(/A long reply that the server stores/)).toHaveLength(1);
  });
});

describe('mergeHealedRows: legitimate repeated lines', () => {
  const ev = (seq: number, text: string, kind = 'player'): LogRow => ({ id: `ev${seq}`, ts: '', who: 'alice', kind, text } as LogRow);
  const live = (n: number, text: string, kind = 'player'): LogRow => ({ id: `r${n}`, ts: '', who: 'alice', kind, text } as LogRow);

  it('the same action twice, BOTH already stored: the older is kept, the newer is the live row', () => {
    const out = mergeHealedRows([ev(1, 'mount'), live(1, 'I attack.')], [ev(600, 'I attack.'), ev(700, 'I attack.')]);
    expect(out.map((r) => r.id)).toEqual(['ev1', 'ev600', 'r1']);
  });

  // DEBT made visible: the newer turn is not stored yet when the heal reads, so the OLDER stored copy is
  // taken for the live row and silently dropped -- the player's history loses a real line.
  test.failing('the same action twice, the newer NOT stored yet: the older stored line must survive', () => {
    const out = mergeHealedRows([ev(1, 'mount'), live(1, 'I attack.')], [ev(600, 'I attack.')]);
    expect(out.map((r) => r.id)).toEqual(['ev1', 'ev600', 'r1']);
  });

  it('identical lines inside the healed history itself are all kept when no live row matches', () => {
    const out = mergeHealedRows([ev(1, 'mount')], [ev(5, 'The wind howls.', 'narration'), ev(9, 'The wind howls.', 'narration')]);
    expect(out.map((r) => r.id)).toEqual(['ev1', 'ev5', 'ev9']);
  });

  it('kind is part of the match: a live player line does not swallow a narration with the same words', () => {
    const out = mergeHealedRows([live(1, 'Run.', 'player')], [ev(5, 'Run.', 'narration')]);
    expect(out.map((r) => r.id)).toEqual(['ev5', 'r1']);
  });

  it('several live rows: history goes before the FIRST of them, order inside each group is kept', () => {
    const out = mergeHealedRows([ev(1, 'm'), live(1, 'a'), live(2, 'b', 'narration')], [ev(10, 'h1', 'narration'), ev(11, 'h2', 'narration')]);
    expect(out.map((r) => r.id)).toEqual(['ev1', 'ev10', 'ev11', 'r1', 'r2']);
  });

  it('an empty heal returns the log unchanged; a heal into an empty log is the heal', () => {
    const log = [ev(1, 'm'), live(1, 'a')];
    expect(mergeHealedRows(log, []).map((r) => r.id)).toEqual(['ev1', 'r1']);
    expect(mergeHealedRows([], [ev(2, 'h')]).map((r) => r.id)).toEqual(['ev2']);
  });
});

describe('history longer than one page', () => {
  it('a 1,200-row log with the second page failing: all 1,200 drawn once, in order', async () => {
    campaign = filler(1200);
    failRequest(2);
    renderPlay(<PlayPage />);
    expect(await screen.findByText('old 500.')).toBeInTheDocument();
    expect(screen.queryByText('old 501.')).not.toBeInTheDocument();
    await tick();
    await tick();
    await waitFor(() => expect(count('old 1200.')).toBe(1));
    for (const n of [1, 250, 499, 500, 501, 502, 750, 1000, 1199, 1200]) expect(count(`old ${n}.`)).toBe(1);
    const order = [1, 250, 500, 501, 502, 750, 1000, 1199, 1200];
    for (let i = 1; i < order.length; i += 1) expect(before(`old ${order[i - 1]}.`, `old ${order[i]}.`)).toBe(true);
    await tick();
    await tick();
    expect(count('old 501.')).toBe(1); // the next ticks are not a second heal
  });

  it('control: when the mount read is COMPLETE nothing heals and a quiet tick draws nothing new', async () => {
    campaign = filler(120);
    renderPlay(<PlayPage />);
    expect(await screen.findByText('old 120.')).toBeInTheDocument();
    await tick();
    await tick();
    expect(count('old 120.')).toBe(1);
    expect(count('old 1.')).toBe(1);
  });
});
