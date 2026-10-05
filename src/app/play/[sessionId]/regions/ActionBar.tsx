'use client';
/**
 * TAV-PLAY-SHELL step 8 — `ActionBar` out of `Composer` (decomposition plan
 * §2.3: "ActionBar | extracted from Composer's ActionRail
 * (main:src/components/Composer.tsx:31-59,118)"). Behaviour-preserving move:
 * the component formerly named `ActionRail` (private to Composer.tsx), the
 * three types describing its data contract (`CombatAction`, `CombatTarget`,
 * the combat-data shape below), and every Escape/menu/focus/announcement
 * concern that lived inside it move here VERBATIM. Identical DOM, ids,
 * roles and accessible names — this changes no pixels. `data-region`
 * matches the other six regions extracted at step 3 (`presets.ts`'s
 * `RegionId` union, decomposition plan §3.2, already reserves `'actionBar'`
 * for this component).
 *
 * Styling is intentionally NOT split into a dedicated `ActionBar.module.css`
 * this step: every class below (`.rail`, `.action*`, `.pop*`, `.deathSave*`,
 * `.pip*`, `.srOnly`, `.notYourTurn`, `.refusedReason`) is defined in
 * `Composer.module.css` and, as of this extraction, used ONLY here — moving
 * the component without moving its stylesheet keeps this commit a pure
 * logic/location change (zero CSS-module hash churn to reason about) and
 * matches every other step-3 region's own choice to defer CSS
 * reorganization (decomposition plan §3.5 Guard 3: "a guard/reorg with one
 * tenant is the mirror-rule failure" — the same call applies to a SPLIT with
 * one tenant, symmetrically). Revisit if a second `ActionBar`-shaped
 * consumer of these classes ever appears.
 *
 * Composer still renders this in the exact spot `ActionRail` occupied
 * (`{combat && <ActionBar .../>}`, first child of `.composer`) — the "phone
 * gains it in combat" layout move (plan §5 step 8, §3.2) and the "Composer
 * minus combat" end state (plan §2.3's `Composer` row) are both step
 * 6/11 territory (S3 pause), not this commit.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type Ref, type RefObject } from 'react';
import Icon from '@/components/Icon';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import { useAnchoredPopover } from '@/lib/a11y/useAnchoredPopover';
import styles from '@/components/Composer.module.css';
import popoverStyles from '@/components/AnchoredPopover.module.css';
import type { RegionVariant } from '../variants';
import type { MoveControl } from '../hooks/useBoard';
import { HELD_FROZEN_NOTE, HELD_VERB_SUFFIX } from '../format';

export type CombatAction = 'attack' | 'dodge' | 'dash' | 'endturn' | 'deathsave';

export interface CombatTarget {
  id: string;
  name: string;
  hp?: number | null;
  maxHp?: number | null;
}

export interface ActionBarProps {
  targets: CombatTarget[];
  /** Called with action + payload. For 'attack', payload is the target id
   *  (participant_id) — the play page maps this to target_id on the engine request.
   *  Backward-compat: callers that only have a name may pass the name; the play
   *  page falls back to `target` (name) when no id is available. */
  onAction: (action: CombatAction, payload?: string) => void;
  busy?: boolean;
  /** Whether it is the player's turn (disables Attack/Dodge/Dash when false). */
  isPlayerTurn?: boolean;
  /** Reason text to surface when an action was refused by the engine. */
  refusedReason?: string | null;
  /** Combat-UX Fixes 2026-07-27, Fix B: true when the viewer's own PC is the
   *  active-turn combatant AND `death_saves.is_dying` (0 HP, active, not
   *  stable). Attack/Dodge/Dash render disabled-visible (not removed) and a
   *  "Roll death save" affordance + pips appear instead. End turn is
   *  unaffected — a downed PC can still pass their turn without rolling. */
  isDying?: boolean;
  /** Death-save tally for the viewer's own downed PC. Only meaningful (and
   *  only read) when `isDying` is true. */
  deathSaves?: { successes: number; failures: number } | null;
  /** TAV-ATTACK-BUTTON-STALE: true when the viewer's own PC has already spent
   *  their ACTION this turn — the server-authoritative 5e action economy
   *  (CombatParticipantState.action_available === false on the combat-state
   *  wire; no new server state). The Attack button renders disabled-visible
   *  with its own reason label instead of letting the click round-trip into
   *  the engine's 400 no_action_remaining. */
  actionSpent?: boolean;
  /** Tora MAJOR-2: exposes the bar's own container so the play page can
   *  refocus it if a turn-transition disables the button the user was just
   *  on, stranding focus on <body> (mirrors the sceneHeadRef tabIndex={-1}
   *  anchor pattern already used for scene/transition mutations). */
  outerRailRef?: RefObject<HTMLDivElement | null>;
  /** Iro CRITICAL-1: provenance flag for the play page's turn-flip refocus
   *  effect. Set to true synchronously, at click time and BEFORE the mutation
   *  fires, when focus was inside this bar — so the effect can tell "my own
   *  disabling click stranded focus" apart from "combatState just arrived via
   *  the poll" (which never sets this). */
  localTurnActionRef?: RefObject<boolean>;
  /** A9c-2 D2: `bar` (default) is the rail above its buttons, as it always was;
   *  `chips` puts the kicker inline with the buttons so a story column spends
   *  one row. Same elements, same names, same live regions. */
  variant?: RegionVariant<'actionBar'>;
  /** B8c-3 M3: the Move toggle. Absent (undefined) where no board is served, the stage has no body, or the creature has no square or budget: the bar then has the four verbs it always had. Present: a
   *  sixth control with a FIXED name, `aria-pressed` for its state, native `disabled` like every other verb (off turn, no feet, busy, session locked), placed before End turn. */
  move?: MoveControl;
  /** The Move button's ref (a separate prop: see useBoard). */
  moveButtonRef?: Ref<HTMLButtonElement>;
  /**
   * B8c-4 P1b (Sora's phone-mount brief 6.4; the Coordinator addendum): the row's turn line, the SAME text the story shows above the composer ("Monster turn — Goblin Skulker"), from the page's one
   * `turnStatusText`. A row that sets `barTurnLine` passes it (`null` when no one is acting); every other row passes nothing, and the bar is byte-for-byte what it was.
   * Given (even as `null`) the bar is in its DESCRIBED form: a verb that is off for the turn or for a downed PC is locked with `aria-disabled`, never native `disabled` (a native one cannot be focused, so
   * its reason could never be reached), stays focusable and is described by a visually hidden node holding this text; the activation is swallowed by a guard. In the bar's narrow form the wait
   * notice stops being a row (Composer.module.css): on screen the reason is the story's turn line and the dimmed verbs, so the bar is one height on both turns.
   */
  turnLine?: string | null;
  /** The fight is held (every character fallen, waiting on the DM): the verbs are locked as on any turn that is not yours, and the notice says why in the held words, not as a live region (the stage's status line announces it once). */
  held?: boolean;
}

