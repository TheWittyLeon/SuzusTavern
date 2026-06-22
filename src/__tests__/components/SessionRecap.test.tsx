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

  it('streams an AI recap when assist is on and replaces the digest', async () => {
    mStream.mockImplementation(async function* () {
      yield { kind: 'chunk' as const, text: 'When last we met, the tide was rising.' };
    });
    render(<SessionRecap session={makeSession({ ai_assist_level: 'full' })} username="leon" />);
    expect(await screen.findByText(/when last we met/i, { selector: 'p' })).toBeInTheDocument();
    expect(mStream).toHaveBeenCalledTimes(1);
    // grounded in the deterministic facts, not free-form
    expect(mStream.mock.calls[0][0].mechanics).toMatch(/DM’d by Suzu/);
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

  it('strip variant is collapsible and dismissible', async () => {
    render(<SessionRecap session={makeSession({ ai_assist_level: 'off' })} username="leon" variant="strip" />);
    // collapsed by default → toggle present, body hidden
    const toggle = await screen.findByRole('button', { name: /where you left off/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /dismiss recap/i })).toBeInTheDocument();
  });
});
