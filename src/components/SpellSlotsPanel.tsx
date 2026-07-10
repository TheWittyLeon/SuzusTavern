'use client';
/**
 * SpellSlotsPanel — T5 (DDX-09 HP + spell-slots slice, character sheet).
 *
 * Interactive spend/restore for a caster's spell slots, rendered as pips
 * (used vs max) per level. Mirrors InventoryPanel's conventions exactly: the
 * shared synchronous `useRef` busy-latch, refetch-after-mutate via
 * getCharacterSheet → onChanged, per-control aria-label, a success toast,
 * aria-busy on the in-flight row.
 *
 * Rendering the slot rows (heading, pips, count) was lifted verbatim out of
 * character/[id]/page.tsx (ST-058) — layout unchanged, spend/restore
 * controls are new.
 *
 * Non-casters render NOTHING (not an empty widget): `isCaster` mirrors the
 * sheet's own `is_spellcaster` flag, checked FIRST, before any slot-count
 * logic — so this is enforceable/testable even when the component is
 * mounted standalone. In the real app the parent page also gates the whole
 * Card wrapper on `sheet.is_spellcaster` (same split as InventoryPanel: the
 * parent owns the Card, this owns the content), so a non-caster's sheet
 * never mounts this component at all — the internal guard is a
 * defense-in-depth / unit-testable backstop, not the only line of defense.
 * A CASTER with zero non-zero slot levels (e.g. an edge-case level-1
 * half-caster) is a DIFFERENT case — that still renders the card head plus
 * an "no spell slots at this level yet" empty row, matching the pre-existing
 * copy from page.tsx.
 *
 * Uses the sheet's own `spell_slots` (already fetched via getCharacterSheet)
 * as the initial/synced data rather than a redundant GET on mount —
 * getSpellSlots is kept in dnd.ts for contract parity and any future
 * standalone-refresh call site, but the parent page always already holds a
 * fresh sheet.
 */
import { useEffect, useRef, useState } from 'react';
import Button from '@/components/Button';
import { useToast } from '@/components/Toast';
import { adjustSpellSlot, getCharacterSheet } from '@/lib/api/dnd';
import { ABILITIES } from '@/lib/dnd/helpers';
import type {
  CharacterSheet,
  SheetSpellcasting,
  SheetSpellSlot,
  SpellSlotsResult,
} from '@/lib/api/types';
import styles from './SpellSlotsPanel.module.css';

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export interface SpellSlotsPanelProps {
  characterId: string;
  username: string;
  /** Spend/restore controls only render for the owner — mirrors
   *  InventoryPanel's isOwner gate. A non-owner still sees the read-only
   *  pips. */
  isOwner: boolean;
  /** Mirrors the sheet's `is_spellcaster` — see the header comment. */
  isCaster: boolean;
  spellcasting: SheetSpellcasting | null;
  spellSlots: Record<string, SheetSpellSlot>;
  /** Fired with the freshly-refetched sheet after a successful mutation, so
   *  the parent page re-renders off the new state. */
  onChanged: (updated: CharacterSheet) => void;
}

