/**
 * HpControl — T5 (DDX-09 HP + spell-slots slice).
 *
 * Happy-path damage/heal wiring + busy-latch + invalid-amount guard, mirrors
 * InventoryPanel.test.tsx's conventions.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  adjustHp: jest.fn(),
  getCharacterSheet: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import HpControl from '../../components/HpControl';
import type { CharacterSheet } from '../../lib/api/types';

const mockAdjustHp = dnd.adjustHp as jest.Mock;
const mockGetSheet = dnd.getCharacterSheet as jest.Mock;

function ability(score: number, modifier: number) {
  return { score, modifier };
}

const BASE_SHEET: CharacterSheet = {
  character_id: 'cid-1',
  owner_username: 'leon',
  name: 'Ashwin',
  race: 'Human',
  subrace: '',
  char_class: 'Fighter',
  subclass: '',
  level: 3,
  background: 'Soldier',
  alignment: '',
  ability_scores: {
    strength: ability(16, 3),
    dexterity: ability(12, 1),
    constitution: ability(14, 2),
    intelligence: ability(10, 0),
    wisdom: ability(10, 0),
    charisma: ability(8, -1),
  },
  hp: { current: 24, max: 24, temp: 0 },
  ac: 11,
  initiative: 1,
  proficiency_bonus: 2,
  speed: 30,
  xp: 900,
  xp_next: 2700,
  hit_dice_remaining: 3,
  proficient_saves: ['strength', 'constitution'],
  proficient_skills: ['athletics'],
  class_features: [],
  conditions: [],
  spellcasting: null,
  spell_slots: {},
  is_spellcaster: false,
  inventory: [],
  inventory_weight: 0,
};

function renderControl(
  hp = { current: 24, max: 24, temp: 0 },
  onChanged = jest.fn(),
  overrides?: { isOwner?: boolean },
) {
  render(
    <ToastProvider>
      <HpControl
        characterId="cid-1"
        username="leon"
        isOwner={overrides?.isOwner ?? true}
        hp={hp}
        onChanged={onChanged}
      />
    </ToastProvider>,
  );
  return { onChanged };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockAdjustHp.mockReset();
  mockGetSheet.mockReset();
});

describe('HpControl — read-only rendering', () => {
  it('renders the current/max HP and the meter', () => {
    renderControl({ current: 18, max: 24, temp: 0 });
    expect(screen.getByText('18/24')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Hit points 18 of 24' })).toBeInTheDocument();
  });

  it('renders temp HP when present', () => {
    renderControl({ current: 24, max: 24, temp: 5 });
    expect(screen.getByText('24/24 (+5)')).toBeInTheDocument();
  });

  it('shows a Down pill when current HP is 0', () => {
    renderControl({ current: 0, max: 24, temp: 0 });
    expect(screen.getByText('Down')).toBeInTheDocument();
  });

  it('non-owner: no damage/heal controls render', () => {
    renderControl(undefined, jest.fn(), { isOwner: false });
    expect(screen.queryByLabelText('HP amount')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply damage' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply healing' })).not.toBeInTheDocument();
  });
});

describe('HpControl — invalid amount disables submit', () => {
  it('Damage/Heal are disabled with an empty amount', () => {
    renderControl();
    expect(screen.getByRole('button', { name: 'Apply damage' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply healing' })).toBeDisabled();
  });

  it('Damage/Heal stay disabled for zero, negative, or non-integer amounts', () => {
    renderControl();
    const input = screen.getByLabelText('HP amount');
    for (const bad of ['0', '-3', '2.5', 'abc']) {
      fireEvent.change(input, { target: { value: bad } });
      expect(screen.getByRole('button', { name: 'Apply damage' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Apply healing' })).toBeDisabled();
    }
    expect(mockAdjustHp).not.toHaveBeenCalled();
  });

  it('Damage/Heal enable for a valid positive integer', () => {
    renderControl();
    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '3' } });
    expect(screen.getByRole('button', { name: 'Apply damage' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Apply healing' })).toBeEnabled();
  });
});

describe('HpControl — damage calls the right endpoint and updates HP live', () => {
  it('clicking Damage calls adjustHp("damage", amount), applies the response immediately, then refetches', async () => {
    mockAdjustHp.mockResolvedValue({ current_hp: 21, max_hp: 24, temp_hp: 0, is_down: false });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 21, max: 24, temp: 0 } });
    const { onChanged } = renderControl();

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply damage' }));
    await flush();

    expect(mockAdjustHp).toHaveBeenCalledWith('cid-1', 'leon', 'damage', 3);
    // HP bar/number reflect the mutation response, not the refetch.
    expect(screen.getByText('21/24')).toBeInTheDocument();
    expect(mockGetSheet).toHaveBeenCalledWith('cid-1', 'leon');
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ hp: { current: 21, max: 24, temp: 0 } }));
    // Amount clears after a successful submit.
    expect((screen.getByLabelText('HP amount') as HTMLInputElement).value).toBe('');
  });

  it('a damage response with is_down:true shows the Down pill immediately', async () => {
    mockAdjustHp.mockResolvedValue({ current_hp: 0, max_hp: 24, temp_hp: 0, is_down: true });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 0, max: 24, temp: 0 } });
    renderControl();

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply damage' }));
    await flush();

    expect(screen.getByText('Down')).toBeInTheDocument();
  });
});

describe('HpControl — heal calls the right endpoint and updates HP live', () => {
  it('clicking Heal calls adjustHp("heal", amount) and updates the bar', async () => {
    mockAdjustHp.mockResolvedValue({ current_hp: 24, max_hp: 24, temp_hp: 0, is_down: false });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 24, max: 24, temp: 0 } });
    const { onChanged } = renderControl({ current: 19, max: 24, temp: 0 });

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply healing' }));
    await flush();

    expect(mockAdjustHp).toHaveBeenCalledWith('cid-1', 'leon', 'heal', 5);
    expect(screen.getByText('24/24')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });
});

describe('HpControl — success toast announcement', () => {
  it('announces "Took N damage." on a successful damage mutation + refetch', async () => {
    mockAdjustHp.mockResolvedValue({ current_hp: 21, max_hp: 24, temp_hp: 0, is_down: false });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 21, max: 24, temp: 0 } });
    renderControl();

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply damage' }));
    await flush();

    expect(await screen.findByText('Took 3 damage.')).toBeInTheDocument();
  });

  it('folds a down TRANSITION into the announcement ("You are down!")', async () => {
    mockAdjustHp.mockResolvedValue({ current_hp: 0, max_hp: 24, temp_hp: 0, is_down: true });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 0, max: 24, temp: 0 } });
    renderControl({ current: 10, max: 24, temp: 0 }); // starts up

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply damage' }));
    await flush();

    expect(await screen.findByText('Took 30 damage. You are down!')).toBeInTheDocument();
  });

  it('folds a recovery TRANSITION into the announcement ("You are back up.")', async () => {
    mockAdjustHp.mockResolvedValue({ current_hp: 8, max_hp: 24, temp_hp: 0, is_down: false });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 8, max: 24, temp: 0 } });
    renderControl({ current: 0, max: 24, temp: 0 }); // starts down

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply healing' }));
    await flush();

    expect(await screen.findByText('Healed 8. You are back up.')).toBeInTheDocument();
  });

  it('announces "Healed N." on a successful heal mutation + refetch', async () => {
    mockAdjustHp.mockResolvedValue({ current_hp: 24, max_hp: 24, temp_hp: 0, is_down: false });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 24, max: 24, temp: 0 } });
    renderControl();

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply healing' }));
    await flush();

    expect(await screen.findByText('Healed 5.')).toBeInTheDocument();
  });
});

describe('HpControl — busy-latch double-submit protection', () => {
  it('back-to-back clicks on Damage in the same React batch call adjustHp only once', async () => {
    mockAdjustHp.mockResolvedValue({ current_hp: 21, max_hp: 24, temp_hp: 0, is_down: false });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 21, max: 24, temp: 0 } });
    renderControl();

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '3' } });
    const dmgBtn = screen.getByRole('button', { name: 'Apply damage' });
    await act(async () => {
      fireEvent.click(dmgBtn);
      fireEvent.click(dmgBtn);
    });
    await flush();

    expect(mockAdjustHp).toHaveBeenCalledTimes(1);
  });

  it('releases the latch on a failed mutate — a subsequent click tries again', async () => {
    mockAdjustHp.mockRejectedValueOnce(new Error('network blip'));
    mockAdjustHp.mockResolvedValueOnce({ current_hp: 21, max_hp: 24, temp_hp: 0, is_down: false });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 21, max: 24, temp: 0 } });
    renderControl();

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '3' } });
    const dmgBtn = screen.getByRole('button', { name: 'Apply damage' });
    fireEvent.click(dmgBtn);
    await flush();
    expect(mockAdjustHp).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(dmgBtn).toBeEnabled());

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply damage' }));
    await flush();
    expect(mockAdjustHp).toHaveBeenCalledTimes(2);
  });

  it('all controls disable while a mutation is in flight', async () => {
    let resolveAdjust: (v: unknown) => void = () => {};
    mockAdjustHp.mockReturnValue(
      new Promise((resolve) => {
        resolveAdjust = resolve;
      }),
    );
    renderControl();

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply damage' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText('HP amount')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply healing' })).toBeDisabled();

    resolveAdjust({ current_hp: 21, max_hp: 24, temp_hp: 0, is_down: false });
    await flush();
  });
});

describe('HpControl — refetch failure after a successful mutate (D2 pattern)', () => {
  it('getCharacterSheet throwing after a resolved adjustHp gets its own warn toast, never onChanged, and releases the latch', async () => {
    mockAdjustHp.mockResolvedValue({ current_hp: 21, max_hp: 24, temp_hp: 0, is_down: false });
    mockGetSheet.mockRejectedValue(new Error('network blip'));
    const { onChanged } = renderControl();

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '3' } });
    const dmgBtn = screen.getByRole('button', { name: 'Apply damage' });
    fireEvent.click(dmgBtn);
    await flush();

    expect(
      await screen.findByText("Couldn't refresh your sheet — reload to see the result."),
    ).toBeInTheDocument();
    expect(screen.queryByText('Took 3 damage.')).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    // The bar/number already applied from the mutation response even though
    // the refetch failed.
    expect(screen.getByText('21/24')).toBeInTheDocument();
    // Not wedged: the amount field cleared on the successful mutate (so the
    // button is correctly disabled on EMPTY input, not on a stuck latch) —
    // prove the latch itself released by typing a fresh amount and firing a
    // real second mutation.
    expect(dmgBtn).toHaveAttribute('aria-busy', 'false');
    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply damage' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Apply damage' }));
    await flush();
    expect(mockAdjustHp).toHaveBeenCalledTimes(2);
  });
});

// ─── Miko adversarial additions (T5 DDX-09 HP/slots gate, 2026-07-09) ───────

describe('Miko adversarial — cross-op busy-latch (damage vs heal share ONE ref)', () => {
  it('Damage then Heal fired in the same React batch: only the first (Damage) dispatch mutates', async () => {
    mockAdjustHp.mockResolvedValue({ current_hp: 21, max_hp: 24, temp_hp: 0, is_down: false });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 21, max: 24, temp: 0 } });
    renderControl();

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '3' } });
    const dmgBtn = screen.getByRole('button', { name: 'Apply damage' });
    const healBtn = screen.getByRole('button', { name: 'Apply healing' });
    await act(async () => {
      fireEvent.click(dmgBtn);
      fireEvent.click(healBtn);
    });
    await flush();

    // The shared synchronous ref (not React's `busy` state, which hasn't
    // committed between the two same-tick dispatches) is what blocks the
    // second call — same mechanism InventoryPanel/SpellSlotsPanel rely on.
    expect(mockAdjustHp).toHaveBeenCalledTimes(1);
    expect(mockAdjustHp).toHaveBeenCalledWith('cid-1', 'leon', 'damage', 3);
  });

  it('Heal then Damage fired in the same batch: only the first (Heal) dispatch mutates', async () => {
    mockAdjustHp.mockResolvedValue({ current_hp: 24, max_hp: 24, temp_hp: 0, is_down: false });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET });
    renderControl({ current: 19, max: 24, temp: 0 });

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '5' } });
    const dmgBtn = screen.getByRole('button', { name: 'Apply damage' });
    const healBtn = screen.getByRole('button', { name: 'Apply healing' });
    await act(async () => {
      fireEvent.click(healBtn);
      fireEvent.click(dmgBtn);
    });
    await flush();

    expect(mockAdjustHp).toHaveBeenCalledTimes(1);
    expect(mockAdjustHp).toHaveBeenCalledWith('cid-1', 'leon', 'heal', 5);
  });
});

describe('Miko adversarial — is_down transitions', () => {
  it('healing back above 0 clears an existing Down state', async () => {
    mockAdjustHp.mockResolvedValue({ current_hp: 5, max_hp: 24, temp_hp: 0, is_down: false });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 5, max: 24, temp: 0 } });
    // Mounts already-down (current 0 <= 0 -> initial isDown guess is true).
    renderControl({ current: 0, max: 24, temp: 0 });
    expect(screen.getByText('Down')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply healing' }));
    await flush();

    expect(screen.queryByText('Down')).not.toBeInTheDocument();
    expect(screen.getByText('5/24')).toBeInTheDocument();
  });

  it('is_down is read from the endpoint response, not re-derived client-side from current_hp alone (e.g. stabilized-at-0 stays non-Down if the server says so)', async () => {
    // Deliberately weird/authoritative-wins case: server reports current_hp=0
    // but is_down:false (e.g. a future "stable at 0" 5e house rule). The
    // component must trust the endpoint's own is_down field over its own
    // `current <= 0` heuristic once a real mutation response has landed.
    mockAdjustHp.mockResolvedValue({ current_hp: 0, max_hp: 24, temp_hp: 0, is_down: false });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 0, max: 24, temp: 0 } });
    renderControl({ current: 5, max: 24, temp: 0 });

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply damage' }));
    await flush();

    expect(screen.getByText('0/24')).toBeInTheDocument();
    expect(screen.queryByText('Down')).not.toBeInTheDocument();
  });
});

describe('Miko adversarial — temp_hp handling', () => {
  it('a damage response that fully soaks temp HP down to 0 drops the "(+N)" suffix', async () => {
    mockAdjustHp.mockResolvedValue({ current_hp: 24, max_hp: 24, temp_hp: 0, is_down: false });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 24, max: 24, temp: 0 } });
    renderControl({ current: 24, max: 24, temp: 5 });
    expect(screen.getByText('24/24 (+5)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply damage' }));
    await flush();

    expect(screen.getByText('24/24')).toBeInTheDocument();
    expect(screen.queryByText(/\(\+/)).not.toBeInTheDocument();
  });

  it('a damage response that only partially soaks temp HP shows the reduced (+N)', async () => {
    mockAdjustHp.mockResolvedValue({ current_hp: 24, max_hp: 24, temp_hp: 2, is_down: false });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 24, max: 24, temp: 2 } });
    renderControl({ current: 24, max: 24, temp: 5 });

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply damage' }));
    await flush();

    expect(screen.getByText('24/24 (+2)')).toBeInTheDocument();
  });
});

describe('Miko adversarial — external hp prop change re-syncs local state (e.g. LevelUp raising max HP)', () => {
  it('a new hp prop (not from this control’s own mutation) updates the displayed number/bar/Down state', () => {
    const { rerender } = render(
      <ToastProvider>
        <HpControl
          characterId="cid-1"
          username="leon"
          isOwner={true}
          hp={{ current: 0, max: 24, temp: 0 }}
          onChanged={jest.fn()}
        />
      </ToastProvider>,
    );
    expect(screen.getByText('Down')).toBeInTheDocument();

    // Simulate LevelUp bumping max HP and topping the character up — a sheet
    // change that never went through adjustHp at all.
    rerender(
      <ToastProvider>
        <HpControl
          characterId="cid-1"
          username="leon"
          isOwner={true}
          hp={{ current: 30, max: 30, temp: 0 }}
          onChanged={jest.fn()}
        />
      </ToastProvider>,
    );

    expect(screen.getByText('30/30')).toBeInTheDocument();
    expect(screen.queryByText('Down')).not.toBeInTheDocument();
  });
});

describe('Miko adversarial — amount validation gaps', () => {
  it('bool-ish string amounts ("true"/"false") are rejected (Number() -> NaN, never posted)', () => {
    renderControl();
    const input = screen.getByLabelText('HP amount');
    for (const bad of ['true', 'false', 'NaN', 'Infinity']) {
      fireEvent.change(input, { target: { value: bad } });
      expect(screen.getByRole('button', { name: 'Apply damage' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Apply healing' })).toBeDisabled();
    }
    expect(mockAdjustHp).not.toHaveBeenCalled();
  });

  // The amount input is bounded to the engine's own ±1,000,000 HpAdjustRequest
  // cap (HP_AMOUNT_MAX) and digits-only, so an over-cap or sci-notation entry is
  // refused HERE (button disabled, adjustHp never called) instead of round-
  // tripping to a generic engine 400.
  it('a >1e6 amount is refused client-side — button disabled, adjustHp never called', async () => {
    renderControl();

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '2000000' } });
    expect(screen.getByRole('button', { name: 'Apply damage' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply healing' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Apply damage' }));
    await flush();
    expect(mockAdjustHp).not.toHaveBeenCalled();
  });

  it('accepts the cap boundary (1000000) and rejects over-cap / sci-notation', () => {
    renderControl();
    const dmg = () => screen.getByRole('button', { name: 'Apply damage' });

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '1000000' } });
    expect(dmg()).toBeEnabled(); // exactly at the cap

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '1000001' } });
    expect(dmg()).toBeDisabled(); // one over

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '1e21' } });
    expect(dmg()).toBeDisabled(); // absurd magnitude

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '3e2' } });
    expect(dmg()).toBeDisabled(); // sci-notation (would be 300)
  });

  // A server refusal for any in-range reason surfaces the SAME generic "Try
  // again in a moment" copy as a transient network failure — consistent with
  // every sibling mutation component (InventoryPanel), a pre-existing
  // codebase-wide characteristic, not new to this diff.
  it('a server-side refusal renders the same generic error toast as a network failure', async () => {
    mockAdjustHp.mockRejectedValue(new Error('server refused'));
    renderControl();

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply damage' }));
    await flush();

    expect(
      await screen.findByText('Could not apply damage. Try again in a moment.'),
    ).toBeInTheDocument();
  });
});

// ── TAV-BUSY-DISABLED-FOCUS-PARK (1.7 audit, 2026-08-10) ─────────────────────
// Same rule and same reasoning as CurrencyPurse: a real browser blurs a focused
// button the moment it goes `disabled`, and a successful apply clears the
// amount so BOTH Damage and Heal are legitimately disabled afterwards and
// neither can take focus back. jsdom does not blur, so the tests simulate it
// and assert where focus LANDED.
describe('focus is never stranded after damage/heal', () => {
  it.each([
    ['Apply damage', 'damage'],
    ['Apply healing', 'heal'],
  ])('%s returns focus to the amount input', async (label) => {
    mockAdjustHp.mockResolvedValue({ current_hp: 21, max_hp: 24, temp_hp: 0, is_down: false });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, hp: { current: 21, max: 24, temp: 0 } });
    renderControl();

    fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '3' } });
    const btn = screen.getByRole('button', { name: label });
    btn.focus();
    fireEvent.click(btn);
    (document.activeElement as HTMLElement)?.blur();
    await flush();

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(screen.getByLabelText('HP amount'));
  });
});
