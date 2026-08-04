'use client';
/**
 * ResourcePanel — the character sheet's class-declared resources.
 *
 * The engine has served a generic resource surface for a while (Ki, Rage,
 * Action Surge, Channel Divinity, Lay on Hands, a subclass's Natural Recovery,
 * the Vessel's Resonance/Instability, ...) and nothing in the Tavern rendered
 * it, so none of it was reachable by a player. This is that surface.
 *
 * Conventions are lifted from CurrencyPurse/HpControl deliberately — the
 * synchronous `useRef` double-submit latch, apply-the-authoritative-response-
 * immediately, structured `data.reason` refusal mapping, a toast for a11y,
 * `aria-busy` while in flight, and an owner gate on every mutating control.
 *
 * ── Two `kind`s, and why they must not share a visual language ──────────────
 * A "pool" counts DOWN from its maximum (Ki 3/5 = three left; full is GOOD).
 * A "track" counts UP toward it (Instability 6/10 = six accrued; full is BAD
 * and triggers a Surge). Rendering both as "current/maximum" with the same
 * meter direction would tell a Vessel their danger meter is a healthy
 * resource. The fill WIDTH is the same computation for both (Kage-CR S2 — an
 * earlier version of this comment claimed the track filled in the opposite
 * direction; it does not). What differs is the colour token, the footer copy,
 * and the meter's aria-label — and, once a track passes half, an explicit
 * "critical" in both the text and the label, because the neutral and danger
 * fills are only 1.07-1.50:1 apart from each other across the four palettes
 * and colour alone would be carrying nothing (Iro-A11y MAJOR-1).
 *
 * ── Not-yet-available rows ─────────────────────────────────────────────────
 * The engine stores a row with `maximum: 0` for a resource the character has
 * not unlocked (a level-1 monk's Ki, a level-1 warlock's four Mystic Arcanum)
 * so it can grow in place on level-up. Those are rendered in a muted
 * "unlocks later" state rather than as a broken 0/0 — and never with a spend
 * control, since there is nothing to spend.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@/components/Button';
import { useToast } from '@/components/Toast';
import { listResources, spendResource, undoLastResource } from '@/lib/api/dnd';
import type { ApiError, ClassResource, UndoableSpend } from '@/lib/api/types';
import styles from './ResourcePanel.module.css';

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

/** Same body-shape probe as CurrencyPurse/HpControl/ConditionsPanel. */
function refusalReason(e: ApiError): string | undefined {
  const body = e.body as { data?: { reason?: string }; message?: string } | null | undefined;
  return body?.data?.reason;
}

function spendErrorMessage(err: unknown, label: string): string {
  const fallback = `Could not spend ${label}. Try again in a moment.`;
  if (!isApiError(err)) return fallback;
  const reason = refusalReason(err);
  // The engine's insufficiency reason is key-scoped (`insufficient_ki`,
  // `insufficient_rage`, ...), so match the prefix rather than a literal.
  if (reason?.startsWith('insufficient_')) return `Not enough ${label} left.`;
  if (reason === 'no_such_resource') return `${label} is not available yet.`;
  if (reason === 'invalid_amount') return 'Spend amount must be a positive whole number.';
  // `track_not_spendable` (D5): the engine refuses a track's spend outright
  // (ENGINE-TRACK-SPEND-GUARD). The panel already declines to render a Use
  // control for a track, so this is not the primary defence — it is what the
  // player sees when the two disagree, which a stale sheet can arrange: load
  // a resource while it is a pool, spend it after content redeclares it a
  // track. Mapped rather than left to the fallback because "could not spend,
  // try again" invites a retry that can never succeed.
  //
  // NB: `track_not_adjustable` is still deliberately absent — that is the
  // /adjust half of the same rule, and this panel ships no adjust control.
  if (reason === 'track_not_spendable') {
    return `${label} is not spent by hand — it changes through play.`;
  }
  return fallback;
}

function undoErrorMessage(err: unknown): string {
  const fallback = 'Could not undo. Try again in a moment.';
  if (!isApiError(err)) return fallback;
  const reason = refusalReason(err);
  if (reason === 'nothing_to_undo') return 'There is nothing left to undo.';
  // Verified against the engine's routes/resources.py — these are the ACTUAL
  // codes it emits. An earlier version of this map invented
  // `undo_target_mismatch` / `stale_seq` / `undo_window_expired`, none of
  // which the engine ever returns, so every one of those refusals fell
  // through to the generic fallback and told the player nothing useful.
  if (reason === 'seq_mismatch') {
    return 'That spend is no longer the most recent one. Refreshing…';
  }
  if (reason === 'state_moved') {
    // The resource moved since the spend (a rest, a level-up, a DM
    // correction) — undoing now would MINT resource, not reverse a mistake.
    return 'That resource has changed since — undoing it is no longer safe.';
  }
  if (reason === 'not_found') return 'That character could not be found.';
  if (reason === 'unavailable') return 'Resources are unavailable right now.';
  return fallback;
}

