'use client';
/**
 * Dashboard — the authed home (ST-040/041/044).
 *
 * Thin-real-data: binds only fields the engine actually stores
 * (channel, status, dm_username, participant count, started_at). No fabricated
 * session metadata (no "session 7 / 412 rolls / tonight 8pm" — that was design
 * mock data; cf. the Sprint-4 landing-stats cut).
 *
 * States (driven by the real session list):
 *  - loading + maybeAuthed → skeleton (M2 first-paint fix, no logged-out flash)
 *  - no sessions → the way-to-start hub (Option B): three doors + Suzu welcome.
 *    This is also exactly what graceful-degradation lands on if the session-list
 *    backend isn't deployed yet (listSessions throws → treated as []).
 *  - has sessions → resume hero + my campaigns + my characters grid.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthProvider';
import { listSessions, listMyCharacters } from '@/lib/api/dnd';
import type { Character, Session } from '@/lib/api/types';
import TavernShell from '@/components/TavernShell';
import PageSkeleton from '@/components/PageSkeleton';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Pill from '@/components/Pill';
import Icon from '@/components/Icon';
import SuzuDM from '@/components/SuzuDM';
import SectionHead from '@/components/SectionHead';
import DeleteCharacterButton from '@/components/DeleteCharacterButton';
import DeleteCampaignButton from '@/components/DeleteCampaignButton';
import SessionRecap from '@/components/SessionRecap';
import { titleizeChannel, formatStarted } from '@/lib/format';
import styles from './Dashboard.module.css';

// ── Way-to-start hub (Option B) — shown when you have no sessions ──────────────
function DashEmpty({
  username,
  characters,
  onChanged,
}: {
  username: string;
  characters: Character[];
  onChanged: () => void;
}) {
  const doors = [
    {
      href: '/modules',
      icon: 'Spellbook' as const,
      title: 'Start a story',
      body: 'Spin up a campaign from a prepared adventure. Pick the mood; Suzu runs it.',
      cta: 'browse modules',
    },
    {
      href: '/lobby',
      icon: 'Users' as const,
      title: 'Find a table',
      body: 'See which campaigns have open seats. Join one and drop in.',
      cta: "see who's playing",
    },
    {
      href: '/character/new',
      icon: 'Scroll' as const,
      title: 'Roll a character',
      body: 'No table yet, no rush. Build a PC and bring them in later — five steps.',
      cta: 'go to the vault',
    },
  ];
  return (
    <div className={styles.empty}>
      <Card pop className={styles.welcome}>
        <SuzuDM size={96} talking aria-hidden />
        <div>
          <Pill tone="lav" dot>
            day one
          </Pill>
          <p className={styles.welcomeQuote}>
            &ldquo;Glad you came, {username}. <em>Pick a door.</em> You can start a story
            tonight, join a table that&rsquo;s running, or roll a character and decide
            later.&rdquo;
          </p>
        </div>
      </Card>

      <div className={styles.doors}>
        {doors.map((d) => (
          <Link key={d.href} href={d.href} className={styles.door}>
            <span className={styles.doorIcon}>
              <Icon name={d.icon} size={26} aria-hidden />
            </span>
            <h2 className={styles.doorTitle}>{d.title}</h2>
            <p className={styles.doorBody}>{d.body}</p>
            <span className={styles.doorCta}>
              {d.cta} <Icon name="Chevron" size={11} aria-hidden />
            </span>
          </Link>
        ))}
      </div>

      {/* Surface existing characters here too — otherwise a player with PCs but
          no running table has no path back to their sheets (the active-state
          grid only renders when sessions > 0). */}
      {characters.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <CharacterGrid
            characters={characters}
            username={username}
            onChanged={onChanged}
          />
        </div>
      )}
    </div>
  );
}

