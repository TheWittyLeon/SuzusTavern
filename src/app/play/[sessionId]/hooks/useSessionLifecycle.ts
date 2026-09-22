'use client';

/**
 * TAV-PLAY-SHELL step 5, hook 1 of ~9 (decomposition plan §2.2) —
 * `useSessionLifecycle(sessionId)`. Owns plan §1.1: session/participants/
 * page-load state, the DM-only session lifecycle controls (pause/resume/
 * end/award-XP) and their busy/confirm/form state, the session-status poll,
 * and every value/handler derived purely from `session`/`username`.
 *
 * Deliberately does NOT own the mount-load effect (page.tsx's "load session
 * + party" effect) — that effect also seeds grounding, the transcript/log,
 * and the journal in ONE atomic fetch+rehydration sequence (five concerns
 * in one effect, sharing one AbortController and one ordering guarantee
 * that 553 tests pin). Splitting it correctly is a cross-hook orchestration
 * problem — the same shape as `useSessionEvents` taking handler callbacks
 * rather than importing sibling hooks (plan §2.2's "one inversion, and it's
 * deliberate") — that only has a safe answer once the hooks it feeds
 * (useMyCharacter, useScene, useTranscript) exist too. Until then, this
 * hook exposes `setSession`/`setParticipants`/`setState` and page.tsx's
 * mount effect keeps calling them directly, unchanged in every other
 * respect. Same reasoning for the XP-form Escape-guard effect (reads
 * combat's `outcomeChooserOpen` and the journal drawer's `journalOpen`
 * alongside this hook's own state) — it stays in page.tsx, reading this
 * hook's returned values.
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import {
  getSession,
  getParticipants,
  pauseSession,
  resumeSession,
  endSession,
  awardSessionXp,
} from '@/lib/api/dnd';
import type { EndSessionLevelUp, Participant, Session } from '@/lib/api/types';
import { sessionsEqual, POLL_INTERVAL_MS } from '../format';

export type SessionActionBusy = 'pause' | 'resume' | 'end' | 'xp' | null;
export type PlayPageLoadState = 'loading' | 'ok' | 'error' | 'notfound';
export type AiAssistLevel = 'full' | 'assist' | 'off';

/**
 * F5/LEVELUP-NO-MOMENT: build the end-session toast's level-up clause from
 * `POST /sessions/{id}/end`'s `data.level_ups` echo. Returns `null` when
 * nobody leveled (empty/absent — degrades gracefully, no clause appended).
 * Private to this hook — `onConfirmEndSession` is its only caller, so (per
 * the mirror rule) this stays here rather than in the shared format.ts.
 */
function levelUpsSummary(levelUps: EndSessionLevelUp[]): string | null {
  const parts = levelUps
    .filter((l): l is EndSessionLevelUp & { name: string } => !!l.name)
    .map((l) => `${l.name} (now level ${l.new_level ?? '?'})`);
  if (parts.length === 0) return null;
  return `Level up: ${parts.join(', ')} — see the party panel to choose new features.`;
}

export interface UseSessionLifecycleResult {
  session: Session | null;
  setSession: Dispatch<SetStateAction<Session | null>>;
  participants: Participant[];
  setParticipants: Dispatch<SetStateAction<Participant[]>>;
  state: PlayPageLoadState;
  setState: Dispatch<SetStateAction<PlayPageLoadState>>;

  sessionActionBusy: SessionActionBusy;
  endSessionConfirmOpen: boolean;
  setEndSessionConfirmOpen: Dispatch<SetStateAction<boolean>>;
  xpFormOpen: boolean;
  setXpFormOpen: Dispatch<SetStateAction<boolean>>;
  xpAmount: string;
  setXpAmount: Dispatch<SetStateAction<string>>;
  xpReason: string;
  setXpReason: Dispatch<SetStateAction<string>>;
  // xpAmountNum itself has no external reader (page.tsx only ever needed
  // the boolean) -- kept as an internal step of xpAmountValid's derivation
  // below, not part of the public surface (mirror rule: no unread field).
  xpAmountValid: boolean;
  xpToggleBtnRef: RefObject<HTMLButtonElement | null>;

