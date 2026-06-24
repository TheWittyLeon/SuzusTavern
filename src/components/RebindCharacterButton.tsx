'use client';
/**
 * RebindCharacterButton (B2-4) — "Change character" affordance in the party panel.
 *
 * Renders a small pencil button next to a party member row. Clicking opens an
 * accessible popover that lists the user's live characters (and a "DM only / no
 * character" option). On confirm, calls POST /api/dnd/sessions/{id}/bind and
 * fires onChanged so the parent can re-fetch participants.
 *
 * Visibility:
 *   - Own row: always visible (for self-rebind).
 *   - Other rows: visible only when `isDm` is true (DM-rebind-others).
 *
 * Disabled state:
 *   - When combat is active (`combatActive`): button shown but disabled with a
 *     tooltip "End or pause the fight to switch characters". Engine would still
 *     200 a direct API call (mid-fight rebind is a server-side no-op), but we
 *     prevent accidental confusion.
 *
 * Error handling (engine 400 reason codes):
 *   - not_your_character → "That character doesn't belong to you."
 *   - unknown_character  → "That character was not found."
 *   - not_a_member       → "You're not a member of this session."
 *   - msm_disabled       → "Character binding is not available right now."
 *   - forbidden_other_user → "You can only change your own character." (BFF 403)
 *   - Fallback: "Could not change character. Try again."
 *
 * A11Y:
 *   - Popover has role="dialog", aria-modal, aria-label.
 *   - Focus moves into the popover on open (container first, then first option).
 *     Returns to trigger on close.
 *   - Escape closes. Tab/Shift-Tab are trapped within the popover.
 *   - Character list uses role="radiogroup" + role="radio" with roving tabindex
 *     and arrow-key navigation.
 *   - Touch targets ≥44px via CSS.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { bindCharacter, listMyCharacters } from '@/lib/api/dnd';
import { useToast } from '@/components/Toast';
import type { ApiError, Character } from '@/lib/api/types';
import styles from './RebindCharacterButton.module.css';

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

function bindErrorMessage(e: unknown): string {
  if (!isApiError(e)) return 'Could not change character. Try again.';
  const body = e.body as
    | { data?: { reason?: string }; reason?: string }
    | null
    | undefined;
  const reason = body?.data?.reason ?? body?.reason ?? e.code;
  const map: Record<string, string> = {
    not_your_character:    "That character doesn't belong to you.",
    unknown_character:     'That character was not found.',
    not_a_member:          "You're not a member of this session.",
    msm_disabled:          'Character binding is not available right now.',
    forbidden_other_user:  'You can only change your own character.',
  };
  return map[reason ?? ''] ?? 'Could not change character. Try again.';
}

export interface RebindCharacterButtonProps {
  sessionId: string;
  /** The party member whose character is being changed. */
  targetUsername: string;
  /** The logged-in user's username — used to list their characters. */
  selfUsername: string;
  /** True when the logged-in user is the session DM (shows button on all rows). */
  isDm: boolean;
  /** True when a combat is currently active — disables the button. */
  combatActive: boolean;
  /** Called after a successful rebind so the parent can re-fetch participants. */
  onChanged: () => void;
}

/**
 * Thin outer wrapper — does the visibility guard (early return OK, no hooks).
 * All hooks live in RebindCharacterButtonInner.
 */
export default function RebindCharacterButton(props: RebindCharacterButtonProps) {
  const isSelf = props.targetUsername.toLowerCase() === props.selfUsername.toLowerCase();
  // Only show the button for own row OR when DM — safe early return, no hooks here.
  if (!isSelf && !props.isDm) return null;
  return <RebindCharacterButtonInner {...props} />;
}