// ── Character grid (ST-044) ───────────────────────────────────────────────────
function CharacterGrid({
  characters,
  username,
  onChanged,
}: {
  characters: Character[];
  username: string;
  onChanged: () => void;
}) {
  return (
    <div>
      <SectionHead title="Your characters" level={2} />
      <div className={styles.charGrid}>
        {characters.map((c) => {
          const cls = String(c.char_class ?? c.class ?? '').toLowerCase();
          const level = (c.level ?? undefined) as number | undefined;
          const sub = [cls, level !== undefined ? String(level) : '']
            .filter(Boolean)
            .join(' ');
          // The delete control is a SIBLING of the card <Link> (never nested —
          // a button inside an anchor is invalid + breaks AT). The wrapper is the
          // positioning context for the corner button.
          return (
            <div key={c.character_id} className={styles.charCardWrap}>
              <Link
                href={`/character/${encodeURIComponent(c.character_id)}`}
                className={styles.charCard}
              >
                <span className={styles.charAvatar} aria-hidden>
                  {String(c.name ?? '?').charAt(0).toUpperCase()}
                </span>
                <span className={styles.charName}>{c.name}</span>
                <span className={styles.charSub}>{sub}</span>
              </Link>
              <DeleteCharacterButton
                characterId={c.character_id}
                characterName={String(c.name ?? 'this character')}
                username={username}
                onChanged={onChanged}
                className={styles.charDelete}
              />
            </div>
          );
        })}
        <Link href="/character/new" className={`${styles.charCard} ${styles.charNew}`}>
          <span className={styles.charNewIcon} aria-hidden>
            <Icon name="Plus" size={20} />
          </span>
          <span className={styles.charName}>New</span>
          <span className={styles.charSub}>create</span>
        </Link>
      </div>
    </div>
  );
}