  isDm: boolean;
  isHumanDM: boolean;
  isPaused: boolean;
  isEnded: boolean;
  sessionLocked: boolean;
  aiLevel: AiAssistLevel;
  aiOff: boolean;

  refreshSessionAfterAction: () => Promise<void>;
  onTogglePause: () => Promise<void>;
  onConfirmEndSession: () => Promise<void>;
  onAwardXp: () => Promise<void>;
}

export function useSessionLifecycle(sessionId: string): UseSessionLifecycleResult {
  const { user } = useAuth();
  const username = user?.username ?? null;
  const { toast } = useToast();

  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [state, setState] = useState<PlayPageLoadState>('loading');

  // DDX-25: DM-only session lifecycle controls (pause/resume/end/xp award).
  // One shared busy flag (not 4 booleans) disables all 3 controls together
  // while any one is in flight — mirrors the single `combatBusy` flag
  // page.tsx already uses for combat mutations.
  const [sessionActionBusy, setSessionActionBusy] = useState<SessionActionBusy>(null);
  const [endSessionConfirmOpen, setEndSessionConfirmOpen] = useState(false);
  const [xpFormOpen, setXpFormOpen] = useState(false);
  const [xpAmount, setXpAmount] = useState('');
  const [xpReason, setXpReason] = useState('');

  // DDX-25: ref for the "Award XP" trigger so focus returns to it when the
  // inline award form is dismissed via Escape (mirrors endCombatBtnRef).
  const xpToggleBtnRef = useRef<HTMLButtonElement>(null);

  // DDX-25 R2 (D5): synchronous latch mirroring combatBusyRef/checkBusyRef/
  // sceneAdvanceBusyRef elsewhere in page.tsx — `sessionActionBusy` (React
  // state) only disables the UI after a re-render, leaving a window where
  // two clicks in the same event-loop tick both fire the mutation. All
  // three DM session-lifecycle actions (pause/resume, end, award XP) share
  // this one ref, mirroring how they already share `sessionActionBusy`.
  const sessionActionBusyRef = useRef(false);

  // DDX-25 R2 (D1): interval handle for the session-status poll (separate
  // from page.tsx's combat-state poll — the two run on independent
  // lifetimes: this one starts once the session has loaded and keeps
  // running until the session ends; the combat one only runs while a
  // combat is active).
  const sessionPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mirror of `session` kept in sync via an effect so the session-status
  // poll callback can read the current status without being a dep of the
  // poll effect (mirrors page.tsx's combatStateRef role for the combat poll).
  const sessionRef = useRef<Session | null>(null);

  // DDX-25 R2 (D1): keep sessionRef in sync for the same reason — the
  // session-status poll effect below reads it without being a dep, so the
  // interval isn't reset every time `session` updates (which happens on
  // every poll tick itself, plus every DM mutation's own refetch).
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // ── session status poll (~4-5s, foregrounded) ───────────────────────────
  // D1 (DDX-25 R2): session status (active/paused/ended) is server truth
  // and, before this, was only ever fetched once on mount plus after the
  // acting DM's own mutation (refreshSessionAfterAction) — a pause/resume/
  // end was therefore invisible to every OTHER open tab (a player's tab, or
  // a second DM tab) until a manual reload, which defeats the point of
  // pausing. Mirrors page.tsx's combat-state poll: same cadence, same
  // document.hidden gate, same ref-mirror-so-the-callback-doesn't-reset-the-
  // interval shape, same non-fatal poll-error handling.
  //
  // No stateSeqRef-style monotone guard here (unlike the combat poll): a
  // combat mutation response carries fresher inline state that a
  // concurrently-in-flight (and thus stale) poll response must not clobber.
  // Session status has no such inline-fresher-response case — every
  // consumer (this poll AND every mutation handler's own
  // refreshSessionAfterAction) reads the exact same GET /sessions/{id}, so
  // whichever call resolves last is, by definition, the most current server
  // truth. Refetch-wins is correct here; there's no local optimistic write
  // for a "stale" poll response to stomp.
  //
  // Deps: [sessionId, state] only — session field changes (status, xp_pool,
  // ...) must NOT reset the interval; sessionRef lets the callback read the
  // current status (to know when to stop) without being a dep. `state`
  // (loading/ok/error/notfound) is set exactly once, in page.tsx's mount
  // effect, so including it only delays the first interval start until the
  // session has actually loaded — it never causes a later reset.
  //
  // DDX-25 R3: setSession(s) is now gated on sessionsEqual(s,
  // sessionRef.current) rather than called unconditionally. Before this
  // fix, EVERY tick — even a pure no-op one where nothing changed
  // server-side — replaced `session` with a freshly-deserialized object, so
  // `session` got a new identity every ~4s regardless. SessionRecap's
  // effects depended on the whole `session` object, so they re-fired on
  // every tick and re-issued a REAL LLM-backed "previously on" narration
  // request indefinitely (live-observed: 20+ repeated recap requests per
  // viewer, scaling with concurrent viewers). A genuine
  // status/xp_pool/dm_mode/... change still differs under sessionsEqual
  // (whole-object structural compare), so cross-tab convergence on
  // pause/resume/end (D1, ADV-4) is unaffected. THIS IDENTITY GUARANTEE IS
  // LOAD-BEARING — do not replace with an unconditional setSession(s).
  useEffect(() => {
    if (!sessionId || state !== 'ok') return;

    const poll = async () => {
      if (document.hidden) return;
      // Stop polling once the session has ended — nothing left to converge on.
      if (sessionRef.current?.status === 'ended') return;
      try {
        const s = await getSession(sessionId);
        if (!sessionsEqual(s, sessionRef.current)) setSession(s);
      } catch {
        // Poll errors are non-fatal — the next tick will retry.
      }
    };

    sessionPollIntervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (sessionPollIntervalRef.current) {
        clearInterval(sessionPollIntervalRef.current);
        sessionPollIntervalRef.current = null;
      }
    };
  }, [sessionId, state]);

  /**
   * DDX-25: refetch the session after any lifecycle mutation (pause/resume/
   * end/xp). The engine's pause/resume/end/xp routes resolve to only
   * `{message: string}` (see the dnd.ts wrapper comment), never the updated
   * Session, so a plain GET is the only way to observe the new status/
   * xp_pool — mirrors the rebind flow's `getParticipants` re-fetch.
   *
   * D8 (DDX-25 R2): this swallows its own failure (`.catch(() => null)`) by
   * design — every caller's mutation already succeeded server-side by the
   * time this runs, so a failed refetch must not surface as an error toast
   * for an action that, in fact, worked. The tradeoff: on a refetch
   * failure, the acting tab briefly shows a success toast without the
   * paused banner/composer-disable reflecting it yet. Left as-is rather
   * than retried inline — the D1 session-status poll (above) corrects it
   * within one cycle (~4-5s) without extra retry logic here.
   */
  const refreshSessionAfterAction = useCallback(async () => {
    const s = await getSession(sessionId).catch(() => null);
    if (s) setSession(s);
  }, [sessionId]);

  /**
   * DDX-25: Pause ⇄ Resume toggle. DM-only — enforced at the render site via
   * the same `isDm` gate every other DM-only control uses.
   */
  const onTogglePause = useCallback(async () => {
    // DDX-25 R2 (D5): sessionActionBusyRef closes the synchronous double-tap
    // window that `sessionActionBusy` (React state) can't.
    if (!session || !username || sessionActionBusy || sessionActionBusyRef.current) return;
    sessionActionBusyRef.current = true;
    const pausing = session.status !== 'paused';
    setSessionActionBusy(pausing ? 'pause' : 'resume');
    try {
      if (pausing) {
        await pauseSession(sessionId, { username, channel: session.channel });
      } else {
        await resumeSession(sessionId, { username, channel: session.channel });
      }
      await refreshSessionAfterAction();
      toast({ tone: 'success', message: pausing ? 'Session paused.' : 'Session resumed.' });
    } catch {
      // D7: the engine may be refusing because the true state already moved
      // (e.g. a 404 "already paused/not active") — refetch so a stale label
      // ("Pause" shown when the session is in fact already paused) self-
      // corrects instead of lingering until a manual reload or the next D1
      // poll tick.
      await refreshSessionAfterAction();
      toast({
        tone: 'error',
        message: pausing
          ? 'Could not pause the session. Try again in a moment.'
          : 'Could not resume the session. Try again in a moment.',
      });
    } finally {
      setSessionActionBusy(null);
      sessionActionBusyRef.current = false;
    }
  }, [session, username, sessionId, sessionActionBusy, refreshSessionAfterAction, toast]);

  /** DDX-25: End session — semi-destructive, confirmed via ConfirmDialog. */
  const onConfirmEndSession = useCallback(async () => {
    // DDX-25 R2 (D5): see onTogglePause's comment above — same synchronous
    // ref-guard, closing the gap this handler previously had no busy-guard
    // of ANY kind (not even the React-state one).
    if (!session || !username || sessionActionBusyRef.current) return;
    sessionActionBusyRef.current = true;
    setSessionActionBusy('end');
    try {
      const result = await endSession(sessionId, { username, channel: session.channel });
      await refreshSessionAfterAction();
      // F5/LEVELUP-NO-MOMENT (D3 — END-SESSION-ONLY scope): refetch the
      // roster so a leveled-up character's stale level in PartyPanel is
      // corrected. Deliberately scoped to THIS handler, not folded into the
      // shared refreshSessionAfterAction above (which ALSO runs on pause/
      // resume/award-XP, where a party refetch would be unnecessary chatter
      // every time — see play.ddx25-session-controls's own regression pin
      // on those handlers' getParticipants call count). Non-fatal on
      // failure: the roster just stays stale until a future natural
      // refresh; the "Session ended." toast below still fires either way
      // (the session DID end) — never a double-toast for this secondary
      // read.
      try {
        const party = await getParticipants(sessionId);
        setParticipants(party);
      } catch {
        // Swallowed — see comment above.
      }
      const summary = levelUpsSummary(result.level_ups ?? []);
      toast({
        tone: 'success',
        message: summary ? `Session ended. ${summary}` : 'Session ended.',
      });
    } catch {
      toast({ tone: 'error', message: 'Could not end the session. Try again in a moment.' });
    } finally {
      setSessionActionBusy(null);
      setEndSessionConfirmOpen(false);
      sessionActionBusyRef.current = false;
    }
  }, [session, username, sessionId, refreshSessionAfterAction, toast]);

  /**
   * DDX-25: Award XP — a session-level party pool (`session.xp_pool`), NOT
   * per-character. The engine's cmd_xp adds `amount` straight to the pool
   * (engine/commands/session_commands.py); the pool is only split across
   * participants when the session later ends (cmd_endsession's
   * xp_per_player). `reason` is optional free text logged with the award.
   * Amount is floored at 1 (not 0) client-side — the engine's own cmd_xp
   * rejects <= 0 with a plain-text refusal that doesn't cleanly surface as
   * an HTTP error, so this avoids that ambiguous edge entirely.
   */
  const onAwardXp = useCallback(async () => {
    // DDX-25 R2 (D5): ref-guard first (see onTogglePause's comment) — this
    // is the highest-priority instance of the gap: the engine's xp_pool
    // write is unconditionally additive (`xp_pool += amount`, no
    // idempotency guard), so a double-fire here GUARANTEES a double award,
    // unlike pause/resume's conditional-UPDATE self-heal.
    if (!session || !username || sessionActionBusyRef.current) return;
    const amount = Math.trunc(Number(xpAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ tone: 'error', message: 'Enter a whole number greater than zero.' });
      return;
    }
    sessionActionBusyRef.current = true;
    setSessionActionBusy('xp');
    try {
      await awardSessionXp(sessionId, {
        username,
        channel: session.channel,
        amount,
        reason: xpReason.trim() || undefined,
      });
      await refreshSessionAfterAction();
      toast({ tone: 'success', message: `Awarded ${amount} XP to the party pool.` });
      setXpFormOpen(false);
      setXpAmount('');
      setXpReason('');
    } catch {
      toast({ tone: 'error', message: 'Could not award XP. Try again in a moment.' });
    } finally {
      setSessionActionBusy(null);
      sessionActionBusyRef.current = false;
    }
  }, [session, username, sessionId, xpAmount, xpReason, refreshSessionAfterAction, toast]);

  // B2-4: is the logged-in user the session DM?
  const isDm = !!(session?.dm_username && username &&
    session.dm_username.toLowerCase() === username.toLowerCase());

  // S5.2: human DM = DM seat + dm_mode 'human'. When true:
  //   - composer modes swap to ['DM Narration', 'OOC']
  //   - AI narrate() path is gated off (early return in narrate())
  //   - DmNarrationPanel renders in the centre pane during combat
  const isHumanDM = isDm && session?.dm_mode === 'human';

  // DDX-25: session lifecycle status, read directly from the server-loaded
  // session (same "no stale snapshot" rule as aiLevel below) — status can
  // now change via the session controls without a full page reload.
  const isPaused = session?.status === 'paused';
  const isEnded = session?.status === 'ended';
  // A paused OR ended session shouldn't accept ANY player action — gates
  // the composer, combat action rail, skill-check, move-on, dice-tray,
  // rebind and the DM-side monster auto-driver (via isSessionLocked, still
  // in page.tsx until useScene/useDice are extracted).
  const sessionLocked = isPaused || isEnded;

  // DDX-25: inline validation for the Award XP form's submit button — the
  // engine's own cmd_xp rejects <= 0 with a plain-text refusal, so the
  // floor is set at 1 client-side rather than relying on that ambiguous
  // edge.
  const xpAmountNum = Math.trunc(Number(xpAmount));
  const xpAmountValid = xpAmount.trim() !== '' && Number.isFinite(xpAmountNum) && xpAmountNum > 0;

  // S5.5: AI assist level read directly from server-loaded session (no
  // stale snapshot).
  //   'off'    → hide ALL AI surfaces; no LLM calls (NarratorStrip, auto-narration, etc.)
  //   'assist' → no auto-fire; AI available only on explicit DM invocation (future affordance).
  //   'full'   → standard AI path unchanged.
  // Read directly from session.ai_assist_level every render cycle — NOT a useState copy.
  const aiLevel: AiAssistLevel = session?.ai_assist_level ?? 'full';
  // True when AI surfaces should be hidden entirely from the UI.
  const aiOff = aiLevel === 'off';

  return {
    session,
    setSession,
    participants,
    setParticipants,
    state,
    setState,
    sessionActionBusy,
    endSessionConfirmOpen,
    setEndSessionConfirmOpen,
    xpFormOpen,
    setXpFormOpen,
    xpAmount,
    setXpAmount,
    xpReason,
    setXpReason,
    xpAmountValid,
    xpToggleBtnRef,
    isDm,
    isHumanDM,
    isPaused,
    isEnded,
    sessionLocked,
    aiLevel,
    aiOff,
    refreshSessionAfterAction,
    onTogglePause,
    onConfirmEndSession,
    onAwardXp,
  };
}
