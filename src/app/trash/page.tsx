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
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { listTrashedCharacters, restoreCharacter } from '@/lib/api/dnd';
import type { Character } from '@/lib/api/types';
import TavernShell from '@/components/TavernShell';
import PageSkeleton from '@/components/PageSkeleton';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Icon from '@/components/Icon';
import SuzuDM from '@/components/SuzuDM';
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
  const { user, loading, maybeAuthed } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

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

  // Redirect unauthenticated visitors (mirrors the dashboard).
  useEffect(() => {
    if (!loading && !user && !maybeAuthed) {
      router.replace('/login');
    }
  }, [loading, user, maybeAuthed, router]);

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
        // Move focus before the row unmounts so it doesn't drop to document.body.
        // Prefer the next sibling's button; fall back to the previous; finally the
        // "Back to dashboard" link (always present in the populated branch).
        const ids = prev?.map((x) => x.character_id) ?? [];
        const idx = ids.indexOf(c.character_id);
        const nextId = ids[idx + 1] ?? ids[idx - 1];
        const nextBtn = nextId ? btnRefs.current.get(nextId) : undefined;
        (nextBtn ?? backRef.current)?.focus();

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

  // First-paint: skeleton until we have a user (covers the silent-refresh window
  // for returning users — no logged-out flash).
  if (!user) {
    return (
      <main
        aria-busy="true"
        aria-label="Loading your trash"
        style={{ padding: 28 }}
      >
        <PageSkeleton variant="list" lines={3} />
      </main>
    );
  }

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
                  onRestore={(x) => void handleRestore(x)}
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
    </TavernShell>
  );
}