/** Gap between the Attack button and its target menu, and the viewport margin. */
export default function ActionBar({
  targets,
  onAction,
  busy,
  isPlayerTurn,
  refusedReason,
  isDying: isDyingProp,
  deathSaves,
  actionSpent: actionSpentProp,
  outerRailRef,
  localTurnActionRef,
  variant = 'bar',
  move,
  moveButtonRef,
  turnLine,
  held = false,
}: ActionBarProps) {
  const [targetOpen, setTargetOpen] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const attackBtnRef = useRef<HTMLButtonElement>(null);
  // A11Y-PANEL-SEMANTICS (P3): id for the visible .railLabel kicker below,
  // referenced via aria-labelledby instead of a separately-authored aria-label
  // — avoids the rail's accessible name being sourced twice (once from the
  // string literal, once from the visible text node with the same words).
  const railUid = useId();

  // A9c C2 (build brief §1, Amendment C.7): the `actionBar` slot is a clip boundary (`overflow-y:auto`), so an absolutely positioned
  // menu opening ABOVE the rail landed in negative overflow and was invisible in every combat cell (measured at f2168da: popup
  // 220x102, visible 220x0). The menu is `position:fixed`, placed from the Attack button's rect, which escapes the slot without
  // moving it in the DOM (the focus/Escape/arrow pins hold).
  // A9d-2 N3: that placement is `useAnchoredPopover` now (extracted from here, the one correct copy), with the rest of its contract:
  // an outside press closes on CLICK and the click is consumed (a tap on Dodge with the menu open sent the action: the old
  // `mousedown` close let the click through), the X-card always takes its first tap and is never covered, Tab past either end
  // closes and returns focus to Attack, and the visual viewport is followed. The menu keeps its DOM position and its menu roles.
  const pop = useAnchoredPopover({
    open: targetOpen,
    onClose: () => setTargetOpen(false),
    anchorRef: attackBtnRef,
    role: 'menu',
    initialFocus: '[role="menuitem"]',
  });

  const notYourTurn = isPlayerTurn === false;
  // The Attack menu's items carry no lock of their own: when the turn goes (a monster's, or the fight held under it) the menu goes with it, so no tap is left that the engine would refuse.
  if (notYourTurn && targetOpen) setTargetOpen(false);
  /** What a locked verb's name says: the hold, or the turn. */
  const lockedWhy = held ? HELD_VERB_SUFFIX : 'not your turn';

  // A11Y (Iro HIGH-3): announce "Your turn" when the turn flips to the player.
  // The notYourTurn div disappearing does NOT trigger a live-region update.
  // A separate polite live-region that changes from "" → "Your turn — choose an action"
  // is the only reliable way to notify screen-reader users without interrupting narration.
  const prevNotYourTurnRef = useRef<boolean | null>(null);
  const [turnAnnounce, setTurnAnnounce] = useState('');
  useEffect(() => {
    const prev = prevNotYourTurnRef.current;
    // Only fire on the false→true transition (was waiting, now it's our turn).
    if (prev === true && !notYourTurn) {
      setTurnAnnounce('Your turn — choose an action');
      const t = setTimeout(() => setTurnAnnounce(''), 4000);
      return () => clearTimeout(t);
    }
    prevNotYourTurnRef.current = notYourTurn;
  }, [notYourTurn]);

  // B8c-3 (Iro): when the turn passes while a verb holds focus, the verb is disabled under the user and focus falls to <body>. One rule for the whole verb row (Dodge, Move, and the rest): the commit that
  // disables it moves focus to this container instead, in the same frame, so a keyboard user is never stranded. Runs only on the turn flip, so a verb that is merely busy keeps its focus.
  useLayoutEffect(() => {
    if (!notYourTurn) return;
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && active.disabled && railRef.current?.contains(active)) railRef.current.focus({ preventScroll: true });
  }, [notYourTurn]);

  const fire = (a: CombatAction, payload?: string) => {
    // Iro CRITICAL-1: capture BEFORE the mutation — the browser focuses a
    // clicked button synchronously, so this is the only reliable moment to
    // know the disabling click originated inside this rail (mirrors
    // hadFocusInCheckWrap/hadFocusInTransitionWrap in page.tsx). The play
    // page's turn-flip refocus effect only proceeds when this was set by a
    // local click for this transition.
    if (localTurnActionRef) {
      localTurnActionRef.current = railRef.current?.contains(document.activeElement) ?? false;
    }
    onAction(a, payload);
    setTargetOpen(false);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // TAV-A11Y-USE-ESCAPE-CONSUME-HOOK (was a hand-rolled UIR2-TAV-11 r2
      // fix): this menu has no busy state to gate on, so the close always
      // fires alongside the unconditional stopPropagation().
      consumeEscape(e, {
        onClose: () => setTargetOpen(false),
        onRefocus: () => attackBtnRef.current?.focus(),
      });
    } else if (e.key === 'Tab') {
      // A11Y (Iro MEDIUM-1): Tab past either end closes the menu and puts focus back on Attack (the popover contract, N3): it neither
      // traps nor strands. Without this the popup stays open after Tab-out.
      pop.popoverProps.onKeyDown(e);
    }
  };

  // Combat-UX Fixes 2026-07-27, Fix B: while the viewer's own PC is dying,
  // Attack/Dodge/Dash are invalid (0 HP) and render disabled-visible rather
  // than being removed — less layout jump, and "these are invalid now" reads
  // clearly. End turn stays independently gated (see endTurnDisabled below) —
  // a downed PC can still pass without rolling.
  const isDying = isDyingProp === true;

  // TAV-ATTACK-BUTTON-STALE: the action is already spent this turn (server-
  // authoritative — see ActionBarProps.actionSpent). Attack-only for now:
  // Dodge/Dash also cost the action engine-side, but this row scoped to the
  // attack button (the observed 400-no_action_remaining path).
  const actionSpent = actionSpentProp === true;

  // Attack is disabled when: busy, no targets, not the player's turn, dying,
  // or the action is already spent this turn. The native `disabled` attribute
  // is the ONE mechanism for every verb (it already blocks dispatched clicks);
  // the onClick carries no second JS guard (A9c-2 D6, carry (c)) — pinned for
  // all five verbs + Cast by play.actionbar-disabled-model.test.tsx.
  const attackDisabled = busy || targets.length === 0 || notYourTurn || isDying || actionSpent;
  // Dodge/dash are also gated on turn + dying.
  const actionDisabled = busy || notYourTurn || isDying;
  // End turn is NOT gated on isDying — a downed PC can pass without rolling.
  const endTurnDisabled = busy || notYourTurn;
  // Roll death save is only ever offered while genuinely dying; busy is the
  // only other gate (isDying already implies it's this player's turn).
  const deathSaveDisabled = busy;

  // B8c-4 P1b: the described form (see `turnLine`). One lock for every verb: `aria-disabled` (focus is kept, the verb stays reachable) and an event guard, in place of the native `disabled`
  // every other row keeps. `describedBy` names the hidden node only while something is locked for the turn or for a downed PC; on your own turn the text ("Your turn!") describes nothing.
  const described = turnLine !== undefined;
  const whyId = `${railUid}-why`;
  const moveWhyId = `${railUid}-move-why`;
  // Held: the reason a verb is locked is the hold, not a turn line (there is none: no one is acting).
  const whyText = held ? HELD_FROZEN_NOTE : turnLine;
  const hasWhy = described && !!whyText && (notYourTurn || isDying);
  /** `disabled` + `aria-disabled` as every verb always had them; or, described, `aria-disabled` alone, plus the reason. Same attribute order as before. */
  const lock = (off: boolean | undefined) => (described ? { 'aria-disabled': off, 'aria-describedby': hasWhy ? whyId : undefined } : { disabled: off, 'aria-disabled': off });
  /** The event guard of a locked verb in the described form (the same swallow `guardLocked` does): true = the activation is dropped. A native `disabled` never reaches a handler, so other rows need none. */
  const swallowed = (off: boolean | undefined, e: React.SyntheticEvent) => {
    if (!described || off !== true) return false;
    e.preventDefault();
    return true;
  };

  return (
    <div
      className={variant === 'chips' ? `${styles.rail} ${styles.railChips}${move ? ` ${styles.railMove}` : ''}` : styles.rail}
      data-variant={variant}
      // A10 step 11 round 4 (TAV-STORY-BAR-MONSTER-TURN): on a monster's turn the wait notice REPLACES the kicker's text in the kicker's own place and adds no row, so the bar is one height on
      // both turns (Story's was 182px at 1280 wide on a monster's turn: the notice took a line and the verbs wrapped). Composer.module.css reads this attribute; a narrow slot (the phone) keeps today's layout.
      data-waiting={notYourTurn ? 'true' : undefined}
      data-held={held ? 'true' : undefined}
      // B8c-4 P1b fix round 2 (Kage I-2): the row's `barTurnLine` flag, not the container's width, decides that the notice is hidden: a Story bar that is narrow (881-920px) keeps its notice and its native
      // `disabled`. Absent where `turnLine` is undefined, so every other row's markup is byte-for-byte what it was.
      data-described={described ? 'true' : undefined}
      ref={(el) => {
        railRef.current = el;
        if (outerRailRef) outerRailRef.current = el;
      }}
      // Tora MAJOR-1: before this, nothing distinguished "your character's
      // controls" from DmNarrationPanel's "DM monster control" region — the
      // two now co-render for a solo human-DM playing their own PC
      // (TAV-SOLO-DM-CAST-RAIL). role="group" + aria-labelledby gives AT
      // users the same region cue DmNarrationPanel's <section aria-label="DM
      // monster control"> already provides.
      //
      // A11Y-PANEL-SEMANTICS (P3): labelledby (not a separate aria-label
      // string) so the accessible name is sourced from the ONE visible
      // .railLabel node below, not duplicated across two places with the
      // same text.
      role="group"
      aria-labelledby={`${railUid}-label`}
      // Tora MAJOR-2: programmatic focus anchor (mirrors sceneHeadRef) — the
      // play page refocuses this container if a turn flip disables the
      // button the user was just on, stranding focus on <body>.
      tabIndex={-1}
      data-region="actionBar"
    >
      {/* Visible uppercase kicker, matching the panelLabel convention shared
          by DmNarrationPanel/ConditionsPanel/CastSpellPanel. */}
      <div id={`${railUid}-label`} className={styles.railLabel}>
        Your character&rsquo;s actions
      </div>
      {/* A11Y (Iro HIGH-3): polite live-region fires once when it becomes the player's
          turn. Kept visually hidden; the text clears after 4s to avoid stale state. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className={styles.srOnly}
      >
        {turnAnnounce}
      </div>
      {/* Refused-action reason — perceivable (not colour-only), sr-accessible. */}
      {refusedReason && (
        <div
          className={styles.refusedReason}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {refusedReason}
        </div>
      )}
      {/* Turn indicator — polite because it's informational, not urgent. */}
      {notYourTurn && (
        <div className={styles.notYourTurn} aria-live={held ? undefined : 'polite'} aria-atomic={held ? undefined : true}>
          {held ? HELD_FROZEN_NOTE : 'Waiting for your turn…'}
        </div>
      )}
      {/* B8c-4 P1b: the verbs' description in the described form: the story's own turn line, from the same variable, visually hidden here (the visible one is above the composer). Not live. */}
      {hasWhy && <span id={whyId} className={styles.srOnly}>{whyText}</span>}
      {described && move?.disabled && !hasWhy && move.reason && <span id={moveWhyId} className={styles.srOnly}>{move.reason}</span>}
      <div className={styles.railBtns}>
        <button
          ref={attackBtnRef}
          type="button"
          className={targetOpen ? `${styles.action} ${styles.actionOn}` : styles.action}
          onClick={(e) => { if (!swallowed(attackDisabled, e)) setTargetOpen((o) => !o); }}
          {...lock(attackDisabled)}
          {...pop.anchorProps}
          aria-label={
            isDying
              ? 'Attack (unavailable — you are down)'
              : notYourTurn
                ? `Attack (${lockedWhy})`
                : actionSpent
                  ? 'Attack (action already spent this turn)'
                  : targets.length === 0
                    ? 'Attack (no valid targets)'
                    : 'Attack'
          }
        >
          <Icon name="Sword" size={13} /> Attack
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={(e) => { if (!swallowed(actionDisabled, e)) fire('dodge'); }}
          {...lock(actionDisabled)}
          aria-label={
            isDying
              ? 'Dodge (unavailable — you are down)'
              : notYourTurn
                ? `Dodge (${lockedWhy})`
                : 'Dodge'
          }
        >
          <Icon name="Shield" size={13} /> Dodge
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={(e) => { if (!swallowed(actionDisabled, e)) fire('dash'); }}
          {...lock(actionDisabled)}
          aria-label={
            isDying
              ? 'Dash (unavailable — you are down)'
              : notYourTurn
                ? `Dash (${lockedWhy})`
                : 'Dash'
          }
        >
          <Icon name="Compass" size={13} /> Dash
        </button>
        {move && (
          <button
            ref={moveButtonRef}
            type="button"
            className={move.pressed ? `${styles.action} ${styles.actionOn}` : styles.action}
            onClick={(e) => { if (!swallowed(move.disabled, e)) move.onToggle(); }}
            {...lock(move.disabled)}
            // Iro m-3: on your own turn Move can be locked with no turn line to say why (no feet left, your move in flight): it gets its own reason node, described form only.
            {...(described && move.disabled && !hasWhy && move.reason ? { 'aria-describedby': moveWhyId } : {})}
            aria-pressed={move.pressed}
          >
            <Icon name="Map" size={13} /> Move
          </button>
        )}
        <button
          type="button"
          className={styles.action}
          onClick={(e) => { if (!swallowed(endTurnDisabled, e)) fire('endturn'); }}
          {...lock(endTurnDisabled)}
          aria-label={notYourTurn ? `End turn (${lockedWhy})` : 'End turn'}
        >
          <Icon name="Check" size={13} /> End turn
        </button>
      </div>
      {isDying && (
        <div className={styles.deathSaveRow}>
          <button
            type="button"
            className={`${styles.action} ${styles.deathSaveBtn}`}
            onClick={(e) => { if (!swallowed(deathSaveDisabled, e)) fire('deathsave'); }}
            {...lock(deathSaveDisabled)}
            aria-label="Roll death save"
          >
            <Icon name="Heart" size={13} /> Roll death save
          </button>
          {/* Death-save pips: 3 success (left) + 3 failure (right), filled from
              the live tally. aria-hidden on the visual dots + numeric readout —
              the group's own aria-label carries the same info as an accessible
              sentence so a screen reader isn't forced to parse dot-by-dot.
              Iro MAJOR-1 (WCAG 1.4.1, not color-only): success pips stay
              circular; failure pips get a distinct SHAPE (rounded square, see
              .pipFailure) so success/failure are never distinguished by hue
              alone. The small `{n}/3` readout beside each group gives sighted
              color-blind/low-vision users the tally without a screen reader. */}
          <div
            className={styles.deathSavePips}
            role="group"
            aria-label={`Death saves: ${deathSaves?.successes ?? 0} of 3 successes, ${deathSaves?.failures ?? 0} of 3 failures`}
          >
            <span className={styles.pipGroup}>
              <span aria-hidden="true" className={styles.pipGroupDots}>
                {[0, 1, 2].map((i) => (
                  <span
                    key={`ds-success-${i}`}
                    data-testid="death-save-pip-success"
                    className={
                      i < (deathSaves?.successes ?? 0)
                        ? `${styles.pip} ${styles.pipSuccess}`
                        : styles.pip
                    }
                  />
                ))}
              </span>
              <span aria-hidden="true" className={styles.pipCount}>
                {deathSaves?.successes ?? 0}/3
              </span>
            </span>
            <span className={styles.pipGroup}>
              <span aria-hidden="true" className={styles.pipGroupDots}>
                {[0, 1, 2].map((i) => (
                  <span
                    key={`ds-failure-${i}`}
                    data-testid="death-save-pip-failure"
                    className={
                      i < (deathSaves?.failures ?? 0)
                        ? `${styles.pip} ${styles.pipFailure}`
                        : styles.pip
                    }
                  />
                ))}
              </span>
              <span aria-hidden="true" className={styles.pipCount}>
                {deathSaves?.failures ?? 0}/3
              </span>
            </span>
          </div>
        </div>
      )}
      {targetOpen && (
        <div
          className={`${styles.pop} ${popoverStyles.scrollCue}`}
          role="menu"
          aria-label="Attack — pick a target"
          ref={(el) => {
            menuRef.current = el;
            pop.attachPopover(el);
          }}
          onKeyDown={onMenuKeyDown}
          id={pop.popoverProps.id}
          style={pop.popoverProps.style}
          data-anchored-popover=""
          data-placement={pop.popoverProps['data-placement']}
        >
          {targets.map((t) => (
            <button
              key={t.id}
              type="button"
              className={styles.popRow}
              role="menuitem"
              // Pass the participant_id as payload; play page uses it as target_id.
              onClick={() => fire('attack', t.id)}
            >
              <span className={styles.popDot} aria-hidden />
              <span className={styles.popName}>{t.name}</span>
              {t.hp != null && t.maxHp != null && (
                <span className={styles.popMeta} aria-label={`${t.hp} of ${t.maxHp} HP`}>
                  {t.hp}/{t.maxHp}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
