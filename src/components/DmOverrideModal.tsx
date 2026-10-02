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
 * The engine enforces the DM-seat check server-side as an existence oracle
 * (WF-I, 2026-08-14): a combat that doesn't exist and a combat that exists
 * but isn't yours both refuse identically — 404 reason='combat_not_found'.
 * Pre-WF-I engines/proxies could still emit 400 reason='not_dm'; that branch
 * is kept below as a harmless legacy fallback.
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
import ConfirmDialog from '@/components/ConfirmDialog';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import styles from './DmOverrideModal.module.css';

const DAMAGE_TYPES = [
  'slashing', 'piercing', 'bludgeoning',
  'fire', 'cold', 'lightning', 'thunder', 'acid',
  'poison', 'necrotic', 'radiant', 'psychic', 'force',
];

// debt: mirrors the engine's OverrideDamagePayload bound (le=999). ceiling: the Tavern refuses a value the engine would accept if the engine's bound is raised. until: the wire carries the bound or the engine's bound changes (Backlog TAV-OVERRIDE-HP-BOUND-MIRROR).
const OVERRIDE_HP_MAX = 999;

/** Why New HP was refused — one message per cause, so none is false. */
const NEW_HP_REFUSAL = {
  erased: "New HP is empty. Enter the target's HP after this damage.",
  notWhole: `New HP must be a whole number from 0 to ${OVERRIDE_HP_MAX}.`,
  tooBig: `New HP can't be more than ${OVERRIDE_HP_MAX}.`,
  unknown: "This target's HP isn't known, so New HP can't be filled in. Enter it yourself.",
} as const;

type NewHpParse =
  | { ok: true; value: number }
  | { ok: false; why: keyof typeof NEW_HP_REFUSAL };

/**
 * Parse the New HP field. What the DM sees is what is sent: no clamping, so
 * anything that is not a whole number 0..OVERRIDE_HP_MAX is refused with its
 * own message. `edited` = the DM has typed in the field (vs. the derived
 * suggestion), which tells "erased" from "target HP unknown".
 */
function parseNewHp(text: string, edited: boolean): NewHpParse {
  const t = text.trim();
  if (t === '') return { ok: false, why: edited ? 'erased' : 'unknown' };
  if (!/^\d+$/.test(t)) return { ok: false, why: 'notWhole' };
  const v = parseInt(t, 10);
  return v > OVERRIDE_HP_MAX ? { ok: false, why: 'tooBig' } : { ok: true, value: v };
}

const DEGREE_OPTIONS: Array<{ value: OverrideCheckOutcome['degree']; label: string }> = [
  { value: 'crit_failure', label: 'Critical Failure' },
  { value: 'failure', label: 'Failure' },
  { value: 'success', label: 'Success' },
  { value: 'crit_success', label: 'Critical Success' },
];

/**
 * Engine refusal codes → readable copy (WF-B reason-map convention — mirrors
 * DmNarrationPanel's refusalCopy / GrantCurrencyPanel's GRANT_REFUSAL_COPY).
 * Codes not listed here fall back to the engine's own message, or a generic
 * string if none is present (see handleSubmit's catch block).
 *
 * combat_not_found (WF-I, 2026-08-14): the engine's DM-seat check is now an
 * existence oracle — a combat that doesn't exist and a combat that exists
 * but isn't yours return the SAME 404/combat_not_found response, so this
 * copy must not imply either state specifically.
 * not_dm (400) is a legacy fallback for pre-WF-I engines/proxies; harmless
 * now that combat_not_found is the primary code.
 */
