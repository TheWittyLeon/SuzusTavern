import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  getSessionEvents: jest.fn(),
}));
jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
}));

import { getSessionEvents } from '../../lib/api/dnd';
import { streamDmNarration } from '../../lib/stream';
import SessionRecap from '../../components/SessionRecap';
import type { Session } from '../../lib/api/types';

const mGetEvents = getSessionEvents as jest.MockedFunction<typeof getSessionEvents>;
const mStream = streamDmNarration as jest.MockedFunction<typeof streamDmNarration>;

function makeSession(extra: Partial<Session> = {}): Session {
  return {
    session_id: 's1',
    channel: 'the_hollow_tide',
    status: 'paused',
    dm_username: 'suzu',
    player_count: 3,
    started_at: '2026-06-14T20:00:00Z',
    ...extra,
  };
}

beforeEach(() => {
  mGetEvents.mockReset().mockResolvedValue([]);
  mStream.mockReset();
});

describe('SessionRecap', () => {
  it('renders the deterministic digest and makes NO narration call when ai is off', async () => {
    render(<SessionRecap session={makeSession({ ai_assist_level: 'off' })} username="leon" />);
    expect(await screen.findByRole('heading', { name: /where you left off/i })).toBeInTheDocument();
    expect(screen.getByText(/DM’d by Suzu/, { selector: 'li' })).toBeInTheDocument();
    // The interlock guarantee: zero narration requests when assist is off.
    expect(mStream).not.toHaveBeenCalled();
  });

  it('makes NO narration call when ai_assist_level is unknown (default safe)', async () => {
    render(<SessionRecap session={makeSession()} username="leon" />);
    await screen.findByRole('heading', { name: /where you left off/i });
    expect(mStream).not.toHaveBeenCalled();
  });

  it('streams an AI recap when assist is on and there is REAL play history', async () => {
    // fromEvents=true requires notable play events (not just metadata).
    mGetEvents.mockResolvedValue([
      { event_type: 'scene_advance', description: 'The party fled the rising tide.' },
    ]);
    mStream.mockImplementation(async function* () {
      yield { kind: 'chunk' as const, text: 'When last we met, the tide was rising.' };
    });
    render(<SessionRecap session={makeSession({ ai_assist_level: 'full' })} username="leon" />);
    expect(await screen.findByText(/when last we met/i, { selector: 'p' })).toBeInTheDocument();
    expect(mStream).toHaveBeenCalledTimes(1);
    // grounded in the deterministic EVENT facts, not free-form or metadata
    expect(mStream.mock.calls[0][0].mechanics).toMatch(/rising tide/i);
  });

  // TAV-7: the internal recap-request prompt must never be persisted/rendered
  // as a real user chat message. kind:'recap' is the contract that tells the
  // server (api/routes/narration.py::_persist_player_action) this is a
  // system-authored meta-action — same treatment as kind:'opening' — so it
  // skips the player_action persist that used to echo the raw prompt into
  // ChatLog as a fake USER row (locked at the mapping layer too, see
  // rehydration.test.ts's "never builds a visible row" case).
  it('TAV-7: marks the request kind:"recap" so the server never persists the internal prompt as a player chat row', async () => {
    mGetEvents.mockResolvedValue([
      { event_type: 'scene_advance', description: 'The party fled the rising tide.' },
    ]);
    mStream.mockImplementation(async function* () {
      yield { kind: 'chunk' as const, text: 'When last we met, the tide was rising.' };
    });
    render(<SessionRecap session={makeSession({ ai_assist_level: 'full' })} username="leon" />);
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].kind).toBe('recap');
  });

  it('does NOT narrate a recap for a fresh session (metadata only, no events) — the fabrication guard', async () => {
    // The bug this locks: metadata-only recap fired an AI "previously on" that
    // hallucinated a nonexistent past. fromEvents=false ⇒ zero narration calls.
    mGetEvents.mockResolvedValue([]);
    render(<SessionRecap session={makeSession({ ai_assist_level: 'full' })} username="leon" />);
    // Card variant still renders the deterministic metadata digest…
    expect(await screen.findByRole('heading', { name: /where you left off/i })).toBeInTheDocument();
    // …but NO AI narration request is issued.
    expect(mStream).not.toHaveBeenCalled();
  });

  it('renders NOTHING on the play strip for a fresh session (no play history)', async () => {
    mGetEvents.mockResolvedValue([]);
    const { container } = render(
      <SessionRecap session={makeSession({ ai_assist_level: 'full' })} username="leon" variant="strip" />,
    );
    // Give effects a tick; the strip must stay empty (read-aloud is the opening, not a recap).
    await waitFor(() => expect(mGetEvents).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
    expect(mStream).not.toHaveBeenCalled();
  });

  it('falls back to the digest if the AI stream errors', async () => {
    mStream.mockImplementation(async function* () {
      yield { kind: 'error' as const, error: 'ai_off' };
    });
    render(<SessionRecap session={makeSession({ ai_assist_level: 'full' })} username="leon" />);
    expect(await screen.findByRole('heading', { name: /where you left off/i })).toBeInTheDocument();
  });

  it('renders the friendly empty state for a brand-new session', async () => {
    render(<SessionRecap session={{ session_id: 's2', channel: 'new_table' }} username="leon" />);
    expect(await screen.findByRole('heading', { name: /your story starts here/i })).toBeInTheDocument();
    expect(mStream).not.toHaveBeenCalled();
  });

  it('strip variant is collapsible and dismissible (with real play history)', async () => {
    mGetEvents.mockResolvedValue([
      { event_type: 'scene_advance', description: 'You crossed the underground river.' },
    ]);
    render(<SessionRecap session={makeSession({ ai_assist_level: 'off' })} username="leon" variant="strip" />);
    // collapsed by default → toggle present, body hidden
    const toggle = await screen.findByRole('button', { name: /previously on/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /dismiss recap/i })).toBeInTheDocument();
  });

  it('DDX-25 R3: does NOT re-issue the AI recap when `session` is replaced by a new-but-equivalent object (e.g. a poll re-render), but DOES recap again for a genuinely new session', async () => {
    // Locks the consumer-hardening half of the R3 fix: the play page's
    // session-status poll hands SessionRecap a freshly-deserialized `session`
    // object every ~4s even when nothing changed. Before the fix, both
    // effects depended on the whole `session` object, so every such update
    // (even a no-op one) re-ran the LLM-backed effect and re-issued a real
    // streamDmNarration call — see the poll-level regression test in
    // play.ddx25-r3-recap-poll-churn.test.tsx for the end-to-end version.
    mGetEvents.mockResolvedValue([
      { event_type: 'scene_advance', description: 'The party fled the rising tide.' },
    ]);
    mStream.mockImplementation(async function* () {
      yield { kind: 'chunk' as const, text: 'When last we met, the tide was rising.' };
    });

    const session = makeSession({ ai_assist_level: 'full' });
    const { rerender } = render(<SessionRecap session={session} username="leon" />);
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));

    // Several re-renders with a BRAND NEW object (same session_id, identical
    // content) — simulates repeated no-op poll ticks landing on this prop.
    for (let i = 0; i < 3; i += 1) {
      rerender(<SessionRecap session={{ ...session }} username="leon" />);
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(mStream).toHaveBeenCalledTimes(1);

    // Even a re-render with a genuinely DIFFERENT field (e.g. a live status
    // flip via pause/resume) must not re-trigger the recap — only a new
    // session_id should.
    rerender(<SessionRecap session={{ ...session, status: 'paused' }} username="leon" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(mStream).toHaveBeenCalledTimes(1);

    // A genuinely NEW session (different session_id) must still recap once —
    // the fix must not break the first-load/new-session behavior.
    mGetEvents.mockResolvedValue([
      { event_type: 'scene_advance', description: 'A new chapter begins.' },
    ]);
    rerender(
      <SessionRecap
        session={{ ...session, session_id: 's2' }}
        username="leon"
      />,
    );
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(2));
  });

  it('renders the human name (not the slug) in the strip sub-label when session.name is set', async () => {
    // Post-fix Tavern session: name = human form value, channel = unique slug with suffix.
    // In the strip variant the title is rendered inside the toggle button as a <span>.
    mGetEvents.mockResolvedValue([
      { event_type: 'scene_advance', description: 'You lit the brazier in the antechamber.' },
    ]);
    render(
      <SessionRecap
        session={makeSession({
          name: 'The Hollow Tide Cave',
          channel: 'the_hollow_tide_cave-9f3a',
          ai_assist_level: 'off',
        })}
        username="leon"
        variant="strip"
      />,
    );
    // The strip button is collapsed by default; the title sub-label is still in DOM.
    const toggle = await screen.findByRole('button', { name: /previously on/i });
    expect(toggle).toBeInTheDocument();
    // The human name appears in the sub-label, not the slug.
    expect(screen.getByText(/The Hollow Tide Cave/)).toBeInTheDocument();
    // The ugly slug with suffix must NOT appear.
    expect(screen.queryByText(/the_hollow_tide_cave-9f3a/)).not.toBeInTheDocument();
  });
});
