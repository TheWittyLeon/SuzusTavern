'use client';

/**
 * TAV-PLAY-SHELL step 5, hook 3 of ~9 (decomposition plan §2.2) —
 * `useSafety`. Owns plan §1.10: the DDX-26 durable, cross-client X-card
 * safety signal -- its state, the raise handler, and the derived
 * "is the banner active" boolean.
 *
 * Takes `session: Session | null`, not just `sessionId` (the plan's own
 * abridged signature is `useSafety(sessionId)`) -- `onRaiseXCard` needs
 * both the "has the session actually loaded yet" guard (`!session`) and
 * `session.session_id` for the write itself, and useSafety doesn't own
 * `session` (useSessionLifecycle does). This is the same kind of
 * signature adjustment useMyCharacter's header already flags: the plan's
 * table is illustrative, not a literal contract.
 *
 * Deliberately does NOT own: the unified events poll's several
 * `setXCardEvent`/`setLatestNarrationSeq` calls (that poll's `events`
 * dependency is `useSessionEvents`, hook 7 -- not yet extracted; those
 * call sites stay in page.tsx and keep calling this hook's returned
 * setters, same pattern as hook 1/2's mount-effect/no-char-toast
 * markers), and the SafetyBanner JSX + its inline onDismiss handler
 * (render, not state -- SafetyBanner is already its own region, extracted
 * in step 3).
 */
import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { postXCard } from '@/lib/api/dnd';
import type { Session } from '@/lib/api/types';

export interface XCardEvent {
  seq: number;
  actor?: string;
}

export interface UseSafetyResult {
  xCardEvent: XCardEvent | null;
  setXCardEvent: Dispatch<SetStateAction<XCardEvent | null>>;
  latestNarrationSeq: number | null;
  setLatestNarrationSeq: Dispatch<SetStateAction<number | null>>;
  dismissedXCardSeq: number | null;
  setDismissedXCardSeq: Dispatch<SetStateAction<number | null>>;
  xCardBusy: boolean;
  xCardBannerRef: RefObject<HTMLDivElement | null>;
  xCardActive: boolean;
  onRaiseXCard: () => Promise<void>;
}

