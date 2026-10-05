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
 *   revive  — restore a fallen PC: sent as the damage override with
 *             target_new_hp > 0 on a dead PC (the engine's restore path); the
 *             wire kind stays 'damage'. Openable from elsewhere via
 *             initialKind / initialTargetId.
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
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { submitOverride } from '@/lib/api/dnd';
import { isFightHeld } from '@/lib/dnd/combatState';
import type {
  CombatParticipantState,
  CombatState,
  OverrideKind,
  OverrideAttackOutcome,
  OverrideCheckOutcome,
  OverrideDamageOutcome,
  SubmitOverrideRequest,
} from '@/lib/api/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import { useScrimDismiss } from '@/lib/a11y/useScrimDismiss';
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

/** The dialog's kinds: the wire's OverrideKind plus 'revive', which is sent as a 'damage' override. */
type DialogKind = OverrideKind | 'revive';
const KIND_ORDER: DialogKind[] = ['attack', 'check', 'save', 'damage', 'revive'];
const REVIVE_ONLY: DialogKind[] = ['revive'];
/** A held fight with a character still standing (the engine's heal-resume): the dialog lists every player character and the title says what the DM is doing. */
const RESUME_TITLE = 'Resume the fight';
const RESUME_STALE = 'The fight is already going again. Nothing was sent.';
/** The engine's sentence for a non-revive override on a held fight; the fallback when the refusal carries none. */
const HELD_REFUSAL_COPY = 'The fight is waiting for the DM: revive a character or end the combat.';

/** Revive: HP the character comes back with. Whole number 1..max (a revive to 0 is not a revive). */
/** The HP field's name, ONE lookup for the label and for every refusal that names the field (they drifted apart once: "HP after resuming" over "Restore to HP must be..."). Keyed by what the
 *  pick is: no pick yet in a Resume dialog, or a character standing, is a resume; a fallen one is a revive. */
const HP_FIELD = { resume: 'HP after resuming', revive: 'Restore to HP' } as const;
function parseReviveHp(text: string, max: number, field: string): { ok: true; value: number } | { ok: false; message: string } {
  const t = text.trim();
  if (t === '') return { ok: false, message: `${field} is empty. Enter 1 to ${max}.` };
  if (!/^\d+$/.test(t)) return { ok: false, message: `${field} must be a whole number from 1 to ${max}.` };
  const v = parseInt(t, 10);
  if (v < 1 || v > max) return { ok: false, message: `${field} must be between 1 and ${max}.` };
  return { ok: true, value: v };
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
  /** Open on this kind instead of Attack (e.g. 'revive' from the Revive… opener). */
  initialKind?: DialogKind;
  /** Preselect this participant (revive: the fallen character). */
  initialTargetId?: string | null;
  /** The fight is held (every character fallen, or waiting on the DM): the engine takes only an override that leaves a player character above 0 HP, so only that is offered (Revive,
   *  and with a character still standing, Resume) and the dialog opens on it, whatever the opener asked for. A fight that BECOMES held under an open dialog switches it over. The page
   *  derives this; the dialog does not read the wire. */
  held?: boolean;
  /** HP each PC was last seen alive with (this tab) — Revive's default. */
  lastAliveHp?: Readonly<Record<string, number>>;
  /** Re-poll the combat state (Revive's empty case). */
  onRefresh?: () => void;
  /** Where focus goes on close when the opener is no longer in the page (e.g.
   *  the Revive… button unmounts once nobody is fallen). Asked at close time,
   *  so it returns the LATEST node. */
  fallbackFocus?: () => HTMLElement | null | undefined;
}

export default function DmOverrideModal({
  open,
  combatId,
  participants,
  defaultActorId,
  onSuccess,
  onClose,
  initialKind,
  initialTargetId,
  held = false,
  lastAliveHp,
  onRefresh,
  fallbackFocus,
}: DmOverrideModalProps) {
  // Held: Revive is the whole list, and the only place the dialog may open.
  const kinds = held ? REVIVE_ONLY : KIND_ORDER;
  const openKind = held ? 'revive' : initialKind;
  const uid = useId();
  const titleId = `${uid}-title`;

  // Form state
  const [kind, setKind] = useState<DialogKind>('attack');
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
  // Revive: the HP the DM typed (null = untouched, follows the default).
  const [reviveHpEdit, setReviveHpEdit] = useState<string | null>(null);
  // Second step for New HP = 0 — rendered as a ConfirmDialog over this form.
  const [confirmZero, setConfirmZero] = useState(false);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Which field the current error belongs to (drives aria-invalid /
  // aria-describedby). 'form' = a notice about no particular field (a poll
  // changed something); engine refusals and 'Reason is required' stay on Reason.
  const [errorField, setErrorField] = useState<'reason' | 'target' | 'newHp' | 'reviveHp' | 'form'>('reason');
  // Bumped on every refusal so an identical repeated message remounts the
  // role="alert" node and is announced again.
  const [errorAttempt, setErrorAttempt] = useState(0);

  // Refs for focus management
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const newHpRef = useRef<HTMLInputElement>(null);
  const reviveHpRef = useRef<HTMLInputElement>(null);
  // Set on open when opened as Revive; consumed by the layout effect below once
  // the field to focus actually exists (see there).
  const pendingReviveFocus = useRef(false);
  const [, setFocusTick] = useState(0);
  const targetRef = useRef<HTMLSelectElement>(null);
  const sendInFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const focusErrorNext = useRef(false);

  const refuse = (message: string, field: 'reason' | 'target' | 'newHp' | 'reviveHp' | 'form') => {
    setSubmitError(message);
    setErrorField(field);
    setErrorAttempt((n) => n + 1);
  };

  // A poll-driven status line. Unlike refuse() it does not bump errorAttempt:
  // the alert is keyed on that, so a bump would remount the node and drop focus
  // to <body> if a failed send had parked it there.
  const notice = (message: string) => {
    setSubmitError(message);
    setErrorField('form');
  };

  // After a failed send the Apply button is disabled and the confirm (if any)
  // has unmounted, so focus would fall to <body> and Tab would leave the modal.
  // Park it on the error instead: it is read out and focus stays inside the trap.
  useEffect(() => {
    if (focusErrorNext.current && submitError) {
      focusErrorNext.current = false;
      errorRef.current?.focus();
    }
    // errorAttempt pairs with key={errorAttempt} on the alert: every remount
    // re-runs this focus check, even when the message text is unchanged.
  }, [submitError, errorAttempt]);

  // Target and New HP are derived from what the Target select can actually
  // show: a target that is the Actor, or no longer alive, is not selected.
  const targetOptions = participants.filter(
    (p) => p.is_alive && p.participant_id !== actorId,
  );
  // A fight that turned held under an open dialog: the only kind the engine will take is Revive (render-time adjustment, like the target reset below).
  if (held && kind !== 'revive') {
    setKind('revive');
    setTargetId('');
    setNewHpEdit(null);
    setReviveHpEdit(null);
  }
  const isRevive = kind === 'revive';
  // Held with a character still standing: the engine accepts an override that leaves ANY player character above 0 HP, so the list is every player character (display only; the
  // engine's refusal is the authority) and the form is "Resume the fight". Otherwise Revive lists the fallen only (the engine's revive predicate: a dead PC); a chosen character
  // a poll has since shown alive stays selectable so Apply can refuse it by name instead of silently dropping it.
  const resumeMode = held && participants.some((p) => p.is_pc && p.is_alive);
  const fallen = participants.filter((p) => p.is_pc && (resumeMode || !p.is_alive));
  const target = isRevive
    ? participants.find((p) => p.is_pc && p.participant_id === targetId)
    : targetOptions.find((p) => p.participant_id === targetId);
  const reviveOptions =
    target && target.is_alive && !fallen.includes(target) ? [...fallen, target] : fallen;
  const reviveMax = target ? Math.min(OVERRIDE_HP_MAX, Math.max(1, Math.floor(target.hp_max) || 1)) : 1;
  const lastAlive = target ? lastAliveHp?.[target.participant_id] : undefined;
  // A character still standing resumes at the HP they have (setting it to that changes nothing); a fallen one comes back with what they had before they fell, else 1.
  const resuming = isRevive && held && !!target?.is_alive;
  const standingHp = typeof target?.hp_current === 'number' && Number.isFinite(target.hp_current) ? Math.floor(target.hp_current) : null;
  // (a standing character at 0 HP defaults to 1, and one above their max to the max: neither default is their current HP, and the hint then says the range instead of "changes nothing")
  const reviveDefault = resuming && standingHp !== null
    ? Math.min(Math.max(1, standingHp), reviveMax)
    : typeof lastAlive === 'number' && Number.isFinite(lastAlive) && lastAlive >= 1
      ? Math.min(Math.floor(lastAlive), reviveMax)
      : 1;
  const reviveHpText = reviveHpEdit ?? (target ? String(reviveDefault) : '');
  // The HP field's kind: a living pick is a resume, a fallen one a revive, and with no pick yet it is whatever the dialog is (Resume the fight, or Revive).
  const hpKind: keyof typeof HP_FIELD = (target ? target.is_alive && held : resumeMode) ? 'resume' : 'revive';
  const reviveParsed = parseReviveHp(reviveHpText, reviveMax, HP_FIELD[hpKind]);
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
    if (open && target) {
      notice(
        newHp === null
          ? `${target.name}'s HP changed. Review New HP and apply again.`
          : `${target.name}'s HP changed. New HP is now ${newHp}. Review and apply again.`,
      );
    }
  }
  // Revive with exactly one fallen character preselects them.
  if (isRevive && !targetId && fallen.length === 1) {
    setTargetId(fallen[0].participant_id);
  }
  // A target that left the select (became the Actor, or died in a poll) is
  // cleared, and a hand-typed New HP for it is released.
  if (targetId !== (target?.participant_id ?? '')) {
    // Not while the hold is switching this dialog over to Revive: the target who just fell is about to be preselected, and "no longer a valid target" beside them is false.
    if (open && !(held && kind !== 'revive') && (kind === 'attack' || kind === 'damage' || kind === 'revive')) {
      const gone = participants.find((p) => p.participant_id === targetId);
      notice(`${gone?.name ?? 'The target'} is no longer a valid target. Pick another.`);
    }
    setTargetId('');
    setNewHpEdit(null);
  }

  // Revive focus-on-open. The HP field only exists after the open effect has
  // switched `kind` to 'revive' and the single fallen character is preselected,
  // which is a LATER render than the one that opened the dialog; a setTimeout(0)
  // raced that render and WebKit lost (focus stayed behind the dialog). So this
  // runs after commits and acts on the FIRST one after the open effect armed it,
  // exactly once, whether or not the field is there. Who and how much come
  // first: the Character select when there is a choice, else the HP field
  // (selected so typing replaces it); with nobody fallen there is no field, so
  // the dialog itself takes focus and Escape and the Tab trap work.
  useLayoutEffect(() => {
    if (!open || !pendingReviveFocus.current) return;
    pendingReviveFocus.current = false;
    if (kind !== 'revive') return;
    const choose = fallen.length > 1 && !initialTargetId;
    const el = choose ? targetRef.current : reviveHpRef.current;
    if (!el) {
      dialogRef.current?.focus({ preventScroll: true });
      return;
    }
    el.focus({ preventScroll: true });
    if (!choose) reviveHpRef.current?.select();
  });

  // The fight turns HELD under an open dialog (another tab's override): the kinds shrink to Revive, so the radio that held focus unmounts and focus would fall to <body>.
  // Put it on the Revive radio. Focus that is still inside the dialog (the Reason box, say) is left where it is.
  const wasHeldRef = useRef(held);
  // The dialog turns into "Resume the fight" while open (a character stands up in a poll): the kind radios go with it, and focus on one would fall to <body> (Tora MINOR-C): same rescue.
  const wasResumeRef = useRef(resumeMode);
  // Held at any point since the dialog opened: a living pick that goes stale is then "the fight is going again", not "back on their feet".
  const heldSeenRef = useRef(held);
  useLayoutEffect(() => {
    const rising = (held && !wasHeldRef.current) || (resumeMode && !wasResumeRef.current);
    wasHeldRef.current = held;
    wasResumeRef.current = resumeMode;
    if (held) heldSeenRef.current = true;
    if (!open || !rising) return;
    const at = document.activeElement;
    if (at && at !== document.body && dialogRef.current?.contains(at)) return;
    // With a character standing there is no radio (the title says Resume): the Character select, else the dialog itself, so Escape and Tab still act on it.
    (dialogRef.current?.querySelector<HTMLElement>('input[type="radio"][value="revive"]') ?? targetRef.current ?? dialogRef.current)?.focus({ preventScroll: true });
  });

  const handleClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);
  const { scrimProps, arm } = useScrimDismiss(handleClose, submitting);

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
    setTargetId(initialTargetId ?? '');
    setReason('');
    setSubmitError(null);
    setSubmitting(false);
    setReviveHpEdit(null);
    // Reset outcome fields to sensible defaults
    setKind(openKind ?? 'attack');
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

    heldSeenRef.current = held;
    pendingReviveFocus.current = openKind === 'revive';
    arm();
    // A state change guarantees a render after this effect, so the layout
    // effect above gets a chance even when nothing else here changed a value.
    setFocusTick((n) => n + 1);

    const t = setTimeout(() => {
      if (openKind === 'revive') return; // the layout effect owns that path
      (firstFocusRef.current as HTMLElement | null)?.focus();
    }, 0);
    return () => {
      clearTimeout(t);
      pendingReviveFocus.current = false;
      const prev = previouslyFocused.current;
      // The opener may be gone (Revive… unmounts once nobody is fallen), or
      // never held focus (the captured element is <body>): then focus goes to
      // the named fallback. (In WebKit a click on the opener focuses the panel
      // <section tabIndex=-1> instead, which stays mounted, so focus returns
      // there; in Chromium the opener holds focus and the fallback is used.)
      if (prev && prev !== document.body && prev.isConnected) prev.focus();
      else fallbackFocus?.()?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);


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
    if (isRevive) {
      if (!target) {
        refuse(resumeMode ? 'Pick the character to resume with.' : 'Pick the character to revive.', 'target');
        targetRef.current?.focus();
        return;
      }
      // Stale guard: the fight is not held (a poll since the dialog opened shows it going again), so this is an ordinary damage override that sets a living
      // character's HP, possibly lowering it, and the engine would NOT refuse it. Held, a living pick is the resume itself and goes out.
      if (target.is_alive && !held) {
        refuse(heldSeenRef.current ? RESUME_STALE : `${target.name} is already back on their feet. Nothing was sent.`, 'target');
        targetRef.current?.focus();
        return;
      }
      if (!reviveParsed.ok) {
        refuse(reviveParsed.message, 'reviveHp');
        reviveHpRef.current?.focus();
        return;
      }
      void send(false);
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
      if (newHpParsed.value === 0 && targetHp === 0 && damageDealt === 0) {
        // Already at 0 HP and no damage to apply: nothing would change, and
        // saying nothing looked like a dead button.
        refuse(`${target?.name ?? 'The target'} is already at 0 HP. Nothing to apply.`, 'newHp');
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
    // Revive goes out as the damage override on a dead PC with HP > 0; the
    // character is both actor and target (no in-fiction attacker).
    let reviveRequest: SubmitOverrideRequest | null = null;
    if (isRevive) {
      if (!target || !reviveParsed.ok || (target.is_alive && !held)) return;
      reviveRequest = {
        kind: 'damage',
        actor_id: target.participant_id,
        target_id: target.participant_id,
        outcome: { damage_dealt: 0, target_new_hp: reviveParsed.value, raw_damage: 0 } satisfies OverrideDamageOutcome,
        reason: reason.trim(),
      };
    }
    // In-flight latch: two confirm clicks in one batch share a closure where
    // `submitting` is still false.
    if (sendInFlight.current) return;
    sendInFlight.current = true;
    setConfirmZero(false);
    setSubmitting(true);
    setSubmitError(null);

    try {
      const result = await submitOverride(combatId, reviveRequest ?? {
        kind: kind as OverrideKind,
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
      // The refusal carries the fight's state (the engine sends the whole object). A HELD fight refuses a non-revive with its own sentence; the static map's "Combat is not active."
      // (and a revive's "The fight has ended") would be untrue of it.
      const refusedState = (body as { data?: { state?: CombatState } } | null)?.data?.state;
      if (engineReason === 'combat_not_active' && isFightHeld(refusedState)) {
        refuse(engineMessage ?? HELD_REFUSAL_COPY, 'reason');
      } else if (isRevive && engineReason === 'combat_not_active') {
        refuse('The fight has ended, so no one can be revived in it.', 'reason');
      } else if (isRevive && engineReason === 'target_down') {
        refuse(`${target?.name ?? 'That character'} can't be revived.${engineMessage ? ` ${engineMessage}` : ''}`, 'reason');
      } else if (engineReason === 'override_malformed') {
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
      {...scrimProps}
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
            {resumeMode && isRevive ? RESUME_TITLE : isRevive ? 'Revive' : 'DM Override'}
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
          {/* Kind radio: with a character still standing the only kind is Resume, which the title names, so there is no choice to draw. */}
          {!resumeMode && (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Override kind</legend>
            <div className={styles.kindRadios} role="radiogroup" aria-label="Override kind">
              {kinds.map((k) => (
                <label key={k} className={styles.radioLabel}>
                  <input
                    ref={k === 'attack' ? (el) => { firstFocusRef.current = el; } : undefined}
                    type="radio"
                    name="override-kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => {
                      // Revive picks from a different list (the fallen), so a
                      // target chosen on either side of the switch is dropped.
                      if (k === 'revive' || kind === 'revive') {
                        setTargetId('');
                        setNewHpEdit(null);
                        setReviveHpEdit(null);
                      }
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
          )}

          {/* Actor — not for Revive: the revived character is both actor and target */}
          {!isRevive && (
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
          )}

          {/* Character — Revive: fallen player characters only */}
          {isRevive && fallen.length === 0 && !target && (
            <div className={styles.field}>
              <span className={styles.label}>No character has fallen.</span>
              {onRefresh && (
                <button type="button" className={styles.quickBtn} onClick={onRefresh}>
                  Refresh
                </button>
              )}
            </div>
          )}
          {isRevive && (fallen.length > 0 || target) && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${uid}-target`}>
                Character <span className={styles.required} aria-hidden>*</span>
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
                  setReviveHpEdit(null);
                  if (errorField === 'target' || errorField === 'form') setSubmitError(null);
                }}
                required
              >
                <option value="">— pick character —</option>
                {reviveOptions.map((p) => (
                  <option key={p.participant_id} value={p.participant_id}>
                    {resumeMode ? (p.is_alive ? `${p.name} (${p.hp_current} of ${p.hp_max} HP)` : `${p.name} (fallen, max ${p.hp_max})`) : `${p.name} (max ${p.hp_max})`}
                  </option>
                ))}
              </select>
            </div>
          )}

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
                    // Picking a target answers 'Target is required' and the
                    // 'no longer a valid target' notice.
                    if (errorField === 'target' || errorField === 'form') setSubmitError(null);
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

            {isRevive && (fallen.length > 0 || target) && (
              <div className={styles.outcomeGrid}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`${uid}-revive-hp`}>
                    {HP_FIELD[hpKind]} <span className={styles.required} aria-hidden>*</span>
                  </label>
                  <div className={styles.quickRow}>
                    <input
                      id={`${uid}-revive-hp`}
                      ref={reviveHpRef}
                      type="number"
                      className={`${styles.numInput} ${styles.reviveHp}`}
                      min={1}
                      max={target ? reviveMax : undefined}
                      inputMode="numeric"
                      value={reviveHpText}
                      disabled={submitting}
                      aria-invalid={(submitError && errorField === 'reviveHp') || undefined}
                      aria-describedby={
                        submitError && errorField === 'reviveHp'
                          ? `${hintId} ${errorId}`
                          : hintId
                      }
                      onChange={(e) => {
                        setReviveHpEdit(e.target.value);
                        if (errorField === 'reviveHp') setSubmitError(null);
                      }}
                    />
                    {target && (
                      <>
                        {([
                          ['1 HP', '1', 'Set to 1 HP', 1],
                          [`Half (${Math.ceil(reviveMax / 2)})`, String(Math.ceil(reviveMax / 2)), `Set to half, ${Math.ceil(reviveMax / 2)} HP`, 2],
                          [`Full (${reviveMax})`, String(reviveMax), `Set to full, ${reviveMax} HP`, 3],
                        ] as const).map(([label, value, name]) => (
                          <button
                            key={label}
                            type="button"
                            className={styles.quickBtn}
                            disabled={submitting}
                            aria-label={name}
                            onClick={() => {
                              setReviveHpEdit(value);
                              // Keep the keyboard on the value just set (no select(): that would fight a caret).
                              reviveHpRef.current?.focus({ preventScroll: true });
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                  <span id={hintId} className={styles.hint}>
                    {hpKind === 'resume'
                      ? !target
                        ? 'Pick a character first. The HP you enter is what they have when the fight resumes.'
                        : reviveDefault === standingHp
                          ? 'Set to their current HP to change nothing. Any other number changes their HP.'
                          : `1 to ${reviveMax}.`
                      : <>
                        {typeof lastAlive === 'number' && lastAlive >= 1 && target
                          ? `Was ${Math.min(Math.floor(lastAlive), reviveMax)} before they fell.`
                          : target
                            ? `1 to ${reviveMax}.`
                            : 'Pick a character first.'}{' '}
                        They return conscious and their death saves are cleared. Dodge and concentration are not restored.
                      </>}
                  </span>
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
              placeholder={isRevive ? (resumeMode ? 'Why is the fight resuming?' : 'Why are you reviving them?') : 'Why are you overriding this outcome?'}
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
            {!(isRevive && fallen.length === 0 && !target) && (
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={submitting || !reason.trim()}
              aria-busy={submitting || undefined}
              aria-label={submitting ? (isRevive && hpKind === 'resume' ? 'Resuming…' : isRevive ? 'Reviving…' : 'Submitting override…') : undefined}
            >
              {submitting
                ? (isRevive && hpKind === 'resume' ? 'Resuming…' : isRevive ? 'Reviving…' : 'Applying…')
                : isRevive && target && reviveParsed.ok
                  ? `${hpKind === 'resume' ? 'Resume with' : 'Revive'} ${target.name} at ${reviveParsed.value} HP`
                  : isRevive
                    ? (hpKind === 'resume' ? 'Resume' : 'Revive')
                    : 'Apply override'}
            </button>
            )}
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
