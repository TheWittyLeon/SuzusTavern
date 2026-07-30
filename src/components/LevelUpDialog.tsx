'use client';
/**
 * LevelUpDialog — LEVELUP-UX: the two-phase level-up modal.
 *
 *   Phase 1 (confirm, `result == null`): the ConfirmDialog copy plus an HP
 *   radio group — "Roll for HP" (preselected) vs "Take the average". The
 *   roll happens SERVER-SIDE (engine 1d(hit_die), levelUpCharacter's
 *   hp_mode) — this dialog only collects the choice.
 *
 *   Phase 2 (results, `result` set): what actually happened — the die roll
 *   (when rolled), HP gained, new features, spell-slot changes — plus a
 *   "Resolve your choices" CTA when the refetched sheet still has pending
 *   level choices. The parent flips phases by setting `result` after its
 *   mutate + refetch resolve; the dialog itself never calls the API.
 *
 * Why not ConfirmDialog: its focus trap cycles only its two action buttons,
 * so form controls in `body` (our radios) become unreachable by forward Tab
 * once focus is on Confirm — a real trap violation. This dialog carries a
 * general trap (all enabled controls, first↔last wrap) and otherwise
 * mirrors ConfirmDialog's mechanics verbatim: portal to body, Escape via
 * consumeEscape (unconditional stopPropagation, close gated on !busy),
 * backdrop onClick-not-mousedown cancel, focus remembered on open and
 * restored on close, busy parks focus on the dialog.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import type { LevelUpGain } from '@/components/LevelUpButton';
import type { LevelUpStep } from '@/lib/api/types';
import styles from './LevelUpDialog.module.css';

export type HpMode = 'roll' | 'average';

export interface LevelUpDialogResult {
  /** Sheet-diff summary (always available — the DDX-10 refetch contract). */
  gain: LevelUpGain;
  /** The engine's structured step — null on a pre-upgrade backend, in which
   *  case the results phase renders from `gain` alone (no die shown). */
  step: LevelUpStep | null;
}

export interface LevelUpDialogProps {
  open: boolean;
  characterName: string;
  /** The level a confirm would advance TO (confirm-phase copy). */
  nextLevel: number;
  isSpellcaster: boolean;
  busy: boolean;
  /** null → confirm phase; set → results phase. */
  result: LevelUpDialogResult | null;
  /** Pending level choices on the REFETCHED sheet (not just newly queued —
   *  banked older choices count too); drives the results-phase CTA. */
  pendingChoiceCount: number;
  onConfirm: (hpMode: HpMode) => void;
  onClose: () => void;
  /** Results-phase "Resolve your choices" CTA — the parent closes and moves
   *  the user to the picker. Falls back to onClose when absent. */
  onResolveChoices?: () => void;
  /** Kage M2: where focus lands on close when the remembered trigger can't
   *  take it — after a successful level-up the parent's sheet re-renders
   *  and the trigger is usually DISABLED (XP-gated again), so restoring to
   *  it is a silent no-op that strands keyboard/SR users at <body>. A ref
   *  (stable identity) so the focus effect never re-runs mid-open. */
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

export default function LevelUpDialog({
  open,
  characterName,
  nextLevel,
  isSpellcaster,
  busy,
  result,
  pendingChoiceCount,
  onConfirm,
  onClose,
  onResolveChoices,
  restoreFocusRef,
}: LevelUpDialogProps) {
  const [hpMode, setHpMode] = useState<HpMode>('roll');
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const doneRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const uid = useId();
  const titleId = `${uid}-title`;
  const bodyId = `${uid}-body`;
  const hpLegendId = `${uid}-hp-legend`;

  const phase: 'confirm' | 'results' = result ? 'results' : 'confirm';

  // Reset the radio to the recommended default on every fresh open (render-
  // time adjustment per React's "adjusting state when a prop changes").
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setHpMode('roll');
  }

