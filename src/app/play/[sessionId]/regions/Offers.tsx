'use client';

import type { RefObject } from 'react';
import type { SceneCheck, SceneTransition } from '@/lib/api/types';
import type { RollTrigger } from '@/components/DiceTray';
import Icon from '@/components/Icon';
import { titleCaseSkill } from '../format';
import styles from '../Play.module.css';

/**
 * TAV-PLAY-SHELL step 3 — pure region extraction (decomposition plan §2.3:
 * "Offers ... replaces the .checkWrap group AND its aria-hidden duplicate —
 * one component, two placements"). This step only extracts the CANONICAL
 * side-panel group (checks + freeform-offer + transitions) — the
 * aria-hidden duplicate above the composer stays in page.tsx, untouched,
 * exactly as its own comment already states ("The side-panel .checkWrap
 * group is left completely as-is — this does not replace it"). Unifying
 * the two into "one component, two placements" is step 4's job ("Kill the
 * aria-hidden duplicate"), not this one.
 */

const CHECK_LOCK_REASON_COPY: Record<string, string> = {
  nat1: 'A critical failure closed this approach.',
  fail_by_5: 'A decisive failure closed this approach.',
  max_attempts: 'Out of attempts.',
};

export interface OffersProps {
  availableChecks: SceneCheck[];
  offeredCheckSkill: string | null;
  checkBusy: boolean;
  talking: boolean;
  sessionLocked: boolean;
  onAttemptCheck: (skill: string) => void;
  checkWrapRef: RefObject<HTMLDivElement | null>;
  freeformOfferedCheck: string | null;
  freeformCheckRef: RefObject<HTMLDivElement | null>;
  rollBusy: boolean;
  combatBusy: boolean;
  onRoll: (trigger: RollTrigger) => void;
  availableTransitions: SceneTransition[];
  adventureComplete: boolean;
  transitionWrapRef: RefObject<HTMLDivElement | null>;
  sceneAdvanceBusy: boolean;
  onMoveOn: (to: string | null) => void;
}

