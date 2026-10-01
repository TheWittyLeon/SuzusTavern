'use client';
/**
 * Composer (ST-063 / CUI-11) — the message composer at the bottom of the centre pane.
 *
 * Say / Act / OOC mode tabs change placeholder + routing: Say & Act go to Suzu's
 * DM pipeline; OOC stays at the table (never sent to the AI). Enter sends,
 * Shift+Enter is a newline.
 *
 * TAV-PLAY-SHELL step 6b, commit C3 (carry (b), build brief §6.6): `ActionBar`
 * (the combat action rail — attack with target picker, dodge, dash, end turn;
 * spell casting in combat, ST-066, is deferred) used to render as this
 * component's first child via a `combat` prop (step 8). It is now a SIBLING
 * of `<Composer/>` in the caller's own JSX — `data-region="actionBar"`
 * (`regions/ActionBar.tsx`) needs a grid area a node nested inside
 * `.composer` can't reach (step 6's whole point). `ComposerProps` no longer
 * carries `combat`/`railRef`/`localTurnActionRef` at all; the caller renders
 * `<ActionBar/>` directly and owns those refs itself. Retires this file's own
 * `debt:` marker (A8) — its `until:` has fired.
 */
import { useRef, type RefObject } from 'react';
import Icon from '@/components/Icon';
import { guardLocked, lockProps } from '@/lib/a11y/lockProps';
import styles from './Composer.module.css';

export type ComposeMode = 'say' | 'act' | 'ooc' | 'dm_narration';

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  mode: ComposeMode;
  onMode: (m: ComposeMode) => void;
  onSend: () => void;
  disabled?: boolean;
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
  /** TAV-PLAY-SHELL step 6b commit C3 (Iro MEDIUM-3, re-homed to
   *  `useFocusAnchors`): the caller's stable anchor for the composer
   *  textarea, so the play page can refocus it when ActionBar unmounts
   *  (combat ends) and keyboard focus would otherwise drop to <body>.
   *  Optional — every other caller is unaffected. */
  textareaAnchorRef?: RefObject<HTMLTextAreaElement | null>;
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
  availableModes,
  sendError = null,
  pending = false,
  disabledReason = null,
  textareaAnchorRef,
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
  // MINOR-3: synchronous latch prevents a fast double-click from firing onSend twice.
  // The Enter path is already guarded by canSend; this closes the onClick gap.
  const pendingRef = useRef(false);

  return (
    <div className={styles.composer}>
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
          ref={(el) => {
            textareaRef.current = el;
            if (textareaAnchorRef) textareaAnchorRef.current = el;
          }}
          className={styles.input}
          placeholder={lockReason ?? (PLACEHOLDER[mode] ?? '')}
          value={value}
          rows={1}
          aria-label={`Compose (${mode})`}
          title={lockReason ?? undefined}
          // Iro A9c-2 IMPORTANT-1: a send/narration lock is `readOnly` +
          // `aria-disabled`, never native `disabled` — that dropped focus to <body>
          // on EVERY send (and on the Auto flip while Suzu narrates).
          {...lockProps(locked, { textInput: true })}
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
          // Not native `disabled` either: a keyboard user on Send loses focus the
          // moment the draft clears (value -> empty -> !canSend).
          {...lockProps(!canSend, { busy: pending })}
          aria-label={pending ? 'Sending…' : 'Send'}
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
