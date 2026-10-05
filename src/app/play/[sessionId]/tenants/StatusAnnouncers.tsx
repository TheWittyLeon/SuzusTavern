'use client';

import type { RefObject } from 'react';
import type { Session } from '@/lib/api/types';
import SessionRecap from '@/components/SessionRecap';
import { DURABLE_GENERATION_ENABLED } from '@/lib/config';
import { HELD_FROZEN_NOTE } from '@/lib/dnd/heldFight';
import styles from '../Play.module.css';

/**
 * TAV-PLAY-SHELL step 6b, commit C2 (Amendment B.4, answers S6) — five of
 * page.tsx's live-region nodes that have no `RegionId` of their own: they
 * ride inside `storyLog`'s slot rather than owning a grid area, so they are
 * TENANTS (`REGION_TENANTS` in `presets.ts`), not regions. Moved VERBATIM —
 * every id, class, role and aria attribute is byte-identical to page.tsx's
 * prior inline JSX; only `data-tenant="<id>"` is new. Every comment
 * explaining WHY each node is shaped the way it is (A1/A2/A8's reasoning)
 * is kept, because that reasoning is the reason a future edit must not
 * "simplify" these back toward a conditionally-mounted wrapper.
 *
 * FIVE named exports, not one Fragment-returning component, for the same
 * reason `regions/TopBar.tsx` and `regions/TableControls.tsx` already give:
 * today's DOM does not hold these five contiguous (StoryLog, DmCombatControls
 * and CastSpellPanel sit between some of them) — a single combined export
 * would have to move at least one of them to be contiguous, and this commit
 * is explicitly DOM-neutral except the new `data-tenant` attributes
 * (build brief §7 C2.6). Each is called from page.tsx at its exact original
 * position. The tenth announcer that needs this same treatment is a new
 * named export here plus one `REGION_TENANTS` row — never a code change to
 * an existing one.
 */

export interface SessionRecapTenantProps {
  session: Session | null;
  username: string | null;
  /** True while combat is active: the strip steps aside (A9d F3) but stays mounted, so the
   *  wrapper is still a live region and the strip keeps its fetch and its `dismissed` state.
   *  It is still in the Journal's Recap history. */
  stepAside?: boolean;
}

/** FIX-8 (MEDIUM-2): aria-label on the live region so AT announces the
 *  context ("Session recap") before reading the content changes.
 *  `role="group"` (round 7, Tora-Dep's prod test: axe `aria-prohibited-attr`, serious): a role-less `div` may not carry a name, so the label was ignored. A GROUP, not a
 *  `region`: this wrapper is always mounted (a live region must exist before its content arrives) and is EMPTY until a recap exists and while combat steps it aside; a
 *  `region` is a landmark and would list an empty "Session recap" in every screen reader's landmark menu. A group is a named container, not a landmark. */
export function SessionRecapTenant({ session, username, stepAside }: SessionRecapTenantProps) {
  return (
    <div role="group" aria-live="polite" aria-label="Session recap" data-tenant="sessionRecap">
      {session && (
        <SessionRecap key={session.session_id} session={session} username={username} variant="strip" hidden={stepAside} />
      )}
    </div>
  );
}

export interface SessionPausedEndedTenantProps {
  isEnded: boolean;
  isPaused: boolean;
}

/** DDX-25: ONE persistent live region for session pause/end — mirrors the
 *  Iro MEDIUM-2 turn-status pattern below (always mounted, only the
 *  text/class swap in place) so AT users get exactly one announcement on
 *  the transition, not a mount/unmount per render. Visible to every seat,
 *  not just the DM — it's the reason the composer/action rail gets
 *  disabled. */
export function SessionPausedEndedTenant({ isEnded, isPaused }: SessionPausedEndedTenantProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={isEnded ? styles.sessionEndedStatus : isPaused ? styles.sessionPausedStatus : 'sr-only'}
      data-tenant="sessionPausedEnded"
    >
      {isEnded
        ? 'Session ended. The DM can start a new one from the dashboard.'
        : isPaused
          ? "Session paused by the DM — you can't act until it resumes."
          : ''}
    </div>
  );
}

export interface TurnStatusTenantProps {
  combatIsActive: boolean;
  activeIsMine: boolean;
  turnStatusText: string | null;
  /** The fight is held: nobody holds a turn, so there is no turn text. The line says why the verbs are locked instead (Tora MINOR-7) and is not announced: the stage strip says the hold once. */
  held?: boolean;
}

