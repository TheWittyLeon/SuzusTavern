'use client';
/**
 * Trash — restore recently deleted characters and campaigns (DEL-8 +
 * TAV-CAMPAIGN-TRASH-NO-RESTORE-UI).
 *
 * Soft-deleted characters and campaigns are recoverable for 7 days
 * (server-side retention); after that the weekly purge removes them for
 * good. This page lists the caller's trashed characters AND trashed
 * campaigns (DM-owned only — `deleteSession`'s own doc comment: "a campaign
 * the user runs"), each with a per-row Restore.
 *
 * v1.1 shipped characters-only: the engine had no `list_deleted_sessions`
 * listing (a DEL-2 parity gap), so there was no end-to-end data path for
 * campaigns and that half was deferred. TAV-CAMPAIGN-TRASH-NO-RESTORE-UI
 * (2026-08-11) is the UI half of closing that gap — see
 * `listTrashedSessions` in `lib/api/dnd.ts` for what's assumed-vs-verified
 * about the listing route it calls (`POST /sessions/{id}/restore` itself was
 * independently confirmed already live by the sibling engine lane).
 *
 * Reachable from the account menu on every authed page (TavernShell → "Trash"),
 * so it stays findable even after deleting your last character (the dashboard
 * grid — and any link living in it — vanishes in that state).
 *
 * Graceful degradation mirrors the dashboard/lobby: a thrown ApiError from the
 * CHARACTERS listing (that endpoint is real and already live) is treated as an
 * empty trash, not an error screen.
 *
 * The CAMPAIGNS listing is different on purpose (TAV-TRASH-CAMPAIGNS-404-HIDE,
 * 2026-08-11): its URL is provisional (see `listTrashedSessions`'s own doc
 * comment) pending a ruling on whether the engine lane ships
 * `list_deleted_sessions` at all. A 404 (or any other failure — unreachable,
 * 5xx) there does NOT mean "zero trashed campaigns"; it means "unknown". Best
 * guess for a bug like this: an earlier iteration DID render "No trashed
 * campaigns." on a 404, which is exactly the defect this feature set out to
 * fix, just resurfacing in a new spot — the UI asserting an absence it never
 * confirmed. So the campaigns section distinguishes THREE states instead of
 * two:
 *   - listing failed (404/unreachable/5xx) → section hidden entirely, no claim
 *   - listing succeeded, zero campaigns    → "No trashed campaigns." (honest)
 *   - listing succeeded, some campaigns    → rows, as normal
 * This is deliberately compatible with either outcome of that pending ruling:
 * once the endpoint ships, no 404 occurs and this branch never fires; until
 * then, the page just never lies about campaigns it hasn't actually checked.
 * Applies per-section either way — a campaigns failure never blocks or breaks
 * the characters section, and vice versa.
 */
import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useAuthGate } from '@/lib/auth/useAuthGate';
import { useToast } from '@/components/Toast';
import {
  listTrashedCharacters,
  restoreCharacter,
  listTrashedSessions,
  restoreSession,
} from '@/lib/api/dnd';
import type { Character, Session } from '@/lib/api/types';
import TavernShell from '@/components/TavernShell';
import PageSkeleton from '@/components/PageSkeleton';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Icon from '@/components/Icon';
import SuzuDM from '@/components/SuzuDM';
import ConfirmDialog from '@/components/ConfirmDialog';
import { formatStarted, sessionTitle } from '@/lib/format';
import { engineErrorMessage } from '@/lib/dnd/engineError';
import { RESTORE_CAMPAIGN_REASON_MAP } from '@/lib/dnd/engineReasons';
import styles from './Trash.module.css';

function restoreCampaignErrorMessage(err: unknown): string {
  return engineErrorMessage(err, {
    fallback: 'Could not restore that campaign. Try again in a moment.',
    reasonMap: RESTORE_CAMPAIGN_REASON_MAP,
  });
}

