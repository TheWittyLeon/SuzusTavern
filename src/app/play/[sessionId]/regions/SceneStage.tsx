'use client';

import type { RefObject, Dispatch, SetStateAction } from 'react';
import type { EndCombatOutcome } from '@/lib/api/types';
import Icon from '@/components/Icon';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import styles from '../Play.module.css';

/**
 * TAV-PLAY-SHELL step 3 — pure region extraction, PLACEHOLDER CONTENT ONLY
 * (decomposition plan §5 step 3: "SceneStage (placeholder content only)").
 * This is NOT §4's SceneStage design (backdrop row + theatre-of-mind
 * combatant band) — that is later work (step 11 and beyond). This is
 * today's scene head + `.scenePlaceholder` box + the combat-note/outcome-
 * chooser/"Stand and fight" ternary, moved verbatim into one file because
 * together they ARE today's stand-in for "what's happening on stage" (the
 * eventual SceneStageProps in §4.1 already carries `combat: CombatState |
 * null` for exactly this reason). Does not include the skill-check/
 * transition chips below it — that's a different concern (Offers, next).
 */
export interface SceneStageProps {
  sceneName: string | null;
  objective: string | null;
  sceneHeadRef: RefObject<HTMLDivElement | null>;
  combatIsActive: boolean;
  activeEncounterId: string | null | undefined;
  sceneHasEncounter: boolean;
  combatBusy: boolean;
  endCombatBtnRef: RefObject<HTMLButtonElement | null>;
  outcomeChooserOpen: boolean;
  setOutcomeChooserOpen: Dispatch<SetStateAction<boolean>>;
  lastOpenerRef: RefObject<HTMLButtonElement | null>;
  allHostilesDown: boolean;
  anyMonsterDown: boolean;
  onEndCombat: (outcome: EndCombatOutcome) => void;
  beginCombatRef: RefObject<HTMLButtonElement | null>;
  onBeginEncounter: () => void;
  talking: boolean;
  sessionLocked: boolean;
  rollBusy: boolean;
}

