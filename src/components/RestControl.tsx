'use client';
/**
 * RestControl — take a short or long rest from the character sheet.
 *
 * The web stack has had a rest hop since VESSEL-REST-PROXY (2026-08-02) and
 * NOTHING in the Tavern called it, so a browser player could never rest at
 * all: spell slots stayed spent, hit dice never came back, and a Vessel's
 * Instability track — which only a long rest zeroes — was permanent. The
 * engine verbs are older still; their only consumers were the Twitch bot's
 * `~shortrest` and `~longrest`. This is the control that makes the whole
 * chain reachable from a browser.
 *
 * ── Why this is NOT part of ResourcePanel ──────────────────────────────────
 * A rest is not a resource action. It restores HP, hit dice, spell slots AND
 * every class-declared resource; class resources are merely its most visible
 * tenant. Nesting it inside ResourcePanel would also make it disappear for
 * exactly the characters who still need it: that panel renders `null` for a
 * class that declares no resources — rogue and ranger declare none at all, and
 * with `SUZU_DND_VESSEL_MECHANICS` off (its default) NO character has rows, so
 * the panel is empty for everyone. Those characters still have hit points and
 * hit dice to recover.
 * So it is a sibling, gated only on ownership.
 *
 * ── Why a long rest confirms and a short rest does not ─────────────────────
 * There is no undo for a rest anywhere in the stack — `undo-last` reverses a
 * `resource_spent` event and a rest emits none. A long rest is also the one
 * action that zeroes a risk track, which a player may be carrying
 * deliberately. That combination — irreversible AND capable of erasing state
 * the player chose to hold — is what earns a confirm. A short rest recovers a
 * strict subset, keeps the track, and is cheap to repeat, so a dialog there
 * would be friction with nothing behind it.
 *
 * ── What comes back ────────────────────────────────────────────────────────
 * Only a message (see `RestResult`). No HP, no slots, no resources. So a
 * successful rest CANNOT patch local state — it must hand control back to the
 * parent via `onRested`, which refetches the sheet and re-keys the resource
 * panel. Anything else would render numbers the server never sent.
 */
import { useEffect, useRef, useState } from 'react';
import Button from '@/components/Button';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { characterRest } from '@/lib/api/dnd';
import type { ApiError, RestType } from '@/lib/api/types';
import styles from './RestControl.module.css';

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

/** Same body-shape probe as ResourcePanel/CurrencyPurse/HpControl. */
function refusalReason(e: ApiError): string | undefined {
  const body = e.body as { data?: { reason?: string }; message?: string } | null | undefined;
  return body?.data?.reason;
}

/**
 * Refusal copy, mapped ONLY to codes the stack actually emits. Verified
 * against the engine's `cmd_shortrest`/`cmd_longrest` (which return exactly
 * one reason, `not_found`), `SPELL_REASON_STATUS` in engine/spells.py, and the
 * NekoNova hop's own `invalid_rest_type`. Inventing plausible-looking codes is
 * how this component's sibling shipped three refusal messages that could never
 * fire — every one of them fell through to the generic fallback.
 *
 * `not_found` is deliberately NEUTRAL copy. The engine's `guard_owner` answers
 * 404/`not_found` for "not yours" as well as "does not exist", on purpose, to
 * close an enumeration oracle — so this string must not resolve the ambiguity
 * the server went out of its way to create.
 */
function restErrorMessage(err: unknown): string {
  const fallback = 'Could not rest. Try again in a moment.';
  if (!isApiError(err)) return fallback;
  const reason = refusalReason(err);
  if (reason === 'not_found') return 'That character could not be found.';
  if (reason === 'invalid_rest_type') return 'That rest type is not recognised.';
  // 503 from the proxy carries no `data.reason` at all — it answers
  // `{success: false, error: "D&D service unavailable"}` — so it lands here,
  // which is the right place for it.
  return fallback;
}

const REST_LABEL: Record<RestType, string> = {
  short: 'Short rest',
  long: 'Long rest',
};

