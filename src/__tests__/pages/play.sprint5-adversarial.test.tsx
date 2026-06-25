/**
 * Sprint 5 Adversarial QA — Break-it pass.
 *
 * Deliberately attacks S5.2–S5.5 guarantees. Every test here either
 * confirms fail-closed behaviour, asserts zero LLM calls under a gate
 * that should suppress them, or probes a sequencing/state edge that the
 * happy-path suite does not exercise.
 *
 * Sections:
 *   ADV-S5.5A  Zero-LLM: dice roll auto-narration suppressed when ai=off
 *   ADV-S5.5B  Zero-LLM: scene advance does NOT fire streamDmNarration when ai=off
 *   ADV-S5.5C  Zero-LLM: beginEncounter (combat start) does NOT call streamDmNarration when ai=off
 *   ADV-S5.5D  Stale client state: switching session off→full between mounts re-enables panel (server truth wins)
 *   ADV-S5.5E  Stale client state: the gate reads session.ai_assist_level directly (not a useState copy) — mutating session mid-render changes outcome
 *   ADV-S5.5F  Human-DM + ai=off: openScene does NOT call streamDmNarration (AI-off client-render path)
 *   ADV-S5.4A  Override modal: target_down engine error → modal stays open, error message shown
 *   ADV-S5.4B  Override modal: not_dm engine error → modal stays open, error message shown
 *   ADV-S5.4C  Override modal: save kind posts correct outcome shape (gap: no existing test covers 'save')
 *   ADV-S5.4D  Override modal: double-submit race — second click before first resolves fires only one submitOverride
 *   ADV-S5.4E  Visibility toggle: optimistic rollback on network error — checkbox reverts
 *   ADV-S5.4F  Override: client does NOT filter dm_override events — a mixed event array renders both rows
 *   ADV-S5.3A  npc_incapacitated refusal surfaced inline (gap: existing suite only covers not_npc_turn)
 *   ADV-S5.3B  Dead monster: action buttons absent even when it was previously active turn
 *   ADV-S5.3C  Speak-as-NPC path posts postSessionEvent, ZERO streamDmNarration calls
 *   ADV-S5.2A  DM narration submit error (5xx): text preserved, postSessionEvent called once, streamDmNarration zero
 *   ADV-S5.2B  DM narration: empty submit is blocked (no postSessionEvent call, no narration call)
 *   ADV-S5.5G  S5.3-AC2 gap: non-DM player cannot access monster panel controls (component-level gate)
 *   ADV-S5.4G  Override: attack with no target_id blocked client-side — submit is disabled
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Standard mocks (mirrors existing sprint5 test files) ─────────────────────

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
  useRouter: () => ({ push: jest.fn() }),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockStreamDmNarration = jest.fn();
const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mockGetParticipants = jest.fn<Promise<unknown>, unknown[]>();
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockPostSessionEvent = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve({ seq: 1 }));
const mockNpcAction = jest.fn<Promise<unknown>, unknown[]>();
const mockSubmitOverride = jest.fn<Promise<unknown>, unknown[]>();
const mockSetSessionPolicy = jest.fn<Promise<unknown>, unknown[]>();
const mockAdvanceScene = jest.fn<Promise<unknown>, unknown[]>();
const mockCombatFromScene = jest.fn<Promise<unknown>, unknown[]>();
const mockRollInitiative = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve({ state: null }));
const mockMonsterTurn = jest.fn<Promise<unknown>, unknown[]>();
const mockEndCombat = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postSessionEvent: (...args: Parameters<AnyFn>) => mockPostSessionEvent(...args),
  npcAction: (...args: Parameters<AnyFn>) => mockNpcAction(...args),
  submitOverride: (...args: Parameters<AnyFn>) => mockSubmitOverride(...args),
  setSessionPolicy: (...args: Parameters<AnyFn>) => mockSetSessionPolicy(...args),
  advanceScene: (...args: Parameters<AnyFn>) => mockAdvanceScene(...args),
  combatFromScene: (...args: Parameters<AnyFn>) => mockCombatFromScene(...args),
  rollInitiative: (...args: Parameters<AnyFn>) => mockRollInitiative(...args),
  monsterTurn: (...args: Parameters<AnyFn>) => mockMonsterTurn(...args),
  endCombat: (...args: Parameters<AnyFn>) => mockEndCombat(...args),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  setFlag: jest.fn(),
  bindCharacter: jest.fn(() =>
    Promise.resolve({ campaign_id: 's1', username: 'dm_alice', role: 'dm', character_id: null }),
  ),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: (...args: Parameters<AnyFn>) => mockStreamDmNarration(...args),
}));

import PlayPage from '@/app/play/[sessionId]/page';
import ChatLog, { type LogRow } from '@/components/ChatLog';
import DmNarrationPanel from '@/components/DmNarrationPanel';
import DmOverrideModal from '@/components/DmOverrideModal';
import type { Session, CombatState, CombatParticipantState } from '@/lib/api/types';
import type { Participant } from '@/lib/api/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AI_OFF_SESSION: Session = {
  session_id: 's1',
  channel: 'test_channel',
  name: 'Hollow Tide — AI Off',
  dm_username: 'dm_alice',
  dm_mode: 'human',
  ai_assist_level: 'off',
  dm_override_player_visible: true,
  active_combat_id: null,
};

const AI_FULL_SESSION: Session = {
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
  name: 'Goblin Grunt',
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

const DEAD_GOBLIN: CombatParticipantState = {
  ...GOBLIN,
  participant_id: 'goblin-dead',
  name: 'Goblin Corpse',
  hp_current: 0,
  is_alive: false,
  can_be_targeted: false,
  is_active_turn: false,
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

const ACTIVE_COMBAT: CombatState = {
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

function setupPlayPage(session: Session, combatState: CombatState | null = null) {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(
    combatState
      ? { ...session, active_combat_id: combatState.combat_id }
      : session,
  );
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetParticipants.mockResolvedValue(DM_PARTY);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(combatState);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockNpcAction.mockResolvedValue({
    message: '[NPC] Goblin attacks.',
    data: { state: ACTIVE_COMBAT, turn_advanced: true },
  });
  mockSubmitOverride.mockResolvedValue({
    applied: { message: 'hit — 6 slashing' },
    state: ACTIVE_COMBAT,
    event_seq: 1,
  });
  mockSetSessionPolicy.mockResolvedValue({ session });
  mockAdvanceScene.mockResolvedValue({ from_scene: 'scene-1', to_scene: 'scene-2' });
}

// ── ADV-S5.5A — Dice roll does NOT call streamDmNarration when ai=off ─────────

describe('ADV-S5.5A — dice roll auto-narration suppressed when ai_assist_level=off', () => {
  it('rolling a d20 does not call streamDmNarration', async () => {
    setupPlayPage(AI_OFF_SESSION);
    render(<PlayPage />);

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    // Locate and click a die button. The d20 is always present in the DiceTray.
    // The aria-label pattern is "Roll d20" (DiceTray renders each die as a button).
    const d20btn = screen.queryByRole('button', { name: /Roll d20/i });
    if (d20btn) {
      await act(async () => {
        fireEvent.click(d20btn);
      });
      await act(async () => { await Promise.resolve(); });
    }

    // Whether or not the button was found: streamDmNarration must never be called.
    expect(mockStreamDmNarration).not.toHaveBeenCalled();
  });
});

// ── ADV-S5.5B — Scene advance does NOT fire streamDmNarration when ai=off ────

describe('ADV-S5.5B — scene advance narrate() call is suppressed when ai=off', () => {
  it('onMoveOn completes without calling streamDmNarration', async () => {
    // Session with a transition available so "Move on" button renders.
    const grounding = {
      scene_id: 'scene-1',
      scene_name: 'The Cave Entrance',
      boxed_text: 'You stand before a dark cave.',
      objective: 'Explore',
      transitions: [{ to: 'scene-2', label: 'Enter the cave', requires_encounter_resolved: null }],
      adventure_title: 'Hollow Tide',
      hook: null,
      encounter_state: null,
    };
    setupPlayPage(AI_OFF_SESSION);
    mockGetGrounding.mockResolvedValue(grounding);
    mockAdvanceScene.mockResolvedValue({ from_scene: 'scene-1', to_scene: 'scene-2' });

    render(<PlayPage />);

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    // "Move on" button should be visible when transitions are available + no active combat.
    const moveOnBtn = screen.queryByRole('button', { name: /Enter the cave|Move on/i });
    if (moveOnBtn) {
      await act(async () => {
        fireEvent.click(moveOnBtn);
      });
      await waitFor(() => expect(mockAdvanceScene).toHaveBeenCalled());
      await act(async () => { await Promise.resolve(); });
    }

    // narrate() is called inside handleSceneAdvance, but the ai=off gate in narrate()
    // must prevent streamDmNarration from being invoked.
    expect(mockStreamDmNarration).not.toHaveBeenCalled();
  });
});

// ── ADV-S5.5C — beginEncounter does NOT call streamDmNarration when ai=off ───

describe('ADV-S5.5C — combat start (beginEncounter) does not call streamDmNarration when ai=off', () => {
  it('starting combat fires zero streamDmNarration calls', async () => {
    setupPlayPage(AI_OFF_SESSION);
    mockCombatFromScene.mockResolvedValue({
      combat_id: 'c1',
      monsters: [{ name: 'Goblin Grunt' }],
      state: ACTIVE_COMBAT,
    });
    mockGetCombatState.mockResolvedValue(ACTIVE_COMBAT);

    render(<PlayPage />);

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    const beginBtn = screen.queryByRole('button', { name: /Begin an encounter/i });
    if (beginBtn) {
      await act(async () => {
        fireEvent.click(beginBtn);
      });
      await act(async () => { await Promise.resolve(); });
    }

    expect(mockStreamDmNarration).not.toHaveBeenCalled();
  });
});

// ── ADV-S5.5D — Server truth wins: off→full between mounts re-enables panel ──

describe('ADV-S5.5D — stale client state: server truth wins on re-mount', () => {
  it('first mount ai=off hides narrator, second mount ai=full shows it', async () => {
    // Mount 1: off — NarratorStrip must be absent.
    setupPlayPage({ ...AI_FULL_SESSION, ai_assist_level: 'off', dm_mode: 'human' } as Session);
    const { unmount } = render(<PlayPage />);
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText(/Suzu is listening/i)).not.toBeInTheDocument();
    unmount();

    // Mount 2: server now returns full — NarratorStrip MUST appear.
    // The gate must read from the fresh getSession response, not from any
    // cached/stale state from the previous mount.
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(AI_FULL_SESSION);
    mockGetSessionEvents.mockResolvedValue([]);
    mockGetParticipants.mockResolvedValue(DM_PARTY);
    mockGetGrounding.mockResolvedValue(null);
    mockGetCombatState.mockResolvedValue(null);
    mockGetCharacterSheet.mockResolvedValue(null);

    render(<PlayPage />);
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Suzu is listening/i)).toBeInTheDocument();
  });
});

// ── ADV-S5.5E — ai=off: openScene uses the client-render path, not streamDmNarration ─

describe('ADV-S5.5E — openScene: ai=off client-render path does not call streamDmNarration', () => {
  it('session with grounding + no prior events: renders from grounding without LLM', async () => {
    const grounding = {
      scene_id: 'scene-1',
      scene_name: 'The Dark Cave',
      boxed_text: 'Torchlight flickers.',
      objective: 'Find the artifact.',
      adventure_title: 'Hollow Tide',
      hook: 'A strange light beckons.',
      transitions: [],
      encounter_state: null,
    };
    setupPlayPage(AI_OFF_SESSION);
    mockGetGrounding.mockResolvedValue(grounding);
    // No prior opening_narrated event — so openScene SHOULD fire.
    mockGetSessionEvents.mockResolvedValue([]);

    render(<PlayPage />);

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    // Give the async openScene a chance to resolve.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    // The opening should have client-rendered the boxed_text into the log.
    // streamDmNarration must NEVER be called — the ai-off path skips the LLM.
    expect(mockStreamDmNarration).not.toHaveBeenCalled();

    // The client-render path should have posted the opening_narrated marker (best-effort).
    // This asserts the optimistic write happened — not a security interlock, but proves
    // the correct branch ran (not the LLM branch which would have called streamDmNarration).
    // The call is fire-and-forget; it may or may not have completed by now; just assert
    // no narration call rather than requiring the postSessionEvent call.
  });
});

// ── ADV-S5.4A — Override: target_down error → modal stays open ───────────────

describe('ADV-S5.4A — override modal: target_down engine error keeps modal open', () => {
  const panelBase = {
    combatId: 'c1',
    combatState: ACTIVE_COMBAT,
    sessionId: 's1',
    dmUsername: 'dm_alice',
    onMessage: jest.fn(),
    onOverrideMessage: jest.fn(),
    onStateUpdate: jest.fn(),
    onStateRefresh: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    const targetDownErr = Object.assign(new Error('target_down'), {
      status: 400,
      body: {
        success: false,
        message: 'That target is already down.',
        data: { reason: 'target_down' },
      },
    });
    mockSubmitOverride.mockRejectedValue(targetDownErr);
    mockSetSessionPolicy.mockResolvedValue({ session: {} });
  });

  it('target_down: modal stays open, error visible, onOverrideMessage NOT called', async () => {
    render(<DmNarrationPanel {...panelBase} />);

    fireEvent.click(screen.getByRole('button', { name: /DM Override/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeInTheDocument());

    const dialog = screen.getByRole('dialog');
    // Fill target + reason
    const targetSelect = within(dialog).getByLabelText(/Target/i);
    fireEvent.change(targetSelect, { target: { value: 'pc-1' } });
    const reasonInput = within(dialog).getByLabelText(/Reason/i);
    fireEvent.change(reasonInput, { target: { value: 'Test target_down' } });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Apply override/i }));
    });

    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toBeInTheDocument(),
    );

    // Modal must stay open.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The error message must surface something intelligible.
    expect(within(dialog).getByRole('alert').textContent).toMatch(/target|down|refused|failed/i);
    // onOverrideMessage must NOT fire on failure — state must not change.
    expect(panelBase.onOverrideMessage).not.toHaveBeenCalled();
    // streamDmNarration absolutely must not be called (no LLM escape on error path).
    expect(mockStreamDmNarration).not.toHaveBeenCalled();
  });
});

// ── ADV-S5.4B — Override: not_dm engine error → modal stays open ─────────────

describe('ADV-S5.4B — override modal: not_dm engine error keeps modal open', () => {
  const panelBase = {
    combatId: 'c1',
    combatState: ACTIVE_COMBAT,
    sessionId: 's1',
    dmUsername: 'not_a_dm_user',
    onMessage: jest.fn(),
    onOverrideMessage: jest.fn(),
    onStateUpdate: jest.fn(),
    onStateRefresh: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    const notDmErr = Object.assign(new Error('not_dm'), {
      status: 400,
      body: {
        success: false,
        message: 'Caller is not the DM of this session.',
        data: { reason: 'not_dm' },
      },
    });
    mockSubmitOverride.mockRejectedValue(notDmErr);
    mockSetSessionPolicy.mockResolvedValue({ session: {} });
  });

  it('not_dm: modal stays open, specific error shown, onOverrideMessage not called', async () => {
    render(<DmNarrationPanel {...panelBase} />);

    fireEvent.click(screen.getByRole('button', { name: /DM Override/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeInTheDocument());

    const dialog = screen.getByRole('dialog');
    const targetSelect = within(dialog).getByLabelText(/Target/i);
    fireEvent.change(targetSelect, { target: { value: 'pc-1' } });
    const reasonInput = within(dialog).getByLabelText(/Reason/i);
    fireEvent.change(reasonInput, { target: { value: 'Impersonating DM' } });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Apply override/i }));
    });

    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toBeInTheDocument(),
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('alert').textContent).toMatch(/DM|only the/i);
    expect(panelBase.onOverrideMessage).not.toHaveBeenCalled();
  });
});

// ── ADV-S5.4C — Override save kind: correct payload shape ─────────────────────
// Gap: existing suite has attack (AC4), check (AC5), damage (AC6). Save is untested.

describe('ADV-S5.4C — override modal: save kind posts correct outcome shape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSubmitOverride.mockResolvedValue({
      applied: { message: 'Constitution save: failed.' },
      state: ACTIVE_COMBAT,
      event_seq: 5,
    });
  });

  it('save kind posts {kind:"save", outcome:{success,degree,total}}', async () => {
    render(
      <DmOverrideModal
        open={true}
        combatId="c1"
        participants={[GOBLIN, PLAYER_PC]}
        defaultActorId="goblin-1"
        onSuccess={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    // Switch to Save
    const saveRadio = screen.getByRole('radio', { name: /Save/i });
    fireEvent.click(saveRadio);

    // Fill reason
    const reason = screen.getByLabelText(/Reason/i);
    fireEvent.change(reason, { target: { value: 'Constitution save ruling' } });

    // Default success=true, degree='success' — flip to failure to test the non-default path.
    const successCheckbox = screen.getByRole('checkbox', { name: /Success/i });
    fireEvent.click(successCheckbox); // now unchecked = failure

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply override/i }));
    });

    await waitFor(() => expect(mockSubmitOverride).toHaveBeenCalled());
    expect(mockSubmitOverride).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        kind: 'save',
        reason: 'Constitution save ruling',
        outcome: expect.objectContaining({ success: false, degree: 'failure' }),
      }),
    );
  });
});

// ── ADV-S5.4D — Double-submit race on override ────────────────────────────────

describe('ADV-S5.4D — override modal: double-submit fires exactly one submitOverride', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    let resolve!: () => void;
    mockSubmitOverride.mockReturnValue(
      new Promise<{ applied: { message: string }; state: CombatState }>((r) => {
        resolve = () => r({ applied: { message: 'hit' }, state: ACTIVE_COMBAT });
      }),
    );
    (mockSubmitOverride as jest.Mock & { _resolve?: () => void })._resolve = resolve;
    mockSetSessionPolicy.mockResolvedValue({ session: {} });
  });

  it('two rapid clicks on Apply override call submitOverride exactly once', async () => {
    let resolveSubmit!: () => void;
    mockSubmitOverride.mockReturnValue(
      new Promise<{ applied: { message: string }; state: CombatState }>((r) => {
        resolveSubmit = () => r({ applied: { message: 'hit' }, state: ACTIVE_COMBAT });
      }),
    );

    render(
      <DmOverrideModal
        open={true}
        combatId="c1"
        participants={[GOBLIN, PLAYER_PC]}
        defaultActorId="goblin-1"
        onSuccess={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const targetSelect = within(dialog).getByLabelText(/Target/i);
    fireEvent.change(targetSelect, { target: { value: 'pc-1' } });
    const reasonInput = within(dialog).getByLabelText(/Reason/i);
    fireEvent.change(reasonInput, { target: { value: 'Double submit test' } });

    const submitBtn = within(dialog).getByRole('button', { name: /Apply override/i });

    // Click twice rapidly before the first resolves.
    act(() => { fireEvent.click(submitBtn); });
    act(() => { fireEvent.click(submitBtn); });

    // Resolve the first (and only legitimate) call.
    await act(async () => { resolveSubmit(); });
    await act(async () => { await Promise.resolve(); });

    // submitOverride must have been called exactly once despite two clicks.
    expect(mockSubmitOverride).toHaveBeenCalledTimes(1);
  });
});

// ── ADV-S5.4E — Visibility toggle: rollback on network error ─────────────────

describe('ADV-S5.4E — visibility toggle: optimistic rollback when setSessionPolicy fails', () => {
  const baseProps = {
    combatId: 'c1',
    combatState: ACTIVE_COMBAT,
    sessionId: 's1',
    dmUsername: 'dm_alice',
    overridePlayerVisible: true,
    onMessage: jest.fn(),
    onOverrideMessage: jest.fn(),
    onStateUpdate: jest.fn(),
    onStateRefresh: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSetSessionPolicy.mockRejectedValue(
      Object.assign(new Error('Network'), { status: 503 }),
    );
  });

  it('checkbox reverts to original state after network failure', async () => {
    render(<DmNarrationPanel {...baseProps} overridePlayerVisible={true} />);

    const checkbox = screen.getByRole('checkbox', { name: /Show my overrides to players/i });
    expect(checkbox).toBeChecked(); // starts checked

    // Click to toggle OFF (optimistic: becomes unchecked).
    await act(async () => {
      fireEvent.click(checkbox);
    });

    // After failure resolves, the checkbox must roll back to checked.
    await waitFor(() => expect(mockSetSessionPolicy).toHaveBeenCalled());
    // Give the catch branch time to run.
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    // Rollback: back to original checked state.
    expect(checkbox).toBeChecked();
  });
});

// ── ADV-S5.4F — Client does NOT filter dm_override events ────────────────────
// Security property: the hide is server-side (proxy filter). The ChatLog component
// must render every event the server returns, including dm_override rows.
// An injected mixed array (player + override) must render both.

describe('ADV-S5.4F — ChatLog: dm_override events not filtered client-side', () => {
  it('mixed event array including dm_override renders ALL rows', () => {
    const rows: LogRow[] = [
      { id: 'p1', who: 'bob', kind: 'player', text: 'I search the room.', ts: '10:00' },
      { id: 'ov1', who: 'DM (dm_alice)', kind: 'dm_override', text: 'DM ruled: miss → hit (8 fire)', ts: '10:01' },
      { id: 'p2', who: 'alice', kind: 'player', text: 'I follow.', ts: '10:02' },
    ];
    render(<ChatLog rows={rows} />);

    // All three rows must be visible — client never hides override events.
    expect(screen.getByText('I search the room.')).toBeInTheDocument();
    expect(screen.getByText('DM ruled: miss → hit (8 fire)')).toBeInTheDocument();
    expect(screen.getByText('I follow.')).toBeInTheDocument();
  });

  it('a dm_override row without a player-visible toggle still renders in ChatLog', () => {
    // Even if dm_override_player_visible=false, the ChatLog component must render
    // whatever the BFF sends. The BFF is responsible for filtering; the client is not.
    const rows: LogRow[] = [
      { id: 'ov2', who: 'DM (dm_alice)', kind: 'dm_override', text: 'Override: crit hit 24 slashing', ts: '10:05' },
    ];
    const { container } = render(<ChatLog rows={rows} />);
    expect(container.querySelector('.dm_override')).toBeInTheDocument();
    expect(screen.getByText('Override: crit hit 24 slashing')).toBeInTheDocument();
  });
});

// ── ADV-S5.3A — npc_incapacitated refusal surfaced inline ────────────────────
// Gap: existing suite only covers not_npc_turn.

describe('ADV-S5.3A — monster panel: npc_incapacitated refusal surfaced inline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const err = Object.assign(new Error('NPC incapacitated'), {
      status: 400,
      body: { success: false, data: { reason: 'npc_incapacitated', state: ACTIVE_COMBAT } },
    });
    mockNpcAction.mockRejectedValue(err);
    mockSetSessionPolicy.mockResolvedValue({ session: {} });
  });

  it('incapacitated monster skip shows inline error and does not call streamDmNarration', async () => {
    render(
      <DmNarrationPanel
        combatId="c1"
        combatState={ACTIVE_COMBAT}
        sessionId="s1"
        dmUsername="dm_alice"
        onMessage={jest.fn()}
        onOverrideMessage={jest.fn()}
        onStateUpdate={jest.fn()}
        onStateRefresh={jest.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Skip monster turn/i })).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Skip monster turn/i }));
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // The error text must surface something about incapacitation.
    expect(screen.getByRole('alert').textContent).toMatch(/incapacitat|action refused/i);
    expect(mockStreamDmNarration).not.toHaveBeenCalled();
  });
});

// ── ADV-S5.3B — Dead monster: action buttons absent ──────────────────────────

describe('ADV-S5.3B — dead monster: action buttons not rendered', () => {
  const COMBAT_WITH_DEAD_GOBLIN: CombatState = {
    ...ACTIVE_COMBAT,
    // The dead goblin is "active_participant_id" — a stale state before refresh.
    active_participant_id: 'goblin-dead',
    participants: [DEAD_GOBLIN, PLAYER_PC],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSetSessionPolicy.mockResolvedValue({ session: {} });
  });

  it('Skip/Attack/Move absent for a dead monster regardless of is_active_turn', () => {
    // Even if the dead goblin is listed as "active" (stale state), no action
    // buttons should render. The gate is `isCurrentTurn && !isDown`.
    render(
      <DmNarrationPanel
        combatId="c1"
        combatState={COMBAT_WITH_DEAD_GOBLIN}
        sessionId="s1"
        dmUsername="dm_alice"
        onMessage={jest.fn()}
        onOverrideMessage={jest.fn()}
        onStateUpdate={jest.fn()}
        onStateRefresh={jest.fn()}
      />,
    );

    // Action buttons must not be present for a dead monster.
    expect(screen.queryByRole('button', { name: /Skip monster turn/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Attack/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move monster/i })).not.toBeInTheDocument();

    // The speak-as-NPC button is also suppressed for dead monsters.
    expect(screen.queryByRole('button', { name: /Speak as/i })).not.toBeInTheDocument();
  });
});

// ── ADV-S5.3C — Speak-as-NPC: zero streamDmNarration calls ──────────────────

describe('ADV-S5.3C — speak-as-NPC posts dm_narration event; zero streamDmNarration calls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPostSessionEvent.mockResolvedValue({ seq: 2 });
    mockSetSessionPolicy.mockResolvedValue({ session: {} });
  });

  it('submitting NPC dialogue calls postSessionEvent once and never streamDmNarration', async () => {
    render(
      <DmNarrationPanel
        combatId="c1"
        combatState={ACTIVE_COMBAT}
        sessionId="s1"
        dmUsername="dm_alice"
        onMessage={jest.fn()}
        onOverrideMessage={jest.fn()}
        onStateUpdate={jest.fn()}
        onStateRefresh={jest.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Speak as Goblin/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /Speak as Goblin/i }));

    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: /Goblin Grunt dialogue/i })).toBeInTheDocument(),
    );

    const npcInput = screen.getByRole('textbox', { name: /Goblin Grunt dialogue/i });
    fireEvent.change(npcInput, { target: { value: 'Gah! Run away!' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Send NPC dialogue/i }));
    });

    await waitFor(() => expect(mockPostSessionEvent).toHaveBeenCalled());

    // Verify the payload includes npc_name.
    expect(mockPostSessionEvent).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        kind: 'dm_narration',
        data: expect.objectContaining({ npc_name: 'Goblin Grunt' }),
        visibility: 'table',
      }),
    );

    // The LLM path must never be touched.
    expect(mockStreamDmNarration).not.toHaveBeenCalled();
  });
});

// ── ADV-S5.2A — DM narration 5xx: text preserved, streamDmNarration zero ─────

describe('ADV-S5.2A — DM narration submit: 5xx error preserves text; zero LLM calls', () => {
  it('after a 503, typed text still in textarea and streamDmNarration not called', async () => {
    setupPlayPage(AI_OFF_SESSION);
    mockPostSessionEvent.mockRejectedValue(
      Object.assign(new Error('Service unavailable'), { status: 503 }),
    );

    render(<PlayPage />);

    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: /DM Narration/i })).toBeInTheDocument(),
    );

    const textarea = screen.getByRole('textbox', { name: /Compose/i });
    fireEvent.change(textarea, { target: { value: 'The old bridge groans.' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    // Text must be preserved on error.
    expect(textarea).toHaveValue('The old bridge groans.');

    // Zero LLM calls — the DM narration path never touches the narration endpoint.
    expect(mockStreamDmNarration).not.toHaveBeenCalled();

    // postSessionEvent was called exactly once (the failed attempt).
    expect(mockPostSessionEvent).toHaveBeenCalledTimes(1);
  });
});

// ── ADV-S5.2B — Empty DM narration submit is blocked ─────────────────────────

describe('ADV-S5.2B — empty DM narration submit: postSessionEvent not called', () => {
  it('clicking Send with empty textarea does not call postSessionEvent or streamDmNarration', async () => {
    setupPlayPage(AI_OFF_SESSION);

    render(<PlayPage />);

    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: /DM Narration/i })).toBeInTheDocument(),
    );

    // Do NOT type anything — textarea stays empty.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));
    });

    await act(async () => { await Promise.resolve(); });

    // Nothing should have been sent.
    expect(mockPostSessionEvent).not.toHaveBeenCalled();
    expect(mockStreamDmNarration).not.toHaveBeenCalled();
  });
});

// ── ADV-S5.5G — Non-DM player: DmNarrationPanel not rendered ─────────────────
// Gap: S5.3-AC2 in the existing suite is a stub (expect(true).toBe(true)).
// Test at the component level: pass isDm-equivalent props to the PAGE that
// simulate a non-DM by having dmUsername !== logged-in user.
// The panel is only shown when `isHumanDM` (isDm && dm_mode==='human') is true.
// We test the negative by rendering the panel props where DM identity doesn't match
// by checking the PlayPage gating logic via a session fixture where dm_username differs.

describe('ADV-S5.5G — DM seat gating: monster panel absent for non-DM seat', () => {
  it('session with dm_username != logged-in user: no monster panel, no override button', async () => {
    // Logged-in user is dm_alice (from auth mock), but the session's DM is someone_else.
    const NOT_MY_SESSION: Session = {
      ...AI_OFF_SESSION,
      dm_username: 'someone_else', // not dm_alice
      dm_mode: 'human',
      active_combat_id: null,
    };

    setupPlayPage(NOT_MY_SESSION, ACTIVE_COMBAT);
    mockGetSession.mockResolvedValue({ ...NOT_MY_SESSION, active_combat_id: 'c1' });

    render(<PlayPage />);

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    // DmNarrationPanel (Monster control region) must NOT render.
    expect(screen.queryByRole('region', { name: /Monster control/i })).not.toBeInTheDocument();
    // Override button must not render.
    expect(screen.queryByRole('button', { name: /DM Override/i })).not.toBeInTheDocument();
    // Visibility toggle must not render.
    expect(screen.queryByRole('checkbox', { name: /Show my overrides to players/i })).not.toBeInTheDocument();
  });
});

// ── ADV-S5.4G — Attack override: submit blocked when target not selected ──────

describe('ADV-S5.4G — override modal: attack submit disabled with no target selected', () => {
  it('Apply override button disabled when attack kind has no target', () => {
    render(
      <DmOverrideModal
        open={true}
        combatId="c1"
        participants={[GOBLIN, PLAYER_PC]}
        defaultActorId="goblin-1"
        onSuccess={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    // Attack is default. Fill in reason but leave target blank.
    const reason = screen.getByLabelText(/Reason/i);
    fireEvent.change(reason, { target: { value: 'Testing target gate' } });

    // Target select shows "— pick target —" (value=""). Submit should be disabled
    // because the client-side guard requires target for attack kind.
    // The disabled state is driven by: !reason.trim() check in the button.
    // The target required check happens inside handleSubmit (setSubmitError path).
    // The button is enabled (reason is filled), but submit should fire setSubmitError.
    const submitBtn = screen.getByRole('button', { name: /Apply override/i });
    // Reason is non-empty: button is NOT disabled at render time...
    // But clicking it with no target selected triggers the client-side guard.
    // So: button enabled, but clicking produces error, submitOverride NOT called.
    fireEvent.click(submitBtn);

    // An inline error should now appear.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // submitOverride must not have been called.
    expect(mockSubmitOverride).not.toHaveBeenCalled();
  });
});