/** Inner component — owns ALL hooks, never early-returns. */
function RebindCharacterButtonInner({
  sessionId,
  targetUsername,
  selfUsername,
  combatActive,
  onChanged,
}: RebindCharacterButtonProps) {
  const { toast } = useToast();
  const uid = useId();
  const dialogId = `${uid}-rebind-dialog`;
  const labelId  = `${uid}-rebind-label`;
  const liveId   = `${uid}-rebind-live`;

  const [open, setOpen]         = useState(false);
  const [busy, setBusy]         = useState(false);
  const [chars, setChars]       = useState<Character[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // character_id string or '' for none
  // Index of the radio option that holds tabIndex=0 (roving tabindex).
  const [focusedIdx, setFocusedIdx] = useState(0);

  const triggerRef  = useRef<HTMLButtonElement>(null);
  const popoverRef  = useRef<HTMLDivElement>(null);
  // Refs for each radio option — built from the chars array (index 0 = "no char").
  const optionRefs  = useRef<(HTMLButtonElement | null)[]>([]);

  const isSelf = targetUsername.toLowerCase() === selfUsername.toLowerCase();

  // Load characters on open. focusedIdx is reset to 0 in the trigger handler
  // (an event, not an effect) so the first option gets the roving tabIndex.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listMyCharacters(selfUsername)
      .then((list) => { if (!cancelled) setChars(list); })
      .catch(() => { if (!cancelled) setChars([]); });
    return () => { cancelled = true; };
  }, [open, selfUsername]);

  // Focus management — Phase 1: immediately focus the dialog container on open,
  // return focus to trigger on close.
  useEffect(() => {
    if (open) {
      popoverRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [open]);

  // Focus management — Phase 2: once chars resolves, move focus to the first
  // radio option. This runs every time chars transitions from null → array.
  useEffect(() => {
    if (open && chars !== null) {
      optionRefs.current[0]?.focus();
    }
  }, [open, chars]);

  // Keep optionRefs in sync with the rendered radio list length.
  // Count: 1 ("no character") + chars.length.
  const optionCount = chars !== null ? 1 + chars.length : 0;

  const closePopover = useCallback(() => {
    setOpen(false);
    setChars(null);
    setSelected(null);
  }, []);

  // Tab trap: cycle focusable children within the popover.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        closePopover();
        return;
      }

      if (e.key === 'Tab') {
        const popover = popoverRef.current;
        if (!popover) return;
        const focusable = Array.from(
          popover.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.tabIndex !== -1);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last  = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [busy, closePopover],
  );

  // Arrow-key navigation for the radiogroup (roving tabindex).
  const handleRadioKeyDown = useCallback(
    (e: React.KeyboardEvent, idx: number) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = (idx + 1) % optionCount;
        setFocusedIdx(next);
        optionRefs.current[next]?.focus();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = (idx - 1 + optionCount) % optionCount;
        setFocusedIdx(prev);
        optionRefs.current[prev]?.focus();
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        // Select the focused option (value: '' for index 0, char id for others).
        if (idx === 0) {
          setSelected('');
        } else if (chars && chars[idx - 1]) {
          setSelected(String(chars[idx - 1].character_id));
        }
      }
    },
    [optionCount, chars],
  );

  const handleConfirm = useCallback(async () => {
    if (busy || selected === null) return;
    setBusy(true);
    try {
      await bindCharacter(sessionId, {
        username: targetUsername,
        character_id: selected === '' ? null : Number(selected),
      });
      toast({ tone: 'info', message: 'Character updated.' });
      onChanged();
      closePopover();
    } catch (err) {
      toast({ tone: 'error', message: bindErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  }, [busy, selected, sessionId, targetUsername, toast, onChanged, closePopover]);

  const tooltip = combatActive
    ? 'End or pause the fight to switch characters'
    : isSelf
      ? 'Change your character'
      : `Change ${targetUsername}'s character`;

  // Build option list for rendering (parallel array for roving tabindex tracking).
  // options[0] = "no character", options[1..] = characters.
  const options: { id: string; label: string; sub?: string }[] = chars
    ? [
        { id: '', label: '— No character (DM / observer only) —' },
        ...chars.map((c) => ({
          id: String(c.character_id),
          label: c.name,
          sub: `${c.char_class} · lv ${c.level}`,
        })),
      ]
    : [];

  return (
    <span className={styles.wrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        title={tooltip}
        aria-label={tooltip}
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        disabled={combatActive}
        onClick={() => { if (!combatActive) { setFocusedIdx(0); setOpen(true); } }}
      >
        {/* Pencil/edit icon — inline SVG keeps the bundle lean */}
        <svg
          aria-hidden="true"
          focusable="false"
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11 2l3 3-8 8H3v-3l8-8z" />
        </svg>
      </button>

      {open && (
        <div className={styles.backdrop} onClick={(e) => {
          if (e.target === e.currentTarget && !busy) closePopover();
        }}>
          <div
            id={dialogId}
            ref={popoverRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelId}
            tabIndex={-1}
            className={styles.popover}
            onKeyDown={handleKeyDown}
          >
            <h3 id={labelId} className={styles.heading}>
              {isSelf ? 'Change your character' : `Change ${targetUsername}'s character`}
            </h3>

            {/* Iro MEDIUM-1: persistent live region wraps the load/list swap so
                "Loading characters…" → options is announced to AT. */}
            <div
              id={liveId}
              aria-live="polite"
              aria-atomic="true"
            >
              {chars === null ? (
                <p className={styles.loading}>Loading characters…</p>
              ) : (
                <div
                  role="radiogroup"
                  aria-label="Select a character"
                  className={styles.list}
                >
                  {options.map((opt, idx) => (
                    <button
                      key={opt.id}
                      ref={(el) => { optionRefs.current[idx] = el; }}
                      type="button"
                      role="radio"
                      aria-checked={selected === opt.id}
                      /* Roving tabindex: only the focused option is in the tab order. */
                      tabIndex={idx === focusedIdx ? 0 : -1}
                      className={`${styles.option} ${selected === opt.id ? styles.optionSelected : ''}`}
                      onClick={() => { setSelected(opt.id); setFocusedIdx(idx); }}
                      onKeyDown={(e) => handleRadioKeyDown(e, idx)}
                    >
                      <span className={styles.optionName}>{opt.label}</span>
                      {opt.sub && (
                        <span className={styles.optionSub}>{opt.sub}</span>
                      )}
                    </button>
                  ))}

                  {chars.length === 0 && (
                    <p className={styles.empty}>
                      You have no characters yet. Create one first.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={closePopover}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => void handleConfirm()}
                disabled={busy || selected === null}
                aria-busy={busy}
              >
                {busy ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
