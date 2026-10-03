'use client';

import { useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import AnchoredPopover from '@/components/AnchoredPopover';
import Icon from '@/components/Icon';
import { keepFieldFocus } from '@/lib/a11y/keepFieldFocus';
import { useAnchoredPopover } from '@/lib/a11y/useAnchoredPopover';
import { MODE_RECORD, type ComposeMode } from '@/components/composeModes';
import styles from './ComposerModeMenu.module.css';

/**
 * The phone's mode control (A10 step 11 tail, S6; Aoi's drawing, Iro's section 6, Tora C-6): a MENU BUTTON, never a control that cycles on press (one stray tap would change what Send does).
 * It shows the current mode as a word and a chevron; its name is "<mode>, compose mode" (the visible word first, WCAG 2.5.3); it opens `useAnchoredPopover`'s menu upward, one
 * `menuitemradio` per mode the PAGE passes (`modes`: three for a player, two for a human DM; nothing here adds or filters one, and the message POST stays the authority), each 44px with a check on
 * the current one and a hint line. Arrows, Home and End move; Enter and Space choose (native buttons); Escape closes (the hook). A mode change never touches the draft.
 *
 * FOCUS (the coordinator's binding ruling): choosing returns focus to WHERE IT WAS before the menu opened. Opened by touch while the field has focus (the player was typing), the buttons here keep
 * the field's focus on pointerdown (`keepFieldFocus`), the menu does not take it (`keepFocusInPlace`), and after the choice the keyboard is still up and nothing new is raised. Opened from the
 * button (keyboard, a screen reader, a switch, or a tap with the field unfocused), focus moves into the menu and comes back to the button, whose name now carries the new mode. No path moves
 * focus INTO the field because a mode was chosen. The new mode is announced by the button's name and the field's name ("Compose (act)"); nothing here is live.
 */
export interface ComposerModeMenuProps {
  mode: ComposeMode;
  onMode: (m: ComposeMode) => void;
  /** The page's `availableModes`: [mode, the page's own label]. The word shown is the record's, the page's label is the fallback for a mode with no record. */
  modes: [ComposeMode, string][];
  /** The composer's field: the menu keeps its focus when the press that opened it came while the field had it. */
  fieldRef: RefObject<HTMLTextAreaElement | null>;
}

export default function ComposerModeMenu({ mode, onMode, modes, fieldRef }: ComposerModeMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Whether the field had focus when the press that opened the menu STARTED (a pointer press), and so whether focus stays put. A keyboard activation has no pointerdown: it moves focus in.
  const fieldHadFocusRef = useRef(false);
  const keepRef = useRef(false);
  const pop = useAnchoredPopover({
    open,
    onClose: () => setOpen(false),
    anchorRef,
    role: 'menu',
    initialFocus: '[role="menuitemradio"][aria-checked="true"]',
    keepFocusInPlace: () => keepRef.current,
  });
  const nameId = useId();
  const labelOf = (k: ComposeMode, fallback: string) => MODE_RECORD[k]?.label ?? fallback;
  const current = modes.find(([k]) => k === mode);
  const word = labelOf(mode, current?.[1] ?? mode);
  const hint = MODE_RECORD[mode]?.hint ?? '';

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items[next]?.focus();
      return;
    }
    pop.popoverProps.onKeyDown(e); // Escape and Tab past either end: the hook's contract
  };

  return (
    <div className={styles.box}>
      <button
        ref={anchorRef}
        type="button"
        className={styles.button}
        data-mode={mode}
        data-mode-menu=""
        aria-label={`${word}, compose mode`}
        {...pop.anchorProps}
        onPointerDown={(e) => {
          fieldHadFocusRef.current = !!fieldRef.current && document.activeElement === fieldRef.current;
          keepFieldFocus.onPointerDown(e);
        }}
        onMouseDown={keepFieldFocus.onMouseDown}
        onClick={(e) => {
          // `detail` is 0 for a keyboard or assistive activation and 1+ for a press: only a press made while the field had focus keeps it there.
          keepRef.current = fieldHadFocusRef.current && e.detail > 0;
          fieldHadFocusRef.current = false;
          setOpen((o) => !o);
        }}
      >
        <span className={styles.word} aria-hidden="true">{word}</span>
        <span className={styles.hint} aria-hidden="true">{hint}</span>
        <Icon name="Chevron" size={12} className={open ? `${styles.chevron} ${styles.chevronOpen}` : styles.chevron} aria-hidden />
      </button>
      <AnchoredPopover pop={pop} role="menu" label="Compose mode" className={styles.menu}>
        <div
          ref={menuRef}
          className={styles.items}
          onKeyDown={onMenuKeyDown}
          id={nameId}
        >
          {modes.map(([k, fallback]) => (
            <button
              key={k}
              type="button"
              role="menuitemradio"
              aria-checked={k === mode}
              className={styles.item}
              {...keepFieldFocus}
              onClick={() => {
                onMode(k);
                setOpen(false);
              }}
            >
              <span className={styles.check} aria-hidden="true">{k === mode ? <Icon name="Check" size={16} /> : null}</span>
              <span className={styles.itemText}>
                <b className={styles.itemWord}>{labelOf(k, fallback)}</b>
                <small className={styles.itemHint}>{MODE_RECORD[k]?.hint ?? ''}</small>
              </span>
            </button>
          ))}
        </div>
      </AnchoredPopover>
    </div>
  );
}