/** Iro MEDIUM-2: ONE persistent live region for turn status. Stays mounted
 *  throughout combat; only the text and className change in place. This
 *  prevents the 4s poll from re-triggering AT announcements on every
 *  combatState object replacement when the text hasn't actually changed. */
export function TurnStatusTenant({ combatIsActive, activeIsMine, turnStatusText, held = false }: TurnStatusTenantProps) {
  if (!combatIsActive) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      // Iro MAJOR-2: was an exact string match on 'Your turn!', which
      // silently fell through to offTurnStatus styling for the isDying
      // label. Key off activeIsMine directly instead — both "your turn"
      // variants (normal + dying) style as your-turn.
      className={activeIsMine ? styles.myTurnStatus : styles.offTurnStatus}
      data-tenant="turnStatus"
    >
      {/* Held: an aria-hidden element INSIDE the stable live node (its role and attributes never change, so nothing is re-announced), and being an element child it keeps the line painted and its height. */}
      {held ? <span aria-hidden="true">{HELD_FROZEN_NOTE}</span> : turnStatusText}
    </div>
  );
}

export interface DeadStatusTenantProps {
  combatIsActive: boolean;
  isMyPcDead: boolean;
}

/** Combat-UX Fixes 2026-07-27 §UI-states "Dead" row (Kage-CR/test-plan
 *  §4.2, previously dropped): a dead PC never becomes the active-turn
 *  participant again, so this can't reuse TurnStatusTenant's region — it
 *  needs its own always-checked gate keyed on the viewer's own roster
 *  entry, independent of whose turn it is.
 *  TAV-PLAY-A11Y-DEADSTATUS-NOT-ALWAYS-MOUNTED: the wrapper is NOT gated
 *  on `combatIsActive && isMyPcDead` (that dropped the live region itself
 *  the instant combat ended while isMyPcDead stayed true — Iro-A11y). The
 *  wrapper mounts unconditionally; only the CONTENT is gated. Empty text
 *  collapses to zero footprint via `.deadStatus:empty` in Play.module.css. */
export function DeadStatusTenant({ combatIsActive, isMyPcDead }: DeadStatusTenantProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={styles.deadStatus}
      data-tenant="deadStatus"
    >
      {combatIsActive && isMyPcDead ? 'Your character has died.' : null}
    </div>
  );
}

export interface DurableRetryRowTenantProps {
  durableRetryRowRef: RefObject<HTMLDivElement | null>;
  jobFailed: boolean;
  onRetryFailedTurn: () => void;
}

/** DDX-20 §9/§4d — retry-after-failed affordance (flag-ON only; `jobFailed`
 *  is never set on the flag-OFF path). Retrying mints a FRESH turn_key
 *  (narrateDurable always does) — the failed one is deduped-forever
 *  server-side. role="status" + aria-live="polite" so a screen reader
 *  announces the failure + retry option once, mirroring the file's other
 *  persistent live-region status rows.
 *  Iro MAJOR-1: PERMANENTLY mounted (contents toggle, not the wrapper
 *  itself) with tabIndex={-1} — same xCardBannerRef pattern as the
 *  safety-signal banner. `onRetryFailedTurn` refocuses this wrapper BEFORE
 *  unmounting the Retry button, so focus never drops to <body>.
 *  `.durableRetryRow:empty` collapses it to zero footprint (no padding/
 *  border/margin) without display:none/visibility:hidden, which would
 *  also pull it out of the a11y tree. */
export function DurableRetryRowTenant({
  durableRetryRowRef,
  jobFailed,
  onRetryFailedTurn,
}: DurableRetryRowTenantProps) {
  if (!DURABLE_GENERATION_ENABLED) return null;
  return (
    <div
      ref={durableRetryRowRef}
      tabIndex={-1}
      className={styles.durableRetryRow}
      role="status"
      aria-live="polite"
      data-tenant="durableRetryRow"
    >
      {jobFailed && (
        <>
          <span id="durable-retry-message">Suzu&apos;s last reply didn&apos;t come through.</span>
          <button
            type="button"
            className="btn"
            onClick={onRetryFailedTurn}
            aria-describedby="durable-retry-message"
          >
            Retry
          </button>
        </>
      )}
    </div>
  );
}
