'use client';
/**
 * HpControl — T5 (DDX-09 HP + spell-slots slice, character sheet).
 *
 * Owns the HP number + bar + "Down" indicator AND (owner-only) a compact
 * damage/heal affordance: one amount input feeding two buttons. Mirrors
 * InventoryPanel's conventions exactly: the shared synchronous `useRef`
 * busy-latch (set before await, released in `finally` on success AND error),
 * refetch-after-mutate via getCharacterSheet → onChanged, per-control
 * aria-label, a success toast (a11y), aria-busy while in flight.
 *
 * Live update without waiting on the refetch: POST /characters/:id/hp
 * returns the FULL post-mutation HP state (current_hp/max_hp/temp_hp/
 * is_down) — this component applies that response to its own local `hp`
 * state IMMEDIATELY (that's what moves the bar/number/Down pill the instant
 * the request resolves), then ALSO refetches the whole sheet and hands it up
 * via onChanged so every other derived field on the parent page (AC,
 * conditions, etc.) stays consistent — same refetch-after-mutate idiom as
 * InventoryPanel, just with an extra immediate-apply step first since the hp
 * endpoint (unlike equip/unequip/give-item) actually returns real numbers.
 * The `hp` prop re-syncs local state on every change (e.g. after the
 * refetch lands, or after an unrelated mutation like LevelUp changes max
 * HP) — see the sync effect below.
 *
 * `isDown` isn't a field CharacterSheet carries (the sheet's structured read
 * has no explicit is_down), so this component derives a starting guess from
 * `hp.current <= 0` and then overwrites it with the endpoint's authoritative
 * `is_down` on every successful mutation — the guess is only ever stale
 * between an external HP change (not through this control) and the next
 * sheet refetch, which is an acceptable, self-healing window.
 */
import { useRef, useState } from 'react';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import { useToast } from '@/components/Toast';
import { adjustHp, getCharacterSheet } from '@/lib/api/dnd';
import type { CharacterSheet, HpAdjustResult } from '@/lib/api/types';
import styles from './HpControl.module.css';

/** Client-side amount cap, mirroring the engine's ±1,000,000 HpAdjustRequest
 *  bound so an over-cap entry is refused with a clear affordance rather than a
 *  generic engine 400. */
const HP_AMOUNT_MAX = 1_000_000;

export interface HpControlProps {
  characterId: string;
  username: string;
  /** Damage/heal controls only render for the owner — mirrors
   *  InventoryPanel's isOwner gate. A non-owner still sees the read-only
   *  HP number + bar. */
  isOwner: boolean;
  hp: { current: number; max: number; temp: number };
  /** Fired with the freshly-refetched sheet after a successful mutation, so
   *  the parent page re-renders off the new state. */
  onChanged: (updated: CharacterSheet) => void;
}