  // Focus: remember the trigger on open, land on Cancel (least-destructive,
  // ConfirmDialog's convention); restore on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      // Kage M2/r2-3: the remembered trigger may be disabled (sheet
      // re-rendered post-level-up), gone, or otherwise unfocusable — a
      // silent no-op .focus() drops the user at <body>. OUTCOME-based
      // check (did focus actually land?) covers the whole class; the
      // explicit disabled test rides along because jsdom lets disabled
      // buttons take focus (real browsers refuse), so tests would
      // otherwise pass a state browsers fail. Fallback = the parent's
      // stable container (the CampaignFloorPanel g2 rescue pattern).
      const prev = previouslyFocused.current;
      prev?.focus?.();
      const landed =
        prev != null &&
        document.activeElement === prev &&
        !(prev as HTMLButtonElement).disabled;
      if (!landed) {
        // Reading the ref at CLEANUP time is the point — the fallback
        // target must be whatever the parent's container is now, at close.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        restoreFocusRef?.current?.focus?.();
      }
    };
    // restoreFocusRef is a ref (stable) — deliberately not a dep; re-running
    // this effect mid-open would re-capture previouslyFocused as a node
    // INSIDE the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Phase flip: move focus to the results-phase primary so SR users hear
  // the new content region instead of sitting on an unmounted button.
  useEffect(() => {
    if (open && phase === 'results') {
      const t = setTimeout(() => doneRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open, phase]);

  // LEVELUP-UX-A11Y-TAIL (Kage m5): when `busy` flips true, a REAL browser
  // blurs the now-disabled focused button to <body> — after which the
  // onKeyDown busy-Tab park below never fires (keydown lands on body, not
  // the dialog). Park focus on the dialog via an effect at the moment busy
  // starts. jsdom lets disabled buttons keep focus, so tests must assert
  // the OUTCOME (dialog focused), not the blur. Same fix in ConfirmDialog.
  useEffect(() => {
    if (open && busy) dialogRef.current?.focus();
  }, [open, busy]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        consumeEscape(e, { onClose, canClose: !busy });
        return;
      }
      if (e.key === 'Tab') {
        const root = dialogRef.current;
        if (!root) return;
        // General trap: every enabled control in DOM order, first↔last wrap
        // (ConfirmDialog's two-button trap generalized for the radio group).
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), a[href]',
          ),
        );
        if (focusables.length === 0) {
          // Busy: everything is disabled — park focus on the dialog itself.
          e.preventDefault();
          e.stopPropagation();
          root.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [busy, onClose],
  );

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const gain = result?.gain ?? null;
  const step = result?.step ?? null;
  const rolled = step?.hp_roll != null;
  const hpGain = step?.hp_gain ?? gain?.hpGain ?? 0;
  const hpMax = step?.hp_max ?? gain?.hpMax ?? 0;

  const dialogContent = (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={styles.dialog}
        onKeyDown={onKeyDown}
      >
        {phase === 'confirm' ? (
          <>
            <h2 id={titleId} className={styles.title}>
              Level up {characterName}?
            </h2>
            <p id={bodyId} className={styles.body}>
              {/* {' '} is load-bearing: JSX drops the newline after the
                  ternary, which rendered "spell slots,and" (live-caught —
                  inherited from the ConfirmDialog-era copy). */}
              {characterName} will advance to level {nextLevel}. HP, hit dice
              {isSpellcaster ? ', spell slots,' : ''}{' '}and class features
              update immediately — this can&rsquo;t be undone.
            </p>
            <fieldset
              className={styles.hpGroup}
              role="radiogroup"
              aria-labelledby={hpLegendId}
              disabled={busy}
            >
              <legend id={hpLegendId} className={styles.hpLegend}>
                Hit points
              </legend>
              <label className={styles.hpOption}>
                <input
                  type="radio"
                  name={`${uid}-hp-mode`}
                  value="roll"
                  checked={hpMode === 'roll'}
                  onChange={() => setHpMode('roll')}
                />
                <span>
                  <strong>Roll for it</strong> — Suzu rolls your hit die at the
                  table; whatever it shows (plus CON) is what you get.
                </span>
              </label>
              <label className={styles.hpOption}>
                <input
                  type="radio"
                  name={`${uid}-hp-mode`}
                  value="average"
                  checked={hpMode === 'average'}
                  onChange={() => setHpMode('average')}
                />
                <span>
                  <strong>Take the average</strong> — the steady, fixed amount
                  every level.
                </span>
              </label>
            </fieldset>
            <div className={styles.actions}>
              <Button
                ref={cancelRef}
                variant="ghost"
                onClick={onClose}
                disabled={busy}
              >
                Not yet
              </Button>
              {/* "Yes, level up", never "Level up" — the trigger button owns
                  that accessible name and both are on screen at once (the
                  ConfirmDialog-era note carries over). */}
              <Button
                variant="primary"
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={() => onConfirm(hpMode)}
              >
                {busy
                  ? hpMode === 'roll'
                    ? 'Rolling…'
                    : 'Saving…'
                  : 'Yes, level up'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 id={titleId} className={styles.title}>
              <Icon name="Crown" size={16} aria-hidden /> Level up! Lv.
              {gain?.fromLevel} → Lv.{gain?.toLevel}
            </h2>
            <div id={bodyId} className={styles.body}>
              {rolled ? (
                <p className={styles.dieLine}>
                  <span className={`mono ${styles.dieValue}`} aria-hidden>
                    {step?.hp_roll}
                  </span>
                  <span>
                    The die came up <strong>{step?.hp_roll}</strong> —{' '}
                    <strong>+{hpGain} HP</strong> (now {hpMax}).
                  </span>
                </p>
              ) : (
                hpGain > 0 && (
                  <p>
                    <strong>+{hpGain} HP</strong> (now {hpMax}) — took the
                    average.
                  </p>
                )
              )}
              {gain && gain.slotChanges.length > 0 && (
                <p>
                  New spell slots:{' '}
                  {gain.slotChanges
                    .map((s) => `Lv.${s.level} ${s.from}→${s.to}`)
                    .join(', ')}
                  .
                </p>
              )}
              {gain && gain.newFeatures.length > 0 && (
                <p>New: {gain.newFeatures.join(', ')}.</p>
              )}
              {pendingChoiceCount > 0 && (
                <p>
                  {pendingChoiceCount === 1
                    ? 'One choice from this climb is waiting'
                    : `${pendingChoiceCount} choices from this climb are waiting`}{' '}
                  on your sheet — subclass, Ability Score Improvement, or new
                  spells.
                </p>
              )}
            </div>
            <div className={styles.actions}>
              {pendingChoiceCount > 0 ? (
                <>
                  <Button ref={doneRef} variant="ghost" onClick={onClose}>
                    Done
                  </Button>
                  <Button
                    variant="primary"
                    onClick={onResolveChoices ?? onClose}
                  >
                    Resolve your choices
                  </Button>
                </>
              ) : (
                <Button ref={doneRef} variant="primary" onClick={onClose}>
                  Done
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(dialogContent, document.body);
}