export default function Offers({
  availableChecks,
  offeredCheckSkill,
  checkBusy,
  talking,
  sessionLocked,
  onAttemptCheck,
  checkWrapRef,
  freeformOfferedCheck,
  freeformCheckRef,
  rollBusy,
  combatBusy,
  onRoll,
  availableTransitions,
  adventureComplete,
  transitionWrapRef,
  sceneAdvanceBusy,
  onMoveOn,
}: OffersProps) {
  return (
    <div data-region="offers">
      {/* P1-PLAYFIX §3.3.3 (S2.4): authored skill-check affordances — shown
          whenever the current scene has authored checks and no combat is
          active. D1a: every authored check for the scene is a
          player-invoked button; the one Suzu invited this turn is just
          highlighted (isOffered below), not exclusively shown. Iro Ship 2
          MINOR-2: role="group" + aria-label mirrors the .outcomeChooser
          group pattern. */}
      {availableChecks.length > 0 && (
        <div ref={checkWrapRef} className={styles.checkWrap} role="group" aria-label="Skill check">
          <div className={styles.checkLabel}>Skill check</div>
          {availableChecks.map((c) => {
            // Iro MINOR-1: a scene authoring two checks with the same skill
            // (different DC) collided on `c.skill` alone for key/noteId/
            // offeredId. Key by skill+dc — stable and unique per authored
            // check within a scene.
            const checkKey = `${c.skill}-${c.dc}`;
            // Iro Ship 2 MAJOR-1: `note` was only reachable via native title=
            // (not reliably announced by AT, invisible on touch). Mirror the
            // outcomeChooser's sr-only + aria-describedby pattern instead.
            const noteId = c.note ? `check-note-${checkKey}` : undefined;
            // P1-PLAYFIX-2 §A.5/§A.6 — highlight the check Suzu invited this
            // turn. A second sr-only span (not color alone) carries the
            // invite to screen readers.
            const isOffered = c.skill === offeredCheckSkill;
            const offeredId = isOffered ? `check-offered-${checkKey}` : undefined;
            // Check Retry + Fail-Forward: locked checks stay in the list --
            // disabled, with the reason available to screen readers.
            const isLocked = c.state === 'locked';
            const isLastAttempt =
              c.state === 'available' &&
              c.max_attempts != null &&
              c.attempts_used != null &&
              c.attempts_used > 0 &&
              c.max_attempts - c.attempts_used === 1;
            const lockReasonId = isLocked ? `check-locked-${checkKey}` : undefined;
            const lockReasonText = isLocked
              ? (CHECK_LOCK_REASON_COPY[c.lock_reason ?? ''] ?? CHECK_LOCK_REASON_COPY.max_attempts)
              : undefined;
            const describedBy =
              [offeredId, noteId, lockReasonId].filter(Boolean).join(' ') || undefined;
            return (
              <button
                key={checkKey}
                type="button"
                className={`${styles.checkBtn} ${isOffered && !isLocked ? styles.checkBtnOffered : ''} ${isLocked ? styles.checkBtnLocked : ''}`}
                onClick={() => {
                  // Iro-A11y MAJOR-3/MAJOR-4: `isLocked` is deliberately NOT
                  // in the native `disabled` prop below (a locked check must
                  // stay Tab-reachable so its sr-only close reason is
                  // announced) — the click is guarded here in JS instead.
                  if (isLocked) return;
                  onAttemptCheck(c.skill);
                }}
                disabled={checkBusy || talking || sessionLocked}
                aria-busy={checkBusy || talking}
                aria-disabled={isLocked || checkBusy || talking || sessionLocked}
                aria-describedby={describedBy}
                title={c.note}
              >
                <Icon name="Check" size={13} aria-hidden />
                {/* Iro Ship 2 MINOR-1: comma reads better in AT/TTS than parens. */}
                {isLocked
                  ? `${titleCaseSkill(c.skill)}, DC ${c.dc} — closed`
                  : `Attempt ${titleCaseSkill(c.skill)}, DC ${c.dc}${isLastAttempt ? ' — last attempt' : ''}`}
                {isOffered && (
                  <span id={offeredId} className="sr-only">Suzu invited this check.</span>
                )}
                {c.note && (
                  <span id={noteId} className="sr-only">{c.note}</span>
                )}
                {isLocked && (
                  <span id={lockReasonId} className="sr-only">{lockReasonText}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Phase 4 (Sora-Arch design §4 Fork 3; Miko-QA "the sleeper bug"
          fix) — a skill Suzu invited this turn that is NOT one of this
          scene's AUTHORED checks (a freeform/unauthored offer). Routes
          through `onRoll` — the SAME quickChecks/postRoll → engine
          `/roll (kind=skill)` primitive, NOT `onAttemptCheck` (`/check`,
          which 400s `no_such_check` for anything unauthored) —
          always-available, server-authoritative, no client-supplied DC.
          Iro-A11y MAJOR-1: when this scene ALSO has authored checks, the
          authored .checkWrap group above renders back-to-back with this
          one — two adjacent role="group" blocks would collide on the
          exact same accessible name ("Skill check") without the
          skill-specific suffix here. */}
      {freeformOfferedCheck && (
        <div
          ref={freeformCheckRef}
          className={styles.checkWrap}
          role="group"
          aria-label={`Skill check: ${titleCaseSkill(freeformOfferedCheck)}`}
        >
          <div className={styles.checkLabel}>Skill check</div>
          <button
            type="button"
            className={`${styles.checkBtn} ${styles.checkBtnOffered}`}
            onClick={() =>
              onRoll({
                kind: 'check',
                skill: freeformOfferedCheck,
                label: titleCaseSkill(freeformOfferedCheck),
              })
            }
            disabled={rollBusy || talking || combatBusy || sessionLocked}
            aria-busy={rollBusy || talking}
            aria-disabled={rollBusy || talking || combatBusy || sessionLocked}
          >
            <Icon name="Check" size={13} aria-hidden />
            {`Attempt ${titleCaseSkill(freeformOfferedCheck)}`}
            <span className="sr-only">Suzu invited this check.</span>
          </button>
        </div>
      )}

      {/* ADV-7T: "Move on" affordance — shown only when transitions are
          available and no combat is active. Iro Ship 2 MINOR-2: role="group"
          + aria-label mirrors the .outcomeChooser group pattern.
          TAV-SLICE-END-ADVANCE-NULL / Kage-CR item 4: once a terminal
          advance has landed (adventureComplete), this affordance is gone
          entirely. */}
      {availableTransitions.length > 0 && !adventureComplete && (
        <div
          ref={transitionWrapRef}
          className={styles.moveOnWrap}
          role="group"
          aria-label="Scene transition"
        >
          <div className={styles.moveOnLabel}>Scene transition</div>
          {availableTransitions.map((t, i) => (
            <button
              // t.to is NOT unique — an adventure can author two exits to
              // the same target scene (different labels), which collided
              // under a bare key={t.to}. Composite with the label + index
              // guarantees uniqueness.
              key={`${t.to}-${t.label ?? ''}-${i}`}
              type="button"
              className={styles.moveOnBtn}
              onClick={() => onMoveOn(t.to)}
              disabled={sceneAdvanceBusy || talking || sessionLocked}
              aria-busy={sceneAdvanceBusy || talking}
              aria-disabled={sceneAdvanceBusy || talking || sessionLocked}
            >
              <Icon name="Compass" size={13} aria-hidden />
              {/* TAV-SLICE-END-ADVANCE-NULL: an unlabelled terminal
                  (`to: null`) exit must never render the literal string
                  "Move on → null" — fall back to neutral completion copy. */}
              {t.label ?? (t.to === null ? 'Conclude the adventure' : `Move on → ${t.to}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
