'use client';
/**
 * GrantCurrencyPanel — T12 (DDX-23t currency UI, DM-only, play page).
 *
 * Lets the session DM grant gold to a chosen party member's character.
 * Session-scoped (needs `session_id` + `character_id`), not combat-scoped —
 * mounted alongside the "Session controls" group (Pause/Resume/End/Award XP)
 * rather than ConditionsPanel's combat-only spot, since a DM should be able
 * to grant gold whether or not combat is active. Gated on the SAME `isDm`
 * check the play page already uses for Award XP (not `isHumanDM` — granting
 * gold is a session-economy action available to any DM seat, human or
 * AI-assisted table, exactly like Award XP).
 *
 * Self-contained (owns its own form state + busy-latch + toast), mirroring
 * ConditionsPanel's "component owns its own mutation" convention rather than
 * threading through the page's `sessionActionBusy` union — this keeps the
 * page.tsx diff to an import + one mount block.
 *
 * Only participants with a BOUND character are offered as grant targets
 * (`p.character?.character_id != null`) — there is nothing to grant to
 * otherwise. Response carries the TARGET character's fresh balance
 * (`{currency_gp, granted}`); this panel doesn't hold that character's
 * sheet, so it surfaces the new balance in the success toast rather than
 * updating any local display — the target player's own sheet page picks up
 * the change on its own next load/refetch (this codebase has no cross-client
 * live sheet sync; see the T12 handoff report for the caveat).
 */
import { useId, useRef, useState } from 'react';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { grantCurrency } from '@/lib/api/dnd';
import type { ApiError, Participant } from '@/lib/api/types';
import styles from './GrantCurrencyPanel.module.css';

/** UX-only sane cap — GrantCurrencyRequest.gold has no Pydantic Field bound
 *  on the engine (a bare int); mirrors HpControl/CurrencyPurse's convention
 *  for consistency, not an actual mirrored server-side limit. */
const GOLD_AMOUNT_MAX = 1_000_000;

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

function refusalReason(e: ApiError): string | undefined {
  const body = e.body as { data?: { reason?: string } } | null | undefined;
  return body?.data?.reason;
}

// Deterministic grant_currency_route refusals (engine owns every rule — see
// NekoNova-DnDEngine routes/sessions.py::grant_currency_route's docstring).
// `not_dm` never actually appears on the wire — guard_dm fails closed with
// reason='not_found' (no oracle distinguishing "not the DM" from "character
// not found"), same as the engine's own doc comment notes.
const GRANT_REFUSAL_COPY: Record<string, string> = {
  invalid_amount: 'Grant amount must be a positive integer.',
  balance_cap: 'That would exceed the maximum allowed balance.',
  session_not_found: 'Session not found — reload and try again.',
  not_found: "That character isn't seated at this table.",
};

function grantErrorMessage(err: unknown): string {
  const fallback = 'Could not grant gold. Try again in a moment.';
  if (!isApiError(err)) return fallback;
  const reason = refusalReason(err);
  return GRANT_REFUSAL_COPY[reason ?? ''] ?? fallback;
}

export interface GrantCurrencyPanelProps {
  sessionId: string;
  participants: Participant[];
  disabled?: boolean;
}

export default function GrantCurrencyPanel({
  sessionId,
  participants,
  disabled = false,
}: GrantCurrencyPanelProps) {
  const { toast } = useToast();
  const uid = useId();

  const targets = participants.filter((p) => p.character?.character_id != null);

  const [targetId, setTargetId] = useState(
    targets[0]?.character?.character_id != null ? String(targets[0].character.character_id) : '',
  );
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  /** Synchronous double-submit latch — see HpControl/InventoryPanel's header
   *  comments for why plain `busy` state alone can't close the same-tick
   *  double-click gap. */
  const mutationBusyRef = useRef(false);

  // Keep the target selector valid as the participant list changes (a rebind
  // dropping/adding a bound character, or the very first render). Adjusted
  // during render (not an effect) per React's documented pattern for
  // "adjusting state when a prop changes" — mirrors ConditionsPanel's own
  // target-selector-sync. Re-derives ids from `targets` (itself filtered from
  // `participants`) so this only needs to compare the `participants` reference.
  const [prevParticipants, setPrevParticipants] = useState(participants);
  if (participants !== prevParticipants) {
    setPrevParticipants(participants);
    const ids = targets.map((p) => String(p.character?.character_id));
    if (ids.length === 0) {
      if (targetId !== '') setTargetId('');
    } else if (!ids.includes(targetId)) {
      setTargetId(ids[0]);
    }
  }

  const parsedAmount = Number(amount);
  const amountValid =
    /^\d+$/.test(amount.trim()) && parsedAmount > 0 && parsedAmount <= GOLD_AMOUNT_MAX;
  const targetParticipant =
    targets.find((p) => String(p.character?.character_id) === targetId) ?? null;
  const grantDisabled = busy || disabled || !targetParticipant || !amountValid;

  async function handleGrant() {
    if (grantDisabled || !targetParticipant?.character?.character_id || mutationBusyRef.current) {
      return;
    }
    mutationBusyRef.current = true;
    setBusy(true);
    const gold = parsedAmount;
    const characterId = String(targetParticipant.character.character_id);
    const targetLabel = targetParticipant.character.name ?? targetParticipant.username;
    try {
      let res;
      try {
        res = await grantCurrency(sessionId, characterId, gold);
      } catch (err) {
        toast({ message: grantErrorMessage(err), tone: 'error' });
        return;
      }
      setAmount('');
      toast({
        message: `Granted ${gold.toLocaleString()} gp to ${targetLabel} (now ${res.currency_gp.toLocaleString()} gp).`,
        tone: 'success',
      });
    } finally {
      mutationBusyRef.current = false;
      setBusy(false);
    }
  }

  if (targets.length === 0) {
    return (
      <div className={styles.panel}>
        <p className={styles.panelLabel}>
          <Icon name="Sparkle" size={12} aria-hidden /> Grant gold
        </p>
        <p className={styles.emptyRow}>No characters seated yet to grant gold to.</p>
      </div>
    );
  }

  return (
    <div className={styles.panel} aria-busy={busy}>
      <p className={styles.panelLabel}>
        <Icon name="Sparkle" size={12} aria-hidden /> Grant gold
      </p>
      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${uid}-target`}>
            Character
          </label>
          <select
            id={`${uid}-target`}
            className={styles.select}
            value={targetId}
            disabled={busy || disabled}
            onChange={(e) => setTargetId(e.target.value)}
          >
            {targets.map((p) => (
              <option key={p.username} value={String(p.character?.character_id)}>
                {p.character?.name ?? p.username}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${uid}-amount`}>
            Gold
          </label>
          <span id={`${uid}-amount-hint`} className="sr-only">
            Enter a whole number from 1 to 1,000,000
          </span>
          <input
            id={`${uid}-amount`}
            className={styles.input}
            type="number"
            inputMode="numeric"
            min={1}
            max={GOLD_AMOUNT_MAX}
            step={1}
            aria-describedby={`${uid}-amount-hint`}
            aria-invalid={amount.length > 0 && !amountValid}
            value={amount}
            disabled={busy || disabled}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <Button
          variant="primary"
          size="default"
          className={styles.grantBtn}
          aria-label={targetParticipant ? `Grant gold to ${targetParticipant.character?.name ?? targetParticipant.username}` : 'Grant gold'}
          aria-busy={busy}
          disabled={grantDisabled}
          onClick={() => void handleGrant()}
        >
          {busy ? '…' : 'Grant'}
        </Button>
      </div>
    </div>
  );
}
