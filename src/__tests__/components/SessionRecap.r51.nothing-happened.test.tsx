/**
 * R51 F2 (2026-10-13): no recap until something has happened. A log of bookkeeping events alone
 * (STRUCTURAL_EVENT_KINDS) sends no narration request and stores no `recap` row, from the card and
 * from the strip. R37 (a stored recap with nothing new is shown, not remade) is pinned by its own
 * file and stays as it was. These tests run the REAL SessionRecap, the REAL getSessionEvents / pager and
 * the REAL streamDmNarration over a fake `fetch`, so "no request leaves the page" is asserted on
 * the network mock (POST /api/narration/dm/stream), not on rendered text.
 *
 * The fake engine mirrors the live wire: GET .../events?since_seq&limit -> { events, max_seq,
 * has_more } (ascending, <= 500 a page); the recap beat is persisted by the server as a `recap`
 * row whose text lives in data.text (ProjectNekoNova api/routes/narration.py).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';

import SessionRecap from '@/components/SessionRecap';
import type { Session } from '@/lib/api/types';

const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.TextDecoder === 'undefined') g.TextDecoder = NodeTextDecoder;
if (typeof g.TextEncoder === 'undefined') g.TextEncoder = NodeTextEncoder;

type Row = { seq: number; kind: string; data?: Record<string, unknown> };

const mockFetch = jest.fn();
let log: Row[] = [];
let eventsMode: 'ok' | 'down' | 'null-data' | 'page2-fails' = 'ok';
let eventsGets = 0;
let writeRecapOnPost = true;
let streamText = 'FRESH RECAP FROM THE MODEL';

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function sseBody(text: string) {
  const enc = new NodeTextEncoder();
  const frames = [`data: ${JSON.stringify({ success: true, text })}\n\n`, 'data: [DONE]\n\n'];
  let i = 0;
  return {
    getReader: () => ({
      read: async () => (i < frames.length ? { done: false, value: enc.encode(frames[i++]) } : { done: true, value: undefined }),
      cancel: async () => undefined,
    }),
  };
}

const posts = () => mockFetch.mock.calls.filter(([url]) => String(url).includes('/api/narration'));
const postBodies = () => posts().map(([, init]) => JSON.parse((init as { body: string }).body));

beforeEach(() => {
  log = [];
  eventsMode = 'ok';
  eventsGets = 0;
  writeRecapOnPost = true;
  streamText = 'FRESH RECAP FROM THE MODEL';
  mockFetch.mockReset();
  g.fetch = mockFetch;
  mockFetch.mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes('/api/narration/dm/stream')) {
      if (writeRecapOnPost) log.push({ seq: (log[log.length - 1]?.seq ?? 0) + 1, kind: 'recap', data: { who: 'Suzu', text: streamText, log_kind: 'recap' } });
      return { ok: true, status: 200, json: async () => ({}), body: sseBody(streamText) };
    }
    if (u.includes('/events?')) {
      eventsGets += 1;
      if (eventsMode === 'down') return json(500, { success: false });
      if (eventsMode === 'null-data') return json(200, { success: true, data: null });
      const q = new URL(u, 'http://x').searchParams;
      const since = Number(q.get('since_seq') ?? 0);
      if (eventsMode === 'page2-fails' && since > 0) return json(500, { success: false });
      const limit = Math.min(Number(q.get('limit') ?? 200), 500);
      const after = log.filter((e) => e.seq > since);
      const page = after.slice(0, limit);
      return json(200, {
        success: true,
        data: { events: page, max_seq: page.length ? page[page.length - 1].seq : since, has_more: after.length > limit },
      });
    }
    return json(404, { success: false });
  });
});

const session = (extra: Partial<Session> = {}): Session => ({
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'paused',
  dm_username: 'suzu',
  player_count: 2,
  started_at: '2026-06-14T20:00:00Z',
  ai_assist_level: 'full',
  ...extra,
});

const row = (seq: number, kind: string, text?: string): Row => ({ seq, kind, data: text === undefined ? {} : { text } });
const story = (from: number, n: number): Row[] => Array.from({ length: n }, (_, i) => row(from + i, 'narration', `story ${from + i}`));
const recap = (seq: number, text: string): Row => ({ seq, kind: 'recap', data: { who: 'Suzu', text, log_kind: 'recap' } });

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
};
async function mount(variant: 'card' | 'strip', props: { session?: Session; username?: string | null } = {}) {
  const view = render(<SessionRecap session={props.session ?? session()} username={props.username === undefined ? 'leon' : props.username} variant={variant} />);
  await settle();
  if (variant === 'strip') {
    const toggle = screen.queryByRole('button', { name: /previously on|where you left off/i });
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  }
  return view;
}
const VARIANTS = ['card', 'strip'] as const;


const BOOKKEEPING = ['session_start', 'session_created', 'session_pause', 'session_resume', 'rebind', 'opening_narrated', 'recap'] as const;
const book = (seq: number, kind: string): Row => ({ seq, kind, data: { description: `bookkeeping ${kind}` } });
const noRecapRows = () => log.filter((e) => e.kind === 'recap' && e.data?.log_kind === 'recap');

describe('R51 F2: a log of bookkeeping alone gets no recap', () => {
  it.each(VARIANTS)('%s: each of the seven kinds, alone, sends nothing and stores nothing', async (variant) => {
    for (const kind of BOOKKEEPING) {
      cleanup();
      mockFetch.mockClear();
      log = [book(1, kind)];
      await mount(variant);
      expect(eventsGets).toBeGreaterThan(0); // control: the log was read
      expect(posts()).toHaveLength(0);
      expect(noRecapRows()).toHaveLength(0);
    }
  });

  it.each(VARIANTS)('%s: all seven together send nothing and store nothing', async (variant) => {
    log = BOOKKEEPING.map((k, i) => book(i + 1, k));
    await mount(variant);
    expect(posts()).toHaveLength(0);
    expect(noRecapRows()).toHaveLength(0);
  });

  it('card: what shows is the state a log with no events shows (the metadata digest), not the bookkeeping text', async () => {
    log = [book(1, 'session_start')];
    await mount('card');
    expect(screen.getByRole('heading', { name: /where you left off/i })).toBeInTheDocument();
    expect(screen.queryByText(/bookkeeping session_start/)).not.toBeInTheDocument();
  });

  it('strip: renders nothing (it needs real play history)', async () => {
    log = [book(1, 'session_start')];
    const { container } = await mount('strip');
    expect(container).toBeEmptyDOMElement();
  });

  it.each(VARIANTS)('%s: the first counting event flips it: one request', async (variant) => {
    log = [book(1, 'session_start'), book(2, 'opening_narrated')];
    const first = await mount(variant);
    expect(posts()).toHaveLength(0);
    first.unmount();
    log.push(row(3, 'player_action', 'I open the door'));
    await mount(variant);
    expect(posts()).toHaveLength(1);
    expect(postBodies()[0].kind).toBe('recap');
  });

  it.each(VARIANTS)('%s: bookkeeping, then a counting event on page two of a long log: a recap is made as before', async (variant) => {
    log = [...Array.from({ length: 500 }, (_, i) => book(i + 1, 'session_resume')), row(501, 'narration', 'the first thing that happened')];
    await mount(variant);
    expect(eventsGets).toBeGreaterThanOrEqual(2);
    expect(posts()).toHaveLength(1);
  });

  it.each(VARIANTS)('%s: a long bookkeeping-only log (two full pages) is read to the end and sends nothing', async (variant) => {
    log = Array.from({ length: 1000 }, (_, i) => book(i + 1, 'session_resume'));
    await mount(variant);
    expect(eventsGets).toBeGreaterThanOrEqual(2);
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: an empty log sends nothing', async (variant) => {
    await mount(variant);
    expect(eventsGets).toBeGreaterThan(0);
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: the first page fails: nothing sent, nothing concluded, nothing thrown', async (variant) => {
    eventsMode = 'down';
    await mount(variant);
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: a stored recap and only bookkeeping after it: the stored one shows, nothing is sent', async (variant) => {
    log = [...story(1, 2), recap(3, 'STORED, THEN QUIET'), book(4, 'session_pause'), book(5, 'session_resume')];
    await mount(variant);
    expect(await screen.findByText(/STORED, THEN QUIET/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('a stored recap with NO story anywhere (only recap rows): the last shows, nothing is sent (R37 as built)', async () => {
    log = [book(1, 'session_start'), recap(2, 'MADE BEFORE R51')];
    await mount('card');
    expect(await screen.findByText(/MADE BEFORE R51/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });
});

// The kinds the engine writes at 2b7f583 (routes/, engine/) whose data carries no `description` or `text`: nothing to tell.
const NO_TEXT_KINDS = [
  'campaign_setting_changed', 'combat_started', 'flag_set', 'character_levelup', 'floor_applied', 'act_handoff',
  'xp_capped', 'x_card', 'beat_done', 'beat_resolved', 'beat_override', 'dm_override',
];
const bare = (seq: number, kind: string | null): Row => ({ seq, kind: kind as string, data: { setting: 'starting_level', from: 1, to: 3 } });

describe('R51 F2: a row counts only when it has story text to tell', () => {
  it.each(VARIANTS)('%s: each engine kind with no text, alone after session_start, sends nothing', async (variant) => {
    for (const kind of [...NO_TEXT_KINDS, '', null, 'some_future_kind']) {
      cleanup();
      mockFetch.mockClear();
      log = [book(1, 'session_start'), bare(2, kind)];
      await mount(variant);
      expect(eventsGets).toBeGreaterThan(0);
      expect(posts()).toHaveLength(0);
    }
  });

  it('card: such a log shows the no-events state, not "Session started by ..."', async () => {
    log = [book(1, 'session_start'), bare(2, 'campaign_setting_changed')];
    await mount('card');
    expect(screen.getByRole('heading', { name: /where you left off/i })).toBeInTheDocument();
    expect(screen.queryByText(/bookkeeping/)).not.toBeInTheDocument();
  });

  it.each(VARIANTS)('%s: a configuration row after a stored recap does not make a new one; the stored one shows', async (variant) => {
    log = [...story(1, 2), recap(3, 'STORED, THEN A SETTING'), bare(4, 'campaign_setting_changed')];
    await mount(variant);
    expect(await screen.findByText(/STORED, THEN A SETTING/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: the first row that carries story text flips it', async (variant) => {
    log = [book(1, 'session_start'), bare(2, 'campaign_setting_changed')];
    const first = await mount(variant);
    expect(posts()).toHaveLength(0);
    first.unmount();
    log.push({ seq: 3, kind: 'scene_advance', data: { description: 'The scene moved to the Hollow.' } });
    await mount(variant);
    expect(posts()).toHaveLength(1);
  });

  it.each(VARIANTS)('%s: a story-kind row with no text (a dice roll without a description) is not something to recap', async (variant) => {
    log = [book(1, 'session_start'), { seq: 2, kind: 'dice_roll', data: { total: 14 } }];
    await mount(variant);
    expect(posts()).toHaveLength(0);
  });
});

describe('R51 F2: a read that stopped early', () => {
  // A later page that fails leaves a prefix. The rule is the same as for a whole log: no story row seen, nothing sent
  // and the "nothing to recap yet" state shows (a digest of bookkeeping lines is a recap of nothing). Nothing is
  // latched: the next open reads again and makes the recap if one is due.
  it.each(VARIANTS)('%s: page 2 fails after bookkeeping-only page 1: nothing sent, the no-events state shows', async (variant) => {
    eventsMode = 'page2-fails';
    log = [...Array.from({ length: 500 }, (_, i) => book(i + 1, 'session_resume')), row(501, 'narration', 'unseen story')];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const view = await mount(variant);
    expect(posts()).toHaveLength(0);
    expect(screen.queryByText(/bookkeeping session_resume/)).not.toBeInTheDocument();
    if (variant === 'card') expect(screen.getByRole('heading', { name: /where you left off/i })).toBeInTheDocument();
    else expect(view.container).toBeEmptyDOMElement();
    warn.mockRestore();
  });

  it('the same log read whole on the next open: the recap is made', async () => {
    log = [...Array.from({ length: 500 }, (_, i) => book(i + 1, 'session_resume')), row(501, 'narration', 'now seen')];
    eventsMode = 'page2-fails';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = await mount('card');
    expect(posts()).toHaveLength(0);
    first.unmount();
    eventsMode = 'ok';
    await mount('card');
    expect(posts()).toHaveLength(1);
    warn.mockRestore();
  });
});
