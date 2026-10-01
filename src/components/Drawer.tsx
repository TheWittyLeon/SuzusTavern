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
  /** Caller-owned class(es) layered on the `<aside>`. */
  className?: string;
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

export default function Drawer({
  id,
  open,
  labelledBy,
  onClose,
  closeButtonRef,
  className,
  children,
}: DrawerProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Focus management on open/close — remember whatever was focused before
  // opening, focus the drawer's close button after paint, restore focus on
  // close via this effect's own cleanup (fires for every path `open` flips
  // false: Esc, scrim click, or the close button itself) — one source of
  // truth instead of one per call site.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
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
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
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
        className={[
          styles.drawer,
          open ? styles.drawerOpen : '',
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
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