/**
 * Re-voice the engine's rest summary for a UI toast.
 *
 * The engine writes for TWITCH CHAT, and it shows: `cmd_longrest` returns
 * `"[Rest] alice takes a long rest. All spell slots restored. HP restored to
 * 9/9, hit dice 4/6."` — a bracket tag and the player's own name in the third
 * person, in a panel where every other toast is second-person ("Healed 5.",
 * "Last spend undone."). Rendering it verbatim was the first version and it
 * read as a chat log leaking into the sheet (Kage-CR I2).
 *
 * The DETAIL is worth keeping — "HP restored to 9/9, hit dice 4/6" is the real
 * outcome, and this component must never invent that. So only the preamble is
 * rewritten, and only when it matches: strip a leading `[Tag] `, then turn a
 * leading `<thisUsername> takes` into `You take`. Anything that does not match
 * is returned UNCHANGED rather than mangled — if the engine's phrasing
 * changes, the player sees a slightly odd but TRUE sentence, never a truncated
 * one. Deliberately anchored to the caller's own username, so it can never
 * rewrite a third party's name out of a message that legitimately mentions
 * one.
 */
export function humanizeRestMessage(message: string, username: string): string {
  const withoutTag = message.replace(/^\[[^\]]*\]\s*/, '');
  if (!username) return withoutTag;
  // Escape the username — it is user-controlled and goes into a RegExp.
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return withoutTag.replace(new RegExp(`^${escaped}\\s+takes\\b`, 'i'), 'You take');
}

export interface RestControlProps {
  characterId: string;
  username: string;
  /** Resting MUTATES the character, so the control renders for the owner
   *  only — same gate as ResourcePanel's spend and CurrencyPurse's. A
   *  non-owner viewing the sheet simply sees no rest buttons. */
  isOwner: boolean;
  /** Called after a rest SUCCEEDS. The parent must refetch the sheet (HP, hit
   *  dice, spell slots) and re-key ResourcePanel — the response carries none
   *  of that, so this callback is the only way the UI becomes true again.
   *
   *  May return a promise, and may REJECT: a reconcile that fails is a real
   *  outcome the player needs told about, and it is a different outcome from
   *  the rest failing. See `takeRest` for how the two are kept apart. */
  onRested: () => void | Promise<void>;
}