export default function SceneStage({
  sceneName,
  objective,
  sceneHeadRef,
  combatIsActive,
  activeEncounterId,
  sceneHasEncounter,
  combatBusy,
  endCombatBtnRef,
  outcomeChooserOpen,
  setOutcomeChooserOpen,
  lastOpenerRef,
  allHostilesDown,
  anyMonsterDown,
  onEndCombat,
  beginCombatRef,
  onBeginEncounter,
  talking,
  sessionLocked,
  rollBusy,
}: SceneStageProps) {
  return (
    <div data-region="sceneStage">
      {/* FIX-8 (MEDIUM-1): aria-label surfaces the scene name to AT so the
          "Scene" kicker (now aria-hidden) doesn't duplicate it on screen
          readers. Iro Ship 2 CRITICAL-1: tabIndex={-1} + ref makes this a
          programmatic focus anchor — refocusSceneHeadIfStranded() lands
          here when a resolved check / taken transition unmounts the
          control the user was just on. */}
      <div
        ref={sceneHeadRef}
        tabIndex={-1}
        className={styles.sceneHead}
        aria-label={sceneName ? `Scene: ${sceneName}` : 'Scene'}
      >
        <span className={styles.kicker} aria-hidden>Scene</span>
        {sceneName && <p className={styles.sceneName}>{sceneName}</p>}
        {objective && <span className={styles.sceneObjective}>{objective}</span>}
      </div>
      <div className={styles.scenePlaceholder}>
        <Icon name="Map" size={22} aria-hidden />
        <span>The tactical map arrives in a later sprint. Suzu narrates the scene above.</span>
      </div>

      {/* Active combat: show combat note + B3-1 outcome chooser. */}
      {combatIsActive ? (
        <>
          <div className={styles.combatNote} role="status" aria-live="polite">
            <Icon name="Sword" size={13} aria-hidden /> In combat · use the action rail in the composer
            {/* B3-1: "End" opens the outcome chooser. Tora MAJOR-2: ref so
                focus returns here when the chooser is dismissed via Escape. */}
            <button
              ref={endCombatBtnRef}
              type="button"
              className={styles.endCombatBtn}
              onClick={(e) => {
                lastOpenerRef.current = e.currentTarget;
                setOutcomeChooserOpen((v) => !v);
              }}
              disabled={combatBusy}
              aria-busy={combatBusy}
              aria-haspopup="true"
              aria-expanded={outcomeChooserOpen}
              aria-label="End combat — choose outcome"
            >
              End
            </button>
          </div>
          {/* F3/COMBAT-NO-AUTO-RESOLVE: advisory-only prompt (never auto-
              resolves — the DM still picks victory/defeat/retreat/etc.).
              Opens the SAME outcome chooser as the "End" button above. */}
          {allHostilesDown && (
            <div className={styles.autoResolvePrompt} role="status" aria-live="polite">
              <Icon name="Skull" size={13} aria-hidden /> All enemies are down.
              <button
                type="button"
                className={styles.autoResolvePromptBtn}
                onClick={(e) => {
                  lastOpenerRef.current = e.currentTarget;
                  setOutcomeChooserOpen(true);
                }}
                disabled={combatBusy}
                aria-busy={combatBusy}
                // Deliberately distinct wording from the "End" button's own
                // "End combat — choose outcome" aria-label above — a shared
                // "End combat" substring would make the two controls
                // indistinguishable by accessible name.
                aria-label="All enemies are down — wrap up the fight and choose an outcome"
              >
                Wrap up
              </button>
            </div>
          )}
          {/* B3-1: outcome chooser popover */}
          {outcomeChooserOpen && (
            <div
              className={styles.outcomeChooser}
              role="group"
              aria-label="Choose combat outcome"
              // Tora MAJOR-2: Escape closes the chooser and returns focus to
              // the trigger. TAV-A11Y-USE-ESCAPE-CONSUME-HOOK: stopPropagation
              // is unconditional; only the actual close stays gated on
              // `!combatBusy`.
              onKeyDown={(e) =>
                consumeEscape(e, {
                  onClose: () => setOutcomeChooserOpen(false),
                  canClose: !combatBusy,
                  // Iro MAJOR-1: refocus whichever control actually opened
                  // the chooser ("End" or "Wrap up"), falling back to
                  // endCombatBtnRef if it was somehow opened without going
                  // through an onClick.
                  onRefocus: () => (lastOpenerRef.current ?? endCombatBtnRef.current)?.focus(),
                })
              }
            >
              <div className={styles.outcomeChooserLabel}>How does this fight end?</div>
              {(
                [
                  {
                    key: 'victory' as EndCombatOutcome,
                    label: 'Victory',
                    sub: 'You finished the foes.',
                    disabled: !anyMonsterDown,
                    disabledTip: 'No enemies are down yet.',
                  },
                  {
                    key: 'retreat' as EndCombatOutcome,
                    label: 'Retreat',
                    sub: 'Fall back; you live to fight again.',
                    disabled: false,
                    disabledTip: undefined,
                  },
                  {
                    key: 'parley' as EndCombatOutcome,
                    label: 'Parley',
                    sub: 'Talk it out.',
                    disabled: false,
                    disabledTip: undefined,
                  },
                  {
                    key: 'flee' as EndCombatOutcome,
                    label: 'Flee',
                    sub: 'Run; consequences possible.',
                    disabled: false,
                    disabledTip: undefined,
                  },
                  {
                    key: 'unresolved' as EndCombatOutcome,
                    label: 'Unresolved',
                    sub: 'End the fight without a verdict.',
                    disabled: false,
                    disabledTip: undefined,
                  },
                ] as {
                  key: EndCombatOutcome;
                  label: string;
                  sub: string;
                  disabled: boolean;
                  disabledTip?: string;
                }[]
              ).map(({ key, label, sub, disabled, disabledTip }) => {
                // Iro HIGH-2: each disabled option gets a visually-hidden description
                // so the reason is conveyed to AT (title= is not reliably read).
                const tipId = disabledTip ? `outcome-tip-${key}` : undefined;
                return (
                  <button
                    key={key}
                    type="button"
                    className={styles.outcomeOption}
                    onClick={() => onEndCombat(key)}
                    disabled={combatBusy || disabled}
                    aria-disabled={disabled || combatBusy}
                    aria-describedby={disabled && tipId ? tipId : undefined}
                  >
                    <span className={styles.outcomeLabel}>{label}</span>
                    <span className={styles.outcomeSub}>{sub}</span>
                    {disabled && disabledTip && (
                      <span id={tipId} className="sr-only">{disabledTip}</span>
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                className={styles.outcomeCancel}
                onClick={() => {
                  setOutcomeChooserOpen(false);
                  // Iro MAJOR-1: same opener-aware refocus as the Escape path above.
                  (lastOpenerRef.current ?? endCombatBtnRef.current)?.focus();
                }}
                disabled={combatBusy}
              >
                Cancel
              </button>
            </div>
          )}
        </>
      ) : activeEncounterId ? (
        // Between fights but encounter_id still set — shouldn't happen post-fix.
        <div className={styles.combatNote} role="status" aria-live="polite">
          <Icon name="Sword" size={13} aria-hidden /> Combat ended
        </div>
      ) : sceneHasEncounter ? (
        // No combat at all, AND the current scene has an authored combat
        // encounter (`sceneHasEncounter`): offer to begin it. Phase 4
        // Package B relabels this button "Stand and fight" so the moment
        // reads as a fight-or-flee choice rather than a generic "start a
        // fight" invite (in practice the button can now only ever render
        // with the "Stand and fight" label; the "Begin an encounter"
        // branch below is kept as-is, unreachable, matching the original
        // fix's own scope). Also disabled while narration/session/other
        // rolls are busy.
        <button
          ref={beginCombatRef}
          type="button"
          className={styles.beginCombat}
          onClick={onBeginEncounter}
          disabled={talking || combatBusy || sessionLocked || rollBusy}
          aria-busy={combatBusy || talking}
          aria-disabled={talking || combatBusy || sessionLocked || rollBusy}
        >
          <Icon name="Sword" size={14} aria-hidden />{' '}
          {sceneHasEncounter ? 'Stand and fight' : 'Begin an encounter'}
        </button>
      ) : null}
    </div>
  );
}
