'use client';
/**
 * InventoryPanel — T5 / DDX-09 inventory slice (character sheet).
 *
 * Interactive equip/unequip (+ self-service give-item) for a character's
 * inventory. Rendering the item rows was lifted verbatim out of
 * character/[id]/page.tsx (ST-057) — behavior is new, layout is not.
 *
 * AC lives on the PARENT sheet (identity card), not here — the engine's
 * equip/unequip/give-item routes all resolve to `{message: string}`
 * (routes/characters.py: equip_item/unequip_item/give_item all
 * `return _ok({"message": result})`, mirroring the DDX-10/DDX-25
 * apiCall<Character> misannotation bug fixed in dnd.ts — see the contract
 * note on equipItem/unequipItem/giveItem there), NEVER a recomputed `ac`
 * field. AC "recompute live" is therefore refetch-after-mutate: on a
 * successful mutation this panel re-fetches the whole sheet via
 * getCharacterSheet and hands it up through onChanged, exactly like
 * LevelUpButton's onLeveledUp — the parent page's `ac` (and this panel's own
 * `equipped` pills) re-render off that fresh sheet.
 *
 * Busy-latch: all three mutating actions (equip, unequip, give-item) share
 * ONE synchronous useRef gate (mirrors LevelUpButton's D1 fix / the
 * DDX-10/DDX-25 sessionActionBusyRef pattern) — a same-tick double click on
 * any control is a no-op, not a double-submit. The whole panel operates on
 * one character row, so serializing every mutation through a single latch
 * (rather than a latch per item) is simpler and still correct: equip/unequip
 * on DIFFERENT items while one is in flight is refused too, not just repeats
 * of the same click — acceptable here since a mutation typically resolves in
 * well under a second and the alternative (per-item latches) buys nothing but
 * complexity for a same-character sheet.
 */
import { useRef, useState, type FormEvent } from 'react';
import Button from '@/components/Button';
import Icon, { type IconName } from '@/components/Icon';
import Pill from '@/components/Pill';
import { useToast } from '@/components/Toast';
import { equipItem, unequipItem, giveItem, getCharacterSheet } from '@/lib/api/dnd';
import type { CharacterSheet, SheetInventoryItem } from '@/lib/api/types';
import styles from './InventoryPanel.module.css';

const ITEM_ICON: Record<string, IconName> = {
  weapon: 'Sword',
  armor: 'Shield',
  shield: 'Shield',
  potion: 'Potion',
  tool: 'Scroll',
  gear: 'Scroll',
};

export interface InventoryPanelProps {
  characterId: string;
  username: string;
  /** Equip/unequip/give-item controls only render for the owner — mirrors
   *  LevelUpButton's isOwner gate and the engine's own OWNER-auth on these
   *  three routes. A non-owner still sees the read-only item list. */
  isOwner: boolean;
  inventory: SheetInventoryItem[];
  inventoryWeight: number;
  /** Fired with the freshly-refetched sheet after a successful mutation, so
   *  the parent page (and its AC display) re-renders off the new state. */
  onChanged: (updated: CharacterSheet) => void;
}

