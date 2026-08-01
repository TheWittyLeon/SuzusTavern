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
  it('shows the scene name + objective out of combat', () => {
    render(<NarratorStrip sceneName="The Sooty Chimney" objective="Find the source of the smell." />);
    expect(
      screen.getByText('The Sooty Chimney — Find the source of the smell.'),
    ).toBeInTheDocument();
  });

  it('shows an idle hint when there is no scene yet', () => {
    render(<NarratorStrip />);
    expect(screen.getByText(/Suzu is setting the scene/i)).toBeInTheDocument();
  });

  it('shows combat status (round + whose turn) when combatActive, not the scene', () => {
    render(
      <NarratorStrip
        sceneName="The Sooty Chimney"
        objective="Find the source of the smell."
        combatActive
        round={2}
        turnStatusText="Your turn!"
      />,
    );
    expect(screen.getByText(/Round 2 — Your turn!/)).toBeInTheDocument();
    expect(screen.queryByText(/The Sooty Chimney/)).not.toBeInTheDocument();
  });

  it('appends the initiative order when provided during combat', () => {
    render(
      <NarratorStrip
        combatActive
        round={1}
        turnStatusText="Monster turn — Goblin"
        initiativeOrder={['Goblin', 'Anomaly', 'Velka']}
      />,
    );
    expect(
      screen.getByText('Round 1 — Monster turn — Goblin — Order: Goblin, Anomaly, Velka'),
    ).toBeInTheDocument();
  });

  it('shows an idle combat hint when combatActive but combatState has not loaded yet', () => {
    render(<NarratorStrip combatActive />);
    expect(screen.getByText(/Combat is underway/i)).toBeInTheDocument();
  });

  // TAV-PLAY-INPUT-LOCK-NO-FEEDBACK (2026-08-01): while a beat generates the
  // whole page is disabled via `talking` — the strip must SAY so instead of
  // leaving the avatar animation as the only (missable) signal.
  it('shows the narrating cue ALONGSIDE the scene line while talking out of combat', () => {
    // Kage-CR 🟢-1 rework: the cue is a sibling line, not a replacement — the
    // scene name + objective (the "what am I doing" anchor) stay visible for
    // the whole generation window.
    render(
      <NarratorStrip
        talking
        sceneName="Waking in the Wild"
        objective="Take stock of yourself and the wood."
      />,
    );
    expect(screen.getByText(/Suzu is narrating/i)).toBeInTheDocument();
    expect(screen.getByText(/Waking in the Wild/)).toBeInTheDocument();
  });

  it('keeps the narrating cue out of the accessible tree (visible-only)', () => {
    // Kage-CR IMPORTANT-2 / Iro-A11y MAJOR-2: the strip is an aria-atomic
    // polite region — an announced cue would add two utterances per beat.
    // ChatLog's "Suzu is composing…" row is the single SR channel for this
    // state; the strip cue is sighted-feedback only.
    render(<NarratorStrip talking sceneName="Waking in the Wild" objective="Take stock." />);
    expect(screen.getByText(/Suzu is narrating/i).closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('keeps the combat status line while talking during combat (no narrating override)', () => {
    render(<NarratorStrip talking combatActive round={2} turnStatusText="Your turn!" />);
    expect(screen.getByText(/Round 2 — Your turn!/)).toBeInTheDocument();
    expect(screen.queryByText(/Suzu is narrating/i)).not.toBeInTheDocument();
  });

  it('drops the narrating cue when talking ends, scene line present throughout', () => {
    const { rerender } = render(
      <NarratorStrip talking sceneName="Waking in the Wild" objective="Take stock." />,
    );
    expect(screen.getByText(/Suzu is narrating/i)).toBeInTheDocument();
    expect(screen.getByText('Waking in the Wild — Take stock.')).toBeInTheDocument();
    rerender(<NarratorStrip sceneName="Waking in the Wild" objective="Take stock." />);
    expect(screen.getByText('Waking in the Wild — Take stock.')).toBeInTheDocument();
    expect(screen.queryByText(/Suzu is narrating/i)).not.toBeInTheDocument();
  });

  // Miko-QA adversarial (TAV-PLAY-INPUT-LOCK-NO-FEEDBACK review, 2026-08-01):
  // combat starting or ending MID-BEAT while `talking` stays true the whole
  // time. `narrating = talking && !combatActive` is recomputed every render,
  // but only a live rerender proves the swap doesn't leave both/neither line
  // showing (e.g. a stale `narrating` snapshot, or the combat line racing in
  // before combatParts is populated).
  it('swaps narrating -> combat line when combat starts mid-beat (talking never drops)', () => {
    const { rerender } = render(
      <NarratorStrip talking sceneName="Waking in the Wild" objective="Take stock." />,
    );
    expect(screen.getByText(/Suzu is narrating/i)).toBeInTheDocument();
    // Combat begins while the SAME beat is still generating.
    rerender(
      <NarratorStrip
        talking
        sceneName="Waking in the Wild"
        objective="Take stock."
        combatActive
        round={1}
        turnStatusText="Your turn!"
      />,
    );
    expect(screen.getByText(/Round 1 — Your turn!/)).toBeInTheDocument();
    expect(screen.queryByText(/Suzu is narrating/i)).not.toBeInTheDocument();
  });

  it('swaps combat line -> narrating when combat ends mid-beat (talking never drops)', () => {
    const { rerender } = render(
      <NarratorStrip talking combatActive round={3} turnStatusText="Your turn!" />,
    );
    expect(screen.getByText(/Round 3 — Your turn!/)).toBeInTheDocument();
    // Combat resolves (e.g. last monster falls) while the SAME beat that
    // narrates the kill is still generating.
    rerender(
      <NarratorStrip talking sceneName="Aftermath" objective="Catch your breath." />,
    );
    expect(screen.getByText(/Suzu is narrating/i)).toBeInTheDocument();
    expect(screen.queryByText(/Round 3/)).not.toBeInTheDocument();
  });

  // Empty-scene + talking (the cold-open first beat, before grounding has a
  // scene): the idle hint STAYS and the cue is withheld — the hint already
  // says Suzu is at work, and swapping it would mutate the atomic region's
  // accessible text per beat on exactly this path (Kage IMPORTANT-4).
  it('keeps the idle hint (no cue) when talking fires before any scene has loaded', () => {
    render(<NarratorStrip talking />);
    expect(screen.getByText(/Suzu is setting the scene/i)).toBeInTheDocument();
    expect(screen.queryByText(/Suzu is narrating/i)).not.toBeInTheDocument();
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
    // TAV-COMPOSING (2026-07-26): default copy changed from 'narrating…' to
    // 'Suzu is composing…' — Suzu hasn't narrated anything yet at this
    // point, she's composing the beat.
    render(<ChatLog rows={[]} thinking />);
    expect(screen.getByText(/composing/i)).toBeInTheDocument();
  });

  describe('ST-CHARLABEL — "CharacterName (username)" player-row speaker labels', () => {
    const PARTICIPANTS: Participant[] = [
      {
        username: 'alice',
        is_dm: false,
        character: {
          character_id: 'c1',
          name: 'Velka',
          char_class: 'Rogue',
          level: 3,
          current_hp: 18,
          max_hp: 20,
          ac: 14,
        },
      },
      {
        username: 'bob',
        is_dm: false,
        // No character bound yet — the map-miss fallback case.
        character: null,
      },
    ];

    it('renders "CharacterName (username)" for a player row with a bound character', () => {
      render(
        <ChatLog
          rows={[{ id: '1', who: 'alice', kind: 'player', text: 'I sneak in.', ts: '20:00' }]}
          participants={PARTICIPANTS}
        />,
      );
      expect(screen.getByText('Velka (alice)')).toBeInTheDocument();
      expect(screen.queryByText('alice', { exact: true })).not.toBeInTheDocument();
    });

    it('falls back to the bare username for a player row with no bound character', () => {
      render(
        <ChatLog
          rows={[{ id: '1', who: 'bob', kind: 'player', text: 'I look around.', ts: '20:00' }]}
          participants={PARTICIPANTS}
        />,
      );
      expect(screen.getByText('bob')).toBeInTheDocument();
    });

    it('falls back to the bare username when participants is omitted (pre-existing callers unaffected)', () => {
      render(
        <ChatLog
          rows={[{ id: '1', who: 'alice', kind: 'player', text: 'I sneak in.', ts: '20:00' }]}
        />,
      );
      expect(screen.getByText('alice')).toBeInTheDocument();
    });

    it('leaves Suzu/Scene/DM/Table rows literal even when the name happens to match a username', () => {
      const rows: LogRow[] = [
        { id: '1', who: 'Suzu', kind: 'narration', text: 'The floor groans.', ts: '20:00' },
        { id: '2', who: 'Scene', kind: 'read_aloud_line', text: 'Welcome, travelers.', ts: '20:01' },
        { id: '3', who: 'DM (alice)', kind: 'dm_override', text: 'The lock was already broken.', ts: '20:02' },
        // Deliberately keyed to match PARTICIPANTS' username so a regression
        // that stops gating on `kind === 'player'` would relabel this too.
        { id: '4', who: 'alice', kind: 'system', text: 'alice rolled a natural 20.', ts: '20:03' },
      ];
      render(<ChatLog rows={rows} participants={PARTICIPANTS} />);
      expect(screen.getByText('Suzu')).toBeInTheDocument();
      expect(screen.getByText('Scene')).toBeInTheDocument();
      expect(screen.getByText('DM (alice)')).toBeInTheDocument();
      // The system row's speaker span is the bare "alice", not "Velka (alice)".
      const systemRow = screen.getByText('alice rolled a natural 20.').closest('.row');
      expect(systemRow).not.toBeNull();
      expect(within(systemRow as HTMLElement).getByText('alice')).toBeInTheDocument();
      expect(within(systemRow as HTMLElement).queryByText('Velka (alice)')).not.toBeInTheDocument();
    });

    it('preserves the player row color accent alongside the character label', () => {
      render(
        <ChatLog
          rows={[
            {
              id: '1',
              who: 'alice',
              kind: 'player',
              text: 'I sneak in.',
              ts: '20:00',
              color: 'var(--accent)',
            },
          ]}
          participants={PARTICIPANTS}
        />,
      );
      const label = screen.getByText('Velka (alice)');
      // The color is applied to the wrapping .who element, not the span itself.
      expect(label.closest(`.${'who'}`) || label.parentElement).toHaveStyle({
        color: 'var(--accent)',
      });
    });

    it('is case-insensitive when matching `who` against the roster username', () => {
      render(
        <ChatLog
          rows={[{ id: '1', who: 'Alice', kind: 'player', text: 'I sneak in.', ts: '20:00' }]}
          participants={PARTICIPANTS}
        />,
      );
      expect(screen.getByText('Velka (Alice)')).toBeInTheDocument();
    });
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

  // TAV-PLAY-INPUT-LOCK-NO-FEEDBACK (2026-08-01): a disabled composer must
  // explain itself — the placeholder carries the reason while disabled.
  it('shows disabledReason as the placeholder while disabled', () => {
    render(
      <Composer {...base} disabled disabledReason="Suzu is narrating — one moment…" />,
    );
    expect(
      screen.getByPlaceholderText('Suzu is narrating — one moment…'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Compose (say)')).toBeDisabled();
  });

  it('keeps the normal mode placeholder when enabled, even with disabledReason set', () => {
    render(<Composer {...base} disabledReason="Suzu is narrating — one moment…" />);
    expect(
      screen.getByPlaceholderText('Say something. Suzu will narrate back.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('Suzu is narrating — one moment…'),
    ).not.toBeInTheDocument();
  });

  it('keeps the normal placeholder when disabled with no reason supplied', () => {
    render(<Composer {...base} disabled />);
    expect(
      screen.getByPlaceholderText('Say something. Suzu will narrate back.'),
    ).toBeInTheDocument();
  });

  it('sets the title attribute to the reason while disabled (pinning current behavior)', () => {
    render(
      <Composer {...base} disabled disabledReason="Session is paused." />,
    );
    expect(screen.getByLabelText('Compose (say)')).toHaveAttribute(
      'title',
      'Session is paused.',
    );
  });

  it('does not set a title attribute when enabled, even with disabledReason set', () => {
    render(<Composer {...base} disabledReason="Session is paused." />);
    expect(screen.getByLabelText('Compose (say)')).not.toHaveAttribute('title');
  });

  // Miko-QA adversarial (TAV-PLAY-INPUT-LOCK-NO-FEEDBACK review, 2026-08-01) —
  // DEFECT REPRO: `disabled={disabled || pending}` locks the textarea, but
  // the placeholder/title swap only checks `disabled && disabledReason` — it
  // never looks at `pending`. A caller that locks the field via `pending`
  // alone (disabled=false) reproduces the EXACT bug this feature was built
  // to fix: an inert textarea with zero explanation. This is not
  // hypothetical — the play page's own human-DM composer does exactly this
  // (see play.sprint5-dm-console.test.tsx S5.2-AC5: `dmNarrationPending`
  // disables the textarea via `pending` while `disabled` stays false, and
  // page.tsx's disabledReason ternary has no branch for "send in flight"
  // either). Regression pin — Miko-QA find (2026-08-01), fixed: the textarea
  // locks on `disabled ||
  // pending`, so the reason gate must read pending too — a pending-only lock
  // previously reverted to the normal mode placeholder mid-lock.
  it('applies the lock reason to a pending-only lock (disabled=false)', () => {
    render(
      <Composer
        {...base}
        pending
        disabledReason="Sending…"
      />,
    );
    const textarea = screen.getByLabelText('Compose (say)');
    expect(textarea).toBeDisabled(); // the lock IS active (disabled || pending)
    expect(textarea).toHaveAttribute('placeholder', 'Sending…');
  });

  it('falls back to "Sending…" on a pending-only lock with no reason supplied', () => {
    render(<Composer {...base} pending />);
    const textarea = screen.getByLabelText('Compose (say)');
    expect(textarea).toBeDisabled();
    expect(textarea).toHaveAttribute('placeholder', 'Sending…');
  });

  // Kage-CR IMPORTANT-1 / Iro-A11y CRITICAL-1: a controlled textarea only
  // paints its placeholder when `value` is empty — and the DM send path keeps
  // the draft in the field for the whole pending window. The reason therefore
  // ALSO renders as a visible banner, independent of the field's value.
  it('renders the lock reason as a visible banner even when the field holds a draft', () => {
    render(
      <Composer
        {...base}
        value="my unsent draft"
        disabled
        disabledReason="Session is paused."
      />,
    );
    const banner = screen.getByText('Session is paused.');
    expect(banner).toBeInTheDocument();
    // A `disabled` lock is announced by its owner (DDX-25 session region /
    // ChatLog composing row) — the banner is visible here but not announced.
    expect(banner).toHaveAttribute('aria-live', 'off');
  });

  it('announces the pending-only "Sending…" banner politely (it has no other owner)', () => {
    render(<Composer {...base} value="draft kept during send" pending />);
    const banner = screen.getByText('Sending…');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(banner).toHaveAttribute('role', 'status');
  });

  // Kage-CR 🟢-2: disabled+pending with NO reason must not fabricate a
  // transient "Sending…" for a lock that outlives the request — degrade to
  // the normal placeholder, no banner.
  it('does not fabricate "Sending…" for a disabled+pending lock with no reason', () => {
    render(<Composer {...base} disabled pending />);
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Say something. Suzu will narrate back.'),
    ).toBeInTheDocument();
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

  // TAV-PARTY-INLINE-SHEET: a member card with a character is now a <button>
  // that calls onSelectMember, not a <Link> that navigates away.
  describe('TAV-PARTY-INLINE-SHEET', () => {
    it('a member with a character renders as a button and calls onSelectMember with their participant on click (no navigation)', () => {
      const onSelectMember = jest.fn();
      render(
        <PartyPanel participants={party} selfUsername="alice" onSelectMember={onSelectMember} />,
      );
      const card = screen.getByRole('button', { name: /Velka/ });
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      fireEvent.click(card);
      expect(onSelectMember).toHaveBeenCalledTimes(1);
      expect(onSelectMember).toHaveBeenCalledWith(party[0]);
    });

    it('a member with no character stays non-interactive (no button, onSelectMember never called)', () => {
      const onSelectMember = jest.fn();
      const noCharacterParty: Participant[] = [{ username: 'bob', is_dm: false, character: null }];
      render(
        <PartyPanel
          participants={noCharacterParty}
          selfUsername="alice"
          onSelectMember={onSelectMember}
        />,
      );
      expect(screen.getByText('no character yet')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /bob/i })).not.toBeInTheDocument();
      expect(onSelectMember).not.toHaveBeenCalled();
    });

    it('clicking a member card with no onSelectMember prop wired does not throw', () => {
      render(<PartyPanel participants={party} selfUsername="alice" />);
      expect(() => fireEvent.click(screen.getByRole('button', { name: /Velka/ }))).not.toThrow();
    });
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