function charSub(c: Character): string {
  const cls = String(c.char_class ?? c.class ?? '').toLowerCase();
  const race = String(c.race ?? '').toLowerCase();
  const level = (c.level ?? undefined) as number | undefined;
  const bits = [race, cls, level !== undefined ? `level ${level}` : '']
    .filter(Boolean)
    .join(' · ');
  // `deleted_at` is the trash marker; surface when present (defensive — the open
  // Character index map means it may or may not be in the payload).
  const deletedAt = c.deleted_at as string | number | undefined;
  const when = deletedAt ? `trashed ${formatStarted(deletedAt)}` : '';
  return [bits, when].filter(Boolean).join('  ·  ');
}

function TrashRow({
  character,
  onRestore,
  restoring,
  buttonRef,
}: {
  character: Character;
  onRestore: (c: Character) => void;
  restoring: boolean;
  buttonRef?: Ref<HTMLButtonElement | HTMLAnchorElement>;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.icon} aria-hidden>
        <Icon name="Scroll" size={18} />
      </span>
      <div className={styles.meta}>
        <div className={styles.name}>{character.name}</div>
        <div className={styles.sub}>{charSub(character)}</div>
      </div>
      <Button
        ref={buttonRef}
        variant="ghost"
        onClick={() => onRestore(character)}
        disabled={restoring}
        aria-label={`Restore ${character.name}`}
        leadingIcon={<Icon name="History" size={14} aria-hidden />}
      >
        {restoring ? 'Restoring…' : 'Restore'}
      </Button>
    </div>
  );
}

function campaignSub(session: Session): string {
  const players = session.player_count ?? session.participant_usernames?.length ?? 0;
  const bits = `${players} player${players === 1 ? '' : 's'}`;
  // Same defensive cast as charSub's deletedAt above — Session carries an open
  // index map, and this field isn't in the typed shape yet.
  const deletedAt = session.deleted_at as string | number | undefined;
  const when = deletedAt ? `trashed ${formatStarted(deletedAt)}` : '';
  return [bits, when].filter(Boolean).join('  ·  ');
}

function TrashCampaignRow({
  session,
  onRestore,
  restoring,
  buttonRef,
}: {
  session: Session;
  onRestore: (s: Session) => void;
  restoring: boolean;
  buttonRef?: Ref<HTMLButtonElement | HTMLAnchorElement>;
}) {
  const name = sessionTitle(session);
  return (
    <div className={styles.row}>
      <span className={styles.icon} aria-hidden>
        <Icon name="Map" size={18} />
      </span>
      <div className={styles.meta}>
        <div className={styles.name}>{name}</div>
        <div className={styles.sub}>{campaignSub(session)}</div>
      </div>
      <Button
        ref={buttonRef}
        variant="ghost"
        onClick={() => onRestore(session)}
        disabled={restoring}
        aria-label={`Restore ${name}`}
        leadingIcon={<Icon name="History" size={14} aria-hidden />}
      >
        {restoring ? 'Restoring…' : 'Restore'}
      </Button>
    </div>
  );
}

