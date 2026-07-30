'use client';
/**
 * SpellInfoPopover — LEVELUP-UX: inline spell details (casting time, range,
 * components, duration, description) on a hover/tap "toggletip".
 *
 * Mounted next to a spell wherever one is being chosen or browsed — the
 * level-up spell picker (LevelChoicePicker's SpellChoiceCard) and both
 * SpellbookPanel tabs. The data is already ON the entry (the engine inlines
 * `_spell_wire_info` onto both spell-list wires), so opening the popover is
 * free — no fetch, no loading state.
 *
 * Interaction contract (Tora: no nested interactives, hover never fights a
 * click target):
 *   - The wrapper span is the HOVER surface: mousing over the child (the
 *     option button / spell name) or the trigger shows the panel; mousing
 *     away hides it. Hover is additive-only — it never intercepts clicks on
 *     the wrapped control.
 *   - The ⓘ trigger button is the TAP/KEYBOARD surface: click toggles a
 *     pinned-open state (touch has no hover), focus shows, blur hides.
 *   - Escape closes — routed through consumeEscape ONLY while open, so a
 *     closed popover lets Escape bubble to whatever overlay owns it.
 *   - iOS Safari doesn't focus buttons on tap (blur can never fire), so a
 *     document pointerdown-outside listener backstops the pinned state.
 *
 * A11y: trigger has aria-expanded + aria-controls; the panel follows it in
 * DOM order so SR users arrow straight into the content. Fields absent on a
 * pre-upgrade backend simply don't render (SpellWireInfo is all-optional);
 * if nothing is available the panel says so instead of opening empty.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Icon from '@/components/Icon';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import type { SpellWireInfo } from '@/lib/api/types';
import styles from './SpellInfoPopover.module.css';

export interface SpellInfoPopoverSpell extends SpellWireInfo {
  name: string;
  level?: number;
  school?: string;
  concentration?: boolean;
  ritual?: boolean;
}

export interface SpellInfoPopoverProps {
  spell: SpellInfoPopoverSpell;
  /** The hover surface — usually the option button or spell name this
   *  popover annotates. Rendered inside the wrapper, BEFORE the trigger. */
  children?: ReactNode;
  className?: string;
}

/** {V:true, S:true, M:'a bit of fur'} → "V, S, M (a bit of fur)". Exported
 *  for tests. */
export function formatComponents(
  components: Record<string, boolean | string> | undefined,
): string {
  if (!components) return '';
  return Object.entries(components)
    .filter(([, v]) => v !== false && v != null)
    .map(([k, v]) => (typeof v === 'string' && v ? `${k} (${v})` : k))
    .join(', ');
}

export default function SpellInfoPopover({
  spell,
  children,
  className,
}: SpellInfoPopoverProps) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const uid = useId();
  const panelId = `${uid}-spell-info`;
  const open = hoverOpen || pinned;

  // Pinned-open backstop for taps that never focus the trigger (iOS): any
  // pointerdown outside the wrapper closes. Attached only while open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPinned(false);
        setHoverOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const componentsText = formatComponents(spell.components);
  const rows: [string, string][] = [];
  if (spell.casting_time) rows.push(['Casting time', spell.casting_time]);
  if (spell.range) rows.push(['Range', spell.range]);
  if (componentsText) rows.push(['Components', componentsText]);
  if (spell.duration) {
    rows.push([
      'Duration',
      spell.concentration ? `Concentration, ${spell.duration}` : spell.duration,
    ]);
  }
  const hasAnyInfo = rows.length > 0 || !!spell.description;

  const levelText =
    spell.level == null
      ? null
      : spell.level === 0
        ? 'Cantrip'
        : `Level ${spell.level}`;

  return (
    <span
      ref={wrapRef}
      className={`${styles.wrap} ${className ?? ''}`}
      onMouseEnter={() => setHoverOpen(true)}
      onMouseLeave={() => {
        setHoverOpen(false);
        setPinned(false);
      }}
    >
      {children}
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Spell details: ${spell.name}`}
        onClick={() => {
          // Toggling off must also drop hover — on a mouse click the pointer
          // is still over the wrapper, so hoverOpen alone would hold it open.
          if (open) {
            setPinned(false);
            setHoverOpen(false);
          } else {
            setPinned(true);
          }
        }}
        onFocus={() => setHoverOpen(true)}
        onBlur={() => {
          setHoverOpen(false);
          setPinned(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            consumeEscape(e, {
              onClose: () => {
                setPinned(false);
                setHoverOpen(false);
              },
            });
          }
        }}
      >
        <Icon name="Eye" size={13} aria-hidden />
      </button>
      {open && (
        <span id={panelId} className={styles.panel}>
          <span className={styles.head}>
            <strong className={styles.name}>{spell.name}</strong>
            {(levelText || spell.school) && (
              <span className={`mono ${styles.meta}`}>
                {[levelText, spell.school, spell.ritual ? 'ritual' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </span>
          {hasAnyInfo ? (
            <>
              {rows.length > 0 && (
                <span className={styles.rows}>
                  {rows.map(([label, value]) => (
                    <span key={label} className={styles.row}>
                      <span className={styles.rowLabel}>{label}</span>
                      <span className={styles.rowValue}>{value}</span>
                    </span>
                  ))}
                </span>
              )}
              {spell.description && (
                <span className={styles.description}>{spell.description}</span>
              )}
              {spell.higher_levels && (
                <span className={styles.description}>
                  <strong>At higher levels.</strong> {spell.higher_levels}
                </span>
              )}
            </>
          ) : (
            <span className={styles.description}>
              No details available for this spell yet.
            </span>
          )}
        </span>
      )}
    </span>
  );
}
