'use client';
/**
 * LeaveCampaignButton — B1 (TAV-CHAR-STUCK-AFTER-CAMPAIGN-END): the
 * character page's escape hatch for a character bound to a campaign that
 * has ended, or is otherwise unreachable. This is Leon's load-bearing fix
 * for a character stuck seated at a table with no other way off it — not
 * polish, see the handoff.
 *
 * ── Render gate ───────────────────────────────────────────────────────────
 * SERVER verdict only, off the SAME `levelup_policy` block the sheet already
 * carries for WorkshopBuildControls (LVLDN): `mode === 'workshop'` means "no
 * campaign binding" (that component's own header comment — "Bound characters
 * never see this"), `'xp'`/`'floor'` both mean bound (levelup_policy's own
 * doc: 'xp' = "bound, at/above floor", 'floor' = "bound below the table's
 * starting_level"). `denied_max_level` keeps its real `mode`, so a level-20
 * BOUND character still reads as bound — see LevelUpPolicy's doc comment.
 * Fails CLOSED like its sibling when `levelup_policy` is entirely absent
 * (pre-upgrade backend): hides rather than offering an op the engine may not
 * support yet. No new field invented — this reuses data the sheet already
 * sends for an existing, reviewed purpose.
 *
 * ── "works when the campaign is unreachable" ─────────────────────────────
 * Deliberately makes NO separate campaign fetch. `sheet` is the same
 * GET .../sheet payload the whole page already has, and `levelup_policy` is
 * computed engine-side from its own `campaign_members` join — not a call out
 * to another service. There is nothing else here that CAN fail reachability,
 * which is what makes the requirement true by construction rather than by a
 * fallback path that has to be separately tested.
 *
 * ── `not_in_campaign` is a success path, not an error ────────────────────
 * A 400 with that reason means the character is ALREADY unbound (e.g. a
 * second tab, or a retry that lands after an earlier attempt already freed
 * it) — the player's actual goal is already true, so it renders identically
 * to a fresh 200. This early-return happens BEFORE `leaveErrorMessage` is
 * ever called, so `not_in_campaign`'s entry in the shared map below is never
 * the live copy path for it — see that map's own doc comment for why it is
 * registered there anyway.
 *
 * B6: `leaveErrorMessage` now sources its reason map from
 * `LEAVE_CAMPAIGN_REASON_MAP` in `src/lib/dnd/engineReasons.ts`, folded in
 * alongside `JOIN_REFUSAL_REASON_MAP` — this file no longer owns its own
 * copy.
 */
import { useEffect, useRef, useState } from 'react';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { leaveCampaign } from '@/lib/api/dnd';
import { engineErrorMessage, extractReason, isApiError } from '@/lib/dnd/engineError';
import { LEAVE_CAMPAIGN_REASON_MAP } from '@/lib/dnd/engineReasons';
import type { CharacterSheet } from '@/lib/api/types';

function leaveErrorMessage(err: unknown): string {
  return engineErrorMessage(err, {
    fallback: 'Could not leave the campaign. Try again in a moment.',
    reasonMap: LEAVE_CAMPAIGN_REASON_MAP,
  });
}

export interface LeaveCampaignButtonProps {
  characterId: string;
  characterName: string;
  username: string;
  /** The SAME sheet the page already holds — see the header comment for why
   *  `sheet.levelup_policy.mode` is the boundness signal, not a new field. */
  sheet: CharacterSheet;
  /**
   * Fired once the character is confirmed free (a real 200, or a 400
   * `not_in_campaign` — both mean "unbound" to the player). The parent
   * should refetch the sheet in the BACKGROUND so `levelup_policy` flips out
   * of 'xp'/'floor' and any workshop-only controls unlock elsewhere on the
   * page — never a full page reload (RestControl's `onRested` convention).
   * May reject; a failed refresh is swallowed here because leaving already
   * succeeded and the toast already told the player so.
   */
  onLeft?: () => void | Promise<void>;
  className?: string;
}

