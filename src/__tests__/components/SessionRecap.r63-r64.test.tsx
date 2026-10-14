/**
 * R63 (M1) and R64 (M2), owner rulings of 2026-10-13, on top of R51 F2.
 *  R63: a STORED recap is hidden while the log has no story (a recap of nothing, made before R51); it shows
 *       again as soon as a story row exists. No model call, no row deleted.
 *  R64: `session_end` is bookkeeping, like `session_start`: ending a session that had no play earns no recap.
 * Same harness as SessionRecap.r51.nothing-happened.test.tsx: the REAL component, reader, pager and stream over a
 * fake `fetch`; "no request" is asserted on the network mock.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';

import SessionRecap from '@/components/SessionRecap';
import type { Session } from '@/lib/api/types';
import { buildRecap } from '@/lib/dnd/recap';

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

const book = (seq: number, kind: string): Row => ({ seq, kind, data: { description: `bookkeeping ${kind}` } });
const ENDED = 'Session ended. 0 XP awarded to 0 players.';
const ended = (seq: number): Row => ({ seq, kind: 'session_end', data: { description: ENDED } });
const noRecapRows = () => log.filter((e) => e.kind === 'recap' && e.data?.log_kind === 'recap');
const heading = (re: RegExp) => screen.getByRole('heading', { name: re });

describe('R64: session_end is bookkeeping', () => {
  it.each(VARIANTS)('%s: start + end only (no play): no request, no recap row, no "Session ended" digest', async (variant) => {
    log = [book(1, 'session_start'), ended(2)];
    const view = await mount(variant);
    expect(eventsGets).toBeGreaterThan(0); // control: the log was read
    expect(posts()).toHaveLength(0);
    expect(noRecapRows()).toHaveLength(0);
    expect(screen.queryByText(/Session ended/)).not.toBeInTheDocument();
    if (variant === 'card') expect(heading(/where you left off/i)).toBeInTheDocument();
    else expect(view.container).toBeEmptyDOMElement();
  });

  it.each(VARIANTS)('%s: an end after a stored recap makes no new one', async (variant) => {
    log = [...story(1, 2), recap(3, 'STORED, THEN THE END'), ended(4)];
    await mount(variant);
    expect(await screen.findByText(/STORED, THEN THE END/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: XP awards and other story rows still count', async (variant) => {
    log = [book(1, 'session_start'), { seq: 2, kind: 'xp_award', data: { description: '50 XP awarded to 2 players.' } }, ended(3)];
    await mount(variant);
    expect(posts()).toHaveLength(1);
  });

  it('assist off: the end line is not printed in the digest beside real story', async () => {
    log = [...story(1, 2), ended(3)];
    await mount('card', { session: session({ ai_assist_level: 'off' }) });
    expect(screen.getByText(/story 2/)).toBeInTheDocument();
    expect(screen.queryByText(/Session ended/)).not.toBeInTheDocument();
  });
});

describe('R63: a stored recap of nothing is hidden', () => {
  it.each(VARIANTS)('%s: start + a stored recap, no story: the stored text is hidden, nothing sent, nothing stored, nothing deleted', async (variant) => {
    log = [book(1, 'session_start'), recap(2, 'A RECAP OF NOTHING')];
    const before = log.length;
    const view = await mount(variant);
    expect(eventsGets).toBeGreaterThan(0);
    expect(screen.queryByText(/A RECAP OF NOTHING/)).not.toBeInTheDocument();
    expect(screen.queryByText(/bookkeeping session_start/)).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    expect(log).toHaveLength(before);
    if (variant === 'card') expect(heading(/where you left off/i)).toBeInTheDocument();
    else expect(view.container).toBeEmptyDOMElement();
  });

  it('assist off: the card shows the metadata state, not "Previously on" with the bookkeeping line', async () => {
    log = [book(1, 'session_start'), recap(2, 'A RECAP OF NOTHING')];
    await mount('card', { session: session({ ai_assist_level: 'off' }) });
    expect(heading(/where you left off/i)).toBeInTheDocument();
    expect(screen.queryByText(/bookkeeping session_start/)).not.toBeInTheDocument();
  });

  it.each(VARIANTS)('%s: start + recap + end (R63 and R64 together): hidden, nothing sent', async (variant) => {
    log = [book(1, 'session_start'), recap(2, 'A RECAP OF NOTHING'), ended(3)];
    await mount(variant);
    expect(screen.queryByText(/A RECAP OF NOTHING/)).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: then a real event arrives: the recap shows again, and a fresh one is made as R37 says', async (variant) => {
    log = [book(1, 'session_start'), recap(2, 'A RECAP OF NOTHING')];
    const first = await mount(variant);
    expect(screen.queryByText(/A RECAP OF NOTHING/)).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    first.unmount();
    log.push(row(3, 'player_action', 'I open the door'));
    await mount(variant);
    expect(posts()).toHaveLength(1);
    expect(await screen.findByText(/FRESH RECAP FROM THE MODEL/, { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText(/A RECAP OF NOTHING/)).not.toBeInTheDocument();
  });

  it('then a real event arrives with no username to generate with: the digest of the story shows (the recap is back)', async () => {
    log = [book(1, 'session_start'), recap(2, 'A RECAP OF NOTHING'), row(3, 'narration', 'The door creaks open.')];
    await mount('card', { username: null });
    expect(posts()).toHaveLength(0);
    expect(screen.getByText(/The door creaks open\./)).toBeInTheDocument();
  });

  it.each(VARIANTS)('%s: a stored recap with story before it still shows (R37 unchanged)', async (variant) => {
    log = [book(1, 'session_start'), ...story(2, 2), recap(4, 'STORED AFTER STORY')];
    await mount(variant);
    expect(await screen.findByText(/STORED AFTER STORY/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });
});

describe('R64: the digest itself (direct buildRecap)', () => {
  it('a session_end beside a notable story row is not printed, and is not what makes the digest "from events"', () => {
    const r = buildRecap(
      session(),
      [
        { event_type: 'session_start', description: 'Session started by suzu.' },
        { event_type: 'scene_advance', description: 'The scene moved to the Hollow.' },
        { event_type: 'session_end', description: ENDED },
      ],
    );
    expect(r.lines).toEqual(['The scene moved to the Hollow.']);
    expect(r.facts).not.toMatch(/Session ended/);
  });
});
