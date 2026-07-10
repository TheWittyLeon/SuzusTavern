/**
 * ConditionsPanel — T7 (DDX-17e condition apply/remove UI).
 *
 * DM-only apply (target + condition + optional duration) and remove
 * (per-combatant chip "x"), busy-latch, success toast, onStateRefresh,
 * onBusyChange — mirrors CastSpellPanel's test conventions.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  applyCondition: jest.fn(),
  removeCondition: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import ConditionsPanel from '../../components/ConditionsPanel';
import type { CombatParticipantState } from '../../lib/api/types';

const mockApply = dnd.applyCondition as jest.Mock;
const mockRemove = dnd.removeCondition as jest.Mock;

function participant(overrides: Partial<CombatParticipantState>): CombatParticipantState {
  return {
    participant_id: 'p',
    entity_id: 'e',
    name: 'Participant',
    is_pc: true,
    initiative: 10,
    hp_current: 10,
    hp_max: 10,
    ac: 12,
    conditions: [],
    is_alive: true,
    can_be_targeted: true,
    is_active_turn: false,
    took_turn: false,
    ...overrides,
  };
}

const VELKA = participant({ participant_id: 'p-velka', entity_id: 'c1', name: 'Velka' });
const GOBLIN = participant({
  participant_id: 'p-goblin',
  entity_id: 'goblin-1',
  name: 'Goblin',
  is_pc: false,
  hp_current: 7,
  hp_max: 7,
  conditions: ['poisoned'],
  condition_durations: { poisoned: 3 },
});

function renderPanel(overrides?: {
  participants?: CombatParticipantState[];
  disabled?: boolean;
  onApplied?: (text: string) => void;
  onStateRefresh?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const onApplied = overrides?.onApplied ?? jest.fn();
  const onStateRefresh = overrides?.onStateRefresh ?? jest.fn();
  const onBusyChange = overrides?.onBusyChange ?? jest.fn();
  render(
    <ToastProvider>
      <ConditionsPanel
        combatId="combat-1"
        dmUsername="suzu"
        participants={overrides?.participants ?? [VELKA, GOBLIN]}
        disabled={overrides?.disabled ?? false}
        onApplied={onApplied}
        onStateRefresh={onStateRefresh}
        onBusyChange={onBusyChange}
      />
    </ToastProvider>,
  );
  return { onApplied, onStateRefresh, onBusyChange };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockApply.mockReset();
  mockRemove.mockReset();
});

describe('ConditionsPanel — rendering', () => {
  it('shows the target/condition/duration controls and an Apply button', () => {
    renderPanel();
    expect(screen.getByLabelText('Target')).toBeInTheDocument();
    expect(screen.getByLabelText('Condition')).toBeInTheDocument();
    expect(screen.getByLabelText('Duration (rounds)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Apply /i })).toBeInTheDocument();
  });

  it('lists the canonical condition set in the picker (includes poisoned and an exhaustion level)', () => {
    renderPanel();
    const select = screen.getByLabelText('Condition');
    const names = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(names).toContain('Poisoned');
    expect(names).toContain('Exhaustion 3');
  });

  it('shows the Goblin already-poisoned chip with a Remove control', () => {
    renderPanel();
    expect(screen.getByText('Poisoned · 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Poisoned from Goblin' })).toBeInTheDocument();
  });

  it('shows "No active conditions." when nobody has one', () => {
    renderPanel({ participants: [VELKA] });
    expect(screen.getByText('No active conditions.')).toBeInTheDocument();
  });
});

describe('ConditionsPanel — apply wiring', () => {
  it('calls applyCondition with combat_id/target(name)/condition/duration_rounds/username', async () => {
    mockApply.mockResolvedValue({ message: 'Poisoned Velka.' });
    const { onApplied, onStateRefresh } = renderPanel();

    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'p-velka' } });
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'poisoned' } });
    fireEvent.change(screen.getByLabelText('Duration (rounds)'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await flush();

    expect(mockApply).toHaveBeenCalledWith({
      combat_id: 'combat-1',
      target: 'Velka',
      condition: 'poisoned',
      duration_rounds: 3,
      username: 'suzu',
    });
    expect(onApplied).toHaveBeenCalledWith('Poisoned Velka.');
    expect(onStateRefresh).toHaveBeenCalled();
  });

  it('omits duration_rounds when the field is left blank (indefinite)', async () => {
    mockApply.mockResolvedValue({ message: 'ok' });
    renderPanel();

    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'p-velka' } });
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'prone' } });
    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await flush();

    const sentBody = mockApply.mock.calls[0][0];
    expect(sentBody).not.toHaveProperty('duration_rounds');
  });

  it('disables Apply and shows a hint for a non-positive duration', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Duration (rounds)'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: /^Apply /i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/whole number of rounds/i);
  });

  it('disables Apply for a duration above the engine cap (1000)', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Duration (rounds)'), { target: { value: '1001' } });
    expect(screen.getByRole('button', { name: /^Apply /i })).toBeDisabled();
  });

  it('disables Apply for a negative duration', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Duration (rounds)'), { target: { value: '-1' } });
    expect(screen.getByRole('button', { name: /^Apply /i })).toBeDisabled();
  });

  it('disables Apply for a non-integer (fractional) duration — jsdom lets this through even though a real number input with step=1 would not', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Duration (rounds)'), { target: { value: '2.5' } });
    expect(screen.getByRole('button', { name: /^Apply /i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/whole number of rounds/i);
  });

  it('a non-numeric duration string never even reaches the component text state — the type="number" input itself normalizes it to blank (real-browser-verified via jsdom), so it is treated as indefinite, not rejected', () => {
    // Confirmed via a direct jsdom probe before writing this: setting a
    // type="number" input's .value to a non-numeric string like "abc"
    // silently coerces to "" — this matches real-browser behavior for
    // <input type="number"> (unlike free-text inputs, where jsdom is more
    // permissive than a real browser and lets literally anything through —
    // see the HpControl gate's own documented caveat, the opposite direction
    // of leniency). So Apply is NOT disabled here; the duration is simply
    // absent (indefinite), same as leaving the field untouched.
    renderPanel();
    const input = screen.getByLabelText('Duration (rounds)') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(input.value).toBe('');
    expect(screen.getByRole('button', { name: /^Apply /i })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables Apply entirely (no crash) when there are no participants to target', () => {
    renderPanel({ participants: [] });
    expect(screen.getByRole('button', { name: /^Apply /i })).toBeDisabled();
    expect(screen.getByText('No active conditions.')).toBeInTheDocument();
  });

  it('shows a success toast naming the condition, target, and duration', async () => {
    mockApply.mockResolvedValue({ message: 'ok' });
    renderPanel();

    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'p-velka' } });
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'poisoned' } });
    fireEvent.change(screen.getByLabelText('Duration (rounds)'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await flush();

    expect(await screen.findByText('Applied Poisoned to Velka (2 rounds).')).toBeInTheDocument();
  });

  it('surfaces a mapped refusal reason as a toast and never optimistically reports success', async () => {
    const err = new Error('API error 400: invalid_condition') as Error & {
      status: number;
      code: string;
      body: unknown;
    };
    err.status = 400;
    err.code = 'invalid_condition';
    err.body = { success: false, data: { reason: 'invalid_condition' } };
    mockApply.mockRejectedValue(err);
    const { onApplied, onStateRefresh } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await flush();

    expect(await screen.findByText("That condition isn't recognized.")).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
    expect(onStateRefresh).not.toHaveBeenCalled();
  });

  it('maps target_not_found to clean copy (never a raw engine string)', async () => {
    const err = new Error('API error 404: target_not_found') as Error & {
      status: number;
      code: string;
      body: unknown;
    };
    err.status = 404;
    err.code = 'target_not_found';
    err.body = { success: false, message: "[Combat] Target 'Velka' not found.", data: { reason: 'target_not_found' } };
    mockApply.mockRejectedValue(err);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await flush();

    expect(await screen.findByText('That target could not be found.')).toBeInTheDocument();
    expect(screen.queryByText(/\[Combat\]/)).not.toBeInTheDocument();
  });

  it('maps no_combat to clean copy', async () => {
    const err = new Error('API error 400: no_combat') as Error & {
      status: number;
      code: string;
      body: unknown;
    };
    err.status = 400;
    err.code = 'no_combat';
    err.body = { success: false, data: { reason: 'no_combat' } };
    mockApply.mockRejectedValue(err);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await flush();

    expect(await screen.findByText('No active combat.')).toBeInTheDocument();
  });

  it('an UNMAPPED reason with an internal-looking raw engine message never leaks that raw string — falls back to generic copy', async () => {
    const err = new Error('API error 500: error') as Error & {
      status: number;
      code: string;
      body: unknown;
    };
    err.status = 500;
    err.code = 'error';
    err.body = {
      success: false,
      message: 'cmd_apply_condition: engine apply_condition did not persist on p-xyz',
      data: { reason: 'error' },
    };
    mockApply.mockRejectedValue(err);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await flush();

    expect(
      await screen.findByText(/Couldn't apply Blinded\. Try again\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/cmd_apply_condition/)).not.toBeInTheDocument();
    expect(screen.queryByText(/p-xyz/)).not.toBeInTheDocument();
  });

  it('a same-shape 404 body with NO reason key at all (the _load_session_for_combat "session is None" branch — see combat_commands.py/routes/combat.py) falls back to generic copy, not a raw/undefined string', async () => {
    // Confirmed via engine source read: routes/combat.py's apply_condition
    // has TWO distinct 404 sources — guard_dm's own denial (reason="not_found",
    // handled below) vs the earlier "_load_session_for_combat returned session
    // is None" branch, which calls _err(msg, 404) with NO reason kwarg at all
    // (data={}). refusalReason then falls through data.reason (absent) ->
    // top-level reason (absent) -> e.code, which client.ts sets to the bare
    // numeric status string ("404") when the body carries neither a top-level
    // `error` nor `code` key. CONDITION_REFUSAL_COPY has no "404" entry, so
    // this path can NEVER show "Combat or session not found." even though
    // that string IS in the map under the "not_found" key — only the
    // guard_dm-denial 404 (which DOES set data.reason="not_found") reaches it.
    const err = new Error('API error 404: 404') as Error & {
      status: number;
      code: string;
      body: unknown;
    };
    err.status = 404;
    err.code = '404';
    err.body = { success: false, message: 'Combat or session not found.', data: {} };
    mockApply.mockRejectedValue(err);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await flush();

    // Still clean (generic fallback), never blank/undefined/raw:
    expect(
      await screen.findByText(/Couldn't apply Blinded\. Try again\./),
    ).toBeInTheDocument();
  });

  it('maps guard_dm\'s own denial shape (reason="not_found", data.reason set) to the specific copy', async () => {
    const err = new Error('API error 404: not_found') as Error & {
      status: number;
      code: string;
      body: unknown;
    };
    err.status = 404;
    err.code = 'not_found';
    err.body = { success: false, message: 'Session not found.', data: { reason: 'not_found' } };
    mockApply.mockRejectedValue(err);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await flush();

    expect(await screen.findByText('Combat or session not found.')).toBeInTheDocument();
  });
});

describe('ConditionsPanel — duplicate-name wire-target risk (client-side manifestation)', () => {
  it('two participants with byte-identical names, selected by two DIFFERENT participant_ids, produce a byte-identical wire target string — the client has no way to disambiguate once sent (engine resolves by name, see _resolve_condition_target in NekoNova-DnDEngine)', async () => {
    const GOBLIN_A = participant({ participant_id: 'p-a', entity_id: 'e-a', name: 'Goblin' });
    const GOBLIN_B = participant({ participant_id: 'p-b', entity_id: 'e-b', name: 'Goblin' });
    mockApply.mockResolvedValue({ message: 'ok' });
    renderPanel({ participants: [GOBLIN_A, GOBLIN_B] });

    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'p-a' } });
    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await flush();
    const firstTarget = mockApply.mock.calls[0][0].target;

    mockApply.mockClear();
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'p-b' } });
    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await flush();
    const secondTarget = mockApply.mock.calls[0][0].target;

    expect(firstTarget).toBe('Goblin');
    expect(secondTarget).toBe('Goblin');
    expect(firstTarget).toBe(secondTarget);
  });
});

describe('ConditionsPanel — refetch reflection (not optimistic)', () => {
  it('does NOT show a newly-applied condition until the participants prop itself is updated by the parent refetch', async () => {
    mockApply.mockResolvedValue({ message: 'ok' });
    const onStateRefresh = jest.fn();
    const { rerender } = render(
      <ToastProvider>
        <ConditionsPanel
          combatId="combat-1"
          dmUsername="suzu"
          participants={[VELKA]}
          onApplied={jest.fn()}
          onStateRefresh={onStateRefresh}
        />
      </ToastProvider>,
    );

    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'p-velka' } });
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'poisoned' } });
    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await flush();

    expect(onStateRefresh).toHaveBeenCalled();
    // Parent hasn't actually refetched yet (onStateRefresh is a stub) — the
    // panel must not have locally/optimistically added the chip itself.
    expect(screen.getByText('No active conditions.')).toBeInTheDocument();

    // Now simulate the parent's real refetch landing.
    const VELKA_POISONED = { ...VELKA, conditions: ['poisoned'], condition_durations: {} };
    rerender(
      <ToastProvider>
        <ConditionsPanel
          combatId="combat-1"
          dmUsername="suzu"
          participants={[VELKA_POISONED]}
          onApplied={jest.fn()}
          onStateRefresh={onStateRefresh}
        />
      </ToastProvider>,
    );
    // Scope past the (also-"Poisoned") condition-picker <option> — query the
    // affected-combatants chip list specifically.
    const affectedList = document.querySelector('.affectedList') as HTMLElement;
    expect(affectedList).not.toBeNull();
    expect(
      within(affectedList).getByText('Poisoned', { selector: 'span[aria-hidden]' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('No active conditions.')).not.toBeInTheDocument();
  });

  it('a removed chip stays visible until the participants prop drops the condition (not optimistic), then disappears on rerender', async () => {
    mockRemove.mockResolvedValue({ message: 'ok' });
    const onStateRefresh = jest.fn();
    const { rerender } = render(
      <ToastProvider>
        <ConditionsPanel
          combatId="combat-1"
          dmUsername="suzu"
          participants={[VELKA, GOBLIN]}
          onApplied={jest.fn()}
          onStateRefresh={onStateRefresh}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove Poisoned from Goblin' }));
    await flush();

    expect(onStateRefresh).toHaveBeenCalled();
    // Still present — the component never mutated its own copy of GOBLIN.
    expect(screen.getByText('Poisoned · 3')).toBeInTheDocument();

    const GOBLIN_CLEARED = { ...GOBLIN, conditions: [], condition_durations: {} };
    rerender(
      <ToastProvider>
        <ConditionsPanel
          combatId="combat-1"
          dmUsername="suzu"
          participants={[VELKA, GOBLIN_CLEARED]}
          onApplied={jest.fn()}
          onStateRefresh={onStateRefresh}
        />
      </ToastProvider>,
    );
    expect(screen.queryByText('Poisoned · 3')).not.toBeInTheDocument();
    expect(screen.getByText('No active conditions.')).toBeInTheDocument();
  });
});

describe('ConditionsPanel — remove wiring', () => {
  it('calls removeCondition with combat_id/target(name)/condition/username', async () => {
    mockRemove.mockResolvedValue({ message: 'Poison wears off Goblin.' });
    const { onApplied, onStateRefresh } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Poisoned from Goblin' }));
    await flush();

    expect(mockRemove).toHaveBeenCalledWith({
      combat_id: 'combat-1',
      target: 'Goblin',
      condition: 'poisoned',
      username: 'suzu',
    });
    expect(onApplied).toHaveBeenCalledWith('Poison wears off Goblin.');
    expect(onStateRefresh).toHaveBeenCalled();
    expect(await screen.findByText('Removed Poisoned from Goblin.')).toBeInTheDocument();
  });
});

describe('ConditionsPanel — a11y (Iro follow-up)', () => {
  it('the duration input is described by the bounds hint via aria-describedby', () => {
    renderPanel();
    const input = screen.getByLabelText('Duration (rounds)');
    fireEvent.change(input, { target: { value: '0' } });
    const describedById = input.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById as string)).toHaveTextContent(
      /whole number of rounds/i,
    );
  });

  it('restores focus to the affected row after removing one of SEVERAL conditions (row survives)', async () => {
    mockRemove.mockResolvedValue({ message: 'ok' });
    const GOBLIN_MULTI = {
      ...GOBLIN,
      conditions: ['poisoned', 'prone'],
      condition_durations: { poisoned: 3 },
    };
    renderPanel({ participants: [VELKA, GOBLIN_MULTI] });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Poisoned from Goblin' }));
    await flush();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const row = screen.getByText('Goblin').closest('div');
    expect(row).toHaveFocus();
  });

  it('falls back to the Target select after removing a combatant\'s LAST condition (the affected row would unmount)', async () => {
    mockRemove.mockResolvedValue({ message: 'ok' });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Poisoned from Goblin' }));
    await flush();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(screen.getByLabelText('Target')).toHaveFocus();
  });
});

describe('ConditionsPanel — busy-latch', () => {
  it('two fast clicks in the same batch call applyCondition only once', async () => {
    let resolveApply: (v: unknown) => void = () => {};
    mockApply.mockReturnValue(
      new Promise((resolve) => {
        resolveApply = resolve;
      }),
    );
    renderPanel();

    const btn = screen.getByRole('button', { name: /^Apply /i });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mockApply).toHaveBeenCalledTimes(1);

    resolveApply({ message: 'ok' });
    await flush();
  });

  it('releases the latch on a failed apply — a subsequent click tries again', async () => {
    mockApply.mockRejectedValueOnce(new Error('network blip'));
    mockApply.mockResolvedValueOnce({ message: 'ok' });
    renderPanel();

    const btn = screen.getByRole('button', { name: /^Apply /i });
    fireEvent.click(btn);
    await flush();
    expect(mockApply).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await flush();
    expect(mockApply).toHaveBeenCalledTimes(2);
  });

  it('raises then releases the shared combat-busy latch around an apply', async () => {
    mockApply.mockResolvedValue({ message: 'ok' });
    const { onBusyChange } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await flush();

    expect(onBusyChange).toHaveBeenNthCalledWith(1, true);
    expect(onBusyChange).toHaveBeenNthCalledWith(2, false);
  });

  it('is aria-busy while an apply is in flight', async () => {
    let resolveApply: (v: unknown) => void = () => {};
    mockApply.mockReturnValue(
      new Promise((resolve) => {
        resolveApply = resolve;
      }),
    );
    const { container } = render(
      <ToastProvider>
        <ConditionsPanel
          combatId="combat-1"
          dmUsername="suzu"
          participants={[VELKA, GOBLIN]}
          onApplied={jest.fn()}
          onStateRefresh={jest.fn()}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();

    resolveApply({ message: 'ok' });
    await flush();
  });

  it('the shared latch also blocks a remove click while an apply is in flight', async () => {
    let resolveApply: (v: unknown) => void = () => {};
    mockApply.mockReturnValue(
      new Promise((resolve) => {
        resolveApply = resolve;
      }),
    );
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Poisoned from Goblin' }));
    await flush();
    expect(mockRemove).not.toHaveBeenCalled();

    resolveApply({ message: 'ok' });
    await flush();
  });

  it('cross-op, reverse direction: the shared latch also blocks an Apply click while a remove is in flight', async () => {
    let resolveRemove: (v: unknown) => void = () => {};
    mockRemove.mockReturnValue(
      new Promise((resolve) => {
        resolveRemove = resolve;
      }),
    );
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Poisoned from Goblin' }));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: /^Apply /i }));
    await flush();
    expect(mockApply).not.toHaveBeenCalled();

    resolveRemove({ message: 'ok' });
    await flush();
  });

  it('releases the latch on a failed remove — a subsequent remove click tries again', async () => {
    mockRemove.mockRejectedValueOnce(new Error('network blip'));
    mockRemove.mockResolvedValueOnce({ message: 'ok' });
    renderPanel();

    const btn = screen.getByRole('button', { name: 'Remove Poisoned from Goblin' });
    fireEvent.click(btn);
    await flush();
    expect(mockRemove).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await flush();
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });
});

describe('ConditionsPanel — disabled prop', () => {
  it('disables Apply and every remove control when disabled=true', () => {
    renderPanel({ disabled: true });
    expect(screen.getByRole('button', { name: /^Apply /i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Poisoned from Goblin' })).toBeDisabled();
  });
});
