'use client';

import type { RefObject, Dispatch, SetStateAction } from 'react';
import type { EndCombatOutcome } from '@/lib/api/types';
import Icon from '@/components/Icon';
import AnchoredPopover from '@/components/AnchoredPopover';
import { useAnchoredPopover } from '@/lib/a11y/useAnchoredPopover';
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
/** The part of the stage that folds (A9d-2 F1): the picture only, and from step 12 the
 *  map. The head, the encounter controls and both announcers sit OUTSIDE it, so a folded
 *  stage still announces and can still end the fight. `foldSpecs` reads this id. */
export const SCENE_STAGE_BODY_ID = 'play-scene-stage-body';

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
  // A9d-2 N4 (Tora MAJOR-1, Sora lever brief 2.2): the outcome chooser is an anchored popover on EVERY row. Inline in the stage it
  // inherited the band's clip: on a phone it rendered at y 346-718 under a band that ended at 333, so the tap on End combat looked
  // like it did nothing. The hook owns placement, the consumed dismissing click, Escape, Tab past either end and the focus
  // rules; End combat and Wrap up both open it, so the opener is whichever was activated (`lastOpenerRef`, recorded from the click).
  const pop = useAnchoredPopover({
    open: outcomeChooserOpen,
    // Closing is gated on `!combatBusy` as the Escape path always was: an end-the-fight request in flight keeps the chooser.
    onClose: () => { if (!combatBusy) setOutcomeChooserOpen(false); },
    anchorRef: endCombatBtnRef,
    openerRef: lastOpenerRef,
    role: 'group',
    // The first ENABLED option (Victory is disabled until an enemy is down), never Cancel.
    initialFocus: 'button:not([disabled])',
    // The fight ends and End combat unmounts with it: focus goes to the scene head, never <body>.
    fallbackFocus: () => sceneHeadRef.current,
  });
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
      <div id={SCENE_STAGE_BODY_ID} data-fold-body>
        <div className={styles.scenePlaceholder}>
          <Icon name="Map" size={22} aria-hidden />
          <span>The tactical map arrives in a later sprint. Suzu narrates the scene above.</span>
        </div>
      </div>

      {/* Active combat: the status text, End combat, and (all enemies down) Wrap up. A9d-2 N4 (Iro 4): the buttons are SIBLINGS of their
          role="status" text, never inside it (a button in a live region is re-announced when it mounts), each pair under a role-less
          wrapper (no role, no name, no tabindex: it is `display: contents` in the phone's strip and carries the box on every other
          row). The status nodes are stable: always rendered while their state holds, never re-created when a button mounts or unmounts. */}
      {combatIsActive ? (
        <>
          <div className={styles.combatNote}>
            <div className={styles.noteText} role="status" aria-live="polite">
              <Icon name="Sword" size={13} aria-hidden /> In combat · use the action bar
            </div>
            {/* B3-1: "End combat" opens the outcome chooser. Tora MAJOR-2: ref so focus returns here when the chooser is dismissed. */}
            <button
              ref={endCombatBtnRef}
              type="button"
              className={styles.endCombatBtn}
              onClick={(e) => {
                pop.recordOpener(e);
                setOutcomeChooserOpen((v) => !v);
              }}
              disabled={combatBusy}
              aria-busy={combatBusy}
              {...pop.anchorProps}
              aria-label="End combat — choose outcome"
            >
              End combat
            </button>
          </div>
          {/* F3/COMBAT-NO-AUTO-RESOLVE: advisory-only prompt (never auto-resolves — the DM still picks victory/defeat/retreat/etc.).
              Opens the SAME outcome chooser as the "End combat" button above. */}
          {allHostilesDown && (
            <div className={styles.autoResolvePrompt}>
              <div className={styles.noteText} role="status" aria-live="polite">
                <Icon name="Skull" size={13} aria-hidden /> All enemies are down.
              </div>
              <button
                type="button"
                className={styles.autoResolvePromptBtn}
                onClick={(e) => {
                  pop.recordOpener(e);
                  setOutcomeChooserOpen(true);
                }}
                disabled={combatBusy}
                aria-busy={combatBusy}
                // Deliberately distinct wording from the "End combat" button's own aria-label above — a shared "End combat" substring
                // would make the two controls indistinguishable by accessible name.
                aria-label="All enemies are down — wrap up the fight and choose an outcome"
              >
                Wrap up
              </button>
            </div>
          )}
          {/* B3-1: the outcome chooser: an anchored popover on every row (A9d-2 N4), a named group, never aria-modal. */}
          <AnchoredPopover pop={pop} role="group" label="Choose combat outcome" className={styles.outcomeChooser}>
            <div className={styles.outcomeChooserLabel}>How does this fight end?</div>
            {(
              [
                { key: 'victory' as EndCombatOutcome, label: 'Victory', sub: 'You finished the foes.', disabled: !anyMonsterDown, disabledTip: 'No enemies are down yet.' },
                { key: 'retreat' as EndCombatOutcome, label: 'Retreat', sub: 'Fall back; you live to fight again.', disabled: false, disabledTip: undefined },
                { key: 'parley' as EndCombatOutcome, label: 'Parley', sub: 'Talk it out.', disabled: false, disabledTip: undefined },
                { key: 'flee' as EndCombatOutcome, label: 'Flee', sub: 'Run; consequences possible.', disabled: false, disabledTip: undefined },
                { key: 'unresolved' as EndCombatOutcome, label: 'Unresolved', sub: 'End the fight without a verdict.', disabled: false, disabledTip: undefined },
              ] as { key: EndCombatOutcome; label: string; sub: string; disabled: boolean; disabledTip?: string }[]
            ).map(({ key, label, sub, disabled, disabledTip }) => {
              // Iro HIGH-2: each disabled option gets a visually-hidden description so the reason is conveyed to AT (title= is not reliably read).
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
                  {disabled && disabledTip && <span id={tipId} className="sr-only">{disabledTip}</span>}
                </button>
              );
            })}
            <button
              type="button"
              className={styles.outcomeCancel}
              // The hook's close rule returns focus to whichever control opened the chooser ("End combat" or "Wrap up").
              onClick={() => setOutcomeChooserOpen(false)}
              disabled={combatBusy}
            >
              Cancel
            </button>
          </AnchoredPopover>
        </>
      ) : activeEncounterId ? (
        // Between fights but encounter_id still set — shouldn't happen post-fix.
        <div className={styles.combatNote}>
          <div className={styles.noteText} role="status" aria-live="polite">
            <Icon name="Sword" size={13} aria-hidden /> Combat ended
          </div>
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
