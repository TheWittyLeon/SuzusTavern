'use client';
/**
 * ConditionsPanel — T7 (DDX-17e) DM-only condition apply/remove controls.
 *
 * Mounted only for the human DM seat during active combat (mirrors
 * DmNarrationPanel's/CastSpellPanel's own mount gate in the play page — same
 * spot in the layout). Owns two mutations against any combatant (PC or
 * monster): apply a condition with an optional duration, and remove one.
 *
 * The read-only chip display (visible to every client, including non-DM
 * players) lives in InitiativeTracker via ConditionChipList — this panel
 * additionally renders each combatant's current conditions as REMOVABLE
 * chips (the DM-only affordance: "an x on the chip"), plus the apply form.
 *
 * Conventions mirrored from CastSpellPanel/InventoryPanel:
 *   - one shared synchronous `mutationBusyRef` gates BOTH apply and remove
 *     (same "one latch serializes all mutating actions in this component"
 *     tradeoff InventoryPanel documents — sub-second mutations, acceptable).
 *   - `onBusyChange` raises/lowers the parent's shared combat-busy latch
 *     (same as CastSpellPanel) so the attack/dodge/dash rail is disabled
 *     while a condition mutation is in flight.
 *   - success toast (a11y — the chip update is otherwise visual-only),
 *     aria-busy on the panel root, aria-label per control, disabled-while-busy.
 *   - `onStateRefresh` re-GETs CombatState so chips update live, exactly like
 *     CastSpellPanel's own contract — even though this route's response
 *     already carries `data.state` directly (unlike /spells/cast), a fresh
 *     poll stays the single source of truth and catches any other concurrent
 *     change (e.g. a round-boundary auto-expiry tick) the snapshot might miss.
 *
 * `target` is resolved by the engine via case-insensitive NAME match (see
 * ApplyConditionRequest's doc comment in lib/api/types.ts) — this panel looks
 * up the chosen participant_id back to its `.name` before sending.
 */
import { useEffect, useId, useRef, useState } from 'react';
import ConditionChipList from '@/components/ConditionChipList';
import { useToast } from '@/components/Toast';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import { applyCondition, removeCondition } from '@/lib/api/dnd';
import { DND_CONDITIONS, formatConditionName } from '@/lib/conditions';
import type { ApiError, CombatParticipantState } from '@/lib/api/types';
import styles from './ConditionsPanel.module.css';

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

/** Same body-shape probe as CastSpellPanel's refusalReason. */
function refusalReason(e: ApiError): string | undefined {
  const body = e.body as { data?: { reason?: string }; reason?: string } | null | undefined;
  return body?.data?.reason ?? body?.reason ?? e.code;
}

// Deterministic refusals, sourced from engine.combat.COMBAT_REASON_STATUS +
// cmd_apply_condition/cmd_remove_condition's own reasons.
const CONDITION_REFUSAL_COPY: Record<string, string> = {
  no_combat: 'No active combat.',
  invalid_condition: "That condition isn't recognized.",
  target_not_found: 'That target could not be found.',
  not_found: 'Combat or session not found.',
};

function refusalMessage(err: unknown, fallback: string): string {
  if (!isApiError(err)) return fallback;
  const reason = refusalReason(err);
  return CONDITION_REFUSAL_COPY[reason ?? ''] ?? fallback;
}

export interface ConditionsPanelProps {
  combatId: string;
  /** Included as `username` on the request body for the engine's log line
   *  (cmd_apply_condition/cmd_remove_condition log `dm_username`, informational
   *  only — the proxy does NOT auto-inject it the way override/npc-action do). */
  dmUsername: string;
  participants: CombatParticipantState[];
  disabled?: boolean;
  /** Fired with the result message so the parent appends it to the shared log. */
  onApplied: (message: string) => void;
  /** Called after a successful apply/remove so the parent re-GETs CombatState. */
  onStateRefresh: () => void;
  /** Raises/lowers the parent's shared combat-busy latch (mirrors CastSpellPanel). */
  onBusyChange?: (busy: boolean) => void;
}