// ── Active dashboard — resume hero + campaigns + characters ────────────────────
function DashActive({
  sessions,
  characters,
  username,
  onChanged,
}: {
  sessions: Session[];
  characters: Character[];
  username: string;
  onChanged: () => void;
}) {
  // Iro MAJOR-1: stable focus target after a campaign delete.
  // When the campaign row unmounts, ConfirmDialog's focus-restore target is gone
  // and focus would land on <body>. We give the "My campaigns" section heading a
  // ref (tabIndex=-1 so it is programmatically focusable without appearing in tab
  // order) and pass it to DeleteCampaignButton as focusFallbackRef. After a
  // confirmed delete the button focuses this element before the row disappears.
  const campaignsSectionRef = useRef<HTMLDivElement>(null);

  const hero = sessions[0];
  const heroTitle = titleizeChannel(hero.channel);
  const isSuzu = (hero.dm_username ?? '').toLowerCase() === 'suzu';
  const players = hero.player_count ?? hero.participant_usernames?.length ?? 0;

  return (
    <>
      <Card pop className={styles.hero}>
        <SuzuDM size={88} talking aria-hidden />
        <div className={styles.heroBody}>
          <div className={styles.heroPills}>
            <Pill tone={hero.status === 'paused' ? 'warn' : 'good'} dot={hero.status === 'active'}>
              {hero.status ?? 'active'}
            </Pill>
            <Pill tone="muted">
              {players} {players === 1 ? 'player' : 'players'}
            </Pill>
            {hero.started_at && <Pill tone="lav">started {formatStarted(hero.started_at)}</Pill>}
          </div>
          <h2 className={styles.heroTitle}>{heroTitle}</h2>
          <p className={styles.heroDm}>
            DM&rsquo;d by {isSuzu ? 'Suzu' : hero.dm_username ?? 'a human DM'}
          </p>
        </div>
        <div className={styles.heroActions}>
          <Button
            variant="primary"
            size="lg"
            href={`/play/${encodeURIComponent(hero.session_id)}`}
            leadingIcon={<Icon name="D20" size={14} aria-hidden />}
          >
            Resume session
          </Button>
        </div>
      </Card>

      {/* "Previously on" recap for the most recent campaign (ST-079).
          key by session so a campaign swap can't flash a stale AI summary (Kage). */}
      <div style={{ marginBottom: 18 }}>
        <SessionRecap key={hero.session_id} session={hero} username={username} variant="card" />
      </div>

      <div className={styles.cols}>
        <div className={styles.colMain}>
          <SectionHead
            ref={campaignsSectionRef}
            title="My campaigns"
            level={2}
            tabIndex={-1}
            action={
              <Button
                variant="ghost"
                href="/modules"
                leadingIcon={<Icon name="Plus" size={12} aria-hidden />}
              >
                New
              </Button>
            }
          />
          <Card padding={false} className={styles.campaignList}>
            {sessions.map((s) => {
              const suzu = (s.dm_username ?? '').toLowerCase() === 'suzu';
              // Only the campaign's DM (owner) sees the delete control; the engine
              // also enforces owner-only delete (a non-owner gets a 404).
              const isDM =
                !!username &&
                (s.dm_username ?? '').toLowerCase() === username.toLowerCase();
              const campaignName = titleizeChannel(s.channel);
              return (
                <div key={s.session_id} className={styles.campaignRow}>
                  <span className={styles.campaignIcon} aria-hidden>
                    <Icon name="Scroll" size={18} />
                  </span>
                  <div className={styles.campaignMeta}>
                    <div className={styles.campaignName}>{campaignName}</div>
                    <div className={styles.campaignSub}>
                      {suzu ? 'Suzu' : (s.dm_username ?? 'human DM')} ·{' '}
                      {s.player_count ?? s.participant_usernames?.length ?? 0} players
                    </div>
                  </div>
                  <Pill tone={s.status === 'paused' ? 'warn' : 'good'} dot={s.status === 'active'}>
                    {s.status ?? 'active'}
                  </Pill>
                  <div className={styles.campaignActions}>
                    <Button
                      variant="ghost"
                      href={`/play/${encodeURIComponent(s.session_id)}`}
                    >
                      Open
                    </Button>
                    {isDM && (
                      <DeleteCampaignButton
                        sessionId={s.session_id}
                        campaignName={campaignName}
                        username={username}
                        onChanged={onChanged}
                        focusFallbackRef={campaignsSectionRef}
                        className={styles.campaignDelete}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
        </div>

        <div className={styles.colSide}>
          <CharacterGrid
            characters={characters}
            username={username}
            onChanged={onChanged}
          />
        </div>
      </div>
    </>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function DashboardSkeleton() {
  return (
    <main aria-busy="true" aria-label="Loading your dashboard" style={{ padding: '32px 28px' }}>
      <PageSkeleton variant="card" lines={3} />
      <div style={{ marginTop: 20 }}>
        <PageSkeleton variant="list" lines={4} />
      </div>
    </main>
  );
}

export default function DashboardPage() {
  const { user, loading, maybeAuthed } = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);

  const username = user?.username ?? null;

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!username) return;
      // Graceful degradation: a thrown ApiError (e.g. backend not yet deployed
      // → 404, or the service down) is treated as an empty/degraded state, never
      // an error screen. The way-to-start hub is a fine place to land.
      const [s, c] = await Promise.all([
        listSessions({ username }, signal).catch(() => [] as Session[]),
        listMyCharacters(username, signal).catch(() => [] as Character[]),
      ]);
      if (!signal.aborted) {
        setSessions(s);
        setCharacters(c);
      }
    },
    [username],
  );

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

  // Re-fetch after a character delete/restore (DEL-7).
  const refresh = useCallback(() => {
    const ac = new AbortController();
    void load(ac.signal);
  }, [load]);

  // First-paint: show skeleton until we have a user. `loading` is only ever true
  // alongside maybeAuthed && !user, so `!user` covers the silent-refresh window
  // too (no logged-out flash for returning users — M2).
  if (!user) {
    return <DashboardSkeleton />;
  }

  const name = user.username ?? '';
  const greetName = name ? `, ${name}` : '';
  const dataLoading = sessions === null;
  const isEmpty = !dataLoading && sessions.length === 0;

  return (
    <TavernShell
      active="dashboard"
      title={isEmpty ? `Welcome${greetName}.` : `Welcome back${greetName}.`}
      actions={
        !isEmpty && !dataLoading && sessions.length > 0 ? (
          <Button
            variant="primary"
            href={`/play/${encodeURIComponent(sessions[0].session_id)}`}
            leadingIcon={<Icon name="D20" size={14} aria-hidden />}
          >
            Resume
          </Button>
        ) : undefined
      }
    >
      <div aria-live="polite">
        {dataLoading ? (
          <PageSkeleton variant="card" lines={3} />
        ) : isEmpty ? (
          <DashEmpty username={name} characters={characters} onChanged={refresh} />
        ) : (
          <DashActive
            sessions={sessions}
            characters={characters}
            username={name}
            onChanged={refresh}
          />
        )}
      </div>
    </TavernShell>
  );
}
