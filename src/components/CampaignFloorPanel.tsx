'use client';
/**
 * CampaignFloorPanel — LVL-1 (campaign starting-level floor, DM-only).
 *
 * Lives in /play/[sessionId]'s "Session controls" group as a peer of
 * GrantCurrencyPanel (same isDm gate, same self-contained-panel pattern:
 * own busy-latch, own toast, `disabled` threaded from the same
 * sessionActionBusy/isEnded expression). Two affordances on one panel:
 *
 *   1. Display + edit the floor (pencil → inline number input →
 *      setStartingLevel). Saving NEVER levels anyone (D3) — the success
 *      toast teaches the lazy+explicit duality in the one place a DM will
 *      actually read it.
 *   2. "Apply floor now" (FR-9) — eagerly catch up every seated member
 *      below the floor, behind a ConfirmDialog with a per-member preview
 *      (Q1 resolved: the data is already in the `participants` prop, zero
 *      new fetch). Always confirms — the action is irreversible (D1)
 *      regardless of how many members it touches. The result lands in a
 *      polite live region as well as a toast (design §10 — this mutates
 *      OTHER people's characters).
 *
 * Preview caveat (Aoi §4, flagged not silent): `participants` is the live
 * roster from GET /participants. Engine-side, campaign membership and this
 * roster are the same table (campaign_members) so the preview is exact for
 * seated members; a member row with no bound character shows nothing here
 * and is skipped server-side too.
 */
import { useId, useRef, useState } from 'react';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { applyCampaignFloor, setStartingLevel } from '@/lib/api/dnd';
import type { ApiError, Participant } from '@/lib/api/types';
import styles from './CampaignFloorPanel.module.css';

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

function refusalReason(e: unknown): string | undefined {
  if (!isApiError(e)) return undefined;
  const body = e.body as { data?: { reason?: string } } | null | undefined;
  return body?.data?.reason;
}

// Deterministic route refusals (engine owns every rule — see
// NekoNova-DnDEngine routes/sessions.py set_starting_level_route /
// apply_floor_route). guard_dm's deny is a 404 reason='not_found' /
// 'session_not_found' (oracle-closing), mirroring GRANT_REFUSAL_COPY's note.
const FLOOR_REFUSAL_COPY: Record<string, string> = {
  invalid_starting_level: 'Starting level must be a whole number from 1 to 20.',
  session_not_found: 'Session not found — reload and try again.',
  not_found: 'Session not found — reload and try again.',
  no_floor: 'This table has no starting-level floor set.',
  msm_disabled: 'Campaign settings are not available on this server.',
};

function floorErrorMessage(err: unknown, fallback: string): string {
  return FLOOR_REFUSAL_COPY[refusalReason(err) ?? ''] ?? fallback;
}

export interface CampaignFloorPanelProps {
  sessionId: string;
  /** The DM's own username (the verified actor server-side; sent for the
   *  engine's belt-and-suspenders dm compare). */
  username: string;
  participants: Participant[];
  /** The campaign's current floor from GET /sessions/{id} (`starting_level`
   *  on the session summary; absent on a pre-upgrade backend → 1). */
  startingLevel: number;
  disabled?: boolean;
  /** Fired after a successful save or apply so the page refetches the
   *  session + participants (mirrors rebind's onChanged). */
  onChanged?: () => void;
}

