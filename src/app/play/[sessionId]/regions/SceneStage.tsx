'use client';

import { createContext, useContext, useState, type ReactNode, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type { EndCombatOutcome } from '@/lib/api/types';
import Icon from '@/components/Icon';
import AnchoredPopover from '@/components/AnchoredPopover';
import { FoldHandleSlot, useFoldBody } from '@/components/FoldDock';
import { useAnchoredPopover } from '@/lib/a11y/useAnchoredPopover';
import type { RegionVariant } from '../variants';
import styles from '../Play.module.css';
import strip from './SceneStage.module.css';

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
 *  stage still announces and can still end the fight. `foldSpecs` reads this id.
 *  A10 step 11 S2b: it is the `hero` stage's BODY, the map's room. */
export const SCENE_STAGE_BODY_ID = 'play-scene-stage-body';

/**
 * B8c-3 M2 (Sora's mount brief 2.2): the scene line's SECOND slot can be written by the stage's body. The context's value is the SETTER only, so a hovered square re-renders this
 * stage's scene line and nothing else (F-i: a page-level inspector state re-rendered all of /play per square). `null` clears it. Outside a stage the setter does nothing.
 */
const StageLineContext = createContext<(text: string | null) => void>(() => {});
export function useStageLine(): (text: string | null) => void {
  return useContext(StageLineContext);
}

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
  /** The combat round, shown beside the status text in the phone's strip (an `aria-hidden` span: the tracker stays the one region that
   *  announces the round, Iro A9d-1 Minor-2). Null = not in combat or unknown. */
  round?: number | null;
  /**
   * A9d-2 N5 (Amendment E.1/E.2): the stage's form, from the registry. `inline` (the phone) is the scene strip: ONE row holding the scene's
   * name, its objective (exploring) or the combat status, and the encounter's buttons; no picture stand-in, no kicker.
   * A10 step 11 S2b (Sora's brief 3.1, Amendment F.1): `hero` is that SAME scene line (the strip's own markup and classes) and then a BODY
   * that fills what is left of the stage's track: it owns its slot's edges (`data-slot-fill`), never scrolls, and its size is the row's. `panel`
   * (Story exploring) is today's stacked head and encounter block, with no body.
   */
  variant?: RegionVariant<'sceneStage'>;
  /** What goes in a `hero` stage's body: the tactical map and the theatre-of-mind band (B8c-3 mounts them). With none, a fight shows the stand-in. */
  children?: ReactNode;
  /** B8c-3 M2 (Iro, step 11 MINOR-2): the body's accessible name once a MAP is in it (a `group`); never a name or a role while the body is empty or holds the stand-in. */
  bodyLabel?: string;
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
  round = null,
  variant = 'panel',
  children,
  bodyLabel,
}: SceneStageProps) {
  const [lineText, setLineText] = useState<string | null>(null);
  // B8c-4 P0: the dock provides whether the body is folded; the body takes the `hidden` ATTRIBUTE (not a class alone: the removed-focus probe, the AX tree and every engine read it). False outside a dock.
  const bodyFolded = useFoldBody();
  const inline = variant === 'inline';
  const hero = variant === 'hero';
  /** The scene line: one row of the scene's name, its second line and the encounter's buttons, the phone's strip (`inline`) and a hero's top. */
  const line = inline || hero;
  /** `styles.x` always; plus the strip's own class when this stage draws the scene line. */
  const cx = (base: string, extra: string | false = false) => (line && extra ? `${base} ${extra}` : base);
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
    <StageLineContext.Provider value={setLineText}>
    <div
      data-region="sceneStage"
      data-toast-clear=""
      data-variant={variant}
      // A `hero` owns its slot's edges: the slot drops its padding and stops being a scroller (Play.module.css, `data-slot-fill`).
      data-slot-fill={hero ? '' : undefined}
      className={hero ? `${cx(styles.stage, strip.strip)} ${strip.hero}` : cx(styles.stage, strip.strip)}
    >
      {/* FIX-8 (MEDIUM-1): aria-label surfaces the scene name to AT so the "Scene" kicker (now aria-hidden) doesn't duplicate it on
          screen readers. Iro Ship 2 CRITICAL-1: tabIndex={-1} + ref makes this a programmatic focus anchor — refocusSceneHeadIfStranded()
          lands here when a resolved check / taken transition unmounts the control the user was just on, and every anchored popover falls
          back to it when its opener is gone (A9d-2 N3). In the strip it is the visible first line. `role="group"` (A9d-2 fix round 2, Iro Minor-7):
          ARIA 1.2 does not allow a name on a role-less generic, and this is the rescue target every popover and the stranded-focus rule lands on. */}
      <div
        ref={sceneHeadRef}
        tabIndex={-1}
        role="group"
        data-focus-fallback=""
        className={cx(styles.sceneHead, strip.head)}
        aria-label={sceneName ? `Scene: ${sceneName}` : 'Scene'}
      >
        {!line && <span className={styles.kicker} aria-hidden>Scene</span>}
        {sceneName && <p className={cx(styles.sceneName, strip.name)}>{sceneName}</p>}
        {/* In the strip the second line is the combat status while a fight runs, so the objective stands down. */}
        {objective && !(line && combatIsActive) && <span className={cx(styles.sceneObjective, strip.objective)}>{objective}</span>}
      </div>
      {/* Active combat: the status text, End combat, and (all enemies down) Wrap up. A9d-2 N4 (Iro 4): the buttons are SIBLINGS of their
          role="status" text, never inside it (a button in a live region is re-announced when it mounts), each pair under a role-less
          wrapper (no role, no name, no tabindex: it is `display: contents` in the phone's strip and carries the box on every other
          row). The status nodes are stable: always rendered while their state holds, never re-created when a button mounts or unmounts. */}
      {combatIsActive ? (
        <>
          <div className={cx(styles.combatNote, strip.wrapper)}>
            <div className={cx(styles.noteText, allHostilesDown || lineText != null ? strip.noteClipped : strip.note)} role="status" aria-live="polite">
              <Icon name="Sword" size={13} aria-hidden /> In combat · use the action bar
              {inline && round != null && <span aria-hidden className={strip.round}> · round {round}</span>}
            </div>
            {/* B8c-3 M2 (Iro ruling 1): the map's line, PLAIN READABLE TEXT, the status node's next sibling and never inside it. No role, no aria-live, no aria-hidden here or on any
                ancestor up to the stage: it is not a second live region (a changed text announces nothing) and a touch user who taps a token moves no focus, so a hidden line would leave
                them no inspector at all. The status above stays in the tree, unchanged and live, only clipped while this shows. Do not tidy this into the status node or add a role.
                `data-stage-line` is how the harness finds it (n:line asserts it is the status node's next sibling). Clipped, not removed, while the "All enemies are down" prompt owns the cell. */}
            {lineText != null && <span data-stage-line="" className={allHostilesDown ? strip.noteClipped : strip.line}>{lineText}</span>}
            {/* B3-1: "End combat" opens the outcome chooser. Tora MAJOR-2: ref so focus returns here when the chooser is dismissed. */}
            <button
              ref={endCombatBtnRef}
              type="button"
              className={cx(styles.endCombatBtn, strip.end)}
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
            <div className={cx(styles.autoResolvePrompt, strip.wrapper)}>
              <div className={cx(styles.noteText, strip.note)} role="status" aria-live="polite">
                <Icon name="Skull" size={13} aria-hidden /> All enemies are down.
              </div>
              <button
                type="button"
                className={cx(styles.autoResolvePromptBtn, strip.wrap)}
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
        <div className={cx(styles.combatNote, strip.wrapper)}>
          <div className={cx(styles.noteText, strip.note)} role="status" aria-live="polite">
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
          className={cx(styles.beginCombat, `${strip.end} ${strip.begin}`)}
          onClick={onBeginEncounter}
          disabled={talking || combatBusy || sessionLocked || rollBusy}
          aria-busy={combatBusy || talking}
          aria-disabled={talking || combatBusy || sessionLocked || rollBusy}
        >
          <Icon name="Sword" size={14} aria-hidden />{' '}
          {sceneHasEncounter ? 'Stand and fight' : 'Begin an encounter'}
        </button>
      ) : null}
      {/* A10 step 11 S2b: a `hero`'s body, the map's room: AFTER the encounter block in the DOM, so Tab goes End combat, then the board. Always in the
          DOM in a `hero` (a body of 0px while exploring: the harness's body legs plant a block in it there too). `panel` and `inline` have none.
          B8c-3 M2: the page passes the map (or the band) as `children` while the state body carries the `space` key, and `null` otherwise (never `false`: `children ?? standIn`).
          debt: a fight whose state body has no `space` key shows the stand-in (a short band gets its one-line form by a container query; the `unserved` room gives the body no height and the text goes with it).
          ceiling: every fight while SUZU_DND_POSITIONING is off; one request after a reload when it is on (the combat id is known one request before the state).
          until: the flag has been on in prod for 7 days (Backlog TAV-STAND-IN-RETIRE); then delete this fallback, `.standIn`, its container query and the harness comparator's stand-in expectation.
      */}
      {/* B8c-4 P0 (H.4): where a body dock's handle is drawn: a `hero`'s, after the encounter buttons and before the body. It renders nothing unless a body dock wraps this stage (no row folds the stage until P1,
          which gives the handle its place on the scene line and its look), so it moves no pixel today. */}
      {hero && <FoldHandleSlot />}
      {hero && (
        <div id={SCENE_STAGE_BODY_ID} data-fold-body hidden={bodyFolded} className={strip.body} role={bodyLabel ? 'group' : undefined} aria-label={bodyLabel}>
          {children ?? (combatIsActive ? (
            <div className={`${styles.scenePlaceholder} ${strip.standIn}`}>
              <Icon name="Map" size={22} aria-hidden />
              <span>The tactical map arrives in a later sprint. Suzu narrates the scene above.</span>
            </div>
          ) : null)}
        </div>
      )}
    </div>
    </StageLineContext.Provider>
  );
}