/** Human copy for the refresh cadence. Unknown values fall through to the raw
 *  string rather than being hidden — a cadence the UI does not recognise is
 *  information the player should still see. */
const REFRESH_COPY: Record<string, string> = {
  short: 'Short or long rest',
  long: 'Long rest',
  // A LONG rest recovers every grant with a stored row regardless of this
  // value — `class_resources._apply_rest` applies the cadence gate ONLY on
  // the short-rest path (Kage-CR S3). So "none"/"daily"/"encounter" mean
  // "not on a SHORT rest", not "never".
  none: 'Long rest only',
  daily: 'Long rest only (daily)',
  encounter: 'Long rest only (per encounter)',
};

export interface ResourcePanelProps {
  characterId: string;
  username: string;
  /** Spend/Undo render for the owner only — mirrors CurrencyPurse's gate.
   *  A non-owner still sees the read-only state. */
  isOwner: boolean;
  /** Bumped by the parent after anything that can change resources (a rest, a
   *  level-up) so the panel refetches without owning that knowledge itself. */
  refreshToken?: number;
}

export default function ResourcePanel({
  characterId,
  username,
  isOwner,
  refreshToken = 0,
}: ResourcePanelProps) {
  const { toast } = useToast();
  const [resources, setResources] = useState<ClassResource[] | null>(null);
  const [undoable, setUndoable] = useState<UndoableSpend | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const mutationBusyRef = useRef(false);

  /** Monotonic load generation (Kage-CR C1). The post-mutation reconciles are
   *  signal-less, and the busy latch releases in `finally` BEFORE they
   *  resolve — so two quick spends produce two in-flight GETs and whichever
   *  lands LAST wins. Reconcile A carries the pre-spend-B snapshot and
   *  clobbers the truth with a stale number (reproduced: server 1/5, panel
   *  3/5), and takes `undoable` with it, leaving Undo holding a `seq` that
   *  can only 409. Same defect this codebase already documents in
   *  SpellbookPanel and the lobby page. */
  const loadGenRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal, opts?: { background?: boolean }) => {
      if (!username || !characterId) return;
      const gen = ++loadGenRef.current;
      const isCurrent = () => mountedRef.current && gen === loadGenRef.current;
      try {
        const data = await listResources(characterId, username, signal);
        if (!isCurrent()) return; // a newer load already answered
        setResources(data.resources ?? []);
        setUndoable(data.undoable ?? null);
        setLoadError(false);
      } catch {
        // An ABORT is not a failure (Kage-CR I2). `apiFetch` rethrows a plain
        // Error for it, so `err.name === 'AbortError'` does NOT work here —
        // five admin pages in this repo carry exactly that dead guard. Check
        // the signal instead.
        if (signal?.aborted || !isCurrent()) return;
        if (opts?.background) {
          // A BACKGROUND reconcile failing must not blank a panel the player
          // is looking at (Kage-CR I1): a successful spend followed by a
          // transient GET failure replaced the whole list with an error card,
          // moments after a success toast. Keep the last-known display and
          // warn, matching SpellbookPanel's stated contract.
          toast({
            message: "Couldn't refresh resources — the numbers may be stale.",
            tone: 'warn',
          });
          return;
        }
        // Initial load only: never blocks the rest of the sheet.
        setLoadError(true);
      }
    },
    [characterId, username, toast],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    // Canonical fetch-on-mount pattern (React docs) — the same justification
    // and the same disable the sibling panels carry (CastSpellPanel,
    // DmOverrideModal). The directive must sit on the line IMMEDIATELY above
    // the call: a multi-line justification between them makes it apply to the
    // comment instead, leaving the real error unsuppressed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, refreshToken]);

  async function handleSpend(res: ClassResource) {
    if (mutationBusyRef.current) return;
    mutationBusyRef.current = true;
    setBusy(true);
    try {
      let after;
      try {
        after = await spendResource(characterId, res.key, username, 1);
      } catch (err) {
        // Kage-CR I3: a refusal means our number was wrong — `insufficient_*`
        // is the engine saying so explicitly. Returning here without a
        // reconcile left the stale value on screen AND the button live. The
        // `finally` below now refetches on every path, matching handleUndo.
        toast({ message: spendErrorMessage(err, res.label), tone: 'error' });
        return;
      }
      // Apply the authoritative response immediately, then reconcile the whole
      // list (a spend can change `undoable`, and a track's spend moves it the
      // other way).
      setResources((prev) =>
        prev
          ? prev.map((r) =>
              r.key === after.key
                ? { ...r, current: after.current, maximum: after.maximum }
                : r,
            )
          : prev,
      );
      setUndoable(after.undoable ?? null);
      toast({
        // `after.label` is the authoritative post-spend label (Kage-CR S6);
        // `res.label` is the pre-spend row's copy.
        message: `${after.label ?? res.label}: ${after.current}/${after.maximum}`,
        tone: 'success',
      });
    } finally {
      mutationBusyRef.current = false;
      setBusy(false);
      // Every path reconciles — success AND refusal (I3).
      void load(undefined, { background: true });
    }
  }

  async function handleUndo() {
    if (mutationBusyRef.current || !undoable) return;
    mutationBusyRef.current = true;
    setBusy(true);
    try {
      let after;
      try {
        // Always pass the `seq` we rendered — the engine refuses rather than
        // silently retargeting a different spend.
        after = await undoLastResource(characterId, username, undoable.seq);
      } catch (err) {
        toast({ message: undoErrorMessage(err), tone: 'error' });
        return;
      }
      // Apply the authoritative response (Kage-CR I5) rather than waiting a
      // whole round trip on the reconcile — same contract as spend, and the
      // header claims it. Undo's payload has NO `undoable`, so clear it: the
      // spend it referred to is gone, and leaving it set kept the button live
      // for a second click that could only ever return `nothing_to_undo`.
      setResources((prev) =>
        prev
          ? prev.map((r) =>
              r.key === after.key
                ? { ...r, current: after.current, maximum: after.maximum }
                : r,
            )
          : prev,
      );
      setUndoable(null);
      toast({ message: 'Last spend undone.', tone: 'success' });
    } finally {
      mutationBusyRef.current = false;
      setBusy(false);
      void load(undefined, { background: true });
    }
  }

  // A class with no declared resources (rogue, ranger) renders nothing at all
  // rather than an empty card — same posture as the sheet's other conditional
  // sections. `null` is still loading; `[]` is a real "this class has none".
  if (resources === null && !loadError) return null;
  if (loadError) {
    return (
      <div className={styles.wrap}>
        <h2 className={styles.title}>Class resources</h2>
        <p className={styles.muted}>
          Couldn&rsquo;t load resources. Reload to try again.
        </p>
      </div>
    );
  }
  if (!resources || resources.length === 0) return null;

  return (
    <div className={styles.wrap} aria-busy={busy}>
      <div className={styles.head}>
        <h2 className={styles.title}>Class resources</h2>
        {isOwner && undoable && (
          <Button
            variant="ghost"
            onClick={handleUndo}
            disabled={busy}
            aria-label="Undo the last resource spend"
          >
            Undo
          </Button>
        )}
      </div>

      <ul className={styles.list}>
        {resources.map((res) => {
          const locked = res.maximum <= 0;
          const isTrack = res.kind === 'track';
          // Pool: how much is LEFT. Track: how much has ACCRUED. Same number,
          // opposite meaning — see the header note.
          const pct = locked
            ? 0
            : Math.max(0, Math.min(100, Math.round((res.current / res.maximum) * 100)));
          const danger = isTrack && res.current * 2 >= res.maximum && res.current > 0;
          // A track is "spent" by the mechanics that raise it, never by the
          // player, and the engine now refuses a track SPEND outright
          // (`track_not_spendable`, D5) — so no spend control for tracks.
          //
          // This comment used to cite the engine's *adjust* refusal as the
          // backing for withholding the *spend* control, which was the wrong
          // guard for this control and, until ENGINE-TRACK-SPEND-GUARD
          // (2026-08-04), a guard that did not exist for spend at all: this
          // `!isTrack` was the ONLY thing preventing a track from being
          // drained. It is now the first of two, and no longer the last.
          const canSpend = isOwner && !locked && !isTrack && res.current > 0;

          return (
            <li key={res.key} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.label}>{res.label}</span>
                <span
                  className={locked ? styles.mutedValue : styles.value}
                  aria-label={
                    locked
                      ? `${res.label}: not available yet`
                      : `${res.label}: ${res.current} of ${res.maximum}`
                  }
                >
                  {locked ? 'Unlocks later' : `${res.current}/${res.maximum}`}
                </span>
              </div>

              {!locked && (
                <div
                  className={styles.meter}
                  role="meter"
                  aria-valuenow={res.current}
                  aria-valuemin={0}
                  aria-valuemax={res.maximum}
                  aria-label={`${res.label} ${
                    isTrack ? (danger ? 'track, critical' : 'track') : 'pool'
                  }`}
                >
                  <div
                    className={
                      danger ? styles.fillDanger : isTrack ? styles.fillTrack : styles.fill
                    }
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}

              <div className={styles.rowFoot}>
                <span className={styles.cadence}>
                  {isTrack
                    ? danger
                      ? 'Risk track — critical'
                      : 'Risk track'
                    : (REFRESH_COPY[res.refresh] ?? res.refresh)}
                </span>
                {canSpend && (
                  <Button
                    variant="ghost"
                    onClick={() => handleSpend(res)}
                    disabled={busy}
                    aria-label={`Use one ${res.label}`}
                  >
                    Use 1
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
