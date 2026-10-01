/**
 * useRovingToolbar — A9c-1 C5 (build brief §4.2, Iro IMPORTANT-2).
 *
 * The WAI-ARIA toolbar pattern as one hook: a group of controls is ONE tab stop
 * and arrow keys move between its items. `/play`'s scene stage was 13 tab stops
 * (six dice, every quick check, three advantage pills) in front of the
 * composer; three toolbars make it three.
 *
 *   const dice = useRovingToolbar({ label: 'Dice', itemCount: 6 });
 *   <div {...dice.toolbarProps}>
 *     {items.map((x, i) => <button key={i} {...dice.itemProps(i)}>...</button>)}
 *   </div>
 *
 * Behaviour:
 *  - `role="toolbar"` + `aria-label` + `aria-orientation` on the container.
 *  - Exactly one item has `tabIndex=0` (the active one); the rest are -1.
 *  - Arrow keys along the orientation (wrapping), Home and End. Items that are
 *    NATIVELY disabled are skipped (they cannot take focus). `aria-disabled`
 *    items stay reachable by design.
 *  - Focus or click on an item makes it the active one (Safari does not focus a
 *    button on click, so click is handled too). Both are delegated at the
 *    container: no per-item handlers to compose with the caller's own.
 *  - Modified keys (Alt/Ctrl/Meta/Shift) are left alone.
 *
 * Mirror note (brief §4.2): the repo already has five hand-rolled roving
 * implementations (modules/page.tsx, Composer, LevelChoicePicker,
 * RebindCharacterButton, SpellbookPanel). This is the shared one; moving the
 * five onto it is TAV-A11Y-ROVING-CONSOLIDATE (P3), not this commit's.
 */
import { useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';

export type ToolbarOrientation = 'horizontal' | 'vertical';

export interface RovingToolbarOptions {
  label: string;
  /** Which arrow keys move focus. Default `horizontal` (Left/Right). */
  orientation?: ToolbarOrientation;
  /** How many items the toolbar renders this pass. */
  itemCount: number;
  /** True for an item that is natively disabled this pass (it is never the
   *  tab stop and arrow keys step over it). */
  isDisabled?: (index: number) => boolean;
}

const ITEM_ATTR = 'data-roving-item';

const KEYS: Record<ToolbarOrientation, { next: string; prev: string }> = {
  horizontal: { next: 'ArrowRight', prev: 'ArrowLeft' },
  vertical: { next: 'ArrowDown', prev: 'ArrowUp' },
};

function itemOf(target: EventTarget | null, container: HTMLElement): HTMLElement | null {
  const el = (target as HTMLElement | null)?.closest?.(`[${ITEM_ATTR}]`) as HTMLElement | null;
  return el && container.contains(el) ? el : null;
}

export function useRovingToolbar({
  label,
  orientation = 'horizontal',
  itemCount,
  isDisabled,
}: RovingToolbarOptions) {
  const [active, setActive] = useState(0);

  // The tab stop: the active item, unless it is gone or disabled, then the first enabled one.
  const clamped = Math.min(active, Math.max(itemCount - 1, 0));
  let tabStop = clamped;
  if (isDisabled?.(clamped)) {
    tabStop = -1;
    for (let i = 0; i < itemCount; i += 1) {
      if (!isDisabled(i)) {
        tabStop = i;
        break;
      }
    }
  }

  const activate = (el: HTMLElement | null) => {
    if (el) setActive(Number(el.getAttribute(ITEM_ATTR)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const current = itemOf(e.target, e.currentTarget);
    if (!current) return;
    const { next, prev } = KEYS[orientation];
    if (e.key !== next && e.key !== prev && e.key !== 'Home' && e.key !== 'End') return;

    const enabled = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(`[${ITEM_ATTR}]`)).filter(
      (el) => !el.matches(':disabled'),
    );
    if (enabled.length === 0) return;
    const at = enabled.indexOf(current);
    let to: HTMLElement;
    if (e.key === 'Home') to = enabled[0];
    else if (e.key === 'End') to = enabled[enabled.length - 1];
    else if (e.key === next) to = enabled[(at + 1) % enabled.length];
    else to = enabled[(at - 1 + enabled.length) % enabled.length];

    e.preventDefault();
    to.focus();
    activate(to);
  };

  return {
    /** Spread onto the container element. */
    toolbarProps: {
      role: 'toolbar' as const,
      'aria-label': label,
      'aria-orientation': orientation,
      onKeyDown,
      onFocus: (e: FocusEvent<HTMLElement>) => activate(itemOf(e.target, e.currentTarget)),
      onClick: (e: MouseEvent<HTMLElement>) => activate(itemOf(e.target, e.currentTarget)),
    },
    /** Spread onto the i-th item. */
    itemProps: (index: number) => ({
      tabIndex: index === tabStop ? 0 : -1,
      [ITEM_ATTR]: index,
    }),
  };
}
