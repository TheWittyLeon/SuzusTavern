'use client';
/**
 * Composer (ST-063 / CUI-11) — the message composer at the bottom of the centre pane.
 *
 * Say / Act / OOC mode tabs change placeholder + routing: Say & Act go to Suzu's
 * DM pipeline; OOC stays at the table (never sent to the AI). Enter sends,
 * Shift+Enter is a newline. When combat is active the ActionRail exposes the
 * engine-backed combat actions (attack with target picker, dodge, dash, end turn);
 * spell casting in combat (ST-066) is deferred.
 *
 * ADV-7/8 (CUI-11): CombatTarget now mirrors CombatParticipantState fields so the
 * target picker can display live HP and filter by can_be_targeted. The onAction
 * callback receives the participant_id (not the name) as payload for attack so the
 * play page can send target_id to the engine (name fallback retained for compat).
 */
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import Icon from '@/components/Icon';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import styles from './Composer.module.css';

export type ComposeMode = 'say' | 'act' | 'ooc' | 'dm_narration';
export type CombatAction = 'attack' | 'dodge' | 'dash' | 'endturn' | 'deathsave';

export interface CombatTarget {
  id: string;
  name: string;
  hp?: number | null;
  maxHp?: number | null;
}

export interface ComposerCombat {
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
}

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  mode: ComposeMode;
  onMode: (m: ComposeMode) => void;
  onSend: () => void;
  disabled?: boolean;
  combat?: ComposerCombat | null;
  /** Override the available mode tabs. Defaults to ['say','act','ooc'].
   *  Human-DM sessions supply ['dm_narration','ooc']. */
  availableModes?: [ComposeMode, string][];
  /** Inline error message to display above the composer (e.g. on 5xx). */
  sendError?: string | null;
  /** When true the send button shows a spinner (submit pending). */
  pending?: boolean;
  /** TAV-PLAY-INPUT-LOCK-NO-FEEDBACK (2026-08-01): human-readable reason the
   *  composer is locked ("Suzu is narrating — one moment…", "Session is
   *  paused."). Rendered as a visible `.lockStatus` banner above the field
   *  while the input is locked (`disabled` OR `pending`) — the banner is the
   *  primary channel, since a controlled textarea only paints its placeholder
   *  on an empty value and the DM send path keeps the draft in the field.
   *  The placeholder + title carry the same reason as supplementary channels
   *  for the empty-value case. A pending-only lock with no supplied reason
   *  falls back to "Sending…" (Miko-QA find: the human-DM send round-trip
   *  locks via `pending` alone). */
  disabledReason?: string | null;
  /** Tora MAJOR-2: exposes the action rail's own container so the play page
   *  can refocus it if a turn-transition disables the button the user was
   *  just on, stranding focus on <body> (mirrors the sceneHeadRef tabIndex={-1}
   *  anchor pattern already used for scene/transition mutations). */
  railRef?: RefObject<HTMLDivElement | null>;
  /** Iro CRITICAL-1: provenance flag for the play page's turn-flip refocus
   *  effect. Set to true synchronously, at click time and BEFORE the mutation
   *  fires, when focus was inside this rail — so the effect can tell "my own
   *  disabling click stranded focus" apart from "combatState just arrived via
   *  the poll" (which never sets this). */
  localTurnActionRef?: RefObject<boolean>;
}

const PLACEHOLDER: Record<ComposeMode, string> = {
  say: 'Say something. Suzu will narrate back.',
  act: 'I climb the chimney quietly…',
  ooc: 'Out-of-character. Visible to the table, not the world.',
  dm_narration: 'Narrate the scene as DM… (or speak as an NPC above)',
};

const DEFAULT_MODES: [ComposeMode, string][] = [
  ['say', 'Say'],
  ['act', 'Act'],
  ['ooc', 'OOC'],
];

