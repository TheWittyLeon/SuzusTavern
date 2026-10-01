'use client';
/**
 * TweaksPanel — appearance settings popover (S3.1 / ST-073).
 *
 * An icon button in TavernShell opens a focus-trapped popover that lets the
 * player pick one of the four palettes and one of the three densities. Choices
 * apply live (no reload) via ThemeProvider and persist to localStorage.
 *
 * A9c-2 D3 (R23): a third group, Layout (Auto / Story / Table), picks `/play`'s
 * preset. It is `disabled` on a phone, which has one layout (R16). The panel is
 * mounted from TavernShell AND from `/play`'s TopBar (`settings` slot), where an
 * ancestor can be a stacking context or clip it — so the open panel and its
 * backdrop PORTAL to `document.body` and are `position: fixed`, placed from the
 * trigger's rect.
 *
 * A11y (also satisfies S3.4 keyboard + S3.5 screen-reader for this surface):
 *  - Trigger is a labelled icon button with aria-haspopup="dialog" + aria-expanded.
 *  - Options are NATIVE radio inputs grouped in <fieldset>/<legend> — free
 *    arrow-key roving, group semantics, and SR announcements.
 *  - The open panel is role="dialog" aria-modal, traps Tab (`useFocusTrap`: a radio
 *    group is one tab stop, so the wrap points are the checked radios, not the first/
 *    last input), closes on Escape and outside-click, and returns focus to the
 *    trigger on EVERY close (Escape, backdrop, picking) via the hook's cleanup.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/Icon';
import { PLAY_PHONE_QUERY } from '@/lib/breakpoints';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import { useFocusTrap } from '@/lib/a11y/useFocusTrap';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { useMediaQuery } from '@/lib/useMediaQuery';
import {
  DENSITIES,
  DENSITY_LABELS,
  LAYOUT_PHONE_NOTE,
  LAYOUT_PREFS,
  LAYOUT_PREF_HINTS,
  LAYOUT_PREF_LABELS,
  VIBE_PREFS,
  VIBE_PREF_HINTS,
  VIBE_PREF_LABELS,
} from '@/lib/theme/theme';
import styles from './TweaksPanel.module.css';

const PANEL_MAX_WIDTH = 300;
const EDGE = 12;
const GAP = 10;

/** Where the fixed panel sits: under the trigger, right edges aligned, kept
 *  inside the viewport (its height is capped to what is left below it, and the
 *  panel scrolls). Mirrors `.panel`'s `width: min(300px, 100vw - 24px)`. */
function placePanel(trigger: HTMLElement): CSSProperties {
  const r = trigger.getBoundingClientRect();
  const width = Math.min(PANEL_MAX_WIDTH, window.innerWidth - 2 * EDGE);
  const left = Math.max(EDGE, Math.min(r.right - width, window.innerWidth - width - EDGE));
  const top = r.bottom + GAP;
  return { top, left, maxHeight: Math.max(120, window.innerHeight - top - EDGE) };
}

export default function TweaksPanel() {
  const { vibePref, density, layout, setVibe, setDensity, setLayout } = useTheme();
  const isPhone = useMediaQuery(PLAY_PHONE_QUERY);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const titleId = `${uid}-title`;

  // Focus returns to the trigger from the trap's cleanup, not from here: a close that
  // focused the trigger before the dialog unmounted would have it pulled straight
  // back by the trap's focusin backstop.
  const close = useCallback(() => setOpen(false), []);
  useFocusTrap(panelRef, open, { restoreFocusTo: triggerRef });

  // Place the fixed panel from the trigger, and keep it there while the page
  // resizes or scrolls (the trigger can sit in a scrolling region).
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      if (triggerRef.current) setPlace(placePanel(triggerRef.current));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

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
      consumeEscape(e, { onClose: () => close() });
    },
    [close],
  );

  const panel = open
    ? createPortal(
        <>
          {/* Backdrop intercepts outside clicks (incl. the sibling UserMenu
              trigger) so only one popover is open at a time and aria-modal is
              truthful. Transparent — appearance settings shouldn't dim the page. */}
          <div className={styles.backdrop} onClick={close} aria-hidden />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={styles.panel}
            style={place}
            onKeyDown={onPanelKeyDown}
          >
            <p id={titleId} className={styles.panelTitle}>
              Appearance
            </p>

            <fieldset className={styles.group}>
              <legend className={styles.legend}>Palette</legend>
              <div className={styles.options}>
                {VIBE_PREFS.map((v) => (
                  <label key={v} className={styles.option}>
                    <input
                      type="radio"
                      name="tavern-vibe"
                      value={v}
                      checked={vibePref === v}
                      onChange={() => setVibe(v)}
                      className={styles.radio}
                    />
                    <span className={styles.optionBody}>
                      <span className={`${styles.swatch} ${styles[`sw_${v.replace('-', '_')}`]}`} aria-hidden />
                      <span className={styles.optionText}>
                        <span className={styles.optionLabel}>{VIBE_PREF_LABELS[v]}</span>
                        <span className={styles.optionHint}>{VIBE_PREF_HINTS[v]}</span>
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

            {/* R23: Auto is the default (nothing stored; picking it clears the key).
                R16: a phone has one layout, so the choice is shown but inert. */}
            <fieldset className={styles.group} disabled={isPhone} aria-describedby={`${uid}-layout-hint`}>
              <legend className={styles.legend}>Layout</legend>
              <div className={styles.densityRow}>
                {LAYOUT_PREFS.map((l) => (
                  <label key={l} className={styles.densityOption}>
                    <input
                      type="radio"
                      name="tavern-layout"
                      value={l}
                      checked={layout === l}
                      onChange={() => setLayout(l)}
                      className={styles.radio}
                    />
                    <span className={styles.densityChip}>{LAYOUT_PREF_LABELS[l]}</span>
                  </label>
                ))}
              </div>
              <p id={`${uid}-layout-hint`} className={styles.groupHint}>
                {isPhone ? LAYOUT_PHONE_NOTE : LAYOUT_PREF_HINTS[layout]}
              </p>
            </fieldset>
          </div>
        </>,
        document.body,
      )
    : null;

  return (
    <div className={styles.wrap}>
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
      {panel}
    </div>
  );
}