export default function InventoryPanel({
  characterId,
  username,
  isOwner,
  inventory,
  inventoryWeight,
  onChanged,
}: InventoryPanelProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');
  /** Synchronous double-submit latch — see the header comment. React state
   *  (`busy`) can't close the same-tick double-click gap because both
   *  dispatches read it before either re-render commits. */
  const mutationBusyRef = useRef(false);

  /**
   * Shared mutate → refetch-after-mutate runner for equip/unequip/give-item.
   * Mirrors LevelUpButton's confirmLevelUp: the mutate and the refetch get
   * separate try/catch blocks (D2) so a refetch failure after a successful
   * mutate gets its own non-retry copy, since the mutate already happened
   * server-side by that point.
   */
  async function runMutation(
    itemLabel: string,
    mutate: () => Promise<unknown>,
    mutateFailMessage: string,
    successMessage: string,
  ): Promise<boolean> {
    if (mutationBusyRef.current) return false;
    mutationBusyRef.current = true;
    setBusy(true);
    setBusyItem(itemLabel);
    try {
      try {
        await mutate();
      } catch {
        toast({ message: mutateFailMessage, tone: 'error' });
        return false;
      }
      try {
        const after = await getCharacterSheet(characterId, username);
        onChanged(after);
        // Announce success programmatically (a11y): the equipped Pill + AC/weight
        // re-render are visual-only, so screen-reader users need the toast's
        // live-region announcement. Mirrors LevelUpButton's success signal.
        toast({ message: successMessage, tone: 'success' });
      } catch {
        toast({
          message: "Couldn't refresh your sheet — reload to see the result.",
          tone: 'warn',
        });
      }
      // The mutation itself succeeded (a refetch blip doesn't undo the write).
      return true;
    } finally {
      mutationBusyRef.current = false;
      setBusy(false);
      setBusyItem(null);
    }
  }

  async function toggleEquip(item: SheetInventoryItem) {
    if (item.equipped) {
      await runMutation(
        item.name,
        () => unequipItem(characterId, username, item.name),
        `Could not unequip ${item.name}. Try again in a moment.`,
        `${item.name} unequipped.`,
      );
    } else {
      await runMutation(
        item.name,
        () => equipItem(characterId, username, item.name),
        `Could not equip ${item.name}. Try again in a moment.`,
        `${item.name} equipped.`,
      );
    }
  }

  async function handleGiveItem(e: FormEvent) {
    e.preventDefault();
    const name = newItemName.trim();
    if (!name || mutationBusyRef.current) return;
    const added = await runMutation(
      `__give__${name}`,
      () => giveItem(characterId, username, name),
      `Could not add ${name}. Try again in a moment.`,
      `Added ${name} to your inventory.`,
    );
    // Keep the typed name on failure so the user can retry without retyping.
    if (added) setNewItemName('');
  }

  return (
    <>
      <div className={styles.cardHead}>
        {/* TAV-SHEET-HEADING-ORDER: h2 — this component is only rendered as a
            top-level sibling section on the character sheet (character/[id]/
            page.tsx), alongside its own h2 "Skills"/"Saving throws" etc. */}
        <h2 className="label" style={{ margin: 0 }}>
          Inventory · weight {inventoryWeight} lb
        </h2>
      </div>
      {inventory.length === 0 ? (
        <p className={styles.emptyRow}>Nothing in the pack yet.</p>
      ) : (
        <ul className={styles.itemList}>
          {inventory.map((it, i) => {
            const rowBusy = busy && busyItem === it.name;
            return (
              <li key={`${it.name}-${i}`} className={styles.itemRow} aria-busy={rowBusy}>
                <span className={styles.itemIcon} aria-hidden>
                  <Icon name={ITEM_ICON[it.item_type] ?? 'Scroll'} size={16} />
                </span>
                <span className={styles.itemMeta}>
                  <span className={styles.itemName}>
                    {it.name}
                    {it.equipped && (
                      <Pill tone="good" className={styles.equipPill}>
                        equipped
                      </Pill>
                    )}
                  </span>
                  {it.sub && <span className={`mono ${styles.itemSub}`}>{it.sub}</span>}
                </span>
                <span className={`mono ${styles.itemQty}`}>×{it.quantity}</span>
                {isOwner && (
                  <Button
                    variant="ghost"
                    size="default"
                    className={styles.equipBtn}
                    disabled={busy}
                    aria-label={`${it.equipped ? 'Unequip' : 'Equip'} ${it.name}`}
                    onClick={() => void toggleEquip(it)}
                  >
                    {rowBusy
                      ? it.equipped
                        ? 'Unequipping…'
                        : 'Equipping…'
                      : it.equipped
                        ? 'Unequip'
                        : 'Equip'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {isOwner && (
        <form className={styles.giveItemForm} onSubmit={(e) => void handleGiveItem(e)}>
          <input
            className={`input ${styles.giveItemInput}`}
            type="text"
            placeholder="Add an item…"
            aria-label="Add an item"
            maxLength={60}
            value={newItemName}
            disabled={busy}
            onChange={(e) => setNewItemName(e.target.value)}
          />
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            aria-label="Add item"
            disabled={busy || !newItemName.trim()}
          >
            <Icon name="Plus" size={14} />
          </Button>
        </form>
      )}
    </>
  );
}
