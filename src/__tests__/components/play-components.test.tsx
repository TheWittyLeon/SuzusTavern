/**
 * Unit tests for the Sprint-7 play components: NarratorStrip, ChatLog, DiceTray,
 * Composer (+ ActionRail), PartyPanel, InitiativeTracker.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import NarratorStrip from '@/components/NarratorStrip';
import ChatLog, { type LogRow } from '@/components/ChatLog';
import DiceTray from '@/components/DiceTray';
import Composer from '@/components/Composer';
import PartyPanel from '@/components/PartyPanel';
import InitiativeTracker, { type InitEntry } from '@/components/InitiativeTracker';
import type { Participant } from '@/lib/api/types';

describe('NarratorStrip', () => {
  it('shows the narration text', () => {
    render(<NarratorStrip text="The chimney smells of soot." />);
    expect(screen.getByText('The chimney smells of soot.')).toBeInTheDocument();
  });

  it('shows a narrating placeholder while talking with no text yet', () => {
    render(<NarratorStrip text="" talking />);
    expect(screen.getByText(/Suzu is narrating/i)).toBeInTheDocument();
  });

  it('shows an idle hint when empty and not talking', () => {
    render(<NarratorStrip text="" />);
    expect(screen.getByText(/Suzu is listening/i)).toBeInTheDocument();
  });
});

describe('ChatLog', () => {
  const rows: LogRow[] = [
    { id: '1', who: 'alice', kind: 'player', text: 'I sneak in.', ts: '20:00' },
    { id: '2', who: 'Suzu', kind: 'narration', text: 'The floor groans.', ts: '20:01' },
    {
      id: '3',
      who: 'alice',
      kind: 'roll',
      text: 'Stealth +7',
      ts: '20:02',
      roll: { sides: 20, value: 18, modifier: 7, crit: false, fumble: false, label: 'Stealth' },
    },
  ];

  it('renders player, narration and roll rows', () => {
    render(<ChatLog rows={rows} />);
    expect(screen.getByText('I sneak in.')).toBeInTheDocument();
    expect(screen.getByText('The floor groans.')).toBeInTheDocument();
    // roll row shows the total (18 + 7 = 25)
    expect(screen.getByText(/= 25/)).toBeInTheDocument();
  });

  it('renders a thinking row when thinking', () => {
    render(<ChatLog rows={[]} thinking />);
    expect(screen.getByText(/narrating/i)).toBeInTheDocument();
  });
});

describe('DiceTray', () => {
  it('rolls a die when a die button is clicked', () => {
    const onRoll = jest.fn();
    render(<DiceTray onRoll={onRoll} />);
    fireEvent.click(screen.getByRole('button', { name: /d20/i }));
    expect(onRoll).toHaveBeenCalledWith(20, 'd20');
  });

  it('rolls a named quick check with its modifier', () => {
    const onRoll = jest.fn();
    render(<DiceTray onRoll={onRoll} quickChecks={[{ name: 'Perception', mod: 3 }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Perception/i }));
    expect(onRoll).toHaveBeenCalledWith(20, 'Perception', 3);
  });

  it('toggles advantage', () => {
    const onAdvantage = jest.fn();
    render(<DiceTray onRoll={jest.fn()} onAdvantage={onAdvantage} />);
    fireEvent.click(screen.getByRole('button', { name: 'advantage' }));
    expect(onAdvantage).toHaveBeenCalledWith('adv');
  });
});

describe('Composer', () => {
  const base = {
    value: '',
    onChange: jest.fn(),
    mode: 'say' as const,
    onMode: jest.fn(),
    onSend: jest.fn(),
  };

  it('disables send when empty and enables on text', () => {
    const { rerender } = render(<Composer {...base} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    rerender(<Composer {...base} value="hi" />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('Enter sends, Shift+Enter does not', () => {
    const onSend = jest.fn();
    render(<Composer {...base} value="go" onSend={onSend} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('switches compose mode', () => {
    const onMode = jest.fn();
    render(<Composer {...base} onMode={onMode} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Act' }));
    expect(onMode).toHaveBeenCalledWith('act');
  });

  it('combat action rail attacks a chosen target', () => {
    const onAction = jest.fn();
    render(
      <Composer
        {...base}
        combat={{ targets: [{ id: 'g1', name: 'Goblin' }], onAction, busy: false }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Attack/i }));
    const menu = screen.getByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Goblin/i }));
    expect(onAction).toHaveBeenCalledWith('attack', 'Goblin');
  });
});

describe('PartyPanel', () => {
  const party: Participant[] = [
    {
      username: 'alice',
      is_dm: false,
      character: {
        character_id: 'c1',
        name: 'Velka',
        char_class: 'Rogue',
        level: 2,
        current_hp: 8,
        max_hp: 10,
        ac: 14,
      },
    },
  ];

  it('renders a member with HP/AC and a "you" badge', () => {
    render(<PartyPanel participants={party} selfUsername="alice" />);
    expect(screen.getByText('Velka')).toBeInTheDocument();
    expect(screen.getByText('8/10')).toBeInTheDocument();
    expect(screen.getByText('AC 14')).toBeInTheDocument();
    expect(screen.getByText('you')).toBeInTheDocument();
  });

  it('renders an empty state', () => {
    render(<PartyPanel participants={[]} selfUsername="alice" />);
    expect(screen.getByText(/No one has joined/i)).toBeInTheDocument();
  });
});

describe('InitiativeTracker', () => {
  const entries: InitEntry[] = [
    { id: 'pc-alice', name: 'Velka', initiative: 18, kind: 'pc', isYou: true },
    { id: 'g1', name: 'Goblin', initiative: 12, kind: 'monster' },
  ];

  it('renders entries and the round when in combat', () => {
    render(<InitiativeTracker entries={entries} round={3} currentIndex={0} />);
    expect(screen.getByText('round 3')).toBeInTheDocument();
    expect(screen.getByText('Velka')).toBeInTheDocument();
    expect(screen.getByText('Goblin')).toBeInTheDocument();
  });

  it('renders nothing with no entries', () => {
    const { container } = render(<InitiativeTracker entries={[]} round={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
