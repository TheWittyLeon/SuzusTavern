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
import { listSessions, joinSession, listMyCharacters } from '@/lib/api/dnd';
import type { Character, Session } from '@/lib/api/types';
import TavernShell from '@/components/TavernShell';
import PageSkeleton from '@/components/PageSkeleton';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Pill from '@/components/Pill';
import Icon from '@/components/Icon';
import SuzuDM from '@/components/SuzuDM';
import { sessionTitle } from '@/lib/format';
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
  userCharacters,
}: {
  session: Session;
  onJoin: (s: Session, characterId?: number) => void;
  joining: boolean;
  userCharacters: Character[];
}) {
  const isSuzu = (session.dm_username ?? '').toLowerCase() === 'suzu';
  const players = session.player_count ?? session.participant_usernames?.length ?? 0;

  // Character binding: auto-bind when exactly one character; show a picker for multiple.
  // useState initializer runs once at mount — before the parent's async listMyCharacters
  // populates userCharacters. Use an effect so the binding fires after the list arrives.
  const [selectedCharId, setSelectedCharId] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (userCharacters.length === 1) {
      const parsed = Number(userCharacters[0].character_id);
      if (Number.isFinite(parsed)) setSelectedCharId(parsed);
    }
  }, [userCharacters]);

  const handleJoinClick = () => {
    onJoin(session, selectedCharId);
  };

  const tableTitle = sessionTitle(session);

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
          <h2 className={styles.cardTitle}>{tableTitle}</h2>
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

      {userCharacters.length > 1 && (
        <div className={styles.cardFoot} style={{ paddingBottom: 0 }}>
          {/* Iro MAJOR-1: aria-label names the table so each card's combobox is unique.
              Iro MINOR-1: sr-only label text associates the control for AT users who
              navigate by form controls (visible label omitted to keep card compact). */}
          <label style={{ display: 'block', width: '100%' }}>
            <span className="sr-only">{`Character for ${tableTitle}`}</span>
            <select
              className="input"
              value={selectedCharId ?? ''}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                setSelectedCharId(e.target.value && Number.isFinite(parsed) ? parsed : undefined);
              }}
              aria-label={`Choose which character to bring to ${tableTitle}`}
              style={{ width: '100%' }}
            >
              <option value="">— no character —</option>
              {userCharacters.map((c) => (
                <option key={c.character_id} value={c.character_id}>
                  {c.name} (Lv {c.level} {c.char_class})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className={styles.cardFoot}>
        <Button
          variant="primary"
          onClick={handleJoinClick}
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
  const [userCharacters, setUserCharacters] = useState<Character[]>([]);

  const username = user?.username ?? null;
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Fetch the current user's characters so the join picker can auto-bind.
  useEffect(() => {
    if (!username) return;
    const ac = new AbortController();
    listMyCharacters(username, ac.signal)
      .then((chars) => {
        if (!ac.signal.aborted && mountedRef.current) setUserCharacters(chars);
      })
      .catch(() => {/* degrade gracefully — picker just won't show */});
    return () => ac.abort();
  }, [username]);

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
    async (s: Session, characterId?: number) => {
      if (!username) return;
      setJoiningId(s.session_id);
      try {
        const joinReq: Parameters<typeof joinSession>[1] = { username, channel: s.channel };
        if (characterId !== undefined) {
          joinReq.character_id = characterId;
        }
        await joinSession(s.session_id, joinReq);
        toast({ tone: 'success', message: `Joined ${sessionTitle(s)}.` });
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
                userCharacters={userCharacters}
              />
            ))}
          </div>
        )}
      </div>
    </TavernShell>
  );
}