export default function ConditionsPanel({
  combatId,
  dmUsername,
  participants,
  disabled = false,
  onApplied,
  onStateRefresh,
  onBusyChange,
}: ConditionsPanelProps) {
  const { toast } = useToast();
  const uid = useId();

  const [targetId, setTargetId] = useState(participants[0]?.participant_id ?? '');
  const [condition, setCondition] = useState<string>(DND_CONDITIONS[0]);
  const [durationText, setDurationText] = useState('');

  // A11Y (Iro MAJOR): row-focus-restore target for handleRemove — mirrors
  // SpellbookPanel's rowRefs Map (keyed here by participant_id rather than
  // spell slug). Removing the LAST condition on a combatant drops that row
  // out of `affected` entirely (the row unmounts), so handleRemove falls
  // back to the Target <select> in that case — see its success path below.
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const [busy, setBusy] = useState(false);
  /** Synchronous double-submit latch — see InventoryPanel/CastSpellPanel's
   *  header comments for why plain `busy` state isn't enough on its own.
   *  One latch serializes apply AND remove (deliberate simplicity, mirrors
   *  InventoryPanel's single mutationBusyRef gating all mutating actions). */
  const mutationBusyRef = useRef(false);

  // Keep the target selector valid as the participant list changes (a downed
  // combatant leaving/joining, or the very first render before any state).
  useEffect(() => {
    if (participants.length === 0) {
      if (targetId !== '') setTargetId('');
      return;
    }
    if (!participants.some((p) => p.participant_id === targetId)) {
      setTargetId(participants[0].participant_id);
    }
  }, [participants, targetId]);

  const durationTrimmed = durationText.trim();
  const durationValue = durationTrimmed === '' ? undefined : Number(durationTrimmed);
  const durationInvalid =
    durationTrimmed !== '' &&
    (!Number.isInteger(durationValue) || (durationValue as number) <= 0 || (durationValue as number) > 1000);

  const targetParticipant = participants.find((p) => p.participant_id === targetId) ?? null;
  const applyDisabled = busy || disabled || !targetParticipant || durationInvalid;

  async function handleApply() {
    if (applyDisabled || !targetParticipant || mutationBusyRef.current) return;
    mutationBusyRef.current = true;
    setBusy(true);
    onBusyChange?.(true);
    const label = formatConditionName(condition);
    try {
      let res;
      try {
        res = await applyCondition({
          combat_id: combatId,
          target: targetParticipant.name,
          condition,
          ...(durationValue != null ? { duration_rounds: durationValue } : {}),
          ...(dmUsername ? { username: dmUsername } : {}),
        });
      } catch (err) {
        toast({
          message: refusalMessage(err, `Couldn't apply ${label}. Try again.`),
          tone: 'error',
        });
        return;
      }
      onApplied(res.message ?? `Applied ${label} to ${targetParticipant.name}.`);
      onStateRefresh();
      setDurationText('');
      toast({
        message: `Applied ${label} to ${targetParticipant.name}${
          durationValue != null ? ` (${durationValue} round${durationValue === 1 ? '' : 's'})` : ''
        }.`,
        tone: 'success',
      });
    } finally {
      mutationBusyRef.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  async function handleRemove(participant: CombatParticipantState, cond: string) {
    if (busy || disabled || mutationBusyRef.current) return;
    mutationBusyRef.current = true;
    setBusy(true);
    onBusyChange?.(true);
    const label = formatConditionName(cond);
    try {
      let res;
      try {
        res = await removeCondition({
          combat_id: combatId,
          target: participant.name,
          condition: cond,
          ...(dmUsername ? { username: dmUsername } : {}),
        });
      } catch (err) {
        toast({
          message: refusalMessage(err, `Couldn't remove ${label}. Try again.`),
          tone: 'error',
        });
        return;
      }
      onApplied(res.message ?? `Removed ${label} from ${participant.name}.`);
      onStateRefresh();
      toast({ message: `Removed ${label} from ${participant.name}.`, tone: 'success' });
      // A11Y (Iro MAJOR): the remove button that was just clicked either
      // stays put (the affected row survives, other conditions remain) or
      // unmounts entirely — this was the combatant's last condition, so the
      // whole row drops out of `affected` once onStateRefresh's refetch
      // lands. Restore focus to the row in the first case; fall back to the
      // Target select in the second (mirrors SpellbookPanel's row-vs.-unmount
      // focus-restore split). requestAnimationFrame gives the parent's
      // refetch-driven rerender a tick to land before we query for the row.
      const rowWillUnmount = participant.conditions.length <= 1;
      requestAnimationFrame(() => {
        if (rowWillUnmount) {
          document.getElementById(`${uid}-target`)?.focus();
        } else {
          rowRefs.current.get(participant.participant_id)?.focus();
        }
      });
    } finally {
      mutationBusyRef.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  const affected = participants.filter((p) => p.conditions.length > 0);

  return (
    <div className={styles.panel} aria-busy={busy}>
      <p className={styles.panelLabel}>
        <Icon name="Pulse" size={12} aria-hidden /> Conditions
      </p>
      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${uid}-target`}>
            Target
          </label>
          <select
            id={`${uid}-target`}
            className={styles.select}
            value={targetId}
            disabled={busy || disabled || participants.length === 0}
            onChange={(e) => setTargetId(e.target.value)}
          >
            {participants.map((p) => (
              <option key={p.participant_id} value={p.participant_id}>
                {p.name} (HP {p.hp_current}/{p.hp_max})
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${uid}-condition`}>
            Condition
          </label>
          <select
            id={`${uid}-condition`}
            className={styles.select}
            value={condition}
            disabled={busy || disabled}
            onChange={(e) => setCondition(e.target.value)}
          >
            {DND_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {formatConditionName(c)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${uid}-duration`}>
            Duration (rounds)
          </label>
          <input
            id={`${uid}-duration`}
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            step={1}
            placeholder="indefinite"
            className={styles.input}
            value={durationText}
            disabled={busy || disabled}
            aria-invalid={durationInvalid || undefined}
            aria-describedby={`${uid}-duration-hint`}
            onChange={(e) => setDurationText(e.target.value)}
          />
        </div>
        <Button
          variant="primary"
          size="default"
          className={styles.applyBtn}
          aria-label={
            targetParticipant
              ? `Apply ${formatConditionName(condition)} to ${targetParticipant.name}`
              : `Apply ${formatConditionName(condition)}`
          }
          aria-busy={busy}
          disabled={applyDisabled}
          onClick={() => void handleApply()}
        >
          {busy ? '…' : 'Apply'}
        </Button>
      </div>
      {durationInvalid && (
        <p id={`${uid}-duration-hint`} className={styles.hint} role="alert">
          Duration must be a whole number of rounds (1-1000), or blank for indefinite.
        </p>
      )}
      {affected.length === 0 ? (
        <p className={styles.emptyRow}>No active conditions.</p>
      ) : (
        <div className={styles.affectedList}>
          {affected.map((p) => (
            <div
              key={p.participant_id}
              ref={(el) => {
                rowRefs.current.set(p.participant_id, el);
              }}
              className={styles.affectedRow}
              tabIndex={-1}
            >
              <span className={styles.affectedName}>{p.name}</span>
              <ConditionChipList
                conditions={p.conditions}
                durations={p.condition_durations}
                combatantName={p.name}
                onRemove={(c) => void handleRemove(p, c)}
                removeDisabled={busy || disabled}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
