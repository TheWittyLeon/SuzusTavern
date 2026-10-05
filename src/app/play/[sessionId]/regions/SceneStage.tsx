'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type { EndCombatOutcome } from '@/lib/api/types';
import Icon from '@/components/Icon';
import AnchoredPopover from '@/components/AnchoredPopover';
import ConfirmDialog from '@/components/ConfirmDialog';
import { FoldHandleSlot, useFoldBody } from '@/components/FoldDock';
import { useAnchoredPopover } from '@/lib/a11y/useAnchoredPopover';
import type { RegionVariant } from '../variants';
import { HELD_END_CANCEL, HELD_END_CONFIRM, HELD_END_TITLE, heldEndBody, heldLine } from '../format';
import { useOverrideDialog } from '../overrideDialog';
import { useRemovedFocus } from '../hooks/useRemovedFocus';
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
  /** Ends the fight. Resolves true when it ended, false when the request failed (the held confirm stays open for a retry); a caller that cannot tell may resolve nothing. `quiet`: the caller shows the
   *  failure itself, so no toast (the held confirm owns its error: one announcement, in context). */
  onEndCombat: (outcome: EndCombatOutcome, opts?: { quiet?: boolean }) => void | Promise<boolean | void>;
  beginCombatRef: RefObject<HTMLButtonElement | null>;
  onBeginEncounter: () => void;
  talking: boolean;
  sessionLocked: boolean;
  rollBusy: boolean;
  /** The combat round, shown beside the status text in the phone's strip (an `aria-hidden` span: the tracker stays the one region that
   *  announces the round, Iro A9d-1 Minor-2). Null = not in combat or unknown. */
  round?: number | null;
  /** Every character has fallen and the fight waits for the DM (`isFightHeld`): the status node says so, in place of "In combat · use the action bar", and the
   *  encounter's buttons become the DM's two exits (Revive…, and one End combat that sends `tpk`); everyone else gets the line and no buttons. */
  held?: boolean;
  /** The session's DM account (`isDm`), whoever holds the DM seat. Held, it gets the line and End combat (behind a confirm) even at a Suzu-DM table, where the override
   *  dialog is not offered and Revive… stays away. The human DM has both regardless of this. */
  canEndHeld?: boolean;
  /** The table's DM seat is a person (`dm_mode` human), not Suzu. It picks the held line (a Suzu-DM table's line names the host, who has the one move that is left). */
  humanDmTable?: boolean;
  /** A player character is still standing in a held fight (the engine's heal-resume race): the line says the fight is on hold and Revive… reads Resume…. */
  heldStanding?: boolean;
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
  held = false,
  canEndHeld = false,
  humanDmTable = true,
  heldStanding = false,
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
  // TPK-HOLD W4: the DM is whoever the override dialog's host opened for (the human-DM seat). Held, the generic End combat and its chooser give way to the
  // two exits below: the engine ends a held fight as a TPK whatever outcome is sent, so a chooser would only offer outcomes that are not true.
  const overrideDialog = useOverrideDialog();
  // The DM's held strip: the human DM (the override dialog is open to them) or the session's DM account at a Suzu-DM table. Revive… follows `overrideDialog` alone.
  const heldDm = held && (!!overrideDialog || canEndHeld);
  const endBody = heldEndBody({ standing: heldStanding, canResume: !!overrideDialog });
  // The phone's strip while held: the scene NAME is one line with an ellipsis (its full text stays in the DOM and in the group's name; `title` is for a pointer). The strip is the one place the
  // name shows on a phone, so it is clamped ONLY while held, where the two-sentence line already takes the room (Aoi addendum 3, 5); a running fight's name wraps as it always did.
  const clampName = held && inline;
  // The held End combat asks first: it records a wipe and cannot be undone. The confirm is the app's ConfirmDialog. It stays open (busy) while the request is in flight, so one press is
  // one request; it goes when the fight does (or the hold lifts), and when the request FAILED with the fight still held it stays, with the error, for a retry.
  const [endConfirm, setEndConfirm] = useState<'closed' | 'open' | 'sent'>('closed');
  const [endFailed, setEndFailed] = useState(false);
  // Adjusted while rendering (as the override host does), not in an effect: the confirm goes when the strip does.
  if (endConfirm !== 'closed' && !(heldDm && combatIsActive)) setEndConfirm('closed');
  if (endConfirm === 'closed' && endFailed) setEndFailed(false);
  // Focus is only ever moved when the control that held it was taken away (`useRemovedFocus`): a cold load into a held fight, or a user resting on <body>, has lost nothing. Three
  // edges remove it: the fight turning held (the generic End combat and its chooser go, another tab's override), the hold lifting (the held buttons go, another tab's revive) and
  // the fight ending (the held End combat and the confirm go: the confirm owned focus, and a press on its button forgot the control it had). All land on the scene head, never the
  // composer, which is where the page's stranded-focus rescue would send it; focus that is somewhere else is left alone.
  const wasHeld = useRef(held);
  const confirmWasOpen = useRef(false);
  const focusWasRemoved = useRemovedFocus();
  useLayoutEffect(() => {
    const at = document.activeElement;
    // A modal dialog that is open owns focus (the override dialog moves it itself when its own radio unmounts): the stage never drags focus out from behind it.
    const stranded = (focusWasRemoved() || (confirmWasOpen.current && (at == null || at === document.body))) && !document.querySelector('[role="dialog"][aria-modal="true"]');
    if (stranded && held !== wasHeld.current) sceneHeadRef.current?.focus({ preventScroll: true });
    wasHeld.current = held;
    confirmWasOpen.current = endConfirm !== 'closed';
  }, [held, endConfirm, sceneHeadRef, focusWasRemoved]);
  // A chooser left open when the fight turned held (another tab's override) closes with the button that opened it, and does not reopen when the fight resumes.
  useEffect(() => {
    if (held) setOutcomeChooserOpen(false);
  }, [held, setOutcomeChooserOpen]);
  const pop = useAnchoredPopover({
    open: outcomeChooserOpen && !held,
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
      className={`${hero ? `${cx(styles.stage, strip.strip)} ${strip.hero}` : cx(styles.stage, strip.strip)}${heldDm ? ` ${strip.heldDm}` : ''}${clampName ? ` ${strip.heldClamp}` : ''}`}
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
        {sceneName && <p className={cx(styles.sceneName, strip.name)} title={clampName ? sceneName : undefined}>{sceneName}</p>}
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
              <Icon name={held ? 'Skull' : 'Sword'} size={13} aria-hidden /> {held ? heldLine({ humanDmTable, canEnd: heldDm, standing: heldStanding }) : 'In combat · use the action bar'}
              {/* Not while held: the player's line is two sentences, and the round's span costs a line at 360 with a long scene name (the strip's 75px cap; the tracker says the round). */}
              {inline && !held && round != null && <span aria-hidden className={strip.round}> · round {round}</span>}
            </div>
            {/* B8c-3 M2 (Iro ruling 1): the map's line, PLAIN READABLE TEXT, the status node's next sibling and never inside it. No role, no aria-live, no aria-hidden here or on any
                ancestor up to the stage: it is not a second live region (a changed text announces nothing) and a touch user who taps a token moves no focus, so a hidden line would leave
                them no inspector at all. The status above stays in the tree, unchanged and live, only clipped while this shows. Do not tidy this into the status node or add a role.
                `data-stage-line` is how the harness finds it (n:line asserts it is the status node's next sibling). Clipped, not removed, while the "All enemies are down" prompt owns the cell. */}
            {lineText != null && <span data-stage-line="" className={allHostilesDown ? strip.noteClipped : strip.line}>{lineText}</span>}
            {held ? (
              // Held: the DM's two exits, SIBLINGS of the status node (a button in a live region is re-announced when it mounts). Revive… leads and is the accent
              // (the recovery); End combat is the danger outline and sits last. Nothing for anyone else: the line says what is happening.
              heldDm && (
                <>
                  {overrideDialog && (
                    <button type="button" className={cx(styles.reviveBtn, strip.end)} aria-haspopup="dialog" disabled={combatBusy} onClick={() => overrideDialog.open({ kind: 'revive' })}>
                      {heldStanding ? 'Resume…' : 'Revive…'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={cx(styles.endCombatBtn, strip.wrap)}
                    disabled={combatBusy}
                    aria-busy={combatBusy}
                    aria-haspopup="dialog"
                    onClick={(e) => {
                      // Never over the revive dialog. Focus the button first so the confirm's focus return is deterministic (Safari does not focus a clicked button).
                      if (overrideDialog?.isOpen) return;
                      e.currentTarget.focus();
                      setEndConfirm('open');
                    }}
                  >
                    End combat
                  </button>
                </>
              )
            ) : (
            // B3-1: "End combat" opens the outcome chooser. Tora MAJOR-2: ref so focus returns here when the chooser is dismissed.
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
            )}
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
          {/* The held End combat's confirm (a total party wipe cannot be undone). Not the outcome chooser: held has one outcome. Cancel takes focus; cancel and Escape give it back to End combat. */}
          <ConfirmDialog
            open={endConfirm !== 'closed'}
            tone="danger"
            title={HELD_END_TITLE}
            body={endFailed ? <>{endBody} <span role="alert">Could not end the fight. Try again.</span></> : endBody}
            confirmLabel={HELD_END_CONFIRM}
            cancelLabel={HELD_END_CANCEL}
            busy={endConfirm === 'sent'}
            onConfirm={async () => {
              if (endConfirm !== 'open') return;
              setEndConfirm('sent');
              setEndFailed(false);
              const ended = await onEndCombat('tpk', { quiet: true });
              // Ended (true): the confirm closes now, whatever the response carried (a 200 with no state leaves the fight looking held until the poll). Failed (false) with the fight still held: back to open,
              // with the error, for a retry. A caller that cannot say stays busy until the fight leaves.
              if (ended === true) setEndConfirm('closed');
              else if (ended === false) { setEndFailed(true); setEndConfirm((c) => (c === 'sent' ? 'open' : c)); }
            }}
            onCancel={() => setEndConfirm('closed')}
          />
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