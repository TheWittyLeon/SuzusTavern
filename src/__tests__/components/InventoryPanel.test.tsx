/**
 * InventoryPanel — T5 / DDX-09 inventory slice.
 *
 * Happy-path equip/unequip/give-item rendering/wiring, PLUS the adversarial
 * sweep (busy-latch across all three handlers, refetch-after-mutate races,
 * soft-refusal/stale-state shapes, no-equip-slot item types) — all in this
 * one file. (An earlier draft of this header referenced a split-out
 * `InventoryPanel.adversarial.test.tsx` mirroring LevelUpButton's file split;
 * that file was never created — Miko-QA gate 2026-07-09 confirmed it doesn't
 * exist and consolidated everything here instead of leaving the stale
 * pointer. If a future pass wants the split for file-size reasons, do it
 * then — don't trust this comment as evidence the split already happened.)
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  equipItem: jest.fn(),
  unequipItem: jest.fn(),
  giveItem: jest.fn(),
  getCharacterSheet: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import InventoryPanel from '../../components/InventoryPanel';
import type { CharacterSheet, SheetInventoryItem } from '../../lib/api/types';

const mockEquip = dnd.equipItem as jest.Mock;
const mockUnequip = dnd.unequipItem as jest.Mock;
const mockGiveItem = dnd.giveItem as jest.Mock;
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

const CHAIN_MAIL: SheetInventoryItem = {
  name: 'Chain Mail',
  item_type: 'armor',
  sub: '',
  quantity: 1,
  equipped: false,
};

const SWORD: SheetInventoryItem = {
  name: 'Longsword',
  item_type: 'weapon',
  sub: '',
  quantity: 1,
  equipped: true,
};

function renderPanel(
  inventory: SheetInventoryItem[],
  onChanged = jest.fn(),
  overrides?: { isOwner?: boolean },
) {
  render(
    <ToastProvider>
      <InventoryPanel
        characterId="cid-1"
        username="leon"
        isOwner={overrides?.isOwner ?? true}
        inventory={inventory}
        inventoryWeight={40}
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
  mockEquip.mockReset();
  mockUnequip.mockReset();
  mockGiveItem.mockReset();
  mockGetSheet.mockReset();
});

describe('InventoryPanel — read-only rendering', () => {
  it('renders the empty state', () => {
    renderPanel([]);
    expect(screen.getByText('Nothing in the pack yet.')).toBeInTheDocument();
  });

  it('renders items with name, quantity, and an "equipped" pill', () => {
    renderPanel([CHAIN_MAIL, SWORD]);
    expect(screen.getByText('Chain Mail')).toBeInTheDocument();
    expect(screen.getByText('Longsword')).toBeInTheDocument();
    expect(screen.getByText('equipped')).toBeInTheDocument();
    expect(screen.getAllByText('×1')).toHaveLength(2);
  });

  it('non-owner: no equip/unequip/add-item controls render', () => {
    renderPanel([CHAIN_MAIL, SWORD], jest.fn(), { isOwner: false });
    expect(screen.queryByRole('button', { name: /^equip\b/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^unequip\b/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add an item')).not.toBeInTheDocument();
  });
});

describe('InventoryPanel — equip calls the right endpoint and refetches AC', () => {
  it('clicking Equip calls equipItem, then refetches the sheet and hands the fresh AC up via onChanged', async () => {
    mockEquip.mockResolvedValue({ message: '[DnD] Equipped Chain Mail.' });
    mockGetSheet.mockResolvedValue({
      ...BASE_SHEET,
      ac: 16,
      inventory: [{ ...CHAIN_MAIL, equipped: true }],
    });
    const { onChanged } = renderPanel([CHAIN_MAIL]);

    fireEvent.click(screen.getByRole('button', { name: /^equip\b/i }));
    await flush();

    expect(mockEquip).toHaveBeenCalledWith('cid-1', 'leon', 'Chain Mail');
    expect(mockGetSheet).toHaveBeenCalledWith('cid-1', 'leon');
    expect(onChanged).toHaveBeenCalledWith(
      expect.objectContaining({ ac: 16 }),
    );
  });
});

describe('InventoryPanel — unequip calls the right endpoint and refetches AC', () => {
  it('clicking Unequip calls unequipItem, then refetches the sheet', async () => {
    mockUnequip.mockResolvedValue({ message: '[DnD] Unequipped Longsword.' });
    mockGetSheet.mockResolvedValue({
      ...BASE_SHEET,
      ac: 11,
      inventory: [{ ...SWORD, equipped: false }],
    });
    const { onChanged } = renderPanel([SWORD]);

    fireEvent.click(screen.getByRole('button', { name: /^unequip\b/i }));
    await flush();

    expect(mockUnequip).toHaveBeenCalledWith('cid-1', 'leon', 'Longsword');
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ ac: 11 }));
  });
});

describe('InventoryPanel — give-item wrapper shape', () => {
  it('submitting the add-item form calls giveItem with the typed name, then refetches', async () => {
    mockGiveItem.mockResolvedValue({ message: '[DnD] Added Torch.' });
    mockGetSheet.mockResolvedValue({
      ...BASE_SHEET,
      inventory: [{ name: 'Torch', item_type: 'gear', sub: '', quantity: 1, equipped: false }],
    });
    const { onChanged } = renderPanel([]);

    const input = screen.getByLabelText('Add an item');
    fireEvent.change(input, { target: { value: 'Torch' } });
    fireEvent.click(screen.getByRole('button', { name: /^add item$/i }));
    await flush();

    expect(mockGiveItem).toHaveBeenCalledWith('cid-1', 'leon', 'Torch');
    expect(mockGetSheet).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
    // Input clears after a successful submit.
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('does not call giveItem for a blank/whitespace-only name', async () => {
    renderPanel([]);
    const addBtn = screen.getByRole('button', { name: /^add item$/i });
    expect(addBtn).toBeDisabled();

    const input = screen.getByLabelText('Add an item');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /^add item$/i })).toBeDisabled();
    expect(mockGiveItem).not.toHaveBeenCalled();
  });
});

describe('InventoryPanel — busy-latch double-submit protection', () => {
  it('back-to-back clicks on Equip in the same React batch call equipItem only once', async () => {
    mockEquip.mockResolvedValue({ message: 'ok' });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, inventory: [{ ...CHAIN_MAIL, equipped: true }] });
    renderPanel([CHAIN_MAIL]);

    const equipBtn = screen.getByRole('button', { name: /^equip\b/i });
    await act(async () => {
      fireEvent.click(equipBtn);
      fireEvent.click(equipBtn);
    });
    await flush();

    expect(mockEquip).toHaveBeenCalledTimes(1);
  });

  it('releases the latch on a failed mutate — a subsequent click tries again', async () => {
    mockEquip.mockRejectedValueOnce(new Error('network blip'));
    mockEquip.mockResolvedValueOnce({ message: 'ok' });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, inventory: [{ ...CHAIN_MAIL, equipped: true }] });
    renderPanel([CHAIN_MAIL]);

    const equipBtn = screen.getByRole('button', { name: /^equip\b/i });
    fireEvent.click(equipBtn);
    await flush();
    expect(mockEquip).toHaveBeenCalledTimes(1);

    // Button must have re-enabled (latch released in `finally`) for a second,
    // real attempt to be possible at all.
    await waitFor(() => expect(equipBtn).toBeEnabled());

    fireEvent.click(equipBtn);
    await flush();
    expect(mockEquip).toHaveBeenCalledTimes(2);
  });

  it('all equip/unequip/add-item controls disable while any one mutation is in flight', async () => {
    let resolveEquip: (v: unknown) => void = () => {};
    mockEquip.mockReturnValue(
      new Promise((resolve) => {
        resolveEquip = resolve;
      }),
    );
    renderPanel([CHAIN_MAIL, SWORD]);

    fireEvent.click(screen.getByRole('button', { name: /^equip\b/i }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: /^unequip\b/i })).toBeDisabled();
    expect(screen.getByLabelText('Add an item')).toBeDisabled();

    resolveEquip({ message: 'ok' });
    await flush();
  });
});

describe('InventoryPanel — refetch failure after a successful mutate (D2 pattern)', () => {
  it('getCharacterSheet throwing after a resolved equipItem gets its own non-retry copy, never onChanged, and releases the latch', async () => {
    mockEquip.mockResolvedValue({ message: '[DnD] Equipped Chain Mail.' });
    mockGetSheet.mockRejectedValue(new Error('network blip'));
    const { onChanged } = renderPanel([CHAIN_MAIL]);

    const equipBtn = screen.getByRole('button', { name: /^equip\b/i });
    fireEvent.click(equipBtn);
    await flush();

    expect(
      await screen.findByText("Couldn't refresh your sheet — reload to see the result."),
    ).toBeInTheDocument();
    // The mutate already happened server-side; must not report it as a mutate
    // failure (that copy would invite a real, redundant second equip attempt).
    expect(
      screen.queryByText('Could not equip Chain Mail. Try again in a moment.'),
    ).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    // No wedge: the button re-enables via the `finally` block.
    await waitFor(() => expect(equipBtn).toBeEnabled());
  });

  // The mandate explicitly asks whether this is proven for EVERY handler, not
  // just equip — runMutation is shared code, but each caller wires its own
  // mutateFailMessage/mutate fn, so a copy-paste slip in one of the other two
  // wire-ups (e.g. the wrong message re-used, or a caller accidentally NOT
  // routed through the shared shielded refetch) wouldn't be caught by the
  // equip-only proof above.
  it('unequip: refetch failure after a resolved unequipItem gets the warn toast, never the equip/unequip fail toast, and releases the latch', async () => {
    mockUnequip.mockResolvedValue({ message: '[DnD] Unequipped Longsword.' });
    mockGetSheet.mockRejectedValue(new Error('network blip'));
    const { onChanged } = renderPanel([SWORD]);

    const unequipBtn = screen.getByRole('button', { name: /^unequip\b/i });
    fireEvent.click(unequipBtn);
    await flush();

    expect(
      await screen.findByText("Couldn't refresh your sheet — reload to see the result."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Could not unequip Longsword. Try again in a moment.'),
    ).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    await waitFor(() => expect(unequipBtn).toBeEnabled());
  });

  it('give-item: refetch failure after a resolved giveItem gets the warn toast, never the give-item fail toast, releases the latch, and still clears the input', async () => {
    mockGiveItem.mockResolvedValue({ message: '[DnD] Added Torch.' });
    mockGetSheet.mockRejectedValue(new Error('network blip'));
    const { onChanged } = renderPanel([]);

    const input = screen.getByLabelText('Add an item');
    fireEvent.change(input, { target: { value: 'Torch' } });
    fireEvent.click(screen.getByRole('button', { name: /^add item$/i }));
    await flush();

    expect(
      await screen.findByText("Couldn't refresh your sheet — reload to see the result."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Could not add Torch. Try again in a moment.'),
    ).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('Add an item')).toBeEnabled());
  });
});

describe('InventoryPanel — busy-latch: unequip and give-item double-submit, and cross-handler serialization', () => {
  it('back-to-back clicks on Unequip in the same React batch call unequipItem only once', async () => {
    mockUnequip.mockResolvedValue({ message: 'ok' });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, inventory: [{ ...SWORD, equipped: false }] });
    renderPanel([SWORD]);

    const unequipBtn = screen.getByRole('button', { name: /^unequip\b/i });
    await act(async () => {
      fireEvent.click(unequipBtn);
      fireEvent.click(unequipBtn);
    });
    await flush();

    expect(mockUnequip).toHaveBeenCalledTimes(1);
  });

  it('back-to-back submits of the give-item form in the same React batch call giveItem only once', async () => {
    mockGiveItem.mockResolvedValue({ message: 'ok' });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, inventory: [] });
    renderPanel([]);

    const input = screen.getByLabelText('Add an item');
    fireEvent.change(input, { target: { value: 'Torch' } });
    const addBtn = screen.getByRole('button', { name: /^add item$/i });
    await act(async () => {
      fireEvent.click(addBtn);
      fireEvent.click(addBtn);
    });
    await flush();

    expect(mockGiveItem).toHaveBeenCalledTimes(1);
  });

  it('equip on one item and unequip on a DIFFERENT item fired in the same batch share the one ref: only the first dispatch mutates', async () => {
    mockEquip.mockResolvedValue({ message: 'ok' });
    mockUnequip.mockResolvedValue({ message: 'ok' });
    mockGetSheet.mockResolvedValue({
      ...BASE_SHEET,
      inventory: [{ ...CHAIN_MAIL, equipped: true }, { ...SWORD, equipped: false }],
    });
    renderPanel([CHAIN_MAIL, SWORD]);

    const equipBtn = screen.getByRole('button', { name: /^equip\b/i }); // Chain Mail
    const unequipBtn = screen.getByRole('button', { name: /^unequip\b/i }); // Longsword
    await act(async () => {
      fireEvent.click(equipBtn);
      fireEvent.click(unequipBtn);
    });
    await flush();

    // The shared ref is set synchronously on the FIRST dispatch (equip, DOM
    // order) before the second click's handler even checks it — the second
    // (unequip) must be a same-tick no-op. Proving the combined total is 1,
    // not just "each individually <= 1", is the actual cross-handler claim.
    const totalMutateCalls = mockEquip.mock.calls.length + mockUnequip.mock.calls.length;
    expect(totalMutateCalls).toBe(1);
    expect(mockEquip).toHaveBeenCalledTimes(1);
    expect(mockUnequip).not.toHaveBeenCalled();
  });

  it('releases the latch on a failed unequip mutate — a subsequent click tries again', async () => {
    mockUnequip.mockRejectedValueOnce(new Error('network blip'));
    mockUnequip.mockResolvedValueOnce({ message: 'ok' });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, inventory: [{ ...SWORD, equipped: false }] });
    renderPanel([SWORD]);

    const unequipBtn = screen.getByRole('button', { name: /^unequip\b/i });
    fireEvent.click(unequipBtn);
    await flush();
    expect(mockUnequip).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(unequipBtn).toBeEnabled());

    fireEvent.click(unequipBtn);
    await flush();
    expect(mockUnequip).toHaveBeenCalledTimes(2);
  });

  it('releases the latch on a failed give-item mutate — the form is usable again', async () => {
    mockGiveItem.mockRejectedValueOnce(new Error('network blip'));
    mockGiveItem.mockResolvedValueOnce({ message: 'ok' });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, inventory: [] });
    renderPanel([]);

    const input = screen.getByLabelText('Add an item');
    fireEvent.change(input, { target: { value: 'Torch' } });
    fireEvent.click(screen.getByRole('button', { name: /^add item$/i }));
    await flush();
    expect(mockGiveItem).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(screen.getByLabelText('Add an item')).toBeEnabled());

    fireEvent.change(screen.getByLabelText('Add an item'), { target: { value: 'Torch' } });
    fireEvent.click(screen.getByRole('button', { name: /^add item$/i }));
    await flush();
    expect(mockGiveItem).toHaveBeenCalledTimes(2);
  });
});

describe('InventoryPanel — soft-refusal / stale-state (unequip of an already-not-equipped item)', () => {
  // Engine ground truth (engine/equipment.py:513-573 unequip_item + routes/
  // characters.py _classify): "X is not currently equipped." contains neither
  // an _ERROR_PREFIXES match nor the substring "not found", so _classify
  // returns (is_error=False, is_not_found=False) and the route falls through
  // to `_ok({"message": result})` — a genuine 200/success envelope carrying a
  // REFUSAL message. From the wrapper's point of view (apiCall<{message}>)
  // this resolves, it never throws — so if the panel's own inventory prop
  // were stale (e.g. unequipped in another tab moments earlier, this page's
  // sheet not yet refreshed) and the user clicks Unequip anyway, `mutate()`
  // "succeeds" with a soft-refusal message the UI never reads. The only thing
  // that can prevent a lie here is the refetch-after-mutate: it must show the
  // refetched TRUTH (still equipped, e.g. someone re-equipped it before the
  // refetch resolved) rather than trusting the click's own optimistic intent.
  it('unequip resolves 200 with a soft-refusal message on a stale-equipped item; the UI trusts the REFETCHED truth, not the click, and does not wedge', async () => {
    mockUnequip.mockResolvedValue({ message: 'Longsword is not currently equipped.' });
    // Refetched sheet shows the item STILL equipped (ground truth never
    // changed) — proves the panel doesn't optimistically flip local state.
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, inventory: [{ ...SWORD, equipped: true }] });
    const { onChanged } = renderPanel([SWORD]);

    const unequipBtn = screen.getByRole('button', { name: /^unequip\b/i });
    fireEvent.click(unequipBtn);
    await flush();

    // No error toast — the wrapper resolved, this isn't the mutate-fail path.
    expect(
      screen.queryByText('Could not unequip Longsword. Try again in a moment.'),
    ).not.toBeInTheDocument();
    expect(mockGetSheet).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledWith(
      expect.objectContaining({ inventory: [expect.objectContaining({ equipped: true })] }),
    );
    // Not wedged: latch released, button usable again.
    await waitFor(() => expect(unequipBtn).toBeEnabled());
  });
});

describe('InventoryPanel — item with no dedicated equip-slot type (graceful, no crash)', () => {
  // The engine's equip_item/unequip_item (engine/equipment.py) impose NO
  // item_type restriction — armor/shield get special AC-recompute handling,
  // but ANY item_type (a potion, a quest item, an unrecognized future type)
  // can be marked equipped=TRUE with no server-side refusal. So the panel is
  // correct to render the same Equip/Unequip affordance uniformly; the only
  // client-side risk is the ITEM_ICON lookup on a shape ITEM_ICON doesn't
  // know about, which must fall back cleanly rather than throwing.
  const MYSTERY_ITEM: SheetInventoryItem = {
    name: 'Strange Trinket',
    item_type: 'quest', // not a key in ITEM_ICON
    sub: '',
    quantity: 1,
    equipped: false,
  };

  it('renders an unrecognized item_type with the Scroll fallback icon and a working Equip control, no crash', async () => {
    mockEquip.mockResolvedValue({ message: 'ok' });
    mockGetSheet.mockResolvedValue({
      ...BASE_SHEET,
      inventory: [{ ...MYSTERY_ITEM, equipped: true }],
    });
    renderPanel([MYSTERY_ITEM]);

    expect(screen.getByText('Strange Trinket')).toBeInTheDocument();
    const equipBtn = screen.getByRole('button', { name: /^equip\b/i });
    fireEvent.click(equipBtn);
    await flush();
    expect(mockEquip).toHaveBeenCalledWith('cid-1', 'leon', 'Strange Trinket');
  });
});