export default function TrashPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // UIR2-TAV-9 (safe part): confirm-before-restore. Holds the row pending
  // confirmation — null closes the dialog (mirrors DeleteCharacterButton's
  // `confirming` state, ConfirmDialog is the same reused component).
  const [confirmTarget, setConfirmTarget] = useState<Character | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // ── Campaigns (TAV-CAMPAIGN-TRASH-NO-RESTORE-UI) — same shape as the
  // characters state above, kept as its own parallel set of state rather than
  // a union, so a failure/loading edge on one type never blocks the other's
  // rendering (see the header comment's "per-section" degradation note).
  const [sessions, setSessions] = useState<Session[] | null>(null);
  // TAV-TRASH-CAMPAIGNS-404-HIDE: true whenever the listing call FAILED (404,
  // unreachable, 5xx — anything thrown), as opposed to succeeding with zero
  // results. Distinct from `sessions === null` (which only means "still
  // loading") — see `loadCampaigns` and the render below for how the three
  // states (unavailable / empty / populated) fork.
  const [campaignsUnavailable, setCampaignsUnavailable] = useState(false);
  const [restoringSessionId, setRestoringSessionId] = useState<string | null>(null);
  const [confirmSessionTarget, setConfirmSessionTarget] = useState<Session | null>(null);
  const [confirmSessionBusy, setConfirmSessionBusy] = useState(false);

  const username = user?.username ?? null;
  const mountedRef = useRef(true);
  // Keyed by character_id — lets handleRestore find adjacent buttons before the
  // activated row unmounts, so keyboard focus never drops to document.body.
  const btnRefs = useRef<Map<string, HTMLButtonElement | HTMLAnchorElement>>(new Map());
  // Same idea, keyed by session_id, for the campaigns section.
  const sessionBtnRefs = useRef<Map<string, HTMLButtonElement | HTMLAnchorElement>>(new Map());
  // Fallback focus target when the last row (of EITHER section) is restored —
  // shared because exactly one of the empty-card button / bottom "Back to
  // dashboard" link is ever mounted at a time, same as the characters-only
  // version of this page.
  const backRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  // Synchronous double-submit latch for character restore, mirroring
  // LeaveCampaignButton's `inFlightRef`. Tora MINOR-1 (2026-08-12): the
  // ConfirmDialog `busy` disable this path relied on alone is STATE-based
  // (`setConfirmBusy`), and `setState` is async — two rapid clicks (or a held
  // Enter) in the same tick can both read `busy` as still-false and both
  // fire `handleRestore`, a classic false-safe under a genuine rapid
  // double-click. Belt-and-suspenders alongside that disable + the
  // optimistic row removal, same as `sessionInFlightRef` below.
  const charInFlightRef = useRef(false);
  // Synchronous double-submit latch for campaign restore, mirroring
  // LeaveCampaignButton's `inFlightRef` and `charInFlightRef` just above —
  // added explicitly per the B2 handoff's double-submit requirement.
  const sessionInFlightRef = useRef(false);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!username) return;
      const c = await listTrashedCharacters(username, signal).catch(
        () => [] as Character[],
      );
      if (!signal?.aborted && mountedRef.current) setCharacters(c);
    },
    [username],
  );

  const loadCampaigns = useCallback(
    async (signal?: AbortSignal) => {
      if (!username) return;
      // .then(onSuccess, onFailure) rather than try/catch or a trailing
      // .catch() — mirrors `load` above's promise-chain shape (the lint rule
      // that guards against cascading setState-in-effect reads a bare
      // async/await try/catch differently than a chained callback here).
      await listTrashedSessions(username, signal).then(
        (s) => {
          if (!signal?.aborted && mountedRef.current) {
            setSessions(s);
            setCampaignsUnavailable(false);
          }
        },
        () => {
          // Any failure here (404 — the common case while the listing
          // route's existence is still pending a ruling — plus
          // unreachable/5xx) means the true campaign-trash state is
          // UNKNOWN, not "empty". Set both: `sessions` to [] so the shared
          // `dataLoading` gate below still resolves, and
          // `campaignsUnavailable` so the render hides the section instead
          // of asserting "No trashed campaigns."
          if (!signal?.aborted && mountedRef.current) {
            setSessions([]);
            setCampaignsUnavailable(true);
          }
        },
      );
    },
    [username],
  );

  useEffect(() => {
    if (!username) return;
    const ac = new AbortController();
    void load(ac.signal);
    void loadCampaigns(ac.signal);
    return () => ac.abort();
  }, [username, load, loadCampaigns]);

  const handleRestore = useCallback(
    async (c: Character) => {
      if (!username) return;
      setRestoringId(c.character_id);
      // Optimistic: drop the row immediately so the list reflects the action;
      // re-fetch on success to stay truthful, restore the row on failure.
      const prev = characters;
      if (mountedRef.current) {
        // MAJOR-1 (Tora, interaction review): this used to also move focus to
        // the next surviving row's button here — but this function only ever
        // runs from `confirmRestore`, WHILE the ConfirmDialog is still open
        // (and `busy`). Moving focus here escapes the open aria-modal dialog
        // to a background element mid-flight. `confirmRestore` now owns that
        // focus-move and fires it strictly AFTER the dialog has closed.
        setCharacters((cur) =>
          (cur ?? []).filter((x) => x.character_id !== c.character_id),
        );
      }
      try {
        await restoreCharacter(c.character_id, username);
        toast({ tone: 'success', message: `${c.name} restored.` });
        void load();
      } catch {
        if (mountedRef.current) setCharacters(prev ?? null);
        toast({
          tone: 'error',
          message: `Could not restore ${c.name}. It stays in your trash for 7 days.`,
        });
      } finally {
        if (mountedRef.current) setRestoringId(null);
      }
    },
    [username, characters, toast, load],
  );

  // UIR2-TAV-9 (safe part): the trigger just opens the confirm dialog — the
  // actual restore (handleRestore, above) only runs from confirmRestore once
  // the user confirms. Cancel/backdrop-dismiss leaves the row untouched.
  const openRestoreConfirm = useCallback((c: Character) => {
    setConfirmTarget(c);
  }, []);

  const confirmRestore = useCallback(async () => {
    // Tora MINOR-1: synchronous latch, checked BEFORE any state read — see
    // `charInFlightRef`'s own doc comment above for why the `busy` state
    // disable alone isn't enough.
    if (!confirmTarget || charInFlightRef.current) return;
    charInFlightRef.current = true;
    // MAJOR-1 (Tora): snapshot the SIBLING button (if any) BEFORE
    // `handleRestore`'s optimistic removal takes this row out of
    // `characters` — a surviving sibling row's button stays mounted
    // throughout, so this snapshot is safe to hold onto. This mirrors the
    // focus-move that used to live inside `handleRestore` itself; it's
    // computed here (not there) so it can fire strictly AFTER the dialog
    // closes below, never while it's still open+busy.
    //
    // Deliberately NOT snapshotting `backRef.current` here too: when the
    // restored row was the LAST one, the populated branch (and its "Back to
    // dashboard" link) unmounts as part of the very same optimistic removal,
    // replaced by the empty-state's OWN "Back to dashboard" button (which
    // shares this same `backRef`) — so `backRef.current` must be read FRESH
    // at focus-time below, not from a pre-removal snapshot that would point
    // at an already-detached node.
    const ids = (characters ?? []).map((x) => x.character_id);
    const idx = ids.indexOf(confirmTarget.character_id);
    const nextId = ids[idx + 1] ?? ids[idx - 1];
    const nextBtn = nextId ? btnRefs.current.get(nextId) : undefined;

    setConfirmBusy(true);
    try {
      await handleRestore(confirmTarget);
    } finally {
      setConfirmBusy(false);
      charInFlightRef.current = false;
      // Close the dialog FIRST, then refocus — never while it's still
      // mounted+open. ConfirmDialog's own restore-on-close effect will try
      // `previouslyFocused.current` (the now-removed trigger button) first,
      // which is a no-op on a detached node, so this explicit call is what
      // actually lands focus somewhere sane.
      setConfirmTarget(null);
      if (mountedRef.current) (nextBtn ?? backRef.current)?.focus();
    }
  }, [confirmTarget, characters, handleRestore]);

  // ── Campaigns — same shape as handleRestore/openRestoreConfirm/confirmRestore
  // above, adapted for Session/session_id. See those functions' comments for
  // the full reasoning (optimistic removal, why focus-move waits for the
  // dialog to close, etc.) — not re-derived here.
  const handleRestoreCampaign = useCallback(
    async (s: Session) => {
      if (!username) return;
      const name = sessionTitle(s);
      setRestoringSessionId(s.session_id);
      const prev = sessions;
      if (mountedRef.current) {
        setSessions((cur) => (cur ?? []).filter((x) => x.session_id !== s.session_id));
      }
      try {
        await restoreSession(s.session_id, username);
        toast({ tone: 'success', message: `${name} restored.` });
        void loadCampaigns();
      } catch (err) {
        // Requirement #5 (B2 handoff): route restore failures through the
        // shared engineErrorMessage chokepoint, not hand-rolled copy — unlike
        // the character path above, which predates that requirement and still
        // uses a fixed generic string (out of scope for this pass to change).
        if (mountedRef.current) setSessions(prev ?? null);
        toast({ tone: 'error', message: restoreCampaignErrorMessage(err) });
      } finally {
        if (mountedRef.current) setRestoringSessionId(null);
      }
    },
    [username, sessions, toast, loadCampaigns],
  );

  const openRestoreCampaignConfirm = useCallback((s: Session) => {
    setConfirmSessionTarget(s);
  }, []);

  const confirmRestoreCampaign = useCallback(async () => {
    if (!confirmSessionTarget || sessionInFlightRef.current) return;
    sessionInFlightRef.current = true;

    const ids = (sessions ?? []).map((x) => x.session_id);
    const idx = ids.indexOf(confirmSessionTarget.session_id);
    const nextId = ids[idx + 1] ?? ids[idx - 1];
    const nextBtn = nextId ? sessionBtnRefs.current.get(nextId) : undefined;

    setConfirmSessionBusy(true);
    try {
      await handleRestoreCampaign(confirmSessionTarget);
    } finally {
      setConfirmSessionBusy(false);
      setConfirmSessionTarget(null);
      sessionInFlightRef.current = false;
      if (mountedRef.current) (nextBtn ?? backRef.current)?.focus();
    }
  }, [confirmSessionTarget, sessions, handleRestoreCampaign]);

  // Resolving (silent refresh) → bounded skeleton; failed refresh → re-auth
  // prompt; genuinely logged out → redirect to /login (UIR2-TAV-3).
  const gate = useAuthGate({
    skeleton: <PageSkeleton variant="list" lines={3} />,
    label: 'Loading your trash',
  });
  if (gate) return gate;

  // One shared loading gate: both lists resolve together so the page never
  // flashes "characters ready, campaigns still spinning" — matches the
  // original single-skeleton behaviour, just fed by two sources now.
  const dataLoading = characters === null || sessions === null;
  const charItems = characters ?? [];
  const campaignItems = sessions ?? [];
  // The page-level empty state (big centered card) only shows when NEITHER
  // section has anything — one section having items is enough to switch to
  // the two-section layout, where each EMPTY section gets its own small
  // inline note instead (full state coverage per the B2 handoff: "empty (no
  // trashed campaigns)" is a real, independently-reachable state, not just a
  // sub-case of the whole page being empty).
  //
  // `campaignsUnavailable` forces this false even when characters are also
  // empty: the big empty card's own copy ("Deleted characters and campaigns
  // show up here…") asserts BOTH are confirmed empty, which would be a lie
  // about campaigns whose listing call actually failed. Falling into the
  // two-section branch instead — with the campaigns section hidden below —
  // never makes that claim.
  const allEmpty = !campaignsUnavailable && charItems.length === 0 && campaignItems.length === 0;

  return (
    <TavernShell active="dashboard" title="Trash">
      <div className={styles.intro}>
        <SuzuDM size={56} glow={false} aria-hidden />
        <div className={styles.introBody}>
          <div className="label">Recently deleted</div>
          <p>
            Characters and campaigns you delete land here. Restore one within 7
            days and it returns exactly as it was — after that, it&rsquo;s
            cleared for good.
          </p>
        </div>
      </div>

      <div aria-live="polite" aria-atomic="true">
        {dataLoading ? (
          <PageSkeleton variant="list" lines={3} />
        ) : allEmpty ? (
          <Card className={styles.emptyCard}>
            <Icon name="Trash" size={40} aria-hidden />
            <h2 className={styles.emptyTitle}>Your trash is empty.</h2>
            {/* Kage IMP-6 (2026-08-12): scoped to characters only. `allEmpty`
                requires `!campaignsUnavailable` (see that flag's own doc
                comment above), and the campaigns listing 404s for 100% of
                current traffic — so this card is UNREACHABLE while a real
                campaign could still be sitting in trash, and "and campaigns"
                would be a promise this card never actually confirmed. The
                page's own intro copy above still mentions campaigns
                generally, which is fine — this is the narrower claim of
                "everything here is confirmed empty". Broadens back to
                "Deleted characters and campaigns…" once
                ENGINE-SESSIONS-TRASH-LISTING (P2) ships and this card
                becomes reachable with campaigns genuinely in scope. */}
            <p className={styles.emptyBody}>
              Nothing to restore. Deleted characters show up here for 7 days.
            </p>
            <Button
              ref={backRef}
              variant="primary"
              href="/dashboard"
              leadingIcon={<Icon name="Home" size={14} aria-hidden />}
            >
              Back to dashboard
            </Button>
          </Card>
        ) : (
          <>
            <section aria-labelledby="trash-characters-heading">
              <h2 id="trash-characters-heading" className={`label ${styles.sectionLabel}`}>
                Characters
              </h2>
              {charItems.length === 0 ? (
                <p className={styles.sectionEmpty}>No trashed characters.</p>
              ) : (
                <Card padding={false} className={styles.list}>
                  {charItems.map((c) => (
                    <TrashRow
                      key={c.character_id}
                      character={c}
                      onRestore={openRestoreConfirm}
                      restoring={restoringId === c.character_id}
                      buttonRef={(el) => {
                        if (el) btnRefs.current.set(c.character_id, el);
                        else btnRefs.current.delete(c.character_id);
                      }}
                    />
                  ))}
                </Card>
              )}
            </section>

            {/* TAV-TRASH-CAMPAIGNS-404-HIDE: when the listing call failed
                (404/unreachable/5xx — `campaignsUnavailable`), the section is
                omitted entirely rather than rendering "No trashed campaigns."
                — the whole point is to never assert an absence this page
                never actually confirmed. See the header comment's three-state
                breakdown. */}
            {!campaignsUnavailable && (
              <section aria-labelledby="trash-campaigns-heading" className={styles.section}>
                <h2 id="trash-campaigns-heading" className={`label ${styles.sectionLabel}`}>
                  Campaigns
                </h2>
                {campaignItems.length === 0 ? (
                  <p className={styles.sectionEmpty}>No trashed campaigns.</p>
                ) : (
                  <Card padding={false} className={styles.list}>
                    {campaignItems.map((s) => (
                      <TrashCampaignRow
                        key={s.session_id}
                        session={s}
                        onRestore={openRestoreCampaignConfirm}
                        restoring={restoringSessionId === s.session_id}
                        buttonRef={(el) => {
                          if (el) sessionBtnRefs.current.set(s.session_id, el);
                          else sessionBtnRefs.current.delete(s.session_id);
                        }}
                      />
                    ))}
                  </Card>
                )}
              </section>
            )}

            <div className={styles.back}>
              <Button
                ref={backRef}
                variant="ghost"
                href="/dashboard"
                leadingIcon={<Icon name="Home" size={14} aria-hidden />}
              >
                Back to dashboard
              </Button>
            </div>
          </>
        )}
      </div>

      {/* UIR2-TAV-9 (safe part): confirm before Restore fires. ConfirmDialog
          portals to document.body — position in the tree doesn't matter. */}
      <ConfirmDialog
        open={confirmTarget != null}
        title={confirmTarget ? `Restore ${confirmTarget.name}?` : 'Restore character?'}
        body="It returns to your active roster exactly as it was when deleted."
        confirmLabel="Restore"
        cancelLabel="Cancel"
        busy={confirmBusy}
        onConfirm={() => void confirmRestore()}
        onCancel={() => setConfirmTarget(null)}
      />

      {/* Campaign-restore confirm — same rationale as the character one above:
          this page already gates character-restore behind a confirm dialog
          (UIR2-TAV-9), so campaign-restore matches it rather than introducing
          a one-click affordance next to a confirm-gated one on the same page
          (B2 handoff requirement #1, "do not invent a second visual
          language"). Restoring a campaign is also the more consequential of
          the two in one respect the character case isn't: it reopens the
          table for every OTHER player who was seated at it, not just the
          caller's own thing — a stray misclick has a blast radius beyond the
          person who clicked it. */}
      <ConfirmDialog
        open={confirmSessionTarget != null}
        title={
          confirmSessionTarget
            ? `Restore ${sessionTitle(confirmSessionTarget)}?`
            : 'Restore campaign?'
        }
        body="It reopens for everyone who was seated at it, exactly as it was when deleted."
        confirmLabel="Restore"
        cancelLabel="Cancel"
        busy={confirmSessionBusy}
        onConfirm={() => void confirmRestoreCampaign()}
        onCancel={() => setConfirmSessionTarget(null)}
      />
    </TavernShell>
  );
}