export default function SpellSlotsPanel({
  characterId,
  username,
  isOwner,
  isCaster,
  spellcasting,
  spellSlots,
  onChanged,
}: SpellSlotsPanelProps) {
  const { toast } = useToast();
  const [slots, setSlots] = useState(spellSlots);
  const [busy, setBusy] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** Synchronous double-submit latch — see InventoryPanel's header comment. */
  const mutationBusyRef = useRef(false);

  // Re-sync from the parent's sheet whenever it changes (our own refetch
  // landing, an initial mount, etc.).
  useEffect(() => {
    setSlots(spellSlots);
  }, [spellSlots]);

  if (!isCaster) return null;

  const levels = Object.entries(slots).sort((a, b) => Number(a[0]) - Number(b[0]));

  async function adjust(level: number, op: 'spend' | 'restore') {
    const key = `${level}-${op}`;
    if (mutationBusyRef.current) return;
    mutationBusyRef.current = true;
    setBusy(true);
    setBusyKey(key);
    try {
      let res: SpellSlotsResult;
      try {
        res = await adjustSpellSlot(characterId, username, level, op);
      } catch {
        toast({
          message:
            op === 'spend'
              ? `Could not spend a level ${level} slot. Try again in a moment.`
              : `Could not restore a level ${level} slot. Try again in a moment.`,
          tone: 'error',
        });
        return;
      }
      // The adjust response is the ONE affected level (flat {level,max,
      // remaining,used}) — merge it into the by-level map for immediate pip
      // feedback; the refetch below then reconciles every level.
      setSlots((prev) => ({
        ...prev,
        [String(res.level)]: { max: res.max, used: res.used, remaining: res.remaining },
      }));
      try {
        const after = await getCharacterSheet(characterId, username);
        onChanged(after);
        // Announce success programmatically (a11y): the pip re-render is
        // visual-only, so screen-reader users need the toast's live-region.
        toast({
          message:
            op === 'spend'
              ? `Spent a level ${level} spell slot.`
              : `Restored a level ${level} spell slot.`,
          tone: 'success',
        });
      } catch {
        toast({
          message: "Couldn't refresh your sheet — reload to see the result.",
          tone: 'warn',
        });
      }
    } finally {
      mutationBusyRef.current = false;
      setBusy(false);
      setBusyKey(null);
    }
  }

  return (
    <>
      <div className={styles.cardHead}>
        <h3 className="label" style={{ margin: 0 }}>
          Spells
          {spellcasting
            ? ` · ${ABILITIES.find((a) => a.key === spellcasting.ability)?.abbr.toLowerCase() ?? ''} (DC ${spellcasting.save_dc})`
            : ''}
        </h3>
        {spellcasting && (
          <span className={`mono ${styles.castAtk}`}>atk {signed(spellcasting.attack_bonus)}</span>
        )}
      </div>
      {levels.length === 0 ? (
        <p className={styles.emptyRow}>No spell slots at this level yet.</p>
      ) : (
        <ul className={styles.slotList}>
          {levels.map(([lvl, slot]) => {
            const rowBusy = busy && busyKey?.startsWith(`${lvl}-`);
            const spendBusy = busy && busyKey === `${lvl}-spend`;
            const restoreBusy = busy && busyKey === `${lvl}-restore`;
            return (
              <li key={lvl} className={styles.slotRow} aria-busy={!!rowBusy}>
                <span className={styles.slotLvl} aria-hidden>
                  {lvl}
                </span>
                <span className={styles.slotLabel}>Level {lvl}</span>
                <span
                  className={styles.slotPips}
                  aria-label={`${slot.remaining} of ${slot.max} level ${lvl} slots remaining`}
                >
                  {Array.from({ length: slot.max }).map((_, i) => (
                    <span
                      key={i}
                      className={`${styles.pip} ${i < slot.remaining ? styles.pipOn : ''}`}
                      aria-hidden
                    />
                  ))}
                </span>
                <span className={`mono ${styles.slotCount}`}>
                  {slot.remaining}/{slot.max}
                </span>
                {isOwner && (
                  <div className={styles.slotBtns}>
                    <Button
                      variant="ghost"
                      size="default"
                      className={styles.slotBtn}
                      aria-label={`Spend a level ${lvl} spell slot`}
                      aria-busy={!!spendBusy}
                      disabled={busy || slot.remaining <= 0}
                      onClick={() => void adjust(Number(lvl), 'spend')}
                    >
                      {spendBusy ? '…' : 'Spend'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="default"
                      className={styles.slotBtn}
                      aria-label={`Restore a level ${lvl} spell slot`}
                      aria-busy={!!restoreBusy}
                      disabled={busy || slot.remaining >= slot.max}
                      onClick={() => void adjust(Number(lvl), 'restore')}
                    >
                      {restoreBusy ? '…' : 'Restore'}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
