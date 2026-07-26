'use client';
/**
 * PartyPanel (ST-061 / CUI-11) — the left-pane party roster.
 *
 * Real data from GET /api/dnd/sessions/:id/participants: each member's first
 * active character with HP bar, HP/max, AC, and class. The self member is
 * highlighted. Members with a character link through to their sheet; members
 * with no character yet show a muted "no character yet" line.
 *
 * ADV-7/8 (CUI-11): when `combatState` is provided and combat is active,
 * HP values are overridden from the engine's structured state so the party
 * panel reflects live combat HP instead of the stale session-load snapshot.
 * Falls back to `participants[].character.*` when no combatState or not in combat.
 *
 * F5/LEVELUP-NO-MOMENT: a "level up" badge renders per-character when
 * `character.pending_choices.length > 0` (queued subclass/ASI/spell picks
 * awaiting resolution) — driven straight off the roster the parent already
 * fetches, no extra per-character request.
 *
 * TAV-PARTY-INLINE-SHEET: a member card with a character used to be a
 * `<Link href="/character/[id]">` — clicking it navigated away and reloaded
 * the whole play session. It's now a `<button>` that calls `onSelectMember`
 * so the caller (the play page) can open the sheet in an inline drawer
 * instead. A member with no character stays non-interactive, exactly as
 * before.
 */
import type { CombatState, Participant } from '@/lib/api/types';
import styles from './PartyPanel.module.css';

export interface PartyPanelProps {
  participants: Participant[];
  selfUsername: string | null;
  loading?: boolean;
  /** Live combat state for in-combat HP overrides (CUI-11). */
  combatState?: CombatState | null;
  /** TAV-PARTY-INLINE-SHEET: called with a member's participant when their
   *  card is clicked (only fires for members who have a character). */
  onSelectMember?: (participant: Participant) => void;
}

function hpColor(ratio: number): string {
  if (ratio > 0.5) return 'var(--good)';
  if (ratio > 0.25) return 'var(--warn)';
  return 'var(--bad)';
}

export default function PartyPanel({
  participants,
  selfUsername,
  loading = false,
  combatState = null,
  onSelectMember,
}: PartyPanelProps) {
  const self = (selfUsername ?? '').toLowerCase();

  if (loading) {
    return <div className={styles.empty}>Loading party…</div>;
  }
  if (participants.length === 0) {
    return <div className={styles.empty}>No one has joined this table yet.</div>;
  }

  // Build a participant_id → combatant lookup for live HP overrides.
  // Matches by character name since participants don't carry participant_id.
  const combatHpByName: Map<string, { hp: number; max: number; isDowned: boolean }> =
    new Map();
  if (combatState && combatState.state !== 'ended') {
    for (const p of combatState.participants) {
      if (p.is_pc) {
        combatHpByName.set(p.name.toLowerCase(), {
          hp: p.hp_current,
          max: p.hp_max,
          isDowned: p.death_saves?.is_downed ?? false,
        });
      }
    }
  }

  return (
    <div>
      <div className={styles.label} id="party-panel-label">
        Party · {participants.length}
      </div>
      <ul className={styles.list} aria-labelledby="party-panel-label">
        {participants.map((p) => {
          const you = p.username.toLowerCase() === self;
          const c = p.character;
          // F5/LEVELUP-NO-MOMENT: driven straight from the roster's own
          // character.pending_choices (routes/sessions.py's participants
          // route echoes the sheet's pending_choices onto each entry) — no
          // per-character sheet fetch needed just to show this badge.
          const hasPendingChoices = (c?.pending_choices?.length ?? 0) > 0;

          // Live combat HP overrides the stale snapshot when available.
          const liveHp = c?.name ? combatHpByName.get(c.name.toLowerCase()) : undefined;
          const hp = liveHp?.hp ?? c?.current_hp ?? null;
          const max = liveHp?.max ?? c?.max_hp ?? null;
          const isDowned = liveHp?.isDowned ?? false;
          const ratio = hp != null && max != null && max > 0 ? hp / max : 1;
          const display = (
            <div className={you ? `${styles.member} ${styles.you}` : styles.member}>
              <div className={styles.avatar} aria-hidden>
                {(c?.name ?? p.username).charAt(0).toUpperCase()}
              </div>
              <div className={styles.body}>
                <div className={styles.nameRow}>
                  <span className={styles.name}>{c?.name ?? p.username}</span>
                </div>
                {/* UIR2-TAV-23: badges moved off the name row onto their own
                    line so a short-but-not-tiny name (e.g. 6 chars) never
                    competes with them for the fixed 220px .left column's
                    width at desktop breakpoints — the name gets the full row
                    and its ellipsis only engages when the name itself is
                    genuinely too long, not whenever a badge is present. */}
                {(you || p.is_dm || isDowned || hasPendingChoices) && (
                  <div className={styles.badgeRow}>
                    {you && <span className={styles.youBadge}>you</span>}
                    {p.is_dm && <span className={styles.dmBadge}>DM</span>}
                    {isDowned && (
                      <span className={styles.downedBadge} aria-label="downed">
                        ↓
                      </span>
                    )}
                    {hasPendingChoices && (
                      // Iro MAJOR-2: the `↑` glyph is aria-hidden so AT doesn't read it
                      // literally; the visible "level up" text stands on its own, and the
                      // descriptive clause moves into the project's existing `.sr-only`
                      // utility (globals.css) rather than a bare-span aria-label (unreliable
                      // across AT). Wording generalized "archetype" → "choose new features"
                      // to match the toast copy (line ~334 below) since pending_choices also
                      // covers ASI/spell picks, not just subclass/archetype.
                      <span className={styles.levelUpBadge}>
                        <span aria-hidden="true">↑</span> level up
                        <span className="sr-only"> — choose new features</span>
                      </span>
                    )}
                  </div>
                )}
                {c ? (
                  <>
                    <div className={styles.sub}>
                      {c.char_class ?? 'Adventurer'}
                      {c.level != null ? ` · lv ${c.level}` : ''}
                    </div>
                    <div
                      className={styles.hp}
                      /* A11Y (Iro MEDIUM-2): role=meter requires aria-valuenow; when hp or
                         max is null (character data not yet loaded) those attributes would be
                         absent, which is a role-attribute-required violation. Guard the role
                         so AT sees a plain div instead of a broken meter widget. */
                      role={hp != null && max != null ? 'meter' : undefined}
                      aria-valuenow={hp ?? undefined}
                      aria-valuemin={hp != null && max != null ? 0 : undefined}
                      aria-valuemax={max ?? undefined}
                      aria-valuetext={
                        hp != null && max != null ? `${hp} of ${max} hit points` : undefined
                      }
                      aria-label={hp != null && max != null ? `${c.name ?? p.username} hit points` : undefined}
                    >
                      <div
                        className={styles.hpFill}
                        style={{ width: `${ratio * 100}%`, background: hpColor(ratio) }}
                      />
                    </div>
                  </>
                ) : (
                  <div className={styles.subMuted}>no character yet</div>
                )}
              </div>
              {c && (
                <div className={styles.stats}>
                  {hp != null && max != null && (
                    <div className={styles.mono}>
                      {hp}/{max}
                    </div>
                  )}
                  {c.ac != null && <div className={styles.ac}>AC {c.ac}</div>}
                </div>
              )}
            </div>
          );
          return (
            <li key={p.username}>
              {c?.character_id ? (
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => onSelectMember?.(p)}
                >
                  {display}
                </button>
              ) : (
                display
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
