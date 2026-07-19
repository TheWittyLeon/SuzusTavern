'use client';
/**
 * Trash — restore recently deleted characters (DEL-8).
 *
 * Soft-deleted characters are recoverable for 7 days (server-side retention);
 * after that the weekly purge removes them for good. This page lists the
 * caller's trashed characters and offers a per-row Restore.
 *
 * Scope (v1.1): characters only. Campaign/session trash is intentionally
 * deferred — the engine never grew a `list_deleted_sessions` listing (omitted in
 * DEL-2 for parity), so there's no end-to-end data path to surface yet.
 *
 * Reachable from the account menu on every authed page (TavernShell → "Trash"),
 * so it stays findable even after deleting your last character (the dashboard
 * grid — and any link living in it — vanishes in that state).
 *
 * Graceful degradation mirrors the dashboard/lobby: a thrown ApiError (backend
 * not yet deployed → 404, or the service down) is treated as an empty trash, not
 * an error screen.
 */
import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useAuthGate } from '@/lib/auth/useAuthGate';
import { useToast } from '@/components/Toast';
import { listTrashedCharacters, restoreCharacter } from '@/lib/api/dnd';
import type { Character } from '@/lib/api/types';
import TavernShell from '@/components/TavernShell';
import PageSkeleton from '@/components/PageSkeleton';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Icon from '@/components/Icon';
import SuzuDM from '@/components/SuzuDM';
import ConfirmDialog from '@/components/ConfirmDialog';
import { formatStarted } from '@/lib/format';
import styles from './Trash.module.css';

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

  const username = user?.username ?? null;
  const mountedRef = useRef(true);
  // Keyed by character_id — lets handleRestore find adjacent buttons before the
  // activated row unmounts, so keyboard focus never drops to document.body.
  const btnRefs = useRef<Map<string, HTMLButtonElement | HTMLAnchorElement>>(new Map());
  // Fallback focus target when the last row is restored.
  const backRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
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

  useEffect(() => {
    if (!username) return;
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [username, load]);

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
    if (!confirmTarget) return;
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
      // Close the dialog FIRST, then refocus — never while it's still
      // mounted+open. ConfirmDialog's own restore-on-close effect will try
      // `previouslyFocused.current` (the now-removed trigger button) first,
      // which is a no-op on a detached node, so this explicit call is what
      // actually lands focus somewhere sane.
      setConfirmTarget(null);
      if (mountedRef.current) (nextBtn ?? backRef.current)?.focus();
    }
  }, [confirmTarget, characters, handleRestore]);

  // Resolving (silent refresh) → bounded skeleton; failed refresh → re-auth
  // prompt; genuinely logged out → redirect to /login (UIR2-TAV-3).
  const gate = useAuthGate({
    skeleton: <PageSkeleton variant="list" lines={3} />,
    label: 'Loading your trash',
  });
  if (gate) return gate;

  const dataLoading = characters === null;
  const items = characters ?? [];

  return (
    <TavernShell active="dashboard" title="Trash">
      <div className={styles.intro}>
        <SuzuDM size={56} glow={false} aria-hidden />
        <div className={styles.introBody}>
          <div className="label">Recently deleted</div>
          <p>
            Characters you delete land here. Restore one within 7 days and it
            returns exactly as it was — after that, it&rsquo;s cleared for good.
          </p>
        </div>
      </div>

      <div aria-live="polite" aria-atomic="true">
        {dataLoading ? (
          <PageSkeleton variant="list" lines={3} />
        ) : items.length === 0 ? (
          <Card className={styles.emptyCard}>
            <Icon name="Trash" size={40} aria-hidden />
            <h2 className={styles.emptyTitle}>Your trash is empty.</h2>
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
            <Card padding={false} className={styles.list}>
              {items.map((c) => (
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
    </TavernShell>
  );
}