export default function RestControl({
  characterId,
  username,
  isOwner,
  onRested,
}: RestControlProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmingLong, setConfirmingLong] = useState(false);
  /** Synchronous double-submit latch. `setBusy` is async, so two clicks in the
   *  same tick both pass a `busy` check and fire two rests — the same defect
   *  ResourcePanel documents and CurrencyPurse/HpControl guard against. A
   *  doubled rest is not merely wasteful here: it is two irreversible state
   *  changes with no undo. */
  const inFlightRef = useRef(false);
  /** A11Y (Iro): the Short rest button is the FOCUSED element when its own
   *  click sets `busy` — unlike Long rest, nothing intervenes to move focus
   *  away first (Long rest opens the dialog, which focuses Cancel; ONLY then
   *  does `busy` ever become true, on Confirm, and ConfirmDialog's own
   *  restore-on-close effect already returns focus to this component's Long
   *  rest trigger). A real browser blurs a focused button the instant it
   *  becomes `disabled` (LEVELUP-UX-A11Y-TAIL — same rule ConfirmDialog's own
   *  busy-focus-park effect exists for), and nothing here recovers it: once
   *  `busy` clears, the button re-enables but focus stays stranded at
   *  <body>, so a keyboard/switch user loses their place on the sheet after
   *  every short rest. jsdom does not reproduce the blur (disabled elements
   *  keep focus there), so this can only be pinned by asserting the OUTCOME.
   *  Long rest is deliberately NOT re-focused here — that would fire after,
   *  and duplicate, ConfirmDialog's own restoration, and do so for the WRONG
   *  button if it ever raced a second attempt. */
  const shortRestRef = useRef<HTMLButtonElement>(null);
  const restTypeInFlightRef = useRef<RestType | null>(null);
  const prevBusyRef = useRef(false);
  useEffect(() => {
    if (prevBusyRef.current && !busy && restTypeInFlightRef.current === 'short') {
      shortRestRef.current?.focus();
    }
    prevBusyRef.current = busy;
  }, [busy]);

  async function takeRest(restType: RestType) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    restTypeInFlightRef.current = restType;
    setBusy(true);
    /** Which half of this function we are in. Both the rest and the reconcile
     *  can throw, and reporting them the same way would be a lie in one
     *  direction: a failed reconcile after a SUCCESSFUL rest would say "could
     *  not rest" about a rest that definitely happened, and the player would
     *  take a second one. */
    let rested = false;
    try {
      const result = await characterRest(characterId, username, restType);
      rested = true;
      // The engine's own summary when it sent one, re-voiced but never
      // re-stated: what was recovered comes from the server, because this
      // component does not know and guessing would assert a rules outcome
      // nobody reported. See `humanizeRestMessage` for what is and is not
      // rewritten.
      const summary = result?.message?.trim();
      toast({
        message: summary
          ? humanizeRestMessage(summary, username)
          : `${REST_LABEL[restType]} taken.`,
        tone: 'success',
      });
      // ONLY on success — a refused rest changed nothing, so there is nothing
      // to reconcile. Awaited so a failure here is visible rather than a
      // silently stale sheet showing pre-rest hit points.
      await onRested();
    } catch (err) {
      toast(
        rested
          ? {
              message:
                'Rested — but these numbers may be out of date. Reload to see them.',
              tone: 'warn',
            }
          : { message: restErrorMessage(err), tone: 'error' },
      );
    } finally {
      inFlightRef.current = false;
      setBusy(false);
      setConfirmingLong(false);
    }
  }

  if (!isOwner) return null;

  return (
    <div aria-busy={busy}>
      <div className={styles.head}>
        <h2 className={styles.title}>Rest</h2>
      </div>
      {/* WORDED AGAINST THE ENGINE, not against intuition (Kage-CR I1/I4).
          A long rest does NOT restore hit dice: `Character.apply_long_rest`
          regains `max(1, level // 2)`, capped at total — half, rounded down,
          minimum one. And class-resource recovery is gated on
          `SUZU_DND_VESSEL_MECHANICS`, which defaults OFF, while the read and
          spend verbs are not — so promising "every class resource" would be a
          lie for any environment with the switch off. "Where your class has
          them" covers both that and the classes declaring none. */}
      <p className={styles.muted}>
        A short rest recovers some resources. A long rest restores hit points
        and spell slots, recovers some hit dice, and refreshes your class
        resources where your class has them.
      </p>
      {/* No `aria-label` on either trigger. The visible text IS the accessible
          name, and an added label here was actively harmful: it made the Long
          rest trigger announce as "Take a long rest", the exact name the
          dialog's own confirm button carries, so once the dialog opened a
          screen-reader or voice-control user had two identically-named
          buttons on the page and no way to tell which one they were on.
          Caught by a test that could not disambiguate them either. */}
      <div className={styles.actions}>
        <Button
          ref={shortRestRef}
          variant="ghost"
          onClick={() => void takeRest('short')}
          disabled={busy}
        >
          Short rest
        </Button>
        <Button
          variant="ghost"
          onClick={() => setConfirmingLong(true)}
          disabled={busy}
        >
          Long rest
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingLong}
        // 'alertdialog' rather than 'dialog': this interrupts to warn about an
        // irreversible change. ConfirmDialog's own prop doc frames the
        // distinction around interrupting an in-progress choice, which a rest
        // is not — the ARIA semantics still fit (an alert that demands a
        // response), so the usage stands; the earlier version of this comment
        // claimed the prop's documented distinction matched, and it does not.
        role="alertdialog"
        title="Take a long rest?"
        // Same engine-accurate wording as the paragraph above, and for the
        // same reason: hit dice come back by halves, not in full, and the
        // class-resource sweep is flag-gated. The risk-track clause is
        // conditional for that same reason — it is the part of a long rest a
        // player is most likely to regret, so it must not be overstated OR
        // quietly dropped.
        body="This restores hit points and spell slots, recovers some hit dice, and refreshes your class resources — including clearing any risk track you are carrying. It cannot be undone."
        confirmLabel="Take a long rest"
        busy={busy}
        onConfirm={() => void takeRest('long')}
        onCancel={() => setConfirmingLong(false)}
      />
    </div>
  );
}
