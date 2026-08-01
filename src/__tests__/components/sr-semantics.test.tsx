/**
 * Screen-reader semantics (S3.5 / ST-077) — accessible names, roles, landmarks,
 * and live-region wiring on the play-screen components. jsdom can't drive a real
 * AT, but it can assert the ARIA contract these depend on.
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChatLog, { type LogRow } from '@/components/ChatLog';
import NarratorStrip from '@/components/NarratorStrip';
import InitiativeTracker, { type InitEntry } from '@/components/InitiativeTracker';
import PartyPanel from '@/components/PartyPanel';
import Icon from '@/components/Icon';
import type { Participant } from '@/lib/api/types';

describe('ChatLog', () => {
  it('is a polite live log region (announces completed lines)', () => {
    const rows: LogRow[] = [
      { id: 'r1', who: 'You', kind: 'player', text: 'Hi', ts: '12:00' },
    ];
    render(<ChatLog rows={rows} />);
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'polite');
  });
});

describe('NarratorStrip', () => {
  it('is a polite status region announcing the scene/combat text normally (not aria-hidden)', () => {
    // TAV-NARRATION-DECOUPLE: NarratorStrip no longer streams narration
    // token-by-token (that flood-risk lived in the chat log's own
    // streaming row, which IS aria-hidden until finalize — see ChatLog's
    // T1/TAV-S1 test). This banner updates rarely (scene change / turn
    // change), so its text is announced normally, not aria-hidden.
    // TAV-PLAY-INPUT-LOCK-NO-FEEDBACK (2026-08-01, Kage IMPORTANT-2 / Iro
    // MAJOR-2 rework): the `talking` cue is VISIBLE-ONLY (aria-hidden) so the
    // atomic region's accessible text stays invariant across `talking` — no
    // entry/exit announcements, no per-beat atomic re-read of the banner.
    // ChatLog's "Suzu is composing…" thinking row is the single SR channel
    // for the generating state.
    const { rerender } = render(
      <NarratorStrip sceneName="The Sooty Chimney" objective="Find the source." />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(
      screen.getByText('The Sooty Chimney — Find the source.'),
    ).not.toHaveAttribute('aria-hidden');
    rerender(
      <NarratorStrip sceneName="The Sooty Chimney" objective="Find the source." talking />,
    );
    // Scene text stays announced normally while talking…
    expect(
      screen.getByText('The Sooty Chimney — Find the source.'),
    ).not.toHaveAttribute('aria-hidden');
    // …and the whole cue (text + pulsing ellipsis) is out of the accessible
    // tree, so the region's computed text is unchanged by the talking flip.
    const cue = screen.getByText(/Suzu is narrating/i);
    expect(cue).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('InitiativeTracker', () => {
  it('renders a named ordered list with aria-current on the active turn', () => {
    const entries: InitEntry[] = [
      { id: 'a', name: 'Velka', initiative: 18, kind: 'pc', isYou: true },
      { id: 'b', name: 'Goblin', initiative: 12, kind: 'monster' },
    ];
    render(<InitiativeTracker entries={entries} round={1} currentIndex={0} />);
    const list = screen.getByRole('list', { name: /initiative/i });
    expect(list.tagName).toBe('OL');
    expect(screen.getByText('Velka').closest('li')).toHaveAttribute('aria-current', 'true');
  });
});

describe('PartyPanel', () => {
  it('renders a named list and the HP meter announces "x of y"', () => {
    const participants: Participant[] = [
      {
        username: 'velka',
        is_dm: false,
        character: { name: 'Velka', char_class: 'rogue', level: 2, current_hp: 12, max_hp: 20 },
      } as unknown as Participant,
    ];
    render(<PartyPanel participants={participants} selfUsername="velka" />);
    expect(screen.getByRole('list', { name: /party/i })).toBeInTheDocument();
    const meter = screen.getByRole('meter', { name: /velka hit points/i });
    expect(meter).toHaveAttribute('aria-valuetext', '12 of 20 hit points');
  });
});

describe('Icon', () => {
  it('is decorative (aria-hidden) by default and semantic when labeled', () => {
    const { rerender, container } = render(<Icon name="Trash" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<Icon name="Trash" label="Delete" />);
    expect(screen.getByRole('img', { name: 'Delete' })).toBeInTheDocument();
  });
});