export default function LeaveCampaignButton({
  characterId,
  characterName,
  username,
  sheet,
  onLeft,
  className,
}: LeaveCampaignButtonProps) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Once true this instance renders nothing. `sheet.levelup_policy` only
   *  flips to 'workshop' after the parent's OWN background refetch (`onLeft`)
   *  resolves, which can lag — this local latch makes the control disappear
   *  on the same tick as the success toast, satisfying "reflect unbound
   *  state without a full reload" even before that refetch lands.
   *
   *  Kage SUGG-5 (2026-08-12): that also means this is an OPTIMISTIC latch,
   *  and an optimistic latch that never reconciles with reality is a UI lie
   *  waiting to happen — if the leave call actually landed on an
   *  already-stale server state (a race with another client, or a server
   *  bug), the parent's refetch can come back reporting the character is
   *  STILL bound. See the reconcile effect below. */
  const [left, setLeft] = useState(false);
  /** Snapshot of `sheet` at the moment `left` was optimistically set, so the
   *  reconcile effect below can tell "the parent hasn't refetched yet
   *  (still the pre-leave sheet)" apart from "the parent refetched and it's
   *  STILL bound" — both look identical if you only read
   *  `sheet.levelup_policy`, but only the second one should un-hide this
   *  control. `null` means "no leave attempt is currently latched". */
  const sheetAtLeaveRef = useRef<CharacterSheet | null>(null);
  /** Synchronous double-submit latch — `setBusy` is async, so two clicks (or
   *  a held Enter) in the same tick can both pass a `busy` check. Same
   *  defect class RestControl/CurrencyPurse/HpControl guard against, and
   *  doubly worth it here: firing the request twice risks the SECOND call
   *  landing on an already-freed character and surfacing `not_in_campaign`
   *  copy for what was, from the player's seat, one click. */
  const inFlightRef = useRef(false);

  const policy = sheet.levelup_policy;
  const bound = !!policy && policy.mode !== 'workshop';

  // Kage SUGG-5: reconcile the optimistic `left` latch once a GENUINELY
  // fresh sheet lands (a new object reference, not the stale pre-leave one
  // still sitting in the parent's state on the first render after
  // `setLeft(true)`). If that fresh sheet still reports bound, the leave did
  // not actually stick server-side — flip the latch back so the control (and
  // the real escape hatch) reappears instead of the player being stuck
  // believing they left when they didn't.
  useEffect(() => {
    if (!left || !sheetAtLeaveRef.current) return;
    if (sheet === sheetAtLeaveRef.current) return; // still the pre-leave snapshot
    sheetAtLeaveRef.current = null;
    // Reconciling derived state (`left`) against a genuinely NEW `sheet` prop
    // is exactly the "adjust state when a prop changes" case React's own
    // effects guide carves out as a legitimate effect use — this cannot move
    // to render-time because it depends on comparing against the PREVIOUS
    // sheet reference captured at leave-time, not the current one alone.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (bound) setLeft(false);
  }, [left, sheet, bound]);

  if (!bound || left) return null;

  async function confirmLeave() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);

    try {
      await leaveCampaign(characterId, username);
    } catch (err) {
      const alreadyFree =
        isApiError(err) && err.status === 400 && extractReason(err) === 'not_in_campaign';
      if (!alreadyFree) {
        toast({ message: leaveErrorMessage(err), tone: 'error' });
        setConfirming(false);
        inFlightRef.current = false;
        setBusy(false);
        return;
      }
      // alreadyFree: fall through to the success path below.
    }

    // SUGG-5: snapshot BEFORE flipping the latch — the reconcile effect
    // above needs to recognize this exact (still pre-leave) sheet object so
    // it doesn't fire on the very next render, before the parent's refetch
    // has had any chance to land.
    sheetAtLeaveRef.current = sheet;
    setLeft(true);
    setConfirming(false);
    toast({
      message: `${characterName} is no longer seated at a table.`,
      tone: 'success',
    });
    try {
      await onLeft?.();
    } catch {
      // Best-effort background refresh — leaving already succeeded and the
      // toast above already told the player so; a stale sheet elsewhere on
      // the page is not this control's error to report.
    }
    inFlightRef.current = false;
    setBusy(false);
  }

  return (
    <>
      <Button
        variant="danger"
        leadingIcon={<Icon name="Power" size={14} aria-hidden />}
        className={className}
        onClick={() => setConfirming(true)}
      >
        Leave campaign
      </Button>

      <ConfirmDialog
        open={confirming}
        // 'alertdialog', not the default 'dialog': ConfirmDialog's own prop
        // doc names "releasing a character from another table" as exactly
        // the case this role is for.
        role="alertdialog"
        tone="danger"
        title="Leave this campaign?"
        body={
          // F5 (1.7 audit): JSX trims LEADING whitespace off every text line
          // independently, including the first line of a text node that
          // starts right after an expression container on the same source
          // line — so the literal space before "will" here was being
          // stripped at build time, rendering "{characterName}will be
          // freed…" with no space. `{' '}` is an explicit string-literal
          // child; JSX never trims those, so the space survives regardless
          // of `characterName`'s value or where the line wraps.
          <>
            {characterName}{' '}
            will be freed from their table and can be seated at a different
            campaign afterward from the lobby. This works even if the
            current table has ended or can&rsquo;t be reached.
          </>
        }
        confirmLabel="Leave now"
        cancelLabel="Stay seated"
        busy={busy}
        onConfirm={() => void confirmLeave()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
