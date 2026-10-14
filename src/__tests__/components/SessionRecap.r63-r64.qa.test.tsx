/**
 * QA edges for R63 / R64 (Miko, 2026-10-13). Adversarial companions to SessionRecap.r63-r64.test.tsx:
 * start/end/start/end, an end that carried XP, case, blank text, recap-newer-than-story, the assist-off paths,
 * an incomplete read, and the "which row earned the recap" question (asserted on the request body).
 * Same harness as SessionRecap.r51.nothing-happened.test.tsx: the REAL component, reader, pager and stream over a
 * fake `fetch`; "no request" is asserted on the network mock.
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

const book = (seq: number, kind: string): Row => ({ seq, kind, data: { description: `bookkeeping ${kind}` } });
const ENDED = 'Session ended. 0 XP awarded to 0 players.';
const ended = (seq: number): Row => ({ seq, kind: 'session_end', data: { description: ENDED } });
const noRecapRows = () => log.filter((e) => e.kind === 'recap' && e.data?.log_kind === 'recap');
const heading = (re: RegExp) => screen.getByRole('heading', { name: re });


const xpAward = (seq: number): Row => ({ seq, kind: 'xp_award', data: { description: '+50 XP: the door' } });
const endedWithXp = (seq: number): Row => ({ seq, kind: 'session_end', data: { description: 'Session ended. 25 XP awarded to 2 players.' } });
const say = (seq: number, kind: string, description: unknown): Row => ({ seq, kind, data: { description } });

describe('QA R64: what earns a recap after an end', () => {
  it.each(VARIANTS)('%s: start, end, start, end (two empty sittings): nothing sent, nothing shown', async (variant) => {
    log = [book(1, 'session_start'), ended(2), book(3, 'session_start'), ended(4)];
    const view = await mount(variant);
    expect(eventsGets).toBeGreaterThan(0);
    expect(posts()).toHaveLength(0);
    expect(screen.queryByText(/Session ended/)).not.toBeInTheDocument();
    if (variant === 'strip') expect(view.container).toBeEmptyDOMElement();
  });

  it.each(VARIANTS)('%s: an end that DID award XP, with no xp_award row (the engine always writes one first; this is the partial-failure shape): earns nothing', async (variant) => {
    log = [book(1, 'session_start'), endedWithXp(2)];
    await mount(variant);
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: the XP earns the recap through the xp_award row, not the end: the request carries the award and not the end line', async (variant) => {
    log = [book(1, 'session_start'), xpAward(2), endedWithXp(3)];
    await mount(variant);
    expect(posts()).toHaveLength(1);
    const mech = String(postBodies()[0].mechanics);
    expect(mech).toContain('+50 XP: the door');
    expect(mech).not.toMatch(/Session ended/);
  });

  it.each(VARIANTS)('%s: story, end, start, end: the story row alone earns exactly one recap', async (variant) => {
    log = [...story(1, 1), ended(2), book(3, 'session_start'), ended(4)];
    await mount(variant);
    expect(posts()).toHaveLength(1);
    expect(String(postBodies()[0].mechanics)).not.toMatch(/Session ended/);
  });

  it.each(VARIANTS)('%s: kind in any case (SESSION_END, Session_End) is bookkeeping too', async (variant) => {
    log = [book(1, 'session_start'), say(2, 'SESSION_END', ENDED), say(3, 'Session_End', ENDED)];
    await mount(variant);
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: a story row of upper-case kind still counts (the list is case-folded both ways)', async (variant) => {
    log = [book(1, 'session_start'), say(2, 'NARRATION', 'The roof falls in.'), ended(3)];
    await mount(variant);
    expect(posts()).toHaveLength(1);
  });

  it.each(VARIANTS)('%s: story rows with empty, whitespace, null or non-string text are not story: end + those = nothing', async (variant) => {
    log = [book(1, 'session_start'), say(2, 'narration', ''), say(3, 'narration', '   \n\t'), say(4, 'player_action', null), say(5, 'xp_award', 42), ended(6)];
    await mount(variant);
    expect(eventsGets).toBeGreaterThan(0);
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: an end with EMPTY text beside real story: still one recap, still no end line', async (variant) => {
    log = [...story(1, 1), say(2, 'session_end', '')];
    await mount(variant);
    expect(posts()).toHaveLength(1);
  });
});

describe('QA R63: the stored recap and the newest story row', () => {
  it.each(VARIANTS)('%s: story then recap (recap is the newest row): shows the stored text, sends nothing', async (variant) => {
    log = [...story(1, 1), recap(2, 'NEWEST ROW IS THE RECAP')];
    await mount(variant);
    expect(await screen.findByText(/NEWEST ROW IS THE RECAP/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: two recaps, no story anywhere: BOTH hidden (a recap never makes itself story)', async (variant) => {
    log = [recap(1, 'ONLY ONE'), recap(2, 'ONLY TWO')];
    await mount(variant);
    expect(eventsGets).toBeGreaterThan(0);
    expect(screen.queryByText(/ONLY (ONE|TWO)/)).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: recap, then a Recap-cased recap kind, story before: the LAST wins and nothing is sent', async (variant) => {
    log = [...story(1, 1), recap(2, 'OLD'), { seq: 3, kind: 'RECAP', data: { text: 'NEWER CASED', log_kind: 'recap' } }];
    await mount(variant);
    expect(await screen.findByText(/NEWER CASED/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: a recap row with blank text and story before it: no stored text, and nothing newer, so nothing sent', async (variant) => {
    log = [...story(1, 1), recap(2, '   ')];
    await mount(variant);
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: stored recap, then ONLY bookkeeping newer (end, pause, resume): stored text stays, nothing sent', async (variant) => {
    log = [...story(1, 1), recap(2, 'STILL CURRENT'), ended(3), book(4, 'session_pause'), book(5, 'session_resume')];
    await mount(variant);
    expect(await screen.findByText(/STILL CURRENT/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: a row that was story in the build that stored the recap and is bookkeeping now (modelled as a session_end with text after a recap, no earlier story): hidden, nothing sent, nothing deleted', async (variant) => {
    log = [book(1, 'session_start'), recap(2, 'RECAP BUILT ON THE END LINE'), ended(3)];
    const before = log.length;
    await mount(variant);
    expect(screen.queryByText(/RECAP BUILT ON THE END LINE/)).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    expect(log).toHaveLength(before);
  });

  it.each(VARIANTS)('%s: that campaign later gets one story row: the recap is "older than a story row", so ONE fresh recap is made', async (variant) => {
    log = [book(1, 'session_start'), recap(2, 'RECAP BUILT ON THE END LINE'), ended(3)];
    (await mount(variant)).unmount();
    expect(posts()).toHaveLength(0);
    log.push(row(4, 'player_action', 'I knock'));
    await mount(variant);
    expect(posts()).toHaveLength(1);
    expect(await screen.findByText(/FRESH RECAP FROM THE MODEL/, { selector: 'p' })).toBeInTheDocument();
  });
});

describe('QA R63/R64: assist off, dependency down, incomplete read', () => {
  const OFF = () => ({ session: session({ ai_assist_level: 'off' }) });

  it('assist off, start + end: the card shows the metadata state; no request', async () => {
    log = [book(1, 'session_start'), ended(2)];
    await mount('card', OFF());
    expect(heading(/where you left off/i)).toBeInTheDocument();
    expect(screen.queryByText(/Session ended/)).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('assist off, strip, start + end: renders nothing', async () => {
    log = [book(1, 'session_start'), ended(2)];
    const view = await mount('strip', OFF());
    expect(view.container).toBeEmptyDOMElement();
  });

  it.each(VARIANTS)('%s: assist off + story + a stored recap row: never a request (interlock), digest prints story, not the recap or the end', async (variant) => {
    log = [...story(1, 1), recap(2, 'STORED'), ended(3)];
    await mount(variant, OFF());
    expect(posts()).toHaveLength(0);
    expect(screen.queryByText(/Session ended/)).not.toBeInTheDocument();
  });

  it.each(VARIANTS)('%s: events endpoint down: no crash, no request, no stored text', async (variant) => {
    eventsMode = 'down';
    log = [...story(1, 1), recap(2, 'UNREACHABLE')];
    await mount(variant);
    expect(posts()).toHaveLength(0);
    expect(screen.queryByText(/UNREACHABLE/)).not.toBeInTheDocument();
  });

  it.each(VARIANTS)('%s: events answer success with null data: no crash, no request', async (variant) => {
    eventsMode = 'null-data';
    await mount(variant);
    expect(posts()).toHaveLength(0);
  });

  it('FINDING-SHAPE (characterization): a first page of only bookkeeping/recap rows followed by a failed page 2 hides a stored recap whose story is on the lost page; nothing is sent and nothing is deleted', async () => {
    eventsMode = 'page2-fails';
    log = [book(1, 'session_start'), recap(2, 'STORED, STORY ON PAGE 2'), ...Array.from({ length: 520 }, (_, i) => book(3 + i, 'session_pause')), ...story(600, 1)];
    await mount('card');
    expect(eventsGets).toBeGreaterThan(1);
    expect(posts()).toHaveLength(0);
    expect(screen.queryByText(/STORED, STORY ON PAGE 2/)).not.toBeInTheDocument();
  });
});
