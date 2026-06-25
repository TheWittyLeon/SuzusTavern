'use client';
/**
 * DmOverrideModal (S5.4) — DM fiat/override modal.
 *
 * Launched from a "DM Override" button on the DM panel. Allows the human DM to
 * post a typed override outcome to POST /api/dnd/combat/{id}/override.
 *
 * Per-kind outcome fields:
 *   attack  — hit, critical_hit, damage_amount, damage_type
 *   check   — success, degree, total
 *   save    — success, degree, total
 *   damage  — damage_dealt, target_new_hp
 *
 * On success: calls onSuccess with the resolved applied.message + new state.
 * On {success:false}: surfaces engine message inline; keeps modal open.
 * On network error: surfaces a generic message inline; keeps modal open.
 *
 * Security: this component is only rendered when isDm && dm_mode==='human'.
 * The engine enforces the DM-seat check server-side (reason='not_dm').
 * Do NOT add client-side filtering of override events — the server filters via
 * dm_override_player_visible. The client renders whatever events the BFF returns.
 *
 * Focus trap + Esc + backdrop-click follow the same pattern as ConfirmDialog.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { submitOverride } from '@/lib/api/dnd';
import type {
  CombatParticipantState,
  OverrideKind,
  OverrideAttackOutcome,
  OverrideCheckOutcome,
  OverrideDamageOutcome,
} from '@/lib/api/types';
import styles from './DmOverrideModal.module.css';

const DAMAGE_TYPES = [
  'slashing', 'piercing', 'bludgeoning',
  'fire', 'cold', 'lightning', 'thunder', 'acid',
  'poison', 'necrotic', 'radiant', 'psychic', 'force',
];

const DEGREE_OPTIONS: Array<{ value: OverrideCheckOutcome['degree']; label: string }> = [
  { value: 'crit_failure', label: 'Critical Failure' },
  { value: 'failure', label: 'Failure' },
  { value: 'success', label: 'Success' },
  { value: 'crit_success', label: 'Critical Success' },
];

export interface DmOverrideModalProps {
  open: boolean;
  combatId: string;
  /** All active participants (used for actor + target dropdowns). */
  participants: CombatParticipantState[];
  /** Default actor participant_id (e.g. current turn holder). */
  defaultActorId?: string | null;
  onSuccess: (message: string, state: import('@/lib/api/types').CombatState | undefined) => void;
  onClose: () => void;
}

