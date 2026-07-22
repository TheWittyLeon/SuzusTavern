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
    expect(onRoll).toHaveBeenCalledWith({ kind: 'die', sides: 20 });
  });

  it('rolls a named quick check with its skill slug', () => {
    const onRoll = jest.fn();
    render(
      <DiceTray
        onRoll={onRoll}
        quickChecks={[{ name: 'Perception', skill: 'perception', mod: 3 }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Perception/i }));
    expect(onRoll).toHaveBeenCalledWith({ kind: 'check', skill: 'perception', label: 'Perception' });
  });

  it('toggles advantage', () => {
    const onAdvantage = jest.fn();
    render(<DiceTray onRoll={jest.fn()} onAdvantage={onAdvantage} />);
    fireEvent.click(screen.getByRole('button', { name: 'advantage' }));
    expect(onAdvantage).toHaveBeenCalledWith('adv');
  });

  // UIR2-TAV-24: the roll-modifier pills wrapped 2+1 at 1280px because
  // "disadvantage" alone didn't fit its share of the ~228px content column.
  // Visible labels shorten; the FULL word stays the accessible name so
  // screen-reader users lose nothing.
  it('shortens the disadvantage/advantage pill labels but keeps the full word as the accessible name', () => {
    render(<DiceTray onRoll={jest.fn()} onAdvantage={jest.fn()} />);
    const adv = screen.getByRole('button', { name: 'advantage' });
    const dis = screen.getByRole('button', { name: 'disadvantage' });
    const straight = screen.getByRole('button', { name: 'straight' });
    expect(adv).toHaveTextContent('Adv');
    expect(dis).toHaveTextContent('Dis');
    expect(straight).toHaveTextContent('Straight');
  });

  it('toggles disadvantage via its shortened pill', () => {
    const onAdvantage = jest.fn();
    render(<DiceTray onRoll={jest.fn()} onAdvantage={onAdvantage} />);
    fireEvent.click(screen.getByRole('button', { name: 'disadvantage' }));
    expect(onAdvantage).toHaveBeenCalledWith('dis');
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

  it('combat action rail attacks a chosen target (passes id as payload)', () => {
    const onAction = jest.fn();
    render(
      <Composer
        {...base}
        combat={{ targets: [{ id: 'g1', name: 'Goblin' }], onAction, busy: false }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Attack/i }));
    const menu = screen.getByRole('menu');
    // CUI-11: payload is now the participant_id, not the name.
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Goblin/i }));
    expect(onAction).toHaveBeenCalledWith('attack', 'g1');
  });

  it('A11Y-PANEL-SEMANTICS: the action rail group is labelled via aria-labelledby pointing at its visible .railLabel kicker, not a separately-authored aria-label string', () => {
    render(
      <Composer
        {...base}
        combat={{ targets: [{ id: 'g1', name: 'Goblin' }], onAction: jest.fn(), busy: false }}
      />,
    );
    const rail = screen.getByRole('group', { name: 'Your character’s actions' });
    const label = screen.getByText('Your character’s actions');
    expect(rail.getAttribute('aria-label')).toBeNull();
    expect(rail.getAttribute('aria-labelledby')).toBe(label.id);
    expect(label.id).toBeTruthy();
  });

  it('disables Attack when isPlayerTurn is false', () => {
    const onAction = jest.fn();
    render(
      <Composer
        {...base}
        combat={{
          targets: [{ id: 'g1', name: 'Goblin' }],
          onAction,
          busy: false,
          isPlayerTurn: false,
        }}
      />,
    );
    const attackBtn = screen.getByRole('button', { name: /Attack.*not your turn/i });
    expect(attackBtn).toBeDisabled();
    // Miko minor: mirrors CastSpellPanel's hostile-turn test — a forced click
    // on a disabled control must never reach onAction.
    fireEvent.click(attackBtn);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('shows refused reason text when refusedReason is set', () => {
    render(
      <Composer
        {...base}
        combat={{
          targets: [{ id: 'g1', name: 'Goblin' }],
          onAction: jest.fn(),
          busy: false,
          refusedReason: "It's not your turn.",
        }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("It's not your turn.");
  });

  it('shows "Waiting for your turn" notice when isPlayerTurn is false', () => {
    render(
      <Composer
        {...base}
        combat={{
          targets: [{ id: 'g1', name: 'Goblin' }],
          onAction: jest.fn(),
          busy: false,
          isPlayerTurn: false,
        }}
      />,
    );
    expect(screen.getByText(/Waiting for your turn/i)).toBeInTheDocument();
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

  // UIR2-TAV-23: the "you" badge used to share the name's flex row, squeezing
  // its ellipsis budget at the fixed 220px .left column width — a 6-char name
  // (e.g. "Ashley") truncated to "Ash…" at desktop widths even though the same
  // name rendered in full on mobile. Badges now render on their own row below
  // the name; this pins that the full name text is present (not truncated by
  // JSX-level slicing — CSS ellipsis itself isn't observable in jsdom, but the
  // full un-sliced string being in the DOM is the behavioral guarantee that
  // matters here) alongside the badge, for a name long enough to have been
  // affected by the old shared-row squeeze.
  it('renders the full character name even when the "you" badge is also present', () => {
    const partyWithLongerName: Participant[] = [
      {
        username: 'alice',
        is_dm: false,
        character: {
          character_id: 'c1',
          name: 'Ashley',
          char_class: 'Rogue',
          level: 2,
          current_hp: 8,
          max_hp: 10,
          ac: 14,
        },
      },
    ];
    render(<PartyPanel participants={partyWithLongerName} selfUsername="alice" />);
    expect(screen.getByText('Ashley')).toBeInTheDocument();
    expect(screen.getByText('you')).toBeInTheDocument();
  });

  // F5/LEVELUP-NO-MOMENT: per-character "level up" badge driven from the
  // roster's own character.pending_choices — no per-character sheet fetch.
  it('shows a "level up" badge when character.pending_choices is non-empty', () => {
    const partyWithPending: Participant[] = [
      {
        username: 'alice',
        is_dm: false,
        character: {
          character_id: 'c1',
          name: 'Velka',
          char_class: 'Rogue',
          level: 4,
          current_hp: 8,
          max_hp: 10,
          ac: 14,
          pending_choices: [{ id: 'ch1', type: 'asi', level: 4, label: 'Ability Score Improvement' }],
        },
      },
    ];
    render(<PartyPanel participants={partyWithPending} selfUsername="alice" />);
    // Iro MAJOR-2: visible text stands on its own ("level up"); the `↑` glyph
    // is aria-hidden (not read aloud) and the descriptive clause lives in
    // sr-only text rather than a bare-span aria-label.
    expect(screen.getByText(/level up/i)).toBeInTheDocument();
    const glyph = screen.getByText('↑');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/choose new features/i)).toHaveClass('sr-only');
  });

  it('shows NO "level up" badge when pending_choices is empty or absent', () => {
    render(<PartyPanel participants={party} selfUsername="alice" />);
    expect(screen.queryByText(/level up/i)).not.toBeInTheDocument();
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
