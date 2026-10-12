/**
 * Lane G QA (Miko), item 1 -- R37: a new "previously on" only when an event is newer than the last
 * stored `recap` row. These tests run the REAL SessionRecap, the REAL getSessionEvents / pager and
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

describe('R37 decision table (network-level)', () => {
  it.each(VARIANTS)('%s: a campaign with history and NO recap row makes exactly one request, grounded and marked kind:recap', async (variant) => {
    log = story(1, 4);
    await mount(variant);
    expect(eventsGets).toBeGreaterThan(0);
    expect(posts()).toHaveLength(1);
    const b = postBodies()[0];
    expect(b.kind).toBe('recap');
    expect(b.session_id).toBe('s1');
    expect(b.mechanics).toMatch(/story 4/);
    expect(await screen.findByText(/FRESH RECAP FROM THE MODEL/, { selector: 'p' })).toBeInTheDocument();
  });

  it.each(VARIANTS)('%s: the last event IS a recap -> its text shows and NO narration request leaves the page', async (variant) => {
    log = [...story(1, 3), recap(4, 'STORED TEXT FOUR')];
    await mount(variant);
    expect(eventsGets).toBeGreaterThan(0); // control: the log was read, so "0 posts" is not vacuous
    expect(await screen.findByText(/STORED TEXT FOUR/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it.each(VARIANTS)('%s: story after the last recap -> one request', async (variant) => {
    log = [...story(1, 2), recap(3, 'OLD STORED'), row(4, 'player_action', 'I open the door')];
    await mount(variant);
    expect(posts()).toHaveLength(1);
    expect(screen.queryByText(/OLD STORED/)).not.toBeInTheDocument();
  });

  it.each(VARIANTS)('%s: several recap rows in a row at the end (production has up to 35) -> the LAST one shows, no request', async (variant) => {
    log = [...story(1, 2), recap(3, 'RECAP ONE'), recap(4, 'RECAP TWO'), recap(5, 'RECAP THREE LAST')];
    await mount(variant);
    expect(await screen.findByText(/RECAP THREE LAST/, { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText(/RECAP ONE|RECAP TWO/)).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('a recap pile followed by one story line is "newer events" and requests once', async () => {
    log = [...story(1, 1), recap(2, 'A'), recap(3, 'B'), row(4, 'player_action', 'I knock')];
    await mount('card');
    expect(posts()).toHaveLength(1);
  });

  it('event_type case is not significant (RECAP)', async () => {
    log = [...story(1, 2), { seq: 3, kind: 'RECAP', data: { text: 'UPPERCASE STORED' } }];
    await mount('card');
    expect(await screen.findByText(/UPPERCASE STORED/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('a recap row is never "newer than itself": a log of ONLY recap rows shows the last and sends nothing', async () => {
    log = [recap(1, 'ONLY ONE'), recap(2, 'ONLY TWO')];
    await mount('card');
    expect(await screen.findByText(/ONLY TWO/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('the stored text is shown trimmed', async () => {
    log = [...story(1, 2), recap(3, '   padded stored   ')];
    await mount('card');
    expect(await screen.findByText('padded stored', { selector: 'p', exact: false })).toBeInTheDocument();
  });

  it('the stored recap is empty: no request, no crash, the digest shows (an empty stored text is not a reason to spend a model call every open)', async () => {
    log = [...story(1, 2), recap(3, '   ')];
    await mount('card');
    expect(posts()).toHaveLength(0);
    expect(screen.getByRole('heading', { name: /previously on/i })).toBeInTheDocument();
    expect(screen.getByText(/story 2/)).toBeInTheDocument();
  });
});

describe('R37: which later events count as "something happened"', () => {
  // CONTROL: real play after the recap must trigger a request, or the failing rows below prove nothing.
  it.each(['narration', 'player_action', 'dice_roll', 'scene_advance', 'combat_start', 'xp_award', 'x_card'])(
    'control: a %s after the recap triggers a new recap',
    async (kind) => {
      log = [...story(1, 2), recap(3, 'OLD'), { seq: 4, kind, data: { text: 'something happened', description: 'something happened' } }];
      await mount('card');
      expect(posts()).toHaveLength(1);
    },
  );

  // QA RULING (Miko): bookkeeping is not story. A pause/resume, a session_start, a rebind, an
  // opening marker or another recap row after the recap means nothing HAPPENED in the fiction; spending a
  // model call there re-creates the spend R37 exists to stop (a resume from the dashboard writes
  // session_resume, then the play strip opens: one call per resume). Fixed (coordinator ruling, R37 read as story only): the kinds are STRUCTURAL_EVENT_KINDS (lib/rehydration.ts). The repo's own taxonomy agrees (lib/rehydration.ts drops recap / rebind / session_start /
  // session_created from the transcript as "structural"). Not a blocker: the failure mode is today's cost, not a wrong answer.
  it.each(['session_start', 'session_created', 'session_pause', 'session_resume', 'rebind', 'opening_narrated'])(
    'JUDGEMENT (non-blocking): a %s after the recap should NOT trigger a new recap',
    async (kind) => {
      log = [...story(1, 2), recap(3, 'STORED BEFORE BOOKKEEPING'), { seq: 4, kind, data: { description: 'bookkeeping' } }];
      await mount('card');
      expect(posts()).toHaveLength(0);
    },
  );
});

describe('R37: the assist interlock is untouched', () => {
  const levels: Array<[string, Partial<Session>]> = [
    ['off', { ai_assist_level: 'off' }],
    ['undefined', { ai_assist_level: undefined }],
    ['unknown string', { ai_assist_level: 'maybe' as unknown as Session['ai_assist_level'] }],
    ['wrong case', { ai_assist_level: 'FULL' as unknown as Session['ai_assist_level'] }],
  ];
  it.each(levels)('assist %s, NO recap row, history present: no request', async (_n, extra) => {
    log = story(1, 3);
    await mount('card', { session: session(extra) });
    expect(eventsGets).toBeGreaterThan(0);
    expect(posts()).toHaveLength(0);
  });
  it.each(levels)('assist %s, stored recap with newer events: no request', async (_n, extra) => {
    log = [...story(1, 1), recap(2, 'STORED'), row(3, 'narration', 'later')];
    await mount('card', { session: session(extra) });
    expect(posts()).toHaveLength(0);
  });
  it.each(levels)('assist %s, stored recap and nothing newer: no request, and no AI paragraph (the stored model text is not presented as Suzu\'s recap)', async (_n, extra) => {
    log = [...story(1, 1), recap(2, 'STORED MODEL TEXT')];
    await mount('card', { session: session(extra) });
    expect(posts()).toHaveLength(0);
    expect(screen.queryByText(/STORED MODEL TEXT/, { selector: 'p' })).not.toBeInTheDocument();
  });
  // (Was a finding, fixed: structural rows stay out of the digest while story remains.) buildRecap's fallback digest takes the last
  // four rows WITH A DESCRIPTION when the log has no "notable" kind, and a stored `recap` row has one, so with
  // assist OFF the deterministic list prints the model's earlier recap as a bullet. recap.ts promises the
  // assist-off recap is "exactly" the deterministic digest. Non-blocking: no model call is made.
  it('assist off: a model-written recap row does not appear in the deterministic digest', async () => {
    log = [...story(1, 1), recap(2, 'STORED MODEL TEXT')];
    await mount('card', { session: session({ ai_assist_level: 'off' }) });
    expect(screen.queryByText(/STORED MODEL TEXT/)).not.toBeInTheDocument();
  });
  it('assist "assist" behaves like "full"', async () => {
    log = story(1, 2);
    await mount('card', { session: session({ ai_assist_level: 'assist' }) });
    expect(posts()).toHaveLength(1);
  });
  it('a metadata-only campaign (no events) never makes a request, even with assist on', async () => {
    await mount('card');
    expect(posts()).toHaveLength(0);
    expect(screen.getByRole('heading', { name: /where you left off/i })).toBeInTheDocument();
  });
});

describe('R37: the username gate moved -- check it did not open a hole', () => {
  it('no username + newer events: no request; the request fires once when the username arrives', async () => {
    log = story(1, 3);
    const s = session();
    const view = render(<SessionRecap session={s} username={null} variant="card" />);
    await settle();
    expect(posts()).toHaveLength(0);
    view.rerender(<SessionRecap session={s} username="leon" variant="card" />);
    await settle();
    expect(posts()).toHaveLength(1);
    view.rerender(<SessionRecap session={{ ...s }} username="leon" variant="card" />);
    await settle();
    expect(posts()).toHaveLength(1);
  });
  it('no username + nothing newer: the stored text still shows (reading needs no identity), and still no request', async () => {
    log = [...story(1, 2), recap(3, 'STORED FOR ANON')];
    await mount('card', { username: null });
    expect(await screen.findByText(/STORED FOR ANON/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });
  it('a new-but-equal session object (the 4 s poll) neither re-requests nor drops the stored text', async () => {
    log = [...story(1, 2), recap(3, 'STORED STAYS')];
    const s = session();
    const view = render(<SessionRecap session={s} username="leon" variant="card" />);
    await settle();
    for (let i = 0; i < 3; i += 1) {
      view.rerender(<SessionRecap session={{ ...s }} username="leon" variant="card" />);
      await settle();
    }
    expect(posts()).toHaveLength(0);
    expect(eventsGets).toBe(1);
    expect(screen.getByText(/STORED STAYS/, { selector: 'p' })).toBeInTheDocument();
  });
});

describe('R37: the events read misbehaves', () => {
  it('the first page fails (HTTP 500): no request, the digest shows, nothing throws', async () => {
    eventsMode = 'down';
    await mount('card');
    expect(posts()).toHaveLength(0);
    expect(screen.getByRole('heading', { name: /where you left off/i })).toBeInTheDocument();
  });
  it('the read answers success with data:null: no request, no crash', async () => {
    eventsMode = 'null-data';
    await mount('card');
    expect(posts()).toHaveLength(0);
    expect(screen.getByRole('heading')).toBeInTheDocument();
  });
  it('the narration request itself fails (500): the digest stays and no second request follows', async () => {
    log = story(1, 3);
    mockFetch.mockImplementationOnce(async () => json(200, { success: true, data: { events: log, max_seq: 3, has_more: false } }));
    const inner = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (u: string, i: unknown) => (String(u).includes('/api/narration') ? json(500, { error: 'boom' }) : inner(u, i)));
    await mount('card');
    expect(posts()).toHaveLength(1);
    expect(screen.getByText(/story 3/)).toBeInTheDocument();
    await settle();
    expect(posts()).toHaveLength(1);
  });

  // DOCUMENTED BEHAVIOUR, not a verdict: a later page that fails ends the read at a contiguous prefix
  // (the pager warns and returns what it has), so the reader cannot see events past the cut. If the
  // prefix ends on a recap, R37 says "nothing newer" and shows the stored text although the log has more.
  // The alternative (generate on an unknown) spends a call during an outage. Left as is; filed to Kage.
  it('PIN: a later page fails and the prefix ends on a recap -> stored text shown, no request (newer events unseen)', async () => {
    eventsMode = 'page2-fails';
    log = [...story(1, 499), recap(500, 'PREFIX ENDS HERE'), ...story(501, 5)];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await mount('card');
    expect(await screen.findByText(/PREFIX ENDS HERE/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('R37: more than one page of events (the paged reader)', () => {
  it('1,200 events, recap is the LAST row (seq 1200, page 3): stored text shown, no request', async () => {
    log = [...story(1, 1199), recap(1200, 'LAST ON PAGE THREE')];
    await mount('card');
    expect(await screen.findByText(/LAST ON PAGE THREE/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    expect(eventsGets).toBeGreaterThanOrEqual(3);
  });
  it('1,200 events, the recap is at seq 500 (end of page 1) and 700 story rows follow: request', async () => {
    log = [...story(1, 499), recap(500, 'END OF PAGE ONE'), ...story(501, 700)];
    await mount('card');
    expect(posts()).toHaveLength(1);
  });
  it('exactly 500 rows ending in a recap (a full page is asked past once): stored text, no request', async () => {
    log = [...story(1, 499), recap(500, 'FULL PAGE RECAP')];
    await mount('card');
    expect(await screen.findByText(/FULL PAGE RECAP/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });
  it('a recap on page 1 only, nothing after it on page 3 but story: request (the tail decides, not the head)', async () => {
    log = [recap(1, 'HEAD RECAP'), ...story(2, 1100)];
    await mount('card');
    expect(posts()).toHaveLength(1);
  });
});

describe('R37: reloads and two mounts in one navigation', () => {
  it('first open generates and the server stores it; a reload (fresh mount) shows the stored text and sends nothing more', async () => {
    log = story(1, 3);
    const first = await mount('card');
    expect(posts()).toHaveLength(1);
    first.unmount();
    await mount('card');
    expect(await screen.findByText(/FRESH RECAP FROM THE MODEL/, { selector: 'p' })).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
    await mount('strip');
    expect(posts()).toHaveLength(1);
  });

  it('dashboard card first, then the play strip: the strip sees the card\'s row and does not generate', async () => {
    log = story(1, 3);
    await mount('card');
    expect(posts()).toHaveLength(1);
    cleanupAll();
    await mount('strip');
    expect(posts()).toHaveLength(1);
    expect(screen.getByText(/FRESH RECAP FROM THE MODEL/, { selector: 'p' })).toBeInTheDocument();
  });

  // DOCUMENTED DEBT (marker in SessionRecap.tsx): both mounts read the log before either row is
  // written, so both generate. Pinned so the day a server guard lands this goes red and gets promoted.
  it('PIN (debt): card and strip mounted in the SAME navigation both generate when neither row exists yet', async () => {
    log = story(1, 3);
    render(
      <>
        <SessionRecap session={session()} username="leon" variant="card" />
        <SessionRecap session={session()} username="leon" variant="strip" />
      </>,
    );
    await settle();
    expect(posts()).toHaveLength(2);
    expect(log.filter((e) => e.kind === 'recap')).toHaveLength(2);
  });

  it('with the row already stored, card + strip mounted together send nothing', async () => {
    log = [...story(1, 3), recap(4, 'ALREADY THERE')];
    render(
      <>
        <SessionRecap session={session()} username="leon" variant="card" />
        <SessionRecap session={session()} username="leon" variant="strip" />
      </>,
    );
    await settle();
    expect(posts()).toHaveLength(0);
  });

  it('a navigation away mid-generation aborts the stream; the next mount (no row written) generates again, once', async () => {
    writeRecapOnPost = false;
    log = story(1, 3);
    const first = await mount('card');
    expect(posts()).toHaveLength(1);
    first.unmount();
    await mount('card');
    expect(posts()).toHaveLength(2);
  });
});

const cleanupAll = () => cleanup(); // unmount everything rendered so far (RTL keeps a registry)