export function useSafety(session: Session | null): UseSafetyResult {
  const { user } = useAuth();
  const username = user?.username ?? null;
  const { toast } = useToast();

  // DDX-26 — durable X-card tracking, derived from the SAME events poll as
  // dice rolls (no new poll). `xCardEvent` pairs seq+actor so a batch never
  // attributes the wrong raiser (see page.tsx's scanXCardTracking). Both
  // this and `latestNarrationSeq` are updated via the functional setState
  // form (`setXCardEvent((prev) => ...)`) by that poll, which always reads
  // the CURRENT committed state at update time — the poll effect's deps
  // are [sessionId, state] (mirrors the dice-roll poll's own reasoning),
  // so a plain closure read of these values inside `poll()` would be
  // stale; the functional updater sidesteps that without needing a
  // ref-mirror.
  const [xCardEvent, setXCardEvent] = useState<XCardEvent | null>(null);
  const [latestNarrationSeq, setLatestNarrationSeq] = useState<number | null>(null);
  // Per-client dismiss, keyed to the seq it was raised for the seat's
  // active banner (dismisses only unnamed on the exact raise) — a NEW
  // x_card (higher seq) is a different raise and re-shows regardless of
  // this value.
  const [dismissedXCardSeq, setDismissedXCardSeq] = useState<number | null>(null);
  // Synchronous double-submit latch for the X-card button (mirrors
  // rollBusyRef) — raising is a real server write (persists an `x_card`
  // event); a same-tick double-click must not fire it twice.
  const xCardBusyRef = useRef(false);
  const [xCardBusy, setXCardBusy] = useState(false);
  // Iro MAJOR-2: the banner wrapper is a PERMANENT, always-mounted anchor
  // (see page.tsx's SafetyBanner call site — only its children toggle) so
  // it's stable regardless of `mobileView`, mirroring the
  // sceneHeadRef/endCombatBtnRef refocus convention. Dismiss unmounts the
  // focused Dismiss button; refocusing this wrapper (tabIndex={-1}) before
  // that unmount lands focus here instead of dropping it to <body>.
  const xCardBannerRef = useRef<HTMLDivElement>(null);

  // ── safety: X-card (DDX-26) ────────────────────────────────────────────
  // Durable, cross-client safety signal. Deliberately NOT gated on
  // sessionLocked/talking — a safety tool must stay reachable regardless
  // of table state. xCardBusyRef: synchronous double-submit latch (mirrors
  // rollBusyRef) — this is a real server write (persists an `x_card`
  // event), so a same-tick double-click must not fire it twice.
  const onRaiseXCard = useCallback(async () => {
    if (!session || xCardBusyRef.current) return;
    xCardBusyRef.current = true;
    setXCardBusy(true);
    try {
      const result = await postXCard(session.session_id);
      // Optimistic local banner — the events poll will also observe this
      // same event (durable truth) and converge every other open tab,
      // exactly like a dice roll converges via the same poll.
      // Kage IMPORTANT-1: the engine (and the BFF passthrough) nests the
      // event under `.event` — read seq/actor from there, never off the
      // top-level result, or this optimistic banner silently never fires.
      const seq = result?.event?.seq;
      if (seq != null) {
        const xCard = { seq, actor: result?.event?.actor ?? username ?? undefined };
        setXCardEvent((prev) => (!prev || xCard.seq > prev.seq ? xCard : prev));
      }
      // UIR2-TAV-25 (CSS/overlap part): no success toast here. The
      // full-width, permanently-mounted xCardBanner already shows "A
      // safety signal was raised — the table eases off." the instant
      // xCardEvent updates — a second, DIFFERENT-toned corner toast saying
      // nearly the same thing was redundant AND is what caused the
      // reported overlap: the global Toast viewport is position:fixed
      // bottom-right (Toast.module.css), which sits directly over this
      // pane's Safety block/X-card button at desktop widths, and (being on
      // its own 5s timer, decoupled from xCardEvent/dismissedXCardSeq)
      // could still be visibly present after the raiser had already
      // dismissed the banner — reading as "persists after dismissed". The
      // banner is the single source of truth for this signal now; only a
      // genuine failure (below) still needs a one-off toast, since no
      // banner event exists to show.
    } catch {
      toast({ tone: 'error', message: 'Could not raise the X-card — try again.' });
    } finally {
      xCardBusyRef.current = false;
      setXCardBusy(false);
    }
  }, [session, username, toast]);

  // DDX-26 — X-card banner active-state: the raised signal is still the
  // newest "beat" on the table (no later narration beat has superseded
  // it) AND this client hasn't already dismissed THIS specific raise
  // (dismissal is keyed to seq, so a fresh higher-seq x_card always
  // re-shows even if a stale one was dismissed — this is what fixes
  // UIR2-TAV-25's persists-after-dismiss bug: the old client-local toast
  // had no seq to key off at all). Mirrors the engine's own soft-redirect
  // auto-clear: once `latestNarrationSeq` overtakes the raise, the table
  // has "eased off" and the banner steps aside on its own, no dismiss
  // required.
  const xCardActive =
    xCardEvent != null &&
    (latestNarrationSeq == null || xCardEvent.seq > latestNarrationSeq) &&
    xCardEvent.seq > (dismissedXCardSeq ?? -1);

  return {
    xCardEvent,
    setXCardEvent,
    latestNarrationSeq,
    setLatestNarrationSeq,
    dismissedXCardSeq,
    setDismissedXCardSeq,
    xCardBusy,
    xCardBannerRef,
    xCardActive,
    onRaiseXCard,
  };
}
