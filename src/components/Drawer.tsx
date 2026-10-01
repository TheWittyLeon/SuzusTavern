'use client';

import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import styles from './Drawer.module.css';

/**
 * TAV-PLAY-SHELL step 2 — the one Drawer primitive, replacing the two
 * hand-rolled `<aside>`s in `/play` (the Journal pane and the member-sheet
 * panel — decomposition plan §5 step 2, §6 "One Drawer"). Preserves both of
 * their invariants byte-for-byte:
 *
 * A5 — ALWAYS MOUNTED. The caller renders this unconditionally (never
 * `{open && <Drawer>}`) so the slide transition always has a "from" state;
 * `visible` controls presence via `inert`+`aria-hidden` instead of
 * mount/unmount. `inert` is the real mechanism (blocks focus + pointer
 * events + a11y-tree presence natively); `aria-hidden` is required
 * alongside it because jsdom implements neither `inert` nor its side
 * effects, but `aria-hidden` IS honored by dom-accessibility-api's
 * isInaccessible() in both real browsers and this repo's test environment.
 *
 * A6 — `open` drives the visual open class, the scrim, `inert`/`aria-hidden`
 * AND dialog semantics (role/aria-modal/tabIndex/the Esc+Tab-trap keydown
 * handler) together, so they can never desync.
 *
 * A9d E4: ONE presentation at every width. Until then the Journal had a second,
 * in-flow mobile-tab presentation below 880px, which is why `open` and a
 * separate `visible` existed (a pane could be presented without being a dialog)
 * and why Kage I1's `open`-without-`visible` state needed a guard. Both props'
 * reason is gone: `visible` and `mobileTabFallback` are deleted, `isVisible =
 * open`, and the bad state is unrepresentable rather than guarded.
 */

export interface DrawerProps {
  /** DOM id on the `<aside>` — also this drawer's stable identity for tests/CSS. */
  id: string;
  /** Presented as a dialog: role="dialog", aria-modal, Tab-trap, Escape-to-close, scrim, and not `inert`. */
  open: boolean;
  /** id of the heading inside `children` that names this drawer (children own their own heading). */
  labelledBy: string;
  onClose: () => void;
  /** The close button lives inside `children`; the drawer focuses it on open and traps Tab within it. */
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}

/**
 * Content-agnostic — moved here from page.tsx's module scope (was
 * JOURNAL_FOCUSABLE_SELECTOR; the Tab-trap already queried it fresh on
 * every Tab rather than caching refs, since drawer content is dynamic —
 * e.g. the Journal's notes textarea, a growing NPC/recap list).
 */
const DRAWER_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What a click lands on that a user would call "the button I pressed". */
const ACTIVATOR_SELECTOR = 'button, a[href], [role="button"], [tabindex]';

/**
 * The drawer's tab stops, in DOM order: the focusable ones a Tab can land on. A roving toolbar's inactive items
 * (`tabindex="-1"`) are not stops, and nothing hidden or inert is (jsdom has no layout, so visibility is judged on
 * the attributes a stylesheet cannot change).
 */
function tabStops(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR)).filter(
    (el) => el.tabIndex >= 0 && !el.closest('[hidden], [inert], [aria-hidden="true"]'),
  );
}

export default function Drawer({
  id,
  open,
  labelledBy,
  onClose,
  closeButtonRef,
  children,
}: DrawerProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // WebKit (Safari, iOS) does not focus a button on click or tap, so at the moment a drawer opens from a
  // click `document.activeElement` is <body> and there is nothing to restore to (Iro A9d-1 IMPORTANT-3). The
  // opening event is the click itself: record, in the capture phase at the document, what the last click
  // landed on. The drawer is always mounted (A5), so the listener is there before any open, and no caller has
  // to hand it its opener (the party tile, the journal toggle, a third drawer's trigger).
  const lastActivatorRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const record = (e: Event) => {
      const hit = (e.target as Element | null)?.closest?.(ACTIVATOR_SELECTOR);
      if (hit instanceof HTMLElement) lastActivatorRef.current = hit;
    };
    document.addEventListener('click', record, true);
    return () => document.removeEventListener('click', record, true);
  }, []);

  // Focus management on open/close — remember whatever was focused before
  // opening, focus the drawer's close button after paint, restore focus on
  // close via this effect's own cleanup (fires for every path `open` flips
  // false: Esc, scrim click, or the close button itself) — one source of
  // truth instead of one per call site.
  useEffect(() => {
    if (!open) return;
    // The focused element, else (WebKit after a click: <body>) what the opening click landed on.
    const active = document.activeElement as HTMLElement | null;
    const opener = active && active !== document.body ? active : lastActivatorRef.current;
    previouslyFocusedRef.current = opener && opener.isConnected && !dialogRef.current?.contains(opener) ? opener : null;
    const t = setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, closeButtonRef]);

  // Esc + a generic Tab-trap, wired only while `open`.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        // TAV-A11Y-USE-ESCAPE-CONSUME-HOOK: neither drawer has a busy state
        // to gate on, so the close always fires alongside the unconditional
        // stopPropagation().
        consumeEscape(e, { onClose });
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        // The trap owns EVERY Tab and Shift+Tab (A9d-2, Iro A9d-1 IMPORTANT-3). It used to step in only when focus
        // was ON the first or last stop and left the rest to the browser, but Safari's default skips buttons in
        // the Tab order, so the first thing Shift+Tab reaches from the notes textarea is outside the dialog (the
        // Close button, the "first" stop, was never in the order): the trap never fired and focus left the modal.
        const stops = tabStops(dialogRef.current);
        e.preventDefault();
        if (stops.length === 0) {
          dialogRef.current.focus();
          return;
        }
        const at = stops.indexOf(document.activeElement as HTMLElement);
        const to = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at === -1 || at === stops.length - 1 ? 0 : at + 1;
        stops[to].focus();
      }
    },
    [onClose],
  );

  return (
    <>
      {open && (
        <div
          // The scrim has no natural accessible role/name to query by (it's
          // a bare click-catcher) — data-testid is this repo's established
          // escape hatch for that case (Composer.tsx's death-save pips).
          // Deliberately NOT a CSS Module class-name substring match: that
          // couples a test to Drawer's internal styling implementation, and
          // literally broke this way once already (play.journal.test.tsx
          // querying `[class*="journalScrim"]`, a name this component no
          // longer uses) when the two hand-rolled scrims were consolidated
          // into this component.
          data-testid={`${id}-scrim`}
          className={styles.scrim}
          onClick={onClose}
        />
      )}
      <aside
        id={id}
        ref={dialogRef}
        className={open ? `${styles.drawer} ${styles.drawerOpen}` : styles.drawer}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        // Unconditional: harmless when `inert`/`aria-hidden` removes it from
        // the tree entirely.
        aria-labelledby={labelledBy}
        // Belt-and-suspenders: `inert` is the real mechanism, but jsdom
        // does not implement its side effects at all (confirmed: neither
        // jsdom nor dom-accessibility-api reference `inert`) — without
        // aria-hidden too, a closed-but-mounted drawer's content would
        // still surface in a role-based test query. aria-hidden alone IS
        // honored by dom-accessibility-api's isInaccessible(), so pairing
        // them is correct in both real browsers and this test environment.
        aria-hidden={open ? undefined : true}
        inert={!open}
        tabIndex={open ? -1 : undefined}
        onKeyDown={open ? onKeyDown : undefined}
      >
        {children}
      </aside>
    </>
  );
}
