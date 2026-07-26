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
 *  - resolving auth (loading/maybeAuthed) → skeleton; failed refresh → re-auth
 *    prompt; genuinely logged out → /login (useAuthGate, UIR2-TAV-3)
 *  - no sessions → the way-to-start hub (Option B): three doors + Suzu welcome.
 *    This is also exactly what graceful-degradation lands on if the session-list
 *    backend isn't deployed yet (listSessions throws → treated as []).
 *  - has sessions → resume hero + my campaigns + my characters grid.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useAuthGate } from '@/lib/auth/useAuthGate';
import {
  listSessions,
  listMyCharacters,
  deleteCharacter,
  restoreCharacter,
  deleteSession,
  restoreSession,
} from '@/lib/api/dnd';
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
import BulkActionBar from '@/components/BulkActionBar';
import ConfirmDialog from '@/components/ConfirmDialog';
import SessionRecap from '@/components/SessionRecap';
import { useBulkDelete } from '@/lib/useBulkDelete';
import { sessionTitle, formatStarted } from '@/lib/format';
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

// ── Character grid (ST-044 + BULK-DEL) ────────────────────────────────────────
function CharacterGrid({
  characters,
  username,
  onChanged,
}: {
  characters: Character[];
  username: string;
  onChanged: () => void;
}) {
  // Focus fallback (Iro MAJOR-1 pattern): a stable, always-mounted heading to
  // refocus onto once select mode exits and the checkboxes/bar unmount.
  const sectionRef = useRef<HTMLDivElement>(null);
  const bulk = useBulkDelete({
    noun: 'character',
    deleteOne: deleteCharacter,
    restoreOne: restoreCharacter,
    username,
    onChanged,
    focusFallbackRef: sectionRef,
  });

  const allIds = characters.map((c) => c.character_id);
  const n = bulk.selected.size;

  return (
    <div>
      <SectionHead
        ref={sectionRef}
        title="Your characters"
        level={2}
        tabIndex={-1}
        action={
          characters.length > 0 ? (
            <Button
              variant="ghost"
              aria-pressed={bulk.selectMode}
              onClick={() =>
                bulk.selectMode ? bulk.exitSelectMode() : bulk.enterSelectMode()
              }
            >
              {bulk.selectMode ? 'Cancel' : 'Select'}
            </Button>
          ) : undefined
        }
      />

      {n > 0 && (
        <BulkActionBar
          count={n}
          noun="character"
          onSelectAll={() => bulk.selectAll(allIds)}
          onClear={bulk.clear}
          onCancel={bulk.exitSelectMode}
          onDelete={bulk.openConfirm}
        />
      )}

      <div className={styles.charGrid}>
        {characters.map((c) => {
          const cls = String(c.char_class ?? c.class ?? '').toLowerCase();
          const level = (c.level ?? undefined) as number | undefined;
          const sub = [cls, level !== undefined ? String(level) : '']
            .filter(Boolean)
            .join(' ');
          const name = String(c.name ?? 'this character');
          const cardBody = (
            <>
              <span className={styles.charAvatar} aria-hidden>
                {String(c.name ?? '?').charAt(0).toUpperCase()}
              </span>
              <span className={styles.charName}>{c.name}</span>
              <span className={styles.charSub}>{sub}</span>
            </>
          );
          // The delete control (or, in select mode, the checkbox) is a SIBLING
          // of the card (never nested — a button/input inside an anchor is
          // invalid + breaks AT). The wrapper is the positioning context for
          // the corner control.
          return (
            <div key={c.character_id} className={styles.charCardWrap}>
              {bulk.selectMode ? (
                // Select mode: the card is no longer a navigation link — the
                // checkbox is the primary control, so clicking the card body
                // would otherwise navigate away mid-selection. tabIndex is left
                // off this div deliberately; the checkbox below is the real
                // keyboard-reachable control.
                <div className={styles.charCard}>{cardBody}</div>
              ) : (
                <Link
                  href={`/character/${encodeURIComponent(c.character_id)}`}
                  className={styles.charCard}
                >
                  {cardBody}
                </Link>
              )}
              {bulk.selectMode ? (
                <label className={styles.charCheckWrap}>
                  <input
                    type="checkbox"
                    className={styles.charCheck}
                    checked={bulk.selected.has(c.character_id)}
                    onChange={() => bulk.toggle(c.character_id)}
                    aria-label={`Select ${name}`}
                  />
                </label>
              ) : (
                <DeleteCharacterButton
                  characterId={c.character_id}
                  characterName={name}
                  username={username}
                  onChanged={onChanged}
                  className={styles.charDelete}
                />
              )}
            </div>
          );
        })}
        {/* TAV-17: the two visible words compose the accessible name "New create",
            which reads as nonsense to a screen reader. Give the link an explicit
            aria-label; the "New" / "create" stack stays as the visual card copy.
            Hidden in select mode — it isn't a selectable/deletable row. */}
        {!bulk.selectMode && (
          <Link
            href="/character/new"
            className={`${styles.charCard} ${styles.charNew}`}
            aria-label="Create a new character"
          >
            <span className={styles.charNewIcon} aria-hidden>
              <Icon name="Plus" size={20} />
            </span>
            <span className={styles.charName}>New</span>
            <span className={styles.charSub}>create</span>
          </Link>
        )}
      </div>

      <ConfirmDialog
        open={bulk.confirmOpen}
        tone="danger"
        title={`Delete ${n} character${n === 1 ? '' : 's'}?`}
        body="They'll move to your trash, recoverable for 7 days."
        confirmLabel="Move to trash"
        cancelLabel="Keep"
        busy={bulk.busy}
        onConfirm={() => void bulk.runDelete()}
        onCancel={bulk.closeConfirm}
      />
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

  // BULK-DEL: only the DM of a campaign can delete it (engine enforces this
  // server-side too — a non-owner delete call 404s). "Select all" only ever
  // selects DM-owned rows; non-DM rows never render a checkbox.
  const isDmOf = useCallback(
    (s: Session) =>
      !!username && (s.dm_username ?? '').toLowerCase() === username.toLowerCase(),
    [username],
  );
  const campaignBulk = useBulkDelete({
    noun: 'campaign',
    deleteOne: deleteSession,
    restoreOne: restoreSession,
    username,
    onChanged,
    focusFallbackRef: campaignsSectionRef,
  });
  const dmSessionIds = sessions.filter(isDmOf).map((s) => s.session_id);
  const nCampaigns = campaignBulk.selected.size;

  const hero = sessions[0];
  const heroTitle = sessionTitle(hero);
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
              <div className={styles.campaignHeadActions}>
                {dmSessionIds.length > 0 && (
                  <Button
                    variant="ghost"
                    aria-pressed={campaignBulk.selectMode}
                    onClick={() =>
                      campaignBulk.selectMode
                        ? campaignBulk.exitSelectMode()
                        : campaignBulk.enterSelectMode()
                    }
                  >
                    {campaignBulk.selectMode ? 'Cancel' : 'Select'}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  href="/modules"
                  leadingIcon={<Icon name="Plus" size={12} aria-hidden />}
                >
                  New
                </Button>
              </div>
            }
          />

          {nCampaigns > 0 && (
            <BulkActionBar
              count={nCampaigns}
              noun="campaign"
              onSelectAll={() => campaignBulk.selectAll(dmSessionIds)}
              onClear={campaignBulk.clear}
              onCancel={campaignBulk.exitSelectMode}
              onDelete={campaignBulk.openConfirm}
            />
          )}

          <Card padding={false} className={styles.campaignList}>
            {sessions.map((s) => {
              const suzu = (s.dm_username ?? '').toLowerCase() === 'suzu';
              // Only the campaign's DM (owner) sees the delete control (single
              // or bulk); the engine also enforces owner-only delete (a
              // non-owner delete call 404s).
              const isDM = isDmOf(s);
              const campaignName = sessionTitle(s);
              return (
                <div
                  key={s.session_id}
                  className={
                    campaignBulk.selectMode
                      ? `${styles.campaignRow} ${styles.campaignRowSelect}`
                      : styles.campaignRow
                  }
                >
                  {campaignBulk.selectMode && (
                    <span className={styles.campaignCheckCol}>
                      {isDM && (
                        <label className={styles.campaignCheckWrap}>
                          <input
                            type="checkbox"
                            checked={campaignBulk.selected.has(s.session_id)}
                            onChange={() => campaignBulk.toggle(s.session_id)}
                            aria-label={`Select campaign ${campaignName}`}
                          />
                        </label>
                      )}
                    </span>
                  )}
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
                    {isDM && !campaignBulk.selectMode && (
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

          <ConfirmDialog
            open={campaignBulk.confirmOpen}
            tone="danger"
            title={`Delete ${nCampaigns} campaign${nCampaigns === 1 ? '' : 's'}?`}
            body={
              nCampaigns === 1 ? (
                <>
                  This closes the table for everyone at it and moves it to your
                  trash. Your players&rsquo; characters are kept. You can restore
                  it for the next 7 days, after which it&rsquo;s permanently
                  removed.
                </>
              ) : (
                <>
                  This closes the table for everyone at these {nCampaigns}{' '}
                  campaigns and moves them to your trash. Your players&rsquo;
                  characters are kept. You can restore them for the next 7 days,
                  after which they&rsquo;re permanently removed.
                </>
              )
            }
            confirmLabel="Move to trash"
            cancelLabel="Keep"
            busy={campaignBulk.busy}
            onConfirm={() => void campaignBulk.runDelete()}
            onCancel={campaignBulk.closeConfirm}
          />
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

export default function DashboardPage() {
  const { user } = useAuth();
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
    if (!username) return;
    const ac = new AbortController();
    // Canonical fetch-on-mount pattern (React docs "Fetching data" example);
    // `load` sets state only after the async request resolves, guarded by
    // `signal.aborted`. There's no external store to subscribe to here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(ac.signal);
    return () => ac.abort();
  }, [username, load]);

  // Re-fetch after a character delete/restore (DEL-7).
  const refresh = useCallback(() => {
    const ac = new AbortController();
    void load(ac.signal);
  }, [load]);

  // Resolving (silent refresh) → bounded skeleton; failed refresh → re-auth
  // prompt; genuinely logged out → redirect to /login. Never an infinite
  // skeleton or a page rendered with a null user (UIR2-TAV-3).
  const gate = useAuthGate({
    skeleton: (
      <>
        <PageSkeleton variant="card" lines={3} />
        <div style={{ marginTop: 20 }}>
          <PageSkeleton variant="list" lines={4} />
        </div>
      </>
    ),
    label: 'Loading your dashboard',
  });
  if (gate) return gate;
  // useAuthGate only returns null once `user` is non-null, but that
  // invariant lives in a different hook — this satisfies TS's narrowing.
  if (!user) return null;

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
          // TAV-DASHBOARD-SKELETON-DOUBLE-LIVEREGION: this wrapping
          // aria-live="polite" div already announces content changes as
          // dataLoading resolves — PageSkeleton's own role="status" region
          // would be a SECOND announcer for the exact same phase.
          // announce={false} makes this a purely visual skeleton so the
          // aria-live wrapper is the single announcer.
          <PageSkeleton variant="card" lines={3} announce={false} />
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
