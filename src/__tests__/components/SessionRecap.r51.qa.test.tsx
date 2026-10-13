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

const book = (seq: number, kind: string): Row => ({ seq, kind, data: { description: `bookkeeping ${kind}` } });
const one = (seq: number, text = 'story'): Row => ({ seq, kind: 'narration', data: { text } });

// FINDING 1: kinds the engine writes before any play that carry NO description (routes/sessions.py:3620
// campaign_setting_changed {setting, from, to}). isStoryEvent counts them; buildRecap then falls back to the
// bookkeeping text, so fromEvents is true and a recap is requested for a campaign where nothing happened.
describe('MIKO F1: a configuration row is not something that happened', () => {
  it.each(VARIANTS)('%s: session_start + campaign_setting_changed (no description) sends nothing', async (variant) => {
    log = [book(1, 'session_start'), { seq: 2, kind: 'campaign_setting_changed', data: { setting: 'starting_level', from: 1, to: 3 } }];
    await mount(variant);
    expect(eventsGets).toBeGreaterThan(0);
    expect(posts()).toHaveLength(0);
  });
  it.each(VARIANTS)('%s: the request, if sent, must not be grounded on bookkeeping text', async (variant) => {
    log = [book(1, 'session_start'), { seq: 2, kind: 'campaign_setting_changed', data: { setting: 'starting_level', from: 1, to: 3 } }];
    await mount(variant);
    for (const b of postBodies()) expect(String(b.mechanics)).not.toMatch(/bookkeeping session_start/);
  });
});

describe('MIKO deny-list edge: malformed rows', () => {
  const cases: Array<[string, Row]> = [
    ['null kind', { seq: 2, kind: null as unknown as string, data: {} }],
    ['empty kind', { seq: 2, kind: '', data: {} }],
    ['unknown kind, no text', { seq: 2, kind: 'zz_unknown', data: {} }],
    ['upper-case bookkeeping kind', { seq: 2, kind: 'SESSION_RESUME', data: { description: 'x' } }],
  ];
  it.each(cases)('card: session_start + %s', async (name, r) => {
    log = [book(1, 'session_start'), r];
    await mount('card');
    // characterization: print what was sent
    // eslint-disable-next-line no-console
    console.log(`[malformed] ${name}: posts=${posts().length}`);
    if (name.startsWith('upper')) expect(posts()).toHaveLength(0);
  });
  it('strip: a malformed-only non-bookkeeping row (null kind, no text) with only bookkeeping text must send nothing', async () => {
    log = [book(1, 'session_start'), { seq: 2, kind: null as unknown as string, data: {} }];
    await mount('strip');
    expect(posts()).toHaveLength(0);
  });
});

describe('MIKO order and timing', () => {
  it.each(VARIANTS)('%s: a due recap is made once for one mount, with a session-object tick mid-read', async (variant) => {
    log = [book(1, 'session_start'), one(2)];
    const s = session();
    const view = render(<SessionRecap session={s} username="leon" variant={variant} />);
    view.rerender(<SessionRecap session={{ ...s }} username="leon" variant={variant} />); // tick before first page answers
    view.rerender(<SessionRecap session={{ ...s, status: 'active' }} username="leon" variant={variant} />);
    await settle();
    expect(posts()).toHaveLength(1);
  });
  it.each(VARIANTS)('%s: first page fails, a tick, nothing sent; remount reads again and makes exactly one', async (variant) => {
    log = [book(1, 'session_start'), one(2)];
    eventsMode = 'down';
    const s = session();
    const view = render(<SessionRecap session={s} username="leon" variant={variant} />);
    await settle();
    view.rerender(<SessionRecap session={{ ...s }} username="leon" variant={variant} />);
    await settle();
    expect(posts()).toHaveLength(0);
    view.unmount();
    eventsMode = 'ok';
    await mount(variant);
    expect(posts()).toHaveLength(1);
  });
  it.each(VARIANTS)('%s: username arrives late (null then set): one request, none before the story is known', async (variant) => {
    log = [book(1, 'session_start'), one(2)];
    const s = session();
    const view = render(<SessionRecap session={s} username={null} variant={variant} />);
    await settle();
    expect(posts()).toHaveLength(0);
    view.rerender(<SessionRecap session={s} username="leon" variant={variant} />);
    await settle();
    expect(posts()).toHaveLength(1);
  });
  it('bookkeeping-only, username arrives late: still nothing', async () => {
    log = [book(1, 'session_start')];
    const s = session();
    const view = render(<SessionRecap session={s} username={null} variant="card" />);
    await settle();
    view.rerender(<SessionRecap session={s} username="leon" variant="card" />);
    await settle();
    expect(posts()).toHaveLength(0);
  });
  it('card and strip mounted together on a due campaign: characterization (debt says 2)', async () => {
    log = [book(1, 'session_start'), one(2)];
    render(<><SessionRecap session={session()} username="leon" variant="card" /><SessionRecap session={session()} username="leon" variant="strip" /></>);
    await settle();
    // eslint-disable-next-line no-console
    console.log(`[two mounts, due] posts=${posts().length}`);
  });
  it('card and strip mounted together on a bookkeeping-only campaign: zero', async () => {
    log = [book(1, 'session_start')];
    render(<><SessionRecap session={session()} username="leon" variant="card" /><SessionRecap session={session()} username="leon" variant="strip" /></>);
    await settle();
    expect(posts()).toHaveLength(0);
  });
  it.each(VARIANTS)('%s: stored recap + one counting event after it makes one; + bookkeeping only makes none', async (variant) => {
    log = [one(1), recap(2, 'OLD'), book(3, 'session_resume'), one(4, 'new')];
    await mount(variant);
    expect(posts()).toHaveLength(1);
    cleanup(); mockFetch.mockClear();
    log = [one(1), recap(2, 'OLD'), book(3, 'session_resume')];
    await mount(variant);
    expect(posts()).toHaveLength(0);
  });
  it.each(VARIANTS)('%s: assist off + due story: no request (interlock) ', async (variant) => {
    log = [one(1)];
    await mount(variant, { session: session({ ai_assist_level: 'off' }) });
    expect(posts()).toHaveLength(0);
  });
});
