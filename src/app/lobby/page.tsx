'use client';
/**
 * Lobby — browse + join tables (ST-033/036/037/039).
 *
 * Thin-real-data: each card binds real engine session fields (channel→title,
 * dm_username, player_count, status). The design's seats/level/mood/tags/cadence
 * are mock-only and intentionally not fabricated.
 *
 * "Start a campaign" routes through pick-a-module (Option B way-to-start), not a
 * bare create — a new user has no table and nowhere to begin otherwise.
 *
 * Filter strip (ST-034) is a real client-side filter over dm_username (All /
 * Suzu DM'd / Human DM'd). Search (ST-035) + a Suzu recommender (ST-038 dynamic)
 * are deferred — the suggestion banner ships as static encouragement.
 *
 * Graceful degradation: if the session-list backend isn't deployed yet,
 * listSessions throws → treated as an empty list (clean "no tables" state).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { listSessions, joinSession } from '@/lib/api/dnd';
import type { Session } from '@/lib/api/types';
import TavernShell from '@/components/TavernShell';
import PageSkeleton from '@/components/PageSkeleton';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Pill from '@/components/Pill';
import Icon from '@/components/Icon';
import SuzuDM from '@/components/SuzuDM';
import { titleizeChannel } from '@/lib/format';
import styles from './Lobby.module.css';

type Filter = 'all' | 'suzu' | 'human';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'suzu', label: "Suzu DM'd" },
  { id: 'human', label: "Human DM'd" },
];

function TableCard({
  session,
  onJoin,
  joining,
}: {
  session: Session;
  onJoin: (s: Session) => void;
  joining: boolean;
}) {
  const isSuzu = (session.dm_username ?? '').toLowerCase() === 'suzu';
  const players = session.player_count ?? session.participant_usernames?.length ?? 0;
  return (
    <Card className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.cardIcon} aria-hidden>
          <Icon name={isSuzu ? 'Sparkle' : 'Map'} size={26} />
        </span>
        <div className={styles.cardHead}>
          <div className={styles.cardPills}>
            <Pill tone={session.status === 'paused' ? 'warn' : 'good'} dot={session.status === 'active'}>
              {session.status ?? 'active'}
            </Pill>
            <span className={styles.players}>
              {players} {players === 1 ? 'player' : 'players'}
            </span>
          </div>
          <h2 className={styles.cardTitle}>{titleizeChannel(session.channel)}</h2>
        </div>
      </div>

      <div className={`${styles.dmLine} ${isSuzu ? styles.dmSuzu : ''}`}>
        {isSuzu ? (
          <>
            <SuzuDM size={22} glow={false} aria-hidden />
            <span>
              DM&rsquo;d by <strong>Suzu</strong> · narration in the open
            </span>
          </>
        ) : (
          <>
            <span className={styles.dmAvatar} aria-hidden>
              {String(session.dm_username ?? '?').charAt(0).toUpperCase()}
            </span>
            <span>
              DM&rsquo;d by <strong>{session.dm_username ?? 'a human DM'}</strong>
            </span>
          </>
        )}
      </div>

      <div className={styles.cardFoot}>
        <Button
          variant="primary"
          onClick={() => onJoin(session)}
          disabled={joining}
        >
          {joining ? 'Joining…' : 'Join table'}
        </Button>
      </div>
    </Card>
  );
}

export default function LobbyPage() {
  const { user, loading, maybeAuthed } = useAuth();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const username = user?.username ?? null;
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const load = useCallback(async (signal?: AbortSignal) => {
    const s = await listSessions({}, signal).catch(() => [] as Session[]);
    // Guard both the mount AbortController (signal) and the signal-less
    // post-join refetch against a setState after unmount.
    if (!signal?.aborted && mountedRef.current) setSessions(s);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const handleJoin = useCallback(
    async (s: Session) => {
      if (!username) return;
      setJoiningId(s.session_id);
      try {
        await joinSession(s.session_id, { username, channel: s.channel });
        toast({ tone: 'success', message: `Joined ${titleizeChannel(s.channel)}.` });
        void load();
      } catch {
        toast({ tone: 'error', message: 'Could not join that table. Try again.' });
      } finally {
        setJoiningId(null);
      }
    },
    [username, toast, load],
  );

  if (loading && maybeAuthed) {
    return (
      <main aria-busy="true" aria-label="Loading tables" style={{ padding: 28 }}>
        <PageSkeleton variant="list" lines={4} />
      </main>
    );
  }

  const dataLoading = sessions === null;
  const visible = (sessions ?? []).filter((s) => {
    const suzu = (s.dm_username ?? '').toLowerCase() === 'suzu';
    if (filter === 'suzu') return suzu;
    if (filter === 'human') return !suzu;
    return true;
  });

  return (
    <TavernShell
      active="lobby"
      title="Find a table"
      actions={
        <Button
          variant="primary"
          href="/modules"
          leadingIcon={<Icon name="Plus" size={14} aria-hidden />}
        >
          Start a campaign
        </Button>
      }
    >
      {/* filter strip (ST-034) */}
      <div className={styles.filters} role="group" aria-label="Filter tables">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`${styles.filter} ${filter === f.id ? styles.filterOn : ''}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <span className={styles.count}>
          {dataLoading ? '…' : `${visible.length} ${visible.length === 1 ? 'table' : 'tables'}`}
        </span>
      </div>

      {/* Suzu suggestion banner (ST-038, static) */}
      <div className={styles.suggestion}>
        <SuzuDM size={44} glow={false} aria-hidden />
        <div className={styles.suggestionBody}>
          <div className="label">Suzu · suggestion</div>
          <p>
            &ldquo;New here? Don&rsquo;t browse — begin. Start a campaign and I&rsquo;ll
            have a table running for you in a minute.&rdquo;
          </p>
        </div>
        <Button variant="ghost" href="/modules">
          Start a campaign
        </Button>
      </div>

      {/* table grid (ST-033) */}
      <div aria-live="polite">
        {dataLoading ? (
          <PageSkeleton variant="list" lines={4} />
        ) : visible.length === 0 ? (
          <Card className={styles.emptyCard}>
            <SuzuDM size={64} glow={false} aria-hidden />
            <h2 className={styles.emptyTitle}>No tables running yet.</h2>
            <p className={styles.emptyBody}>
              {sessions && sessions.length > 0
                ? 'No tables match this filter.'
                : 'Be the first — start a campaign and pick a one-shot to run tonight.'}
            </p>
            <Button
              variant="primary"
              href="/modules"
              leadingIcon={<Icon name="Plus" size={14} aria-hidden />}
            >
              Start a campaign
            </Button>
          </Card>
        ) : (
          <div className={styles.grid}>
            {visible.map((s) => (
              <TableCard
                key={s.session_id}
                session={s}
                onJoin={handleJoin}
                joining={joiningId === s.session_id}
              />
            ))}
          </div>
        )}
      </div>
    </TavernShell>
  );
}
