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
import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import ComposerModeMenu from '@/components/ComposerModeMenu';
import Icon from '@/components/Icon';
import { DEFAULT_MODES, MODE_RECORD, type ComposeMode } from '@/components/composeModes';
import { keepFieldFocus } from '@/lib/a11y/keepFieldFocus';
import { lockProps } from '@/lib/a11y/lockProps';
import type { RegionVariant } from '@/app/play/[sessionId]/variants';
import styles from './Composer.module.css';

export type { ComposeMode };

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
  /**
   * A9d-2 N7 (Amendment E.4): `full` (the default) is the composer as it always was. `roll` (a `hero` stage's rows: A10 S1) puts `tools` (the Roll control, which opens the dice) at the END of the mode row: DOM order
   * modes, Roll, textarea, send; the mode row never wraps. A10 step 11 tail, S6: `line` is the phone's: Roll, a Mode MENU button (no tab list), the field and Send, in that order, one row from 360 wide and two
   * (Roll and Mode, then the field and Send together) where the field would be under 9rem. `tools` is painted by `roll` and `line`.
   */
  variant?: RegionVariant<'composer'>;
  tools?: ReactNode;
}

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
  variant = 'full',
  tools,
}: ComposerProps) {
  // Use caller-supplied mode list if provided; default to the standard player set.
  const MODES = availableModes ?? DEFAULT_MODES;
  const line = variant === 'line';
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
  // A one-row field (`roll`, `line`) takes the mode's short placeholder (14 characters or fewer: composeModes.ts); the long text is its accessible description. A lock reason is shown whole.
  const hintId = useId();
  const shortPlaceholder = (variant === 'roll' || line) && !lockReason;
  const record = MODE_RECORD[mode];
  // MINOR-3: synchronous latch prevents a fast double-click from firing onSend twice.
  // The Enter path is already guarded by canSend; this closes the onClick gap.
  const pendingRef = useRef(false);
  // The `line` field grows with its text to three lines (92px: the amendment's cap) and then scrolls inside; at rest it is the 44px row. A one-row composer on a phone is a whole band, and its growth
  // is paid by the map's rows, then the page, never the story's floor.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!line || !el) return;
    // An EMPTY field is the 44px row (CSS): its scrollHeight counts a wrapping PLACEHOLDER (the lock reason, 2 lines at 148px), and the lock line takes no height (round 3, Aoi), so it is never sized.
    if (!value) { el.style.height = ''; return; }
    el.style.height = 'auto';
    if (el.scrollHeight > 0) el.style.height = `${Math.min(el.scrollHeight + 2, 92)}px`;
  }, [value, line]);

  return (
    // `data-toast-avoid`: a toast must never stand over the composer (Send, the textarea); Toast.tsx places its host by these marks.
    <div className={styles.composer} data-region="composer" data-variant={variant} data-mode={mode} data-toast-avoid="">
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
      {/* TAV-PLAY-INPUT-LOCK-NO-FEEDBACK, reshaped by A10 step 11 round 3 (Aoi's ruling between Kage's "no height" and Iro's "reserve the row"): the lock reason takes NO height.
          It was a visible banner above the field (40px, mounted while a narration or a send lasts), which stepped the board and the log on every narration and the safety control
          with them on a short page. Now: an ALWAYS-MOUNTED live region, visually hidden (zero height, out of flow), whose text is set when the lock begins and cleared when it
          ends (an always-mounted region is what makes the announcement reliable: it is the accessibility reviewer's point, and it costs no layout); the reason's visible home is the
          placeholder and the title (below), a lock glyph at the field's trailing edge, and, for a typed draft, the story's own composing row above the composer, which names a
          narration and is already announced. Politeness is as it was: `off` for a `disabled` lock (its owner announces it: ChatLog's composing row for `talking`, the DDX-25 session
          status region for paused or ended), `polite` for "Sending…" (nothing else announces it). The send error stays an in-flow alert: it must be read, it is rare, and it is what
          the player is trying to fix (the harness holds it as a named cell). */}
      <div className="sr-only" role="status" aria-live={disabled ? 'off' : 'polite'} aria-atomic="true" data-composer-lock="">
        {lockReason ?? ''}
      </div>
      <div className={styles.row}>
        {/* The mode row. `line` (the phone, A10 step 11 tail S6): Roll, then the Mode MENU button; no tab list. `full` and `roll`: the modes as a tab list and, on a `roll` row, the Roll control after them.
            `display: contents` unless the variant makes it its own flex box (Composer.module.css). */}
        <div className={styles.modeRow}>
          {line ? (
            <>
              {tools}
              <ComposerModeMenu mode={mode} onMode={onMode} modes={MODES} fieldRef={textareaRef} />
            </>
          ) : (
            <>
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
              {variant === 'roll' && tools}
            </>
          )}
        </div>
        {/* The input and Send: one flex item on a `roll` row, so a composer that wraps wraps them TOGETHER (Send alone on a second row was 44px of the story for one button). `display: contents` otherwise (Composer.module.css). The hidden hint belongs to the textarea and rides with it. */}
        <div className={styles.inputRow}>
          {/* The field: the textarea and, while locked, a lock glyph at its trailing edge (the reason's visible mark that takes no height; the textarea gets 28px of end padding while locked, so nothing shifts). */}
          <div className={styles.field}>
            <textarea
              ref={(el) => {
                textareaRef.current = el;
                if (textareaAnchorRef) textareaAnchorRef.current = el;
              }}
              className={styles.input}
              placeholder={lockReason ?? (shortPlaceholder ? record?.placeholderShort : record?.placeholderLong) ?? ''}
              aria-describedby={shortPlaceholder ? hintId : undefined}
              value={value}
              rows={1}
              enterKeyHint={line ? 'send' : undefined}
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
            {locked && (
              <span className={styles.lockGlyph} aria-hidden="true" title={lockReason ?? undefined} data-composer-lock-glyph="">
                <Icon name="Lock" size={16} />
              </span>
            )}
          </div>
          {shortPlaceholder && <span id={hintId} className="sr-only">{record?.placeholderLong}</span>}
          <button
            type="button"
            className={styles.send}
            // Not native `disabled` either: a keyboard user on Send loses focus the
            // moment the draft clears (value -> empty -> !canSend).
            {...lockProps(!canSend, { busy: pending })}
            aria-label={pending ? 'Sending…' : 'Send'}
            {...(line ? keepFieldFocus : null)}
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
    </div>
  );
}
