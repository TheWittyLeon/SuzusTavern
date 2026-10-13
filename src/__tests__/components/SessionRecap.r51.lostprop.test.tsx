// readComplete lost in transit (a spread / slice / JSON copy between getSessionEvents and SessionRecap).
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SessionRecap from '@/components/SessionRecap';
import { streamDmNarration } from '@/lib/stream';

let mode: 'copy' | 'plain-null' = 'copy';
let rows: Array<Record<string, unknown>> = [];
jest.mock('../../lib/api/dnd', () => ({
  getSessionEvents: async () => (mode === 'copy' ? [...rows] : null),
}));
jest.mock('../../lib/stream', () => ({ streamDmNarration: jest.fn(async function* () { yield { kind: 'chunk', text: 'RECAP' }; }) }));

const s = { session_id: 's1', channel: 'c', status: 'paused', dm_username: 'suzu', player_count: 2, started_at: '2026-06-14T20:00:00Z', ai_assist_level: 'full' } as never;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
beforeEach(() => { (streamDmNarration as jest.Mock).mockClear(); mode = 'copy'; });

describe('MIKO: readComplete dropped by a copy', () => {
  it.each(['card', 'strip'] as const)('%s: due recap (story event present) is STILL made with the property gone', async (variant) => {
    rows = [{ event_type: 'session_start', description: 'Session started.' }, { event_type: 'narration', description: 'A door opened.' }];
    render(<SessionRecap session={s} username="leon" variant={variant} />); await settle();
    expect(streamDmNarration).toHaveBeenCalledTimes(1);
  });
  it.each(['card', 'strip'] as const)('%s: bookkeeping-only log sends nothing with the property gone', async (variant) => {
    rows = [{ event_type: 'session_start', description: 'Session started.' }];
    render(<SessionRecap session={s} username="leon" variant={variant} />); await settle();
    expect(streamDmNarration).not.toHaveBeenCalled();
  });
  it('card: bookkeeping-only with the property gone — what shows? (characterization)', async () => {
    rows = [{ event_type: 'session_start', description: 'Session started.' }];
    render(<SessionRecap session={s} username="leon" variant="card" />); await settle();
    // eslint-disable-next-line no-console
    console.log('[lost prop, bookkeeping only] heading=', screen.getByRole('heading').textContent, '| shows Session started:', !!screen.queryByText(/Session started/));
  });
  it.each(['card', 'strip'] as const)('%s: a stored recap with property gone still shows and sends nothing', async (variant) => {
    rows = [{ event_type: 'narration', description: 'x' }, { event_type: 'recap', description: 'STORED' }];
    render(<SessionRecap session={s} username="leon" variant={variant} />); await settle();
    expect(streamDmNarration).not.toHaveBeenCalled();
  });
});
