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
  it('is a polite status region with the streaming text hidden from AT', () => {
    const { container } = render(<NarratorStrip text="The door creaks." talking />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    // The word-by-word reveal must be aria-hidden so AT isn't flooded per token.
    expect(screen.getByText('The door creaks.')).toHaveAttribute('aria-hidden', 'true');
    void container;
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
