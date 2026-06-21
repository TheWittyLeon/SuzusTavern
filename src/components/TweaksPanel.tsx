'use client';
/**
 * TweaksPanel — appearance settings popover (S3.1 / ST-073).
 *
 * An icon button in TavernShell opens a focus-trapped popover that lets the
 * player pick one of the four palettes and one of the three densities. Choices
 * apply live (no reload) via ThemeProvider and persist to localStorage.
 *
 * A11y (also satisfies S3.4 keyboard + S3.5 screen-reader for this surface):
 *  - Trigger is a labelled icon button with aria-haspopup="dialog" + aria-expanded.
 *  - Options are NATIVE radio inputs grouped in <fieldset>/<legend> — free
 *    arrow-key roving, group semantics, and SR announcements.
 *  - The open panel is role="dialog" aria-modal, traps Tab, closes on Escape and
 *    outside-click, and restores focus to the trigger on close.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import Icon from '@/components/Icon';
import { useTheme } from '@/lib/theme/ThemeProvider';
import {
  DENSITIES,
  DENSITY_LABELS,
  VIBES,
  VIBE_HINTS,
  VIBE_LABELS,
} from '@/lib/theme/theme';
import styles from './TweaksPanel.module.css';

export default function TweaksPanel() {
  const { vibe, density, setVibe, setDensity } = useTheme();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const titleId = `${uid}-title`;

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Focus the checked palette radio on open. Outside-click dismissal is handled
  // by the backdrop (below), which makes aria-modal honest — page content is
  // genuinely inert while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const checked = panelRef.current?.querySelector<HTMLInputElement>(
        'input[name="tavern-vibe"]:checked',
      );
      checked?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  const onPanelKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      // Trap Tab within the panel's focusable controls.
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'input, button',
      );
      if (!focusables || focusables.length === 0) return;
      const list = Array.from(focusables).filter((el) => !el.hasAttribute('disabled'));
      const first = list[0];
      const last = list[list.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [close],
  );

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((o) => !o)}
        aria-label="Appearance settings"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Icon name="Sliders" size={17} aria-hidden />
      </button>

      {open && (
        <>
          {/* Backdrop intercepts outside clicks (incl. the sibling UserMenu
              trigger) so only one popover is open at a time and aria-modal is
              truthful. Transparent — appearance settings shouldn't dim the page. */}
          <div className={styles.backdrop} onClick={() => close(false)} aria-hidden />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={styles.panel}
          onKeyDown={onPanelKeyDown}
        >
          <p id={titleId} className={styles.panelTitle}>
            Appearance
          </p>

          <fieldset className={styles.group}>
            <legend className={styles.legend}>Palette</legend>
            <div className={styles.options}>
              {VIBES.map((v) => (
                <label key={v} className={styles.option}>
                  <input
                    type="radio"
                    name="tavern-vibe"
                    value={v}
                    checked={vibe === v}
                    onChange={() => setVibe(v)}
                    className={styles.radio}
                  />
                  <span className={styles.optionBody}>
                    <span className={`${styles.swatch} ${styles[`sw_${v.replace('-', '_')}`]}`} aria-hidden />
                    <span className={styles.optionText}>
                      <span className={styles.optionLabel}>{VIBE_LABELS[v]}</span>
                      <span className={styles.optionHint}>{VIBE_HINTS[v]}</span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.group}>
            <legend className={styles.legend}>Density</legend>
            <div className={styles.densityRow}>
              {DENSITIES.map((d) => (
                <label key={d} className={styles.densityOption}>
                  <input
                    type="radio"
                    name="tavern-density"
                    value={d}
                    checked={density === d}
                    onChange={() => setDensity(d)}
                    className={styles.radio}
                  />
                  <span className={styles.densityChip}>{DENSITY_LABELS[d]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        </>
      )}
    </div>
  );
}