const OVERRIDE_REFUSAL_COPY: Record<string, string> = {
  combat_not_found: "That combat can't be overridden — it may have ended, or you may not be its DM.",
  not_dm: 'Only the DM can submit overrides.',
  combat_not_active: 'Combat is not active.',
  actor_not_found: 'Selected actor not found in combat.',
  target_not_found: 'Selected target not found in combat.',
};

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
  // New HP the DM typed by hand, as the raw input string. null = untouched, in
  // which case the field FOLLOWS `target.hp_current - damageDealt` (see
  // derivedNewHp below). Never defaults to 0: the engine reads target_new_hp as
  // "is this target down", so a silent 0 downs a PC / deactivates a monster.
  const [newHpEdit, setNewHpEdit] = useState<string | null>(null);
  // Second step for New HP = 0 — rendered as a ConfirmDialog over this form.
  const [confirmZero, setConfirmZero] = useState(false);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Which field the current error belongs to (drives aria-invalid /
  // aria-describedby). 'form' = a notice about no particular field (a poll
  // changed something); engine refusals and 'Reason is required' stay on Reason.
  const [errorField, setErrorField] = useState<'reason' | 'target' | 'newHp' | 'form'>('reason');
  // Bumped on every refusal so an identical repeated message remounts the
  // role="alert" node and is announced again.
  const [errorAttempt, setErrorAttempt] = useState(0);

  // Refs for focus management
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const newHpRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLSelectElement>(null);
  const sendInFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const focusErrorNext = useRef(false);

  const refuse = (message: string, field: 'reason' | 'target' | 'newHp' | 'form') => {
    setSubmitError(message);
    setErrorField(field);
    setErrorAttempt((n) => n + 1);
  };

  // After a failed send the Apply button is disabled and the confirm (if any)
  // has unmounted, so focus would fall to <body> and Tab would leave the modal.
  // Park it on the error instead: it is read out and focus stays inside the trap.
  useEffect(() => {
    if (focusErrorNext.current && submitError) {
      focusErrorNext.current = false;
      errorRef.current?.focus();
    }
  }, [submitError, errorAttempt]);

  // Target and New HP are derived from what the Target select can actually
  // show: a target that is the Actor, or no longer alive, is not selected.
  const targetOptions = participants.filter(
    (p) => p.is_alive && p.participant_id !== actorId,
  );
  const target = targetOptions.find((p) => p.participant_id === targetId);
  const targetHp =
    typeof target?.hp_current === 'number' && Number.isFinite(target.hp_current)
      ? target.hp_current
      : null;
  const derivedNewHp = targetHp === null ? '' : String(Math.max(0, targetHp - damageDealt));
  const newHpText = newHpEdit ?? derivedNewHp;
  const newHpParsed = parseNewHp(newHpText, newHpEdit !== null);
  const newHp = newHpParsed.ok ? newHpParsed.value : null;

  // The confirm is only ever shown for the value that will be sent. If a poll
  // (or an edit) moves the resolved New HP off 0 while it is up, it closes and
  // nothing is sent; the DM re-applies. Render-time adjustment, not an effect.
  const zeroResolved = kind === 'damage' && newHp === 0;
  if (confirmZero && !zeroResolved) {
    setConfirmZero(false);
    // Say so (alert box, focus untouched). If the target itself vanished, the
    // target notice below speaks instead.
    if (target) {
      refuse(
        newHp === null
          ? `${target.name}'s HP changed. Review New HP and apply again.`
          : `${target.name}'s HP changed. New HP is now ${newHp}. Review and apply again.`,
        'form',
      );
    }
  }
  // A target that left the select (became the Actor, or died in a poll) is
  // cleared, and a hand-typed New HP for it is released.
  if (targetId !== (target?.participant_id ?? '')) {
    if (kind === 'attack' || kind === 'damage') {
      const gone = participants.find((p) => p.participant_id === targetId);
      refuse(`${gone?.name ?? 'The target'} is no longer a valid target. Pick another.`, 'form');
    }
    setTargetId('');
    setNewHpEdit(null);
  }

  // Initialise actor when modal opens or participants change
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const initial = defaultActorId ?? participants[0]?.participant_id ?? '';
    // Bundled with real DOM focus management (activeElement capture, deferred
    // focus, restore-on-close below) — genuine effect territory, not a render
    // concern; can't move to a render-time adjustment without splitting the
    // focus/timeout side effects apart from the state reset.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    setNewHpEdit(null);
    setConfirmZero(false);

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
      if (e.key === 'Escape') {
        // TAV-A11Y-USE-ESCAPE-CONSUME-HOOK (was a hand-rolled UIR2-TAV-11 r2
        // fix): stopPropagation is unconditional. handleClose() already
        // no-ops while submitting, so the busy gate still applies to the
        // actual close.
        consumeEscape(e, { onClose: handleClose });
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
    [handleClose],
  );

  const buildOutcome = (): OverrideAttackOutcome | OverrideCheckOutcome => {
    if (kind === 'attack') {
      const out: OverrideAttackOutcome = { hit, critical_hit: criticalHit };
      if (hit) {
        out.damage = [{ amount: damageAmount, type: damageType }];
      }
      return out;
    }
    const out: OverrideCheckOutcome = { success, degree, total };
    return out;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // While the zero-confirm is up only ITS button may send; a second form
    // submit (Enter key-repeat, two Enters in one tick) must not skip the gate.
    if (submitting || confirmZero) return;
    if (!reason.trim()) {
      refuse('Reason is required.', 'reason');
      return;
    }
    if ((kind === 'attack' || kind === 'damage') && !target) {
      refuse('Target is required for attack and damage overrides.', 'target');
      targetRef.current?.focus();
      return;
    }
    if (kind === 'damage') {
      if (!newHpParsed.ok) {
        refuse(NEW_HP_REFUSAL[newHpParsed.why], 'newHp');
        newHpRef.current?.focus();
        return;
      }
      if (newHpParsed.value === 0) {
        setSubmitError(null);
        setConfirmZero(true);
        return;
      }
    }
    void send(false);
  };

  const send = async (zeroConfirmed: boolean) => {
    // A redundant second gate (handleSubmit already refuses these), reading the
    // same render's values: damage may only go out with a valid New HP, and 0
    // only from the confirm button.
    if (kind === 'damage' && (!newHpParsed.ok || (newHpParsed.value === 0 && !zeroConfirmed))) {
      setConfirmZero(false);
      return;
    }
    // In-flight latch: two confirm clicks in one batch share a closure where
    // `submitting` is still false.
    if (sendInFlight.current) return;
    sendInFlight.current = true;
    setConfirmZero(false);
    setSubmitting(true);
    setSubmitError(null);

    try {
      const result = await submitOverride(combatId, {
        kind,
        actor_id: actorId,
        target_id: (kind === 'attack' || kind === 'damage') ? target?.participant_id ?? null : null,
        outcome:
          kind === 'damage' && newHpParsed.ok
            ? { damage_dealt: damageDealt, target_new_hp: newHpParsed.value, raw_damage: damageDealt } satisfies OverrideDamageOutcome
            : buildOutcome(),
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

      focusErrorNext.current = true;
      if (engineReason === 'override_malformed') {
        refuse(`Override refused: ${engineMessage ?? 'shape invalid'}`, 'reason');
      } else {
        refuse(
          OVERRIDE_REFUSAL_COPY[engineReason ?? '']
          ?? engineMessage
          ?? 'Override failed. Check the values and try again.',
          'reason',
        );
      }
    } finally {
      sendInFlight.current = false;
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const activeParticipants = participants.filter((p) => p.is_alive);
  const confirmOpen = confirmZero && zeroResolved;
  const errorId = `${uid}-error`;
  const hintId = `${uid}-newhp-hint`;
  const needsTarget = kind === 'attack' || kind === 'damage';

  return (
    <>
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
        // The zero-confirm is a second modal on top: nothing underneath may take
        // focus, pointer or AT attention while it is up.
        inert={confirmOpen || undefined}
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

        <form onSubmit={handleSubmit} noValidate>
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
                ref={targetRef}
                value={target?.participant_id ?? ''}
                disabled={submitting}
                aria-invalid={(submitError && errorField === 'target') || undefined}
                aria-describedby={submitError && errorField === 'target' ? errorId : undefined}
                onChange={(e) => {
                    setTargetId(e.target.value);
                    // A hand-typed New HP was for the previous target; release it.
                    setNewHpEdit(null);
                  }}
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
                        max={OVERRIDE_HP_MAX}
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
                    max={OVERRIDE_HP_MAX}
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
                    ref={newHpRef}
                    type="number"
                    className={styles.numInput}
                    min={0}
                    max={OVERRIDE_HP_MAX}
                    value={newHpText}
                    disabled={submitting}
                    aria-invalid={(submitError && errorField === 'newHp') || undefined}
                    aria-describedby={
                      submitError && errorField === 'newHp' ? `${hintId} ${errorId}` : hintId
                    }
                    onChange={(e) => {
                      setNewHpEdit(e.target.value);
                      // The DM is fixing it: drop the stale invalid state.
                      if (errorField === 'newHp') setSubmitError(null);
                    }}
                  />
                  <span id={hintId} className={styles.hint}>
                    Fills in as current HP minus damage dealt. Type to set it yourself.
                  </span>
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
              aria-invalid={(submitError && errorField === 'reason') || undefined}
              aria-describedby={submitError && errorField === 'reason' ? errorId : undefined}
              onChange={(e) => setReason(e.target.value)}
            />
            <span className={styles.charCount} aria-hidden>
              {reason.length}/500
            </span>
          </div>

          {/* Inline error */}
          {submitError && (
            <div
              key={errorAttempt}
              id={errorId}
              ref={errorRef}
              tabIndex={-1}
              className={styles.error}
              role="alert"
              aria-live="assertive"
            >
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
    {/* Escape and backdrop clicks stay on the confirm because ConfirmDialog
        consumes its own Escape (consumeEscape) and only treats a click as
        dismiss when target === currentTarget; the sibling placement is just
        tidy, not what protects them. */}
    <ConfirmDialog
      open={confirmOpen}
      role="alertdialog"
      tone="danger"
      title="Drop to 0 HP?"
      body={`This drops ${target?.name ?? 'the target'} to 0 HP.`}
      confirmLabel="Drop to 0 HP"
      onConfirm={() => void send(true)}
      onCancel={() => setConfirmZero(false)}
    />
    </>
  );
}
