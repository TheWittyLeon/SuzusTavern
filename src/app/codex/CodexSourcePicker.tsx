'use client';
// src/app/codex/CodexSourcePicker.tsx
//
// TAV-CODEX-SOURCE-PICKER-NPC (Aoi-UI §1) — the codex header's single-select
// content-source filter: All sources / SRD / Suzu's / one option per
// homebrew pack, labelled by `display_name`.
//
// ARIA pattern: a collapsible "select-only combobox" (APG) — the trigger is
// non-editable (no text input), matching the existing in-app precedent that
// the results list is already a role="listbox" + aria-activedescendant
// virtual-focus widget (page.tsx's onListboxKeyDown). Trigger:
// role="combobox", aria-haspopup="listbox", aria-expanded, aria-controls,
// aria-activedescendant while open. Popup: role="listbox",
// aria-label="Content source", options role="option"/aria-selected, the
// selected one also carries a non-color "check" glyph (mirrors CodexRow's
// `.rowOn` "selected" chip — never color alone, Iro).
//
// Degraded states (Aoi-UI §1):
//   - packs still loading: trigger reads "All sources", not interactive.
//   - packs endpoint failed: trigger reads "All sources" + an inline notice
//     sits next to it — the rest of the page keeps working against the
//     unfiltered /catalog (no `pack` param sent for any kind).

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Icon from '@/components/Icon';
import type { ContentPack } from '@/lib/api/types';
import { groupPacksBySource } from '@/lib/dnd/codex';
import styles from './Codex.module.css';

/** A11Y MAJOR-5 precedent (page.tsx): typeahead buffer reset window. */
const TYPEAHEAD_RESET_MS = 500;

export type PacksStatus = 'loading' | 'ok' | 'error';

export interface CodexSourcePickerProps {
  packs: ContentPack[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  status: PacksStatus;
}

interface FlatOption {
  value: string | undefined;
  label: string;
}

const ALL_OPTION: FlatOption = { value: undefined, label: 'All sources' };

export default function CodexSourcePicker({ packs, value, onChange, status }: CodexSourcePickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef<{ buffer: string; timer: ReturnType<typeof setTimeout> | null }>({
    buffer: '',
    timer: null,
  });
  const popupId = useId();
  const labelId = useId();

  const grouped = useMemo(() => groupPacksBySource(packs), [packs]);
  const interactive = status === 'ok';

  // Flattened options in display order — group headers are NOT options (APG:
  // a listbox's direct interactive children are role="option" only; group
  // labels are presentational dividers, matched by index-skipping below).
  // Kage-CR #6: memoized — `selectIndex`/`onTriggerKeyDown` close over this
  // array, and an unmemoized conditional expression here made its identity
  // (and therefore useCallback's dependency) change on every render.
  const options: FlatOption[] = useMemo(
    () =>
      interactive
        ? [
            ALL_OPTION,
            ...grouped.srd.map((p) => ({ value: p.pack_id, label: p.display_name })),
            ...grouped.suzu.map((p) => ({ value: p.pack_id, label: p.display_name })),
            ...grouped.homebrew.map((p) => ({ value: p.pack_id, label: p.display_name })),
            ...grouped.other.map((p) => ({ value: p.pack_id, label: p.display_name })),
          ]
        : [ALL_OPTION],
    [interactive, grouped],
  );

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selectedLabel = options[selectedIndex]?.label ?? ALL_OPTION.label;

  const optionDomId = useCallback((idx: number) => `${popupId}-opt-${idx}`, [popupId]);

  const closePopup = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const openPopup = useCallback(() => {
    if (!interactive) return;
    setActiveIndex(selectedIndex);
    setOpen(true);
  }, [interactive, selectedIndex]);

  const selectIndex = useCallback(
    (idx: number) => {
      const opt = options[idx];
      if (!opt) return;
      onChange(opt.value);
      closePopup(true);
    },
    [options, onChange, closePopup],
  );

  // Kage-CR #19: clear a pending typeahead-buffer-reset timer on unmount —
  // otherwise it fires after the component is gone (harmless in practice,
  // since it only mutates a ref, but still a leaked timer with no owner).
  useEffect(() => {
    const typeahead = typeaheadRef.current;
    return () => {
      if (typeahead.timer) clearTimeout(typeahead.timer);
    };
  }, []);

  // Outside click closes without change (APG select-only combobox contract).
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  // CRITICAL-1 (Iro-A11y): real DOM focus NEVER leaves this trigger button —
  // the popup <ul> below is a virtual-focus listbox (APG select-only
  // combobox), never itself focused. Every key this widget handles — both
  // "closed, about to open" AND "open, navigating" — therefore lives in ONE
  // handler on the button, keyed on `open`, matching the exact precedent
  // this file's header already cites (page.tsx's listbox: one handler,
  // `aria-activedescendant`, virtual focus). A handler on the `<ul>` (a
  // sibling of the focused button, not an ancestor) would never fire.
  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openPopup();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectIndex(activeIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePopup(true);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const ta = typeaheadRef.current;
      if (ta.timer) clearTimeout(ta.timer);
      ta.buffer += e.key.toLowerCase();
      ta.timer = setTimeout(() => {
        ta.buffer = '';
      }, TYPEAHEAD_RESET_MS);
      const match = options.findIndex((o) => o.label.toLowerCase().startsWith(ta.buffer));
      if (match !== -1) setActiveIndex(match);
    }
  };

