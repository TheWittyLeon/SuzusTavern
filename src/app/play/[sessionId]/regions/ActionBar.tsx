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
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import Icon from '@/components/Icon';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import { useAnchoredPopover } from '@/lib/a11y/useAnchoredPopover';
import styles from '@/components/Composer.module.css';
import popoverStyles from '@/components/AnchoredPopover.module.css';
import type { RegionVariant } from '../variants';

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

  return (
    <div
      className={variant === 'chips' ? `${styles.rail} ${styles.railChips}` : styles.rail}
      data-variant={variant}
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
        <div className={styles.notYourTurn} aria-live="polite" aria-atomic="true">
          Waiting for your turn…
        </div>
      )}
      <div className={styles.railBtns}>
        <button
          ref={attackBtnRef}
          type="button"
          className={targetOpen ? `${styles.action} ${styles.actionOn}` : styles.action}
          onClick={() => setTargetOpen((o) => !o)}
          disabled={attackDisabled}
          aria-disabled={attackDisabled}
          {...pop.anchorProps}
          aria-label={
            isDying
              ? 'Attack (unavailable — you are down)'
              : notYourTurn
                ? 'Attack (not your turn)'
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
          onClick={() => fire('dodge')}
          disabled={actionDisabled}
          aria-disabled={actionDisabled}
          aria-label={
            isDying
              ? 'Dodge (unavailable — you are down)'
              : notYourTurn
                ? 'Dodge (not your turn)'
                : 'Dodge'
          }
        >
          <Icon name="Shield" size={13} /> Dodge
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={() => fire('dash')}
          disabled={actionDisabled}
          aria-disabled={actionDisabled}
          aria-label={
            isDying
              ? 'Dash (unavailable — you are down)'
              : notYourTurn
                ? 'Dash (not your turn)'
                : 'Dash'
          }
        >
          <Icon name="Compass" size={13} /> Dash
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={() => fire('endturn')}
          disabled={endTurnDisabled}
          aria-disabled={endTurnDisabled}
          aria-label={notYourTurn ? 'End turn (not your turn)' : 'End turn'}
        >
          <Icon name="Check" size={13} /> End turn
        </button>
      </div>
      {isDying && (
        <div className={styles.deathSaveRow}>
          <button
            type="button"
            className={`${styles.action} ${styles.deathSaveBtn}`}
            onClick={() => fire('deathsave')}
            disabled={deathSaveDisabled}
            aria-disabled={deathSaveDisabled}
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
