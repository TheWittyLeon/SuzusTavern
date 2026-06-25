/**
 * A11y + interaction fix tests — Iro/Tora pass on feat/sprint5-dm-console.
 *
 * Covers:
 *   MAJOR-1  NPC attack target menu closes on outside mousedown.
 *   MINOR-1  Toggle ref-latch: rapid double-tap fires setSessionPolicy once.
 *   M1       ChatLog: dm_override rows include sr-only " — DM ruling" label.
 *   M3       DmOverrideModal: aria-describedby on reason textarea links to error div.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Module mocks ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockSetSessionPolicy = jest.fn<Promise<unknown>, unknown[]>();
const mockNpcAction = jest.fn<Promise<unknown>, unknown[]>();
const mockPostSessionEvent = jest.fn<Promise<unknown>, unknown[]>();
const mockSubmitOverride = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/api/dnd', () => ({
  setSessionPolicy: (...args: Parameters<AnyFn>) => mockSetSessionPolicy(...args),
  npcAction: (...args: Parameters<AnyFn>) => mockNpcAction(...args),
  postSessionEvent: (...args: Parameters<AnyFn>) => mockPostSessionEvent(...args),
  submitOverride: (...args: Parameters<AnyFn>) => mockSubmitOverride(...args),
}));

import ChatLog, { type LogRow } from '@/components/ChatLog';
import DmNarrationPanel from '@/components/DmNarrationPanel';
import DmOverrideModal from '@/components/DmOverrideModal';
import type { CombatState, CombatParticipantState } from '@/lib/api/types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

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

const PANEL_BASE = {
  combatId: 'c1',
  combatState: ACTIVE_COMBAT_STATE,
  sessionId: 's1',
  dmUsername: 'dm_alice',
  onMessage: jest.fn(),
  onOverrideMessage: jest.fn(),
  onStateUpdate: jest.fn(),
  onStateRefresh: jest.fn(),
};

// ── M1 — ChatLog sr-only label for dm_override rows ──────────────────────────

describe('M1 — ChatLog: dm_override rows include sr-only DM ruling label', () => {
  it('appends sr-only " — DM ruling" text for dm_override kind', () => {
    const rows: LogRow[] = [
      {
        id: 'ov1',
        who: 'DM (dm_alice)',
        kind: 'dm_override',
        text: 'DM ruled: hit — 6 slashing',
        ts: '10:00',
      },
    ];
    render(<ChatLog rows={rows} />);
    // The sr-only span text must be in the DOM (visually hidden but announced).
    expect(screen.getByText('— DM ruling')).toBeInTheDocument();
  });

  it('does NOT append the sr-only label for dm_narration rows', () => {
    const rows: LogRow[] = [
      {
        id: 'n1',
        who: 'DM (actor)',
        kind: 'dm_narration',
        text: 'Shadows creep across the floor.',
        ts: '10:01',
      },
    ];
    render(<ChatLog rows={rows} />);
    expect(screen.queryByText('— DM ruling')).not.toBeInTheDocument();
  });
});

// ── M3 — DmOverrideModal aria-describedby wiring ─────────────────────────────

describe('M3 — DmOverrideModal: aria-describedby links error div to reason textarea', () => {
  const MODAL_BASE = {
    open: true,
    combatId: 'c1',
    participants: [GOBLIN, PLAYER_PC],
    defaultActorId: 'goblin-1',
    onSuccess: jest.fn(),
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSubmitOverride.mockRejectedValue(
      Object.assign(new Error('No reason'), {
        status: 400,
        body: { success: false, message: 'reason required', data: { reason: 'override_malformed' } },
      }),
    );
  });

  it('textarea has no aria-describedby when no error is present', () => {
    render(<DmOverrideModal {...MODAL_BASE} />);
    const textarea = screen.getByLabelText(/Reason/i);
    expect(textarea).not.toHaveAttribute('aria-describedby');
  });

  it('textarea aria-describedby points to the error div when error appears', async () => {
    render(<DmOverrideModal {...MODAL_BASE} />);

    const textarea = screen.getByLabelText(/Reason/i);
    // Fill reason so submit is enabled, then submit to trigger engine error
    fireEvent.change(textarea, { target: { value: 'test' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply override/i }));
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );

    const errorDiv = screen.getByRole('alert');
    expect(errorDiv).toHaveAttribute('id');
    const errorId = errorDiv.getAttribute('id')!;
    expect(textarea).toHaveAttribute('aria-describedby', errorId);
  });
});

// ── MAJOR-1 — NPC attack target menu outside-click dismissal ─────────────────

describe('MAJOR-1 — DmNarrationPanel: NPC attack target menu closes on outside mousedown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetSessionPolicy.mockResolvedValue({ session: {} });
    mockNpcAction.mockResolvedValue({ message: 'attacked', data: { state: ACTIVE_COMBAT_STATE } });
  });

  it('target menu closes when mousedown fires outside the attack wrap', async () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <DmNarrationPanel {...PANEL_BASE} />
      </div>,
    );

    // Open the target menu
    const attackBtn = screen.getByRole('button', { name: /Attack — pick target/i });
    fireEvent.click(attackBtn);

    await waitFor(() =>
      expect(screen.getByRole('menu', { name: /pick target/i })).toBeInTheDocument(),
    );

    // Mousedown outside the wrap
    fireEvent.mouseDown(screen.getByTestId('outside'));

    await waitFor(() =>
      expect(screen.queryByRole('menu', { name: /pick target/i })).not.toBeInTheDocument(),
    );
  });

  it('target menu stays open when mousedown fires inside the attack wrap', async () => {
    render(<DmNarrationPanel {...PANEL_BASE} />);

    const attackBtn = screen.getByRole('button', { name: /Attack — pick target/i });
    fireEvent.click(attackBtn);

    await waitFor(() =>
      expect(screen.getByRole('menu', { name: /pick target/i })).toBeInTheDocument(),
    );

    // Mousedown on the attack button itself (inside the wrap) — menu stays open
    fireEvent.mouseDown(attackBtn);

    expect(screen.getByRole('menu', { name: /pick target/i })).toBeInTheDocument();
  });
});

// ── MINOR-1 — Toggle ref-latch: rapid double-tap fires setSessionPolicy once ──

describe('MINOR-1 — DmNarrationPanel: toggle ref-latch prevents double-fire', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Slow promise — never resolves in the test, so the latch stays engaged.
    mockSetSessionPolicy.mockReturnValue(new Promise(() => {}));
  });

  it('calling handleToggleVisible twice synchronously fires setSessionPolicy once', async () => {
    render(<DmNarrationPanel {...PANEL_BASE} overridePlayerVisible={true} />);

    const checkbox = screen.getByRole('checkbox', { name: /Show my overrides to players/i });

    // Two rapid clicks
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);

    // Only one policy call should have fired
    expect(mockSetSessionPolicy).toHaveBeenCalledTimes(1);
  });
});