  return (
    <div className={styles.sourcePicker} ref={rootRef}>
      <span id={labelId} className="sr-only">
        Content source
      </span>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={popupId}
        aria-labelledby={`${labelId} ${labelId}-value`}
        // Kage-CR #16: aria-disabled, not the native `disabled` attribute —
        // `disabled` removes the button from the tab order entirely, so a
        // keyboard/AT user tabbing past it during "packs loading"/"packs
        // failed" gets no signal it exists at all. `aria-disabled` keeps it
        // reachable and announced as disabled (with a reason, via the
        // adjacent notice on error) while `openPopup()` already no-ops for
        // both click and keydown when `!interactive` — so it stays inert
        // either way, just discoverable.
        aria-disabled={!interactive || undefined}
        className={styles.sourcePickerTrigger}
        aria-activedescendant={open ? optionDomId(activeIndex) : undefined}
        onClick={() => (open ? closePopup(false) : openPopup())}
        onKeyDown={onTriggerKeyDown}
      >
        <Icon name="Compass" size={14} aria-hidden />
        <span id={`${labelId}-value`}>{selectedLabel}</span>
        <Icon name="Chevron" size={12} aria-hidden className={styles.sourcePickerChevron} />
      </button>

      {status === 'error' && (
        <span className={styles.sourcePickerNotice} role="status" aria-live="polite">
          <span aria-hidden="true">!</span> Sources unavailable — showing everything
        </span>
      )}

      {open && (
        <ul
          ref={popupRef}
          id={popupId}
          role="listbox"
          aria-label="Content source"
          className={styles.sourcePickerPopup}
        >
          {renderGroup(null, [ALL_OPTION], 0)}
          {/* Aoi-UI §1: SRD/Suzu's render FLAT (no group heading) — assumes
              exactly one pack of each kind today. If the packs-list ever
              returns >1 of either, every one of them still renders (and is
              still keyboard-reachable/selectable via `options` above) —
              just without a sub-group heading, per Aoi's own documented
              fallback ("flag to Sora", not a silent drop). */}
          {grouped.srd.length > 0 &&
            renderGroup(
              null,
              grouped.srd.map((p) => ({ value: p.pack_id, label: p.display_name })),
              1,
            )}
          {grouped.suzu.length > 0 &&
            renderGroup(
              null,
              grouped.suzu.map((p) => ({ value: p.pack_id, label: p.display_name })),
              1 + grouped.srd.length,
            )}
          {grouped.homebrew.length > 0 &&
            renderGroup(
              'Homebrew',
              grouped.homebrew.map((p) => ({ value: p.pack_id, label: p.display_name })),
              1 + grouped.srd.length + grouped.suzu.length,
            )}
          {grouped.other.length > 0 &&
            renderGroup(
              'Other',
              grouped.other.map((p) => ({ value: p.pack_id, label: p.display_name })),
              1 + grouped.srd.length + grouped.suzu.length + grouped.homebrew.length,
            )}
        </ul>
      )}
    </div>
  );

  function renderOptions(groupOptions: FlatOption[], startIndex: number) {
    return groupOptions.map((opt, i) => {
      const idx = startIndex + i;
      const selected = opt.value === value;
      return (
        <li
          key={opt.value ?? '__all__'}
          id={optionDomId(idx)}
          role="option"
          aria-selected={selected}
          className={`${styles.sourcePickerOption} ${idx === activeIndex ? styles.sourcePickerOptionActive : ''}`}
          onMouseDown={(e) => {
            // Prevent the outside-click/blur handler from firing before
            // the click's own selection logic runs.
            e.preventDefault();
          }}
          onClick={() => selectIndex(idx)}
        >
          {selected && <Icon name="Check" size={12} aria-hidden className={styles.sourcePickerCheck} />}
          {opt.label}
        </li>
      );
    });
  }

  // MAJOR-1 (Iro-A11y): a flat group (All/SRD/Suzu's — no heading) renders
  // its options as direct children of the outer listbox. A HEADED group
  // (Homebrew/Other) uses the APG grouped-listbox shape instead of a bare
  // `aria-hidden` divider, so the heading text ("Homebrew") actually reaches
  // the accessibility tree.
  //
  // Iro-A11y (live pass, .226) MINOR aria-allowed-role: `role="group"` +
  // `aria-labelledby` must NOT sit on the outer `<li>` — ARIA-in-HTML
  // doesn't permit `group` on `li` there. Canonical APG shape instead: the
  // outer `<li>` is a plain presentational wrapper (HTML still wants a
  // `<ul>`'s direct children to be `<li>`s); `role="group"` +
  // `aria-labelledby` move onto the inner `<ul>` (a valid host for `group`),
  // which wraps the group's actual `role="option"` items. Zero visual
  // change — same DOM shape, the roles just moved one level down.
  function renderGroup(heading: string | null, groupOptions: FlatOption[], startIndex: number) {
    if (!heading) return <>{renderOptions(groupOptions, startIndex)}</>;
    const headingId = `${popupId}-group-${heading.toLowerCase()}`;
    return (
      <li role="presentation">
        <span id={headingId} role="presentation" className={styles.sourcePickerGroup}>
          {heading}
        </span>
        <ul role="group" aria-labelledby={headingId} className={styles.sourcePickerGroupList}>
          {renderOptions(groupOptions, startIndex)}
        </ul>
      </li>
    );
  }
}