export default function DmOverrideModal({
  open,
  combatId,
  participants,
  defaultActorId,
  onSuccess,
  onClose,
}: DmOverrideModalProps) {
  const uid = useId();
  const titleId = `${uid}-title`;

  // Form state
  const [kind, setKind] = useState<OverrideKind>('attack');
  const [actorId, setActorId] = useState<string>('');
  const [targetId, setTargetId] = useState<string>('');
  const [reason, setReason] = useState('');

  // Attack fields
  const [hit, setHit] = useState(true);
  const [criticalHit, setCriticalHit] = useState(false);
  const [damageAmount, setDamageAmount] = useState<number>(0);
  const [damageType, setDamageType] = useState('slashing');

  // Check/save fields
  const [success, setSuccess] = useState(true);
  const [degree, setDegree] = useState<OverrideCheckOutcome['degree']>('success');
  const [total, setTotal] = useState<number>(10);

  // Damage fields
  const [damageDealt, setDamageDealt] = useState<number>(0);
  const [targetNewHp, setTargetNewHp] = useState<number>(0);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Refs for focus management
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Initialise actor when modal opens or participants change
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const initial = defaultActorId ?? participants[0]?.participant_id ?? '';
    setActorId(initial);
    setTargetId('');
    setReason('');
    setSubmitError(null);
    setSubmitting(false);
    // Reset outcome fields to sensible defaults
    setKind('attack');
    setHit(true);
    setCriticalHit(false);
    setDamageAmount(0);
    setDamageType('slashing');
    setSuccess(true);
    setDegree('success');
    setTotal(10);
    setDamageDealt(0);
    setTargetNewHp(0);

    const t = setTimeout(() => {
      (firstFocusRef.current as HTMLElement | null)?.focus();
    }, 0);
    return () => {
      clearTimeout(t);
      previouslyFocused.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  // Focus trap within the dialog
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        e.stopPropagation();
        handleClose();
        return;
      }
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [submitting, handleClose],
  );

  const buildOutcome = ():
    | OverrideAttackOutcome
    | OverrideCheckOutcome
    | OverrideDamageOutcome => {
    if (kind === 'attack') {
      const out: OverrideAttackOutcome = { hit, critical_hit: criticalHit };
      if (hit) {
        out.damage = [{ amount: damageAmount, type: damageType }];
      }
      return out;
    }
    if (kind === 'check' || kind === 'save') {
      const out: OverrideCheckOutcome = { success, degree, total };
      return out;
    }
    // damage
    return { damage_dealt: damageDealt, target_new_hp: targetNewHp, raw_damage: damageDealt } satisfies OverrideDamageOutcome;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!reason.trim()) {
      setSubmitError('Reason is required.');
      return;
    }
    if ((kind === 'attack' || kind === 'damage') && !targetId) {
      setSubmitError('Target is required for attack and damage overrides.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const result = await submitOverride(combatId, {
        kind,
        actor_id: actorId,
        target_id: (kind === 'attack' || kind === 'damage') ? targetId || null : null,
        outcome: buildOutcome(),
        reason: reason.trim(),
      });

      // result is the data envelope (apiCall unwraps success.data).
      const message = (result as { applied?: { message?: string } })?.applied?.message
        ?? 'DM override applied.';
      const newState = (result as { state?: import('@/lib/api/types').CombatState })?.state;
      onSuccess(message, newState);
    } catch (err) {
      // ApiError: {status, code, body}
      const body = (err as { body?: unknown })?.body;
      const engineMessage =
        (body as { message?: string } | null)?.message ??
        (body as { data?: { message?: string } } | null)?.data?.message ??
        null;
      const engineReason =
        (body as { data?: { reason?: string } } | null)?.data?.reason ?? null;

      if (engineReason === 'override_malformed') {
        setSubmitError(`Override refused: ${engineMessage ?? 'shape invalid'}`);
      } else if (engineReason === 'not_dm') {
        setSubmitError('Only the DM can submit overrides.');
      } else if (engineReason === 'combat_not_active') {
        setSubmitError('Combat is not active.');
      } else if (engineReason === 'actor_not_found') {
        setSubmitError('Selected actor not found in combat.');
      } else if (engineReason === 'target_not_found') {
        setSubmitError('Selected target not found in combat.');
      } else {
        setSubmitError(engineMessage ?? 'Override failed. Check the values and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const activeParticipants = participants.filter((p) => p.is_alive);
  const targetOptions = activeParticipants.filter((p) => p.participant_id !== actorId);
  const needsTarget = kind === 'attack' || kind === 'damage';

  return (
    <div
      ref={backdropRef}
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) handleClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.dialog}
        onKeyDown={onKeyDown}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            DM Override
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Close override modal"
            disabled={submitting}
            onClick={handleClose}
          >
            ✕
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          {/* Kind radio */}
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Override kind</legend>
            <div className={styles.kindRadios} role="radiogroup" aria-label="Override kind">
              {(['attack', 'check', 'save', 'damage'] as OverrideKind[]).map((k) => (
                <label key={k} className={styles.radioLabel}>
                  <input
                    ref={k === 'attack' ? (el) => { firstFocusRef.current = el; } : undefined}
                    type="radio"
                    name="override-kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => {
                      setKind(k);
                      setSubmitError(null);
                    }}
                    className={styles.radioInput}
                  />
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                </label>
              ))}
            </div>
          </fieldset>

          {/* Actor */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${uid}-actor`}>
              Actor
            </label>
            <select
              id={`${uid}-actor`}
              className={styles.select}
              value={actorId}
              disabled={submitting}
              onChange={(e) => setActorId(e.target.value)}
            >
              {activeParticipants.map((p) => (
                <option key={p.participant_id} value={p.participant_id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Target — only for attack + damage */}
          {needsTarget && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${uid}-target`}>
                Target <span className={styles.required} aria-hidden>*</span>
              </label>
              <select
                id={`${uid}-target`}
                className={styles.select}
                value={targetId}
                disabled={submitting}
                onChange={(e) => setTargetId(e.target.value)}
                required
              >
                <option value="">— pick target —</option>
                {targetOptions.map((p) => (
                  <option key={p.participant_id} value={p.participant_id}>
                    {p.name} (HP {p.hp_current}/{p.hp_max})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Outcome fields — per kind */}
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Outcome</legend>

            {(kind === 'attack') && (
              <div className={styles.outcomeGrid}>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={hit}
                    disabled={submitting}
                    onChange={(e) => setHit(e.target.checked)}
                  />
                  Hit
                </label>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={criticalHit}
                    disabled={submitting || !hit}
                    onChange={(e) => setCriticalHit(e.target.checked)}
                  />
                  Critical hit
                </label>
                {hit && (
                  <>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`${uid}-dmg-amount`}>
                        Damage amount
                      </label>
                      <input
                        id={`${uid}-dmg-amount`}
                        type="number"
                        className={styles.numInput}
                        min={0}
                        max={999}
                        value={damageAmount}
                        disabled={submitting}
                        onChange={(e) => setDamageAmount(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`${uid}-dmg-type`}>
                        Damage type
                      </label>
                      <select
                        id={`${uid}-dmg-type`}
                        className={styles.select}
                        value={damageType}
                        disabled={submitting}
                        onChange={(e) => setDamageType(e.target.value)}
                      >
                        {DAMAGE_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
              </div>
            )}

            {(kind === 'check' || kind === 'save') && (
              <div className={styles.outcomeGrid}>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={success}
                    disabled={submitting}
                    onChange={(e) => {
                      setSuccess(e.target.checked);
                      setDegree(e.target.checked ? 'success' : 'failure');
                    }}
                  />
                  Success
                </label>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`${uid}-degree`}>
                    Degree
                  </label>
                  <select
                    id={`${uid}-degree`}
                    className={styles.select}
                    value={degree}
                    disabled={submitting}
                    onChange={(e) => setDegree(e.target.value as OverrideCheckOutcome['degree'])}
                  >
                    {DEGREE_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`${uid}-total`}>
                    Total
                  </label>
                  <input
                    id={`${uid}-total`}
                    type="number"
                    className={styles.numInput}
                    min={-20}
                    max={50}
                    value={total}
                    disabled={submitting}
                    onChange={(e) => setTotal(parseInt(e.target.value, 10) || 0)}
                  />
                </div>
              </div>
            )}

            {kind === 'damage' && (
              <div className={styles.outcomeGrid}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`${uid}-dmg-dealt`}>
                    Damage dealt
                  </label>
                  <input
                    id={`${uid}-dmg-dealt`}
                    type="number"
                    className={styles.numInput}
                    min={0}
                    max={999}
                    value={damageDealt}
                    disabled={submitting}
                    onChange={(e) => setDamageDealt(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`${uid}-target-hp`}>
                    Target new HP
                  </label>
                  <input
                    id={`${uid}-target-hp`}
                    type="number"
                    className={styles.numInput}
                    min={0}
                    max={999}
                    value={targetNewHp}
                    disabled={submitting}
                    onChange={(e) => setTargetNewHp(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  />
                </div>
              </div>
            )}
          </fieldset>

          {/* Reason */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${uid}-reason`}>
              Reason <span className={styles.required} aria-hidden>*</span>
            </label>
            <textarea
              id={`${uid}-reason`}
              className={styles.textarea}
              rows={2}
              maxLength={500}
              placeholder="Why are you overriding this outcome?"
              value={reason}
              disabled={submitting}
              required
              aria-required="true"
              aria-describedby={submitError ? `${uid}-error` : undefined}
              onChange={(e) => setReason(e.target.value)}
            />
            <span className={styles.charCount} aria-hidden>
              {reason.length}/500
            </span>
          </div>

          {/* Inline error */}
          {submitError && (
            <div id={`${uid}-error`} className={styles.error} role="alert" aria-live="assertive">
              {submitError}
            </div>
          )}

          {/* Actions */}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelBtn}
              disabled={submitting}
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={submitting || !reason.trim()}
              aria-busy={submitting || undefined}
              aria-label={submitting ? 'Submitting override…' : undefined}
            >
              {submitting ? 'Applying…' : 'Apply override'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