export default function CampaignFloorPanel({
  sessionId,
  username,
  participants,
  startingLevel,
  disabled = false,
  onChanged,
}: CampaignFloorPanelProps) {
  const { toast } = useToast();
  const uid = useId();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(startingLevel));
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  /** Synchronous double-submit latch (HpControl/GrantCurrencyPanel's
   *  convention — plain `busy` state can't close the same-tick gap). */
  const mutationBusyRef = useRef(false);
  // Widened to Button's forwardRef element union (button-or-anchor).
  const pencilRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const draftNum = Number(draft.trim());
  const draftValid = /^\d+$/.test(draft.trim()) && draftNum >= 1 && draftNum <= 20;

  const belowFloor = participants.filter(
    (p) =>
      p.character != null &&
      p.character.level != null &&
      p.character.level < startingLevel,
  );

  function openEdit() {
    setDraft(String(startingLevel));
    setEditing(true);
    // Handler-driven focus (not an effect) — fires only on the real
    // transition, StrictMode-safe by construction (RebindCharacterButton's
    // open/close focus contract).
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function closeEdit() {
    setEditing(false);
    requestAnimationFrame(() => pencilRef.current?.focus());
  }

  // Kage m9: if the panel is disabled while the editor is open (session
  // ended / another session action started), close the editor — Save must
  // not stay live against an ended table. Render-time adjustment per
  // React's "adjusting state when a prop changes" pattern
  // (GrantCurrencyPanel's own prevParticipants convention).
  const [prevDisabled, setPrevDisabled] = useState(disabled);
  if (disabled !== prevDisabled) {
    setPrevDisabled(disabled);
    if (disabled && editing) setEditing(false);
  }

  async function saveEdit() {
    if (!draftValid || busy || disabled || mutationBusyRef.current) return;
    mutationBusyRef.current = true;
    setBusy(true);
    // Kage m10: clear the live region BEFORE the await — aria-live only
    // announces on content CHANGE, so an identical back-to-back summary
    // would otherwise be silent to a screen reader (and a stale apply
    // result would sit under an unrelated save).
    setLastResult(null);
    try {
      try {
        await setStartingLevel(sessionId, username, draftNum);
      } catch (err) {
        toast({
          message: floorErrorMessage(err, 'Could not update the starting level. Try again in a moment.'),
          tone: 'error',
        });
        return;
      }
      toast({
        tone: 'success',
        message:
          draftNum > 1
            ? `Starting level updated to ${draftNum}. Existing members catch up next time they rebind, or via Apply floor now.`
            : 'Starting level reset to 1 — the classic climb.',
      });
      closeEdit();
      onChanged?.();
    } finally {
      mutationBusyRef.current = false;
      setBusy(false);
    }
  }

  async function confirmApply() {
    if (busy || disabled || mutationBusyRef.current) return;
    mutationBusyRef.current = true;
    setBusy(true);
    setLastResult(null); // Kage m10 — see saveEdit.
    try {
      let res;
      try {
        res = await applyCampaignFloor(sessionId, username);
      } catch (err) {
        // Dialog stays open on failure (GrantCurrencyPanel's convention).
        toast({
          message: floorErrorMessage(err, 'Could not apply the floor. Try again in a moment.'),
          tone: 'error',
        });
        return;
      }
      setConfirmOpen(false);
      const leveled = res.leveled.length;
      const failed = res.failures.length;
      const summary =
        failed > 0
          ? `Floor applied — ${leveled} member${leveled === 1 ? '' : 's'} leveled to ${res.starting_level}, ${failed} failed (safe to retry — Apply floor now resumes them).`
          : `Floor applied — ${leveled} member${leveled === 1 ? '' : 's'} leveled to ${res.starting_level}.`;
      setLastResult(summary);
      toast({ tone: failed > 0 ? 'warn' : 'success', message: summary });
      onChanged?.();
    } finally {
      mutationBusyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={styles.panel} aria-busy={busy}>
      <p className={styles.panelLabel}>
        <Icon name="Sparkle" size={12} aria-hidden /> Starting level
      </p>
      <div className={styles.row}>
        {!editing ? (
          <>
            <span className={`mono ${styles.value}`}>Level {startingLevel}</span>
            <Button
              ref={pencilRef}
              variant="ghost"
              aria-label="Edit starting level"
              disabled={busy || disabled}
              onClick={openEdit}
            >
              Edit
            </Button>
          </>
        ) : (
          <>
            <label className="sr-only" htmlFor={`${uid}-floor-input`}>
              Starting level
            </label>
            <input
              id={`${uid}-floor-input`}
              ref={inputRef}
              className={styles.input}
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              step={1}
              aria-invalid={!draftValid}
              aria-describedby={!draftValid ? `${uid}-floor-invalid` : undefined}
              value={draft}
              disabled={busy || disabled}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button variant="ghost" onClick={closeEdit} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || disabled || !draftValid}
              aria-busy={busy}
              onClick={() => void saveEdit()}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          disabled={belowFloor.length === 0 || busy || disabled}
          onClick={() => setConfirmOpen(true)}
        >
          Apply floor now
        </Button>
      </div>
      {editing && !draftValid && (
        <p id={`${uid}-floor-invalid`} className={styles.invalidNote}>
          Must be between 1 and 20.
        </p>
      )}
      {/* The empty state IS the explanation — never open a confirm dialog
          that would do nothing (Aoi §4's no-op anti-pattern note). */}
      {!editing && belowFloor.length === 0 && (
        <p className={styles.emptyRow}>
          Every seated member is already at level {startingLevel} or above.
        </p>
      )}
      {/* Apply-floor result — polite live region, always mounted (design
          §10: this mutated other people's characters; a toast alone isn't
          enough for screen-reader users). */}
      <p role="status" aria-live="polite" className={styles.result}>
        {lastResult}
      </p>

      <ConfirmDialog
        open={confirmOpen}
        title={`Apply the level ${startingLevel} floor now?`}
        body={
          <>
            {belowFloor.length} member{belowFloor.length === 1 ? '' : 's'} will
            be leveled up to match the table:
            <ul className={styles.previewList}>
              {belowFloor.map((p) => (
                <li key={p.username}>
                  {p.character?.name ?? p.username}: level {p.character?.level} →{' '}
                  {startingLevel}
                </li>
              ))}
            </ul>
            Each will see any subclass or Ability Score Improvement choices
            from the levels they cross, waiting on their character sheet. This
            can&rsquo;t be undone.
          </>
        }
        confirmLabel="Level them up now"
        cancelLabel="Not yet"
        busy={busy}
        onConfirm={() => void confirmApply()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
