'use client';
/**
 * Composer (ST-063 / CUI-11) — the message composer at the bottom of the centre pane.
 *
 * Say / Act / OOC mode tabs change placeholder + routing: Say & Act go to Suzu's
 * DM pipeline; OOC stays at the table (never sent to the AI). Enter sends,
 * Shift+Enter is a newline. When combat is active `ActionBar` (below, wrapped
 * from `regions/ActionBar.tsx`) exposes the engine-backed combat actions
 * (attack with target picker, dodge, dash, end turn); spell casting in combat
 * (ST-066) is deferred.
 *
 * TAV-PLAY-SHELL step 8 (decomposition plan §2.3/§5): the action rail itself
 * — formerly a private `ActionRail` function in this file — moved verbatim to
 * `regions/ActionBar.tsx`. This file now WRAPS it in the exact spot it always
 * rendered (first child of `.composer`); Composer's own props are unchanged.
 * `ComposerCombat` is kept as a type alias onto `ActionBarProps` (minus the
 * two refs Composer supplies itself) rather than a second, hand-copied field
 * list — one shape, one owner.
 *
 * ADV-7/8 (CUI-11): CombatTarget now mirrors CombatParticipantState fields so the
 * target picker can display live HP and filter by can_be_targeted. The onAction
 * callback receives the participant_id (not the name) as payload for attack so the
 * play page can send target_id to the engine (name fallback retained for compat).
 *
 * A8 fix round, Kage-CR IMPORTANT-3 (2026-09-28): the import below is the
 * only one in all of src/components/ that reaches into src/app/ — every
 * other region depends on src/components/ the other way — and ActionBar's
 * stylesheet is still Composer.module.css (see regions/ActionBar.tsx's own
 * header). The Omit-based ComposerCombat alias is the right call and isn't
 * itself the debt: it deletes together with the import in one edit at step
 * 6/11, with no second field list to reconcile. What fights step 6 is
 * placement — data-region="actionBar" sits on a node nested inside
 * .composer, so a grid area supplied from the play root can't reach it.
 *
 * debt: ActionBar renders as Composer's child, so a shared component
 * imports a route-private region and borrows its stylesheet.
 * ceiling: fine while page.tsx is ActionBar's only transitive caller.
 * until: step 6/11 renders ActionBar from the shell and combat leaves ComposerProps.
 */
import { useEffect, useRef, type RefObject } from 'react';
import Icon from '@/components/Icon';
import ActionBar, { type ActionBarProps } from '@/app/play/[sessionId]/regions/ActionBar';
import styles from './Composer.module.css';

export type ComposeMode = 'say' | 'act' | 'ooc' | 'dm_narration';

/** The data half of `ActionBarProps` — everything Composer's caller supplies
 *  via the `combat` prop. The two refs (`outerRailRef`/`localTurnActionRef`)
 *  are NOT part of this: Composer supplies those itself from its own
 *  `railRef`/`localTurnActionRef` props, so they are never duplicated in the
 *  `combat` object a caller builds. */
export type ComposerCombat = Omit<ActionBarProps, 'outerRailRef' | 'localTurnActionRef'>;

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
  /** Tora MAJOR-2: exposes ActionBar's own container so the play page
   *  can refocus it if a turn-transition disables the button the user was
   *  just on, stranding focus on <body> (mirrors the sceneHeadRef tabIndex={-1}
   *  anchor pattern already used for scene/transition mutations). Passed
   *  straight through to `ActionBar`'s `outerRailRef` prop. */
  railRef?: RefObject<HTMLDivElement | null>;
  /** Iro CRITICAL-1: provenance flag for the play page's turn-flip refocus
   *  effect. Set to true synchronously, at click time and BEFORE the mutation
   *  fires, when focus was inside ActionBar — so the effect can tell "my own
   *  disabling click stranded focus" apart from "combatState just arrived via
   *  the poll" (which never sets this). Passed straight through to
   *  `ActionBar`'s `localTurnActionRef` prop. */
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

  // A11Y (Iro MEDIUM-3): when ActionBar unmounts (combat ends), keyboard focus is
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
        <ActionBar {...combat} outerRailRef={railRef} localTurnActionRef={localTurnActionRef} />
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
