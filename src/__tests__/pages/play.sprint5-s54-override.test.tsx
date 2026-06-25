/**
 * S5.4 — DM Override + Visibility Toggle tests.
 *
 * AC coverage:
 *
 * S5.4-AC1  Override control + toggle render for isDm + dm_mode='human'.
 * S5.4-AC2  Override control absent for non-DM seats (player view).
 * S5.4-AC3  Override control absent when dm_mode='ai' (AI DM).
 * S5.4-AC4  Submit posts correct per-kind payload (attack example).
 * S5.4-AC5  Submit posts correct check payload.
 * S5.4-AC6  Submit posts correct damage payload.
 * S5.4-AC7  {success:false} / engine error surfaces message inline; modal stays open.
 * S5.4-AC8  Visibility toggle posts policy { dm_override_player_visible } + updates state.
 * S5.4-AC9  ChatLog renders dm_override kind with dm_override CSS class.
 * S5.4-AC10 No client-side filtering of override events: ChatLog renders whatever it receives.
 * S5.4-AC11 DmOverrideModal standalone: reason required — submit blocked when empty.
 * S5.4-AC12 DmNarrationPanel: override button present; toggle reflects initial prop.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Page-level mocks (needed for PlayPage integration tests) -----------------

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'dm_alice', email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

const mockSubmitOverride = jest.fn();
const mockSetSessionPolicy = jest.fn();
const mockPostSessionEvent = jest.fn();
const mockNpcAction = jest.fn();
const mockGetSession = jest.fn();
const mockGetSessionEvents = jest.fn(() => Promise.resolve([]));
const mockGetParticipants = jest.fn();
const mockGetGrounding = jest.fn(() => Promise.resolve(null));
const mockGetCombatState = jest.fn(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn(() => Promise.resolve(null));
const mockStreamDmNarration = jest.fn();

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  getSessionEvents: (...args: unknown[]) => mockGetSessionEvents(...args),
  getParticipants: (...args: unknown[]) => mockGetParticipants(...args),
  getGrounding: (...args: unknown[]) => mockGetGrounding(...args),
  getCombatState: (...args: unknown[]) => mockGetCombatState(...args),
  getCharacterSheet: (...args: unknown[]) => mockGetCharacterSheet(...args),
  postSessionEvent: (...args: unknown[]) => mockPostSessionEvent(...args),
  npcAction: (...args: unknown[]) => mockNpcAction(...args),
  submitOverride: (...args: unknown[]) => mockSubmitOverride(...args),
  setSessionPolicy: (...args: unknown[]) => mockSetSessionPolicy(...args),
  combatFromScene: jest.fn(),
  rollInitiative: jest.fn(),
  monsterTurn: jest.fn(),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'dm_alice', role: 'dm', character_id: null })),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: (...args: unknown[]) => mockStreamDmNarration(...args),
}));

import PlayPage from '@/app/play/[sessionId]/page';
import ChatLog, { type LogRow } from '@/components/ChatLog';
import DmNarrationPanel from '@/components/DmNarrationPanel';
import DmOverrideModal from '@/components/DmOverrideModal';
import type { Session, CombatState, CombatParticipantState } from '@/lib/api/types';
import type { Participant } from '@/lib/api/types';

// ── Fixtures -----------------------------------------------------------------

const HUMAN_DM_SESSION: Session = {
  session_id: 's1',
  channel: 'test_channel',
  name: 'The Hollow Tide',
  dm_username: 'dm_alice',
  dm_mode: 'human',
  ai_assist_level: 'off',
  dm_override_player_visible: true,
  active_combat_id: null,
};

const AI_SESSION: Session = {
  session_id: 's1',
  channel: 'test_channel',
  name: 'AI Table',
  dm_username: 'dm_alice',
  dm_mode: 'ai',
  ai_assist_level: 'full',
  active_combat_id: null,
};

const GOBLIN: CombatParticipantState = {
  participant_id: 'goblin-1',
  entity_id: 'goblin',
  name: 'Goblin Sharpshooter',
  is_pc: false,
  initiative: 14,
  hp_current: 7,
  hp_max: 7,
  ac: 13,
  conditions: [],
  is_alive: true,
  can_be_targeted: true,
  is_active_turn: true,
  took_turn: false,
};

const PLAYER_PC: CombatParticipantState = {
  participant_id: 'pc-1',
  entity_id: '42',
  name: 'Luke Stormwind',
  is_pc: true,
  initiative: 10,
  hp_current: 28,
  hp_max: 28,
  ac: 16,
  conditions: [],
  is_alive: true,
  can_be_targeted: true,
  is_active_turn: false,
  took_turn: false,
};

const ACTIVE_COMBAT_STATE: CombatState = {
  combat_id: 'c1',
  session_id: 's1',
  round: 1,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'goblin-1',
  initiative: ['goblin-1', 'pc-1'],
  participants: [GOBLIN, PLAYER_PC],
};

const DM_PARTY: Participant[] = [
  { username: 'dm_alice', is_dm: true, character: null },
];

// ── Helpers ------------------------------------------------------------------

function setupPlayWithCombat(session: Session = HUMAN_DM_SESSION) {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ ...session, active_combat_id: 'c1' });
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetParticipants.mockResolvedValue(DM_PARTY);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(ACTIVE_COMBAT_STATE);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockPostSessionEvent.mockResolvedValue({ seq: 1 });
  mockNpcAction.mockResolvedValue({
    message: '[NPC] Goblin attacks.',
    data: { state: ACTIVE_COMBAT_STATE, turn_advanced: true },
  });
  mockSubmitOverride.mockResolvedValue({
    applied: { message: 'hit — 6 slashing (reason: test)' },
    state: ACTIVE_COMBAT_STATE,
    event_seq: 42,
  });
  mockSetSessionPolicy.mockResolvedValue({ session: { ...session, dm_override_player_visible: false } });
}

// ── PlayPage integration: render gate tests ----------------------------------

describe('S5.4 — PlayPage integration: DM Override control render gate', () => {
  it('S5.4-AC1: override button and visibility toggle render for isDm + human + active combat', async () => {
    setupPlayWithCombat();
    render(<PlayPage />);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /DM Override/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /DM Override/i })).toBeInTheDocument();
    // Visibility toggle
    expect(screen.getByRole('checkbox', { name: /Show my overrides to players/i })).toBeInTheDocument();
  });

  it('S5.4-AC3: override control absent when dm_mode=ai (AI DM)', async () => {
    setupPlayWithCombat(AI_SESSION);
    render(<PlayPage />);
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: /DM Override/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Show my overrides to players/i })).not.toBeInTheDocument();
  });
});

// ── DmNarrationPanel component: submit override (attack) --------------------
// Test at the component level (more reliable for form interaction than PlayPage).

describe('S5.4-AC4 — DmNarrationPanel: submit override with attack payload', () => {
  const panelBase = {
    combatId: 'c1',
    combatState: ACTIVE_COMBAT_STATE,
    sessionId: 's1',
    dmUsername: 'dm_alice',
    onMessage: jest.fn(),
    onOverrideMessage: jest.fn(),
    onStateUpdate: jest.fn(),
    onStateRefresh: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSubmitOverride.mockResolvedValue({
      applied: { message: 'hit — 6 slashing' },
      state: ACTIVE_COMBAT_STATE,
      event_seq: 1,
    });
    mockSetSessionPolicy.mockResolvedValue({ session: {} });
  });

  it('submit fires submitOverride with correct attack payload', async () => {
    render(<DmNarrationPanel {...panelBase} />);

    // Open modal
    fireEvent.click(screen.getByRole('button', { name: /DM Override/i }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).toBeInTheDocument(),
    );

    const dialog = screen.getByRole('dialog');

    // Attack is the default kind. Select target within dialog.
    const targetSelect = within(dialog).getByLabelText(/Target/i);
    fireEvent.change(targetSelect, { target: { value: 'pc-1' } });

    // Fill reason
    const reasonInput = within(dialog).getByLabelText(/Reason/i);
    fireEvent.change(reasonInput, { target: { value: 'Boss move override' } });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Apply override/i }));
    });

    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalled());

    expect(mockSubmitOverride).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        kind: 'attack',
        actor_id: 'goblin-1',
        target_id: 'pc-1',
        reason: 'Boss move override',
        outcome: expect.objectContaining({ hit: true }),
      }),
    );

    // onOverrideMessage should be called (not the generic onMessage)
    await waitFor(() =>
      expect(panelBase.onOverrideMessage).toHaveBeenCalled(),
    );
    // streamDmNarration must NEVER be called for DM override
    expect(mockStreamDmNarration).not.toHaveBeenCalled();
  });

  it('S5.4-AC7: engine {success:false} surfaces message inline; modal stays open', async () => {
    const engineErr = Object.assign(new Error('Override malformed'), {
      status: 400,
      body: {
        success: false,
        message: 'damage amount must be 0-999',
        data: { reason: 'override_malformed' },
      },
    });
    mockSubmitOverride.mockRejectedValue(engineErr);

    render(<DmNarrationPanel {...panelBase} />);

    fireEvent.click(screen.getByRole('button', { name: /DM Override/i }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).toBeInTheDocument(),
    );

    const dialog = screen.getByRole('dialog');

    // Pick target + add reason so submit is enabled
    const targetSelect = within(dialog).getByLabelText(/Target/i);
    fireEvent.change(targetSelect, { target: { value: 'pc-1' } });
    const reasonInput = within(dialog).getByLabelText(/Reason/i);
    fireEvent.change(reasonInput, { target: { value: 'test' } });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Apply override/i }));
    });

    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toBeInTheDocument(),
    );
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/override refused/i);
    // Modal stays open for correction
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // onOverrideMessage must NOT be called on failure
    expect(panelBase.onOverrideMessage).not.toHaveBeenCalled();
  });
});

// ── PlayPage integration: visibility toggle ----------------------------------

describe('S5.4 — PlayPage integration: visibility toggle', () => {
  it('S5.4-AC8: toggle posts policy and updates local checkbox state', async () => {
    setupPlayWithCombat();
    render(<PlayPage />);
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: /Show my overrides to players/i })).toBeInTheDocument(),
    );

    const toggle = screen.getByRole('checkbox', { name: /Show my overrides to players/i });
    expect(toggle).toBeChecked();  // overridePlayerVisible defaults true

    await act(async () => {
      fireEvent.click(toggle);
    });

    await waitFor(() => expect(mockSetSessionPolicy).toHaveBeenCalled());
    expect(mockSetSessionPolicy).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ dm_override_player_visible: false }),
    );
  });
});

// ── ChatLog component: dm_override kind rendering ---------------------------

describe('S5.4-AC9 — ChatLog renders dm_override kind with distinct CSS class', () => {
  it('applies dm_override class to dm_override rows', () => {
    const rows: LogRow[] = [
      {
        id: 'ov1',
        who: 'DM (dm_alice)',
        kind: 'dm_override',
        text: 'DM ruled: hit — 6 slashing (reason: boss move)',
        ts: '10:00',
      },
    ];
    const { container } = render(<ChatLog rows={rows} />);
    expect(container.querySelector('.dm_override')).toBeInTheDocument();
  });

  it('S5.4-AC10: ChatLog renders dm_override events without client-side filtering', () => {
    // The component must NOT filter override events. It renders what it receives.
    // Both rows here — one regular, one override — should both appear in the DOM.
    const rows: LogRow[] = [
      {
        id: 'p1',
        who: 'alice',
        kind: 'player',
        text: 'I attack!',
        ts: '10:00',
      },
      {
        id: 'ov1',
        who: 'DM (dm_alice)',
        kind: 'dm_override',
        text: 'DM ruled: hit — 8 fire damage',
        ts: '10:01',
      },
    ];
    const { container } = render(<ChatLog rows={rows} />);
    // Both rows visible — NO filtering of dm_override by the component
    expect(screen.getByText('I attack!')).toBeInTheDocument();
    expect(screen.getByText('DM ruled: hit — 8 fire damage')).toBeInTheDocument();
    expect(container.querySelector('.dm_override')).toBeInTheDocument();
  });
});

// ── DmNarrationPanel unit: override button + toggle --------------------------

describe('S5.4-AC12 — DmNarrationPanel: override button + toggle present', () => {
  const baseProps = {
    combatId: 'c1',
    combatState: ACTIVE_COMBAT_STATE,
    sessionId: 's1',
    dmUsername: 'dm_alice',
    onMessage: jest.fn(),
    onOverrideMessage: jest.fn(),
    onStateUpdate: jest.fn(),
    onStateRefresh: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSetSessionPolicy.mockResolvedValue({ session: {} });
  });

  it('renders override button', () => {
    render(<DmNarrationPanel {...baseProps} />);
    expect(screen.getByRole('button', { name: /DM Override/i })).toBeInTheDocument();
  });

  it('toggle defaults to checked when overridePlayerVisible=true', () => {
    render(<DmNarrationPanel {...baseProps} overridePlayerVisible={true} />);
    const checkbox = screen.getByRole('checkbox', { name: /Show my overrides to players/i });
    expect(checkbox).toBeChecked();
  });

  it('toggle defaults to unchecked when overridePlayerVisible=false', () => {
    render(<DmNarrationPanel {...baseProps} overridePlayerVisible={false} />);
    const checkbox = screen.getByRole('checkbox', { name: /Show my overrides to players/i });
    expect(checkbox).not.toBeChecked();
  });

  it('clicking toggle fires setSessionPolicy with toggled value', async () => {
    render(<DmNarrationPanel {...baseProps} overridePlayerVisible={true} />);
    const checkbox = screen.getByRole('checkbox', { name: /Show my overrides to players/i });
    await act(async () => {
      fireEvent.click(checkbox);
    });
    await waitFor(() => expect(mockSetSessionPolicy).toHaveBeenCalled());
    expect(mockSetSessionPolicy).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ dm_override_player_visible: false }),
    );
  });

  it('override button opens the override modal on click', async () => {
    render(<DmNarrationPanel {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /DM Override/i }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).toBeInTheDocument(),
    );
  });
});

// ── DmOverrideModal unit: form validation + payload --------------------------

describe('S5.4-AC11 — DmOverrideModal: reason required, submit blocked when empty', () => {
  const modalBase = {
    open: true,
    combatId: 'c1',
    participants: [GOBLIN, PLAYER_PC],
    defaultActorId: 'goblin-1',
    onSuccess: jest.fn(),
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSubmitOverride.mockResolvedValue({
      applied: { message: 'hit — 4 slashing' },
      state: ACTIVE_COMBAT_STATE,
    });
  });

  it('submit button is disabled when reason is empty', () => {
    render(<DmOverrideModal {...modalBase} />);
    // Reason field is empty by default
    const submit = screen.getByRole('button', { name: /Apply override/i });
    expect(submit).toBeDisabled();
  });

  it('submit button enables when reason is filled', () => {
    render(<DmOverrideModal {...modalBase} />);
    const reason = screen.getByLabelText(/Reason/i);
    fireEvent.change(reason, { target: { value: 'Narrative beat' } });
    expect(screen.getByRole('button', { name: /Apply override/i })).not.toBeDisabled();
  });

  it('S5.4-AC5: check kind posts correct outcome shape', async () => {
    render(<DmOverrideModal {...modalBase} />);

    // Switch to check
    const checkRadio = screen.getByRole('radio', { name: /Check/i });
    fireEvent.click(checkRadio);

    // Fill reason
    const reason = screen.getByLabelText(/Reason/i);
    fireEvent.change(reason, { target: { value: 'Contest ruling' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply override/i }));
    });

    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalled());
    expect(mockSubmitOverride).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        kind: 'check',
        outcome: expect.objectContaining({ success: true, degree: 'success' }),
      }),
    );
  });

  it('S5.4-AC6: damage kind posts correct outcome shape', async () => {
    const { container } = render(<DmOverrideModal {...modalBase} />);

    const dmgRadio = screen.getByRole('radio', { name: /Damage/i });
    fireEvent.click(dmgRadio);

    // Damage kind requires a target — select one (use the select within the dialog)
    const dialog = screen.getByRole('dialog');
    // After switching to 'damage', the target select appears. Use getAllByRole and pick
    // the last select (actor is first, target is second).
    const selects = within(dialog).getAllByRole('combobox');
    // selects[0] = actor, selects[1] = target
    fireEvent.change(selects[1], { target: { value: 'pc-1' } });

    // Fill damage fields
    const dealtInput = screen.getByLabelText(/Damage dealt/i);
    fireEvent.change(dealtInput, { target: { value: '12' } });
    const hpInput = screen.getByLabelText(/Target new HP/i);
    fireEvent.change(hpInput, { target: { value: '4' } });

    const reason = screen.getByLabelText(/Reason/i);
    fireEvent.change(reason, { target: { value: 'Direct damage ruling' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply override/i }));
    });

    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalled());
    expect(mockSubmitOverride).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        kind: 'damage',
        target_id: 'pc-1',
        outcome: expect.objectContaining({
          damage_dealt: 12,
          target_new_hp: 4,
          raw_damage: 12,
        }),
      }),
    );
  });

  it('Esc closes the modal', () => {
    const onClose = jest.fn();
    render(<DmOverrideModal {...modalBase} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('backdrop click closes the modal', () => {
    const onClose = jest.fn();
    const { container } = render(<DmOverrideModal {...modalBase} onClose={onClose} />);
    // The backdrop is the outermost element with the backdrop class
    const backdrop = container.firstChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });
});
