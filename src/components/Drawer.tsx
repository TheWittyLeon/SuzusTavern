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
 * A6 — `visible` (not `open`) drives the visual open class, the scrim AND
 * `inert`/`aria-hidden`, so the three can never desync. `open` alone drives
 * dialog SEMANTICS (role/aria-modal/tabIndex/the Esc+Tab-trap keydown
 * handler) — this is what lets the Journal pane be `visible` (mobile tab
 * active) without being a `dialog` at all, while the member-sheet drawer
 * (no separate mobile presentation) simply passes the same value for both.
 *
 * `open`/`visible` are DELIBERATELY two separate props, not one collapsed
 * into the other — see A6 above; a caller with no second presentation
 * (member-sheet today) passes the same boolean for both, which is one
 * caller-side line, not a second code path in here.
 */

export interface DrawerProps {
  /** DOM id on the `<aside>` — also this drawer's stable identity for tests/CSS. */
  id: string;
  /** Dialog semantics active: role="dialog", aria-modal, Tab-trap, Escape-to-close. */
  open: boolean;
  /** Mounted-and-presented (may be true while `open` is false — see A6 above). */
  visible: boolean;
  /** id of the heading inside `children` that names this drawer (children own their own heading). */
  labelledBy: string;
  onClose: () => void;
  /** The close button lives inside `children`; the drawer focuses it on open and traps Tab within it. */
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  /**
   * True for a drawer that hands off to an in-flow mobile-tab pane below
   * the play shell's phone breakpoint (today: the Journal only) instead of
   * staying a fixed overlay at every width (the member-sheet drawer has no
   * such fallback and stays fixed everywhere — Play.module.css's own
   * comment on `.memberSheetDrawer` says so explicitly). Gates the fixed/
   * slide-over geometry to `PLAY_PHONE_QUERY`'s complement; below that
   * width both flip back to normal flow so the caller's own mobile-pane
   * `className` (below) can lay it out instead.
   */
  mobileTabFallback?: boolean;
  /** Caller-owned class(es) layered on the `<aside>` — e.g. the Journal's
   *  own `.journalPane`, which Play.module.css's `.showJournal .journalPane`
   *  mobile rule still targets for the in-flow pane layout. */
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
  visible,
  labelledBy,
  onClose,
  closeButtonRef,
  mobileTabFallback = false,
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

  // Esc + a generic Tab-trap, wired only while acting as a dialog (`open`) —
  // never while merely `visible` (e.g. the Journal's mobile tab pane, which
  // is a plain pane, not a dialog).
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
      {visible && (
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
          className={mobileTabFallback ? styles.scrimMobileFallback : styles.scrim}
          onClick={onClose}
        />
      )}
      <aside
        id={id}
        ref={dialogRef}
        className={[
          mobileTabFallback ? styles.drawerMobileFallback : styles.drawer,
          visible ? styles.drawerOpen : '',
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        // Unconditional (not `open ? ... : undefined`) so the region is
        // named in a non-dialog presentation too (e.g. the Journal's mobile
        // tab) — harmless when `inert`/`aria-hidden` removes it from the
        // tree entirely.
        aria-labelledby={labelledBy}
        // Belt-and-suspenders: `inert` is the real mechanism, but jsdom
        // does not implement its side effects at all (confirmed: neither
        // jsdom nor dom-accessibility-api reference `inert`) — without
        // aria-hidden too, a closed-but-mounted drawer's content would
        // still surface in a role-based test query. aria-hidden alone IS
        // honored by dom-accessibility-api's isInaccessible(), so pairing
        // them is correct in both real browsers and this test environment.
        aria-hidden={visible ? undefined : true}
        inert={!visible}
        tabIndex={open ? -1 : undefined}
        onKeyDown={open ? onKeyDown : undefined}
      >
        {children}
      </aside>
    </>
  );
}