export default function HpControl({ characterId, username, isOwner, hp, onChanged }: HpControlProps) {
  const { toast } = useToast();
  const [local, setLocal] = useState(hp);
  const [isDown, setIsDown] = useState(hp.current <= 0);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyOp, setBusyOp] = useState<'damage' | 'heal' | null>(null);
  /** Synchronous double-submit latch — see InventoryPanel's header comment;
   *  React state can't close the same-tick double-click gap. */
  const mutationBusyRef = useRef(false);

  // Re-sync from the parent's sheet whenever it changes (our own refetch
  // landing, a LevelUp changing max HP, an initial mount, etc.). Adjusted
  // during render (not an effect) per React's documented pattern for
  // "adjusting state when a prop changes" — avoids an extra render pass.
  const [prevHp, setPrevHp] = useState(hp);
  if (hp.current !== prevHp.current || hp.max !== prevHp.max || hp.temp !== prevHp.temp) {
    setPrevHp(hp);
    setLocal(hp);
    setIsDown(hp.current <= 0);
  }

  // Mirror the engine's ±1,000,000 amount cap (routes/characters.py HpAdjustRequest)
  // so an over-cap value is refused HERE with a clear affordance instead of round-
  // tripping to a generic 400 the player can't distinguish from a network blip.
  const parsedAmount = Number(amount);
  // Digits-only also rejects sci-notation ("3e2") and decimals that Number() would
  // otherwise coerce past a bare Number.isInteger check.
  const amountValid =
    /^\d+$/.test(amount.trim()) && parsedAmount > 0 && parsedAmount <= HP_AMOUNT_MAX;
  const hpPct = local.max > 0 ? Math.max(0, Math.min(100, (local.current / local.max) * 100)) : 0;

  async function applyHp(op: 'damage' | 'heal') {
    if (mutationBusyRef.current || !amountValid) return;
    mutationBusyRef.current = true;
    setBusy(true);
    setBusyOp(op);
    const amt = parsedAmount;
    try {
      let res: HpAdjustResult;
      try {
        res = await adjustHp(characterId, username, op, amt);
      } catch {
        toast({
          message:
            op === 'damage'
              ? 'Could not apply damage. Try again in a moment.'
              : 'Could not heal. Try again in a moment.',
          tone: 'error',
        });
        return;
      }
      // Apply the authoritative response immediately — the bar/number/Down
      // pill move right now, no refetch wait required.
      setLocal({ current: res.current_hp, max: res.max_hp, temp: res.temp_hp });
      const wasDown = isDown;
      setIsDown(res.is_down);
      setAmount('');
      try {
        const after = await getCharacterSheet(characterId, username);
        onChanged(after);
        // Announce success programmatically (a11y) — the bar move + Down pill are
        // visual-only, so screen-reader users need the toast's live-region. The
        // down/up TRANSITION is the most game-critical state this control can
        // produce, so fold it into the announcement rather than leaving a SR user
        // to re-navigate the HP block to discover it.
        const downNote =
          res.is_down && !wasDown
            ? ' You are down!'
            : wasDown && !res.is_down
              ? ' You are back up.'
              : '';
        toast({
          message: (op === 'damage' ? `Took ${amt} damage.` : `Healed ${amt}.`) + downNote,
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
      setBusyOp(null);
    }
  }

  return (
    <div className={styles.wrap} aria-busy={busy}>
      <div className={styles.hpHead}>
        <span className={styles.hpLabel} style={{ color: 'var(--good)' }}>
          HP
        </span>
        <span className={`mono ${styles.hpNum}`}>
          {local.current}/{local.max}
          {local.temp > 0 ? ` (+${local.temp})` : ''}
        </span>
        {isDown && <Pill tone="bad">Down</Pill>}
      </div>
      <div
        className={styles.hpBar}
        role="meter"
        aria-label={`Hit points ${local.current} of ${local.max}`}
        aria-valuenow={Math.max(0, local.current)}
        aria-valuemin={0}
        aria-valuemax={local.max}
      >
        <span className={styles.hpFill} style={{ width: `${hpPct}%` }} />
      </div>
      {isOwner && (
        <div className={styles.hpControls}>
          <span id="hp-amount-hint" className="sr-only">
            Enter a whole number from 1 to 1,000,000
          </span>
          <input
            className={`input ${styles.hpInput}`}
            type="number"
            inputMode="numeric"
            min={1}
            max={HP_AMOUNT_MAX}
            step={1}
            placeholder="Amount"
            aria-label="HP amount"
            aria-describedby="hp-amount-hint"
            aria-invalid={amount.length > 0 && !amountValid}
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button
            variant="ghost"
            size="default"
            aria-label="Apply damage"
            aria-busy={busy && busyOp === 'damage'}
            disabled={busy || !amountValid}
            onClick={() => void applyHp('damage')}
          >
            {busy && busyOp === 'damage' ? 'Applying…' : 'Damage'}
          </Button>
          <Button
            variant="ghost"
            size="default"
            aria-label="Apply healing"
            aria-busy={busy && busyOp === 'heal'}
            disabled={busy || !amountValid}
            onClick={() => void applyHp('heal')}
          >
            {busy && busyOp === 'heal' ? 'Healing…' : 'Heal'}
          </Button>
        </div>
      )}
    </div>
  );
}
