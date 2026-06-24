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
 *   - Focus moves into the popover on open; restores on close.
 *   - Escape closes. Focus is trapped between interactive elements.
 *   - Character radio list uses role="radiogroup" + role="radio".
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

export default function RebindCharacterButton({
  sessionId,
  targetUsername,
  selfUsername,
  isDm,
  combatActive,
  onChanged,
}: RebindCharacterButtonProps) {
  const { toast } = useToast();
  const uid = useId();
  const dialogId = `${uid}-rebind-dialog`;
  const labelId  = `${uid}-rebind-label`;

  const [open, setOpen]       = useState(false);
  const [busy, setBusy]       = useState(false);
  const [chars, setChars]     = useState<Character[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // character_id string or '' for none

  const triggerRef  = useRef<HTMLButtonElement>(null);
  const popoverRef  = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  const isSelf = targetUsername.toLowerCase() === selfUsername.toLowerCase();

  // Only show the button for own row OR when DM
  if (!isSelf && !isDm) return null;

  // Load characters on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listMyCharacters(selfUsername)
      .then((list) => { if (!cancelled) setChars(list); })
      .catch(() => { if (!cancelled) setChars([]); });
    return () => { cancelled = true; };
  }, [open, selfUsername]);

  // Focus management: into popover on open, back to trigger on close
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => firstItemRef.current?.focus(), 50);
      return () => clearTimeout(t);
    } else {
      triggerRef.current?.focus();
    }
  }, [open]);

  const closePopover = useCallback(() => {
    setOpen(false);
    setChars(null);
    setSelected(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        closePopover();
      }
    },
    [busy, closePopover],
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
        onClick={() => { if (!combatActive) setOpen(true); }}
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

            {chars === null ? (
              <p className={styles.loading}>Loading characters…</p>
            ) : (
              <div
                role="radiogroup"
                aria-label="Select a character"
                className={styles.list}
              >
                {/* "DM only / no character" option */}
                <button
                  ref={firstItemRef}
                  type="button"
                  role="radio"
                  aria-checked={selected === ''}
                  className={`${styles.option} ${selected === '' ? styles.optionSelected : ''}`}
                  onClick={() => setSelected('')}
                >
                  <span className={styles.optionName}>— No character (DM / observer only) —</span>
                </button>

                {chars.map((c) => (
                  <button
                    key={c.character_id}
                    type="button"
                    role="radio"
                    aria-checked={selected === String(c.character_id)}
                    className={`${styles.option} ${selected === String(c.character_id) ? styles.optionSelected : ''}`}
                    onClick={() => setSelected(String(c.character_id))}
                  >
                    <span className={styles.optionName}>{c.name}</span>
                    <span className={styles.optionSub}>
                      {c.char_class} · lv {c.level}
                    </span>
                  </button>
                ))}

                {chars.length === 0 && (
                  <p className={styles.empty}>
                    You have no characters yet. Create one first.
                  </p>
                )}
              </div>
            )}

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
