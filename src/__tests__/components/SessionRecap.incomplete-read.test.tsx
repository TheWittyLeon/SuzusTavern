/**
 * HUNT1020-27 -- a later events page that fails ends the read at a prefix. The prefix cannot say that nothing is
 * newer than its last recap, so SessionRecap must not generate (and store) a new recap from it. Real SessionRecap,
 * real getSessionEvents and pager, over a fake `fetch` (same harness as SessionRecap.r37.qa.test.tsx).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
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

beforeEach(() => {
  log = [];
  eventsMode = 'ok';
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
describe('HUNT1020-27: a later page fails and the prefix holds story after an OLDER recap', () => {
  // seq 301 an old recap, story after it, then the latest recap at 701 with nothing past it.
  const realLog = () => [...story(1, 300), recap(301, 'OLD RECAP'), ...story(302, 399), recap(701, 'LATEST RECAP')];

  it.each(VARIANTS)('%s: control, every page served -> nothing sent', async (variant) => {
    log = realLog();
    await mount(variant);
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: page 2 fails -> nothing sent, no recap row written', async (variant) => {
    eventsMode = 'page2-fails';
    log = realLog();
    const rows = log.length;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await mount(variant);
    expect(posts()).toHaveLength(0);
    expect(log).toHaveLength(rows);
    warn.mockRestore();
  });

  it('page 2 fails -> nothing sent; a new mount after the partial read (complete this time) still generates', async () => {
    eventsMode = 'page2-fails';
    log = [...story(1, 500), ...story(501, 5)];
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
