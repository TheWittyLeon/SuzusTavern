/**
 * TPK-HOLD W2 — a held fight (every character fallen after a DM override, waiting on the DM) is
 * live and frozen. The page-level wiring only the page can get wrong: the action bar and Cast
 * are locked with the held words (not "Waiting for your turn…"), "Move on", the scene's checks
 * and the rebind button are withheld, and the stage's status node says so.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { CombatParticipantState, CombatState, GroundingData, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 's1' }) }));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }) }));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));
jest.mock('../../lib/stream', () => ({ streamDmNarration: jest.fn() }));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';
import { heldLine } from '@/app/play/[sessionId]/format';

// The page's table is Suzu's (`dm_mode: 'ai'`) and the viewer is a player, not its host.
const HELD_LINE_WAITING = heldLine({ humanDmTable: false, canEnd: false, standing: false });
import PartyStrip from '@/app/play/[sessionId]/regions/PartyStrip';
import CastSpellPanel from '@/components/CastSpellPanel';

const SESSION: Session = {
  session_id: 's1', channel: 'c', status: 'active', dm_username: 'suzu', participant_usernames: ['leon'],
  player_count: 1, active_combat_id: 'combat-1', dm_mode: 'ai', ai_assist_level: 'full',
};
const PARTY: Participant[] = [{
  username: 'leon', is_dm: false,
  character: { character_id: 'c1', name: 'Anomaly', char_class: 'Warlock', level: 1, current_hp: 0, max_hp: 9, ac: 12 },
}];
const GROUNDING: GroundingData = {
  scene_id: 'a', scene_name: 'The Flight', boxed_text: 'x', objective: 'y',
  transitions: [{ to: 'b', label: 'Press forward' }], checks: [{ skill: 'Perception', dc: 10, state: 'available' } as never],
  flags: {}, encounter_state: {}, encounter: null,
};
const pc = (over: Partial<CombatParticipantState> = {}): CombatParticipantState => ({
  participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 0, hp_max: 9, ac: 12,
  conditions: [], is_alive: false, can_be_targeted: false, is_active_turn: false, took_turn: false, ...over,
});
const goblin: CombatParticipantState = {
  participant_id: 'g1', entity_id: 'g', name: 'Goblin', is_pc: false, initiative: 8, hp_current: 7, hp_max: 7, ac: 13,
  conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false,
};
const fight = (state: CombatState['state']): CombatState => ({
  combat_id: 'combat-1', session_id: 's1', round: 2, state, turn_index: 0, active_participant_id: null,
  initiative: ['p1', 'g1'], participants: [pc(), goblin],
});

const mock = <T extends (...a: never[]) => unknown>(f: unknown) => f as jest.MockedFunction<T>;

async function renderWith(state: CombatState['state'] | null) {
  mock<typeof dnd.getSession>(dnd.getSession).mockResolvedValue({ ...SESSION, active_combat_id: state ? 'combat-1' : null });
  mock<typeof dnd.getParticipants>(dnd.getParticipants).mockResolvedValue(PARTY);
  mock<typeof dnd.getGrounding>(dnd.getGrounding).mockResolvedValue(GROUNDING);
  mock<typeof dnd.getCombatState>(dnd.getCombatState).mockResolvedValue((state ? fight(state) : null) as CombatState);
  renderPlay(<PlayPage />);
  await screen.findByRole('textbox');
}

describe('a held fight is live and frozen', () => {
  it('says so in the stage status node and offers no turn controls', async () => {
    await renderWith('held');
    const status = await screen.findByText(HELD_LINE_WAITING);
    expect(status.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByText(/In combat · use the action bar/)).toBeNull();

    // The action bar stays (so focus is never stranded) but every verb is locked, with the held words.
    const rail = await screen.findByRole('group', { name: /your character.s actions/i });
    for (const name of [/^attack/i, /^dodge/i, /^dash/i, /end turn/i]) {
      expect(within(rail).getByRole('button', { name })).toBeDisabled();
    }
    expect(within(rail).getByText('The fight is on hold.')).toBeInTheDocument();
    expect(within(rail).queryByText(/waiting for your turn/i)).toBeNull();
    // ...and the notice is not a second live region.
    expect(within(rail).getByText('The fight is on hold.')).not.toHaveAttribute('aria-live');
  });

  it('withholds Move on and the scene checks', async () => {
    await renderWith('held');
    await screen.findByText(HELD_LINE_WAITING);
    expect(screen.queryByText('Press forward')).toBeNull();
    expect(screen.queryByText(/perception/i)).toBeNull();
  });

  it('positive control: with no fight the same scene offers Move on and the check', async () => {
    await renderWith(null);
    expect(await screen.findByText('Press forward')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/perception/i)).toBeInTheDocument());
  });
});

describe('every other live state is frozen too (before initiative, between turns)', () => {
  it.each(['idle', 'rolling_initiative', 'between_turns'] as const)("'%s' offers no Move on", async (state) => {
    await renderWith(state);
    // The fight's state has landed once the stage's combat note is up.
    await screen.findByText(/In combat · use the action bar/);
    expect(screen.queryByText('Press forward')).toBeNull();
  });
});

describe('the rebind button waits on a live fight, whatever its state', () => {
  // [state, rebind locked]. A fight that has not ended locks it (held included); an ended one, or none, does not.
  it.each([
    ['idle', true], ['rolling_initiative', true], ['active', true], ['between_turns', true], ['held', true], ['ended', false],
  ] as const)("state '%s' -> locked %s", (state, locked) => {
    render(
      <PartyStrip
        participants={PARTY} selfUsername="leon" combatState={fight(state)} onSelectMember={jest.fn()} isDm={false} sessionId="s1"
        combatIsActive={state !== 'ended'} sessionLocked={false} onRebindChanged={jest.fn()} round={2} selfPcId="p1" variant="strip"
      />,
    );
    const btn = screen.getAllByRole('button').find((b) => /character/i.test(b.getAttribute('aria-label') ?? ''));
    expect(btn).toBeDefined();
    if (locked) expect(btn).toBeDisabled(); else expect(btn).toBeEnabled();
  });
});

describe('Cast says why it is locked', () => {
  const panel = (held: boolean) => (
    <CastSpellPanel
      combatId="combat-1" characterId="c1" username="leon" participants={[pc(), goblin]} spellSlots={{}}
      isPlayerTurn={false} held={held} onCast={jest.fn()} onSheetChanged={jest.fn()} onStateRefresh={jest.fn()}
    />
  );
  it('held: the held words, not a live region', () => {
    render(panel(true));
    const note = screen.getByText('The fight is on hold.');
    expect(note).not.toHaveAttribute('aria-live');
    expect(screen.queryByText(/waiting for your turn/i)).toBeNull();
  });
  it('not held: the turn words, live, as before', () => {
    render(panel(false));
    expect(screen.getByText(/waiting for your turn/i)).toHaveAttribute('aria-live', 'polite');
  });
});