function ActionRail({
  combat,
  outerRailRef,
  localTurnActionRef,
}: {
  combat: ComposerCombat;
  outerRailRef?: RefObject<HTMLDivElement | null>;
  localTurnActionRef?: RefObject<boolean>;
}) {
  const [targetOpen, setTargetOpen] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const attackBtnRef = useRef<HTMLButtonElement>(null);
  // A11Y-PANEL-SEMANTICS (P3): id for the visible .railLabel kicker below,
  // referenced via aria-labelledby instead of a separately-authored aria-label
  // — avoids the rail's accessible name being sourced twice (once from the
  // string literal, once from the visible text node with the same words).
  const railUid = useId();

  const notYourTurn = combat.isPlayerTurn === false;

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

  // Outside-click dismissal. mousedown (not click) so that opening the menu via
  // the Attack button's own click doesn't immediately re-close it, and so that
  // menu items — which live INSIDE railRef — are never dismissed before their
  // click fires.
  useEffect(() => {
    if (!targetOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) setTargetOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [targetOpen]);

  // APG menu-button: move focus into the menu when it opens (keyboard users).
  useEffect(() => {
    if (targetOpen) {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
  }, [targetOpen]);

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
    combat.onAction(a, payload);
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
      // A11Y (Iro MEDIUM-1): APG menu-button — Tab closes the menu and lets focus
      // move naturally. Without this the popup stays open after Tab-out.
      setTargetOpen(false);
      // Don't preventDefault: let the browser advance focus as normal.
    }
  };

  // Combat-UX Fixes 2026-07-27, Fix B: while the viewer's own PC is dying,
  // Attack/Dodge/Dash are invalid (0 HP) and render disabled-visible rather
  // than being removed — less layout jump, and "these are invalid now" reads
  // clearly. End turn stays independently gated (see endTurnDisabled below) —
  // a downed PC can still pass without rolling.
  const isDying = combat.isDying === true;

  // TAV-ATTACK-BUTTON-STALE: the action is already spent this turn (server-
  // authoritative — see ComposerCombat.actionSpent). Attack-only for now:
  // Dodge/Dash also cost the action engine-side, but this row scoped to the
  // attack button (the observed 400-no_action_remaining path).
  const actionSpent = combat.actionSpent === true;

  // Attack is disabled when: busy, no targets, not the player's turn, dying,
  // or the action is already spent this turn.
  const attackDisabled =
    combat.busy || combat.targets.length === 0 || notYourTurn || isDying || actionSpent;
  // Dodge/dash are also gated on turn + dying.
  const actionDisabled = combat.busy || notYourTurn || isDying;
  // End turn is NOT gated on isDying — a downed PC can pass without rolling.
  const endTurnDisabled = combat.busy || notYourTurn;
  // Roll death save is only ever offered while genuinely dying; busy is the
  // only other gate (isDying already implies it's this player's turn).
  const deathSaveDisabled = combat.busy;

  return (
    <div
      className={styles.rail}
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
      {combat.refusedReason && (
        <div
          className={styles.refusedReason}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {combat.refusedReason}
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
          onClick={() => !attackDisabled && setTargetOpen((o) => !o)}
          disabled={attackDisabled}
          aria-disabled={attackDisabled}
          aria-expanded={targetOpen}
          aria-haspopup="menu"
          aria-label={
            isDying
              ? 'Attack (unavailable — you are down)'
              : notYourTurn
                ? 'Attack (not your turn)'
                : actionSpent
                  ? 'Attack (action already spent this turn)'
                  : combat.targets.length === 0
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
            aria-label={`Death saves: ${combat.deathSaves?.successes ?? 0} of 3 successes, ${combat.deathSaves?.failures ?? 0} of 3 failures`}
          >
            <span className={styles.pipGroup}>
              <span aria-hidden="true" className={styles.pipGroupDots}>
                {[0, 1, 2].map((i) => (
                  <span
                    key={`ds-success-${i}`}
                    data-testid="death-save-pip-success"
                    className={
                      i < (combat.deathSaves?.successes ?? 0)
                        ? `${styles.pip} ${styles.pipSuccess}`
                        : styles.pip
                    }
                  />
                ))}
              </span>
              <span aria-hidden="true" className={styles.pipCount}>
                {combat.deathSaves?.successes ?? 0}/3
              </span>
            </span>
            <span className={styles.pipGroup}>
              <span aria-hidden="true" className={styles.pipGroupDots}>
                {[0, 1, 2].map((i) => (
                  <span
                    key={`ds-failure-${i}`}
                    data-testid="death-save-pip-failure"
                    className={
                      i < (combat.deathSaves?.failures ?? 0)
                        ? `${styles.pip} ${styles.pipFailure}`
                        : styles.pip
                    }
                  />
                ))}
              </span>
              <span aria-hidden="true" className={styles.pipCount}>
                {combat.deathSaves?.failures ?? 0}/3
              </span>
            </span>
          </div>
        </div>
      )}
      {targetOpen && (
        <div
          className={styles.pop}
          role="menu"
          aria-label="Attack — pick a target"
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
        >
          {combat.targets.map((t) => (
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

export default function Composer({
  value,
  onChange,
  mode,
  onMode,
  onSend,
  disabled = false,
  combat = null,
  availableModes,
  sendError = null,
  pending = false,
  disabledReason = null,
  railRef,
  localTurnActionRef,
}: ComposerProps) {
  // Use caller-supplied mode list if provided; default to the standard 3-tab set.
  const MODES = availableModes ?? DEFAULT_MODES;
  const canSend = value.trim().length > 0 && !disabled && !pending;
  // TAV-PLAY-INPUT-LOCK-NO-FEEDBACK: the textarea locks on `disabled || pending`
  // (below), so the self-explaining lock reason must cover BOTH — a supplied
  // reason wins; a pending-only lock with no reason falls back to "Sending…"
  // (matches the send button's aria-label for the same state). The
  // `disabled && pending && no-reason` cell deliberately yields null rather
  // than fabricate "Sending…" for a lock that outlives the request (Kage-CR:
  // unreachable from the live caller, which always supplies a reason when
  // disabled — degrade to the normal placeholder if that invariant breaks).
  const locked = disabled || pending;
  const lockReason =
    (locked && disabledReason) || (pending && !disabled ? 'Sending…' : null);
  // Refs to the mode tab buttons so Arrow keys move DOM focus (not just
  // selection) to the newly-active tab — APG tablist contract (Iro S3.4).
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevCombatRef = useRef<ComposerCombat | null>(null);
  // MINOR-3: synchronous latch prevents a fast double-click from firing onSend twice.
  // The Enter path is already guarded by canSend; this closes the onClick gap.
  const pendingRef = useRef(false);

  // A11Y (Iro MEDIUM-3): when ActionRail unmounts (combat ends), keyboard focus is
  // dropped to <body>. Detect the null transition and restore focus to the textarea
  // — the next logical interaction point after combat ends.
  useEffect(() => {
    const prev = prevCombatRef.current;
    if (prev !== null && combat === null) {
      // Only steal focus if it was last inside the Composer area (don't yank from unrelated UI).
      textareaRef.current?.focus();
    }
    prevCombatRef.current = combat;
  }, [combat]);

  return (
    <div className={styles.composer}>
      {combat && (
        <ActionRail combat={combat} outerRailRef={railRef} localTurnActionRef={localTurnActionRef} />
      )}
      {/* S5.2: inline error banner — text is preserved in the textarea on error. */}
      {sendError && (
        <div
          className={styles.sendError}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {sendError}
        </div>
      )}
      {/* TAV-PLAY-INPUT-LOCK-NO-FEEDBACK (Kage-CR IMPORTANT-1 / Iro-A11y
          CRITICAL-1): the lock reason gets a VISIBLE banner, not just the
          placeholder — a controlled textarea only paints its placeholder when
          `value` is empty, and the human-DM send path keeps the draft in the
          field for the whole pending window (cleared only on success), so a
          placeholder-only reason never renders exactly where it's needed.
          aria-live: polite ONLY for the pending-only case (nothing else
          announces "Sending…"); a `disabled` lock is already announced by its
          owner (ChatLog's composing row for `talking`, the DDX-25 session
          status region for paused/ended) — announcing it again here would
          double-speak every beat. */}
      {lockReason && (
        <div
          className={styles.lockStatus}
          role="status"
          aria-live={disabled ? 'off' : 'polite'}
          aria-atomic="true"
        >
          {lockReason}
        </div>
      )}
      <div className={styles.row}>
        <div
          className={styles.modes}
          role="tablist"
          aria-label="Compose mode"
          onKeyDown={(e) => {
            const order = MODES.map(([k]) => k);
            const idx = order.indexOf(mode);
            let next = idx;
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              next = (idx + 1) % order.length;
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              next = (idx - 1 + order.length) % order.length;
            }
            if (next !== idx) {
              onMode(order[next]);
              // Move focus to the newly-active tab, not just the selection.
              tabRefs.current[next]?.focus();
            }
          }}
        >
          {MODES.map(([k, lbl], i) => (
            <button
              key={k}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={mode === k}
              // Roving tabindex: only the active tab is in the tab order; the
              // others are reached with Arrow keys (APG tabs pattern).
              tabIndex={mode === k ? 0 : -1}
              className={mode === k ? `${styles.mode} ${styles.modeOn}` : styles.mode}
              onClick={() => onMode(k)}
            >
              {lbl}
            </button>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          className={styles.input}
          placeholder={lockReason ?? (PLACEHOLDER[mode] ?? '')}
          value={value}
          rows={1}
          aria-label={`Compose (${mode})`}
          title={lockReason ?? undefined}
          disabled={disabled || pending}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
        <button
          type="button"
          className={styles.send}
          disabled={!canSend}
          aria-label={pending ? 'Sending…' : 'Send'}
          aria-busy={pending}
          onClick={() => {
            if (!canSend || pendingRef.current) return;
            pendingRef.current = true;
            // Reset after the current microtask so the latch only blocks genuine
            // double-clicks; the caller's pending state takes over from there.
            Promise.resolve().then(() => { pendingRef.current = false; });
            onSend();
          }}
        >
          {pending ? (
            <span className={styles.sendSpinner} aria-hidden />
          ) : (
            <Icon name="Send" size={14} />
          )}
        </button>
      </div>
    </div>
  );
}
