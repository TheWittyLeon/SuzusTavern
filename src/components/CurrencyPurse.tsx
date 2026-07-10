'use client';
/**
 * CurrencyPurse — T12 (DDX-23t currency UI, character sheet).
 *
 * Displays a character's gold purse (`sheet.currency_gp`) and, owner-only,
 * a compact Spend affordance: one amount input + a Spend button. Mirrors
 * HpControl's conventions closely (this is the sibling "single-number
 * economy control" on the sheet): the shared synchronous `useRef` busy-latch,
 * apply-the-response-immediately-then-refetch pattern, per-control
 * aria-label, a success toast (a11y), aria-busy while in flight.
 *
 * POST /characters/:id/currency/spend returns the FULL post-mutation
 * balance (`{currency_gp, spent}`) — this component applies that to its own
 * local `gp` state immediately (moves the "🪙 N gp" line that same tick),
 * then ALSO refetches the whole sheet and hands it up via onChanged so every
 * other derived sheet field stays consistent, exactly like HpControl's own
 * two-step update.
 *
 * Refusals are mapped from the engine's structured `reason` code
 * (CURRENCY_REASON_STATUS — NekoNova-DnDEngine engine/currency.py:81-87)
 * rather than a generic message: `insufficient_funds` gets the engine's own
 * "has X gp, needs Y gp" message (already clean, human-readable, and more
 * useful than a static string here), everything else gets a static copy.
 */
import { useEffect, useRef, useState } from 'react';
import Button from '@/components/Button';
import { useToast } from '@/components/Toast';
import { spendCurrency, getCharacterSheet } from '@/lib/api/dnd';
import type { ApiError, CharacterSheet, SpendCurrencyResult } from '@/lib/api/types';
import styles from './CurrencyPurse.module.css';

/** Client-side amount cap — there is no engine-side Field bound on
 *  SpendCurrencyRequest.amount (a bare `int`), so this is a UX-only sane
 *  cap, chosen to match HpControl's HP_AMOUNT_MAX for consistency rather
 *  than mirroring an actual server-side limit. */
const GOLD_AMOUNT_MAX = 1_000_000;

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

/** Same body-shape probe as HpControl/ConditionsPanel's refusalReason. */
function refusalReason(e: ApiError): string | undefined {
  const body = e.body as { data?: { reason?: string }; message?: string } | null | undefined;
  return body?.data?.reason;
}

function spendErrorMessage(err: unknown): string {
  const fallback = 'Could not spend gold. Try again in a moment.';
  if (!isApiError(err)) return fallback;
  const reason = refusalReason(err);
  const body = err.body as { message?: string } | null | undefined;
  if (reason === 'insufficient_funds' && body?.message) return body.message;
  if (reason === 'invalid_amount') return 'Spend amount must be a positive integer.';
  return fallback;
}

export interface CurrencyPurseProps {
  characterId: string;
  username: string;
  /** Spend control only renders for the owner — mirrors HpControl's isOwner
   *  gate. A non-owner still sees the read-only purse display. */
  isOwner: boolean;
  currencyGp: number;
  /** Fired with the freshly-refetched sheet after a successful spend, so
   *  the parent page re-renders off the new state. */
  onChanged: (updated: CharacterSheet) => void;
}

export default function CurrencyPurse({
  characterId,
  username,
  isOwner,
  currencyGp,
  onChanged,
}: CurrencyPurseProps) {
  const { toast } = useToast();
  const [gp, setGp] = useState(currencyGp);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  /** Synchronous double-submit latch — see HpControl's header comment;
   *  React state can't close the same-tick double-click gap. */
  const mutationBusyRef = useRef(false);

  // Re-sync from the parent's sheet whenever it changes (our own refetch
  // landing, a DM grant landing on a later reload, an initial mount, etc.).
  useEffect(() => {
    setGp(currencyGp);
  }, [currencyGp]);

  // Digits-only also rejects sci-notation ("3e2") and decimals that Number()
  // would otherwise coerce past a bare Number.isInteger check — mirrors
  // HpControl's amountValid exactly.
  const parsedAmount = Number(amount);
  const amountValid =
    /^\d+$/.test(amount.trim()) && parsedAmount > 0 && parsedAmount <= GOLD_AMOUNT_MAX;

  async function handleSpend() {
    if (mutationBusyRef.current || !amountValid) return;
    mutationBusyRef.current = true;
    setBusy(true);
    const amt = parsedAmount;
    try {
      let res: SpendCurrencyResult;
      try {
        res = await spendCurrency(characterId, amt);
      } catch (err) {
        toast({ message: spendErrorMessage(err), tone: 'error' });
        return;
      }
      // Apply the authoritative response immediately — the purse moves
      // right now, no refetch wait required.
      setGp(res.currency_gp);
      setAmount('');
      try {
        const after = await getCharacterSheet(characterId, username);
        onChanged(after);
        toast({
          message: `Spent ${amt.toLocaleString()} gp. Purse now ${res.currency_gp.toLocaleString()} gp.`,
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
    }
  }

  return (
    <div className={styles.wrap} aria-busy={busy}>
      <div className={styles.head}>
        <span className={styles.label}>Purse</span>
        <span className={`mono ${styles.amountNum}`}>
          <span aria-hidden>🪙</span> {gp.toLocaleString()} gp
        </span>
      </div>
      {isOwner && (
        <div className={styles.controls}>
          <span id="gold-amount-hint" className="sr-only">
            Enter a whole number from 1 to 1,000,000
          </span>
          <input
            className={`input ${styles.input}`}
            type="number"
            inputMode="numeric"
            min={1}
            max={GOLD_AMOUNT_MAX}
            step={1}
            placeholder="Amount"
            aria-label="Gold amount"
            aria-describedby="gold-amount-hint"
            aria-invalid={amount.length > 0 && !amountValid}
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button
            variant="ghost"
            size="default"
            aria-label="Spend gold"
            aria-busy={busy}
            disabled={busy || !amountValid}
            onClick={() => void handleSpend()}
          >
            {busy ? 'Spending…' : 'Spend'}
          </Button>
        </div>
      )}
    </div>
  );
}
