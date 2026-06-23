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
 */
import Link from 'next/link';
import type { CombatState, Participant } from '@/lib/api/types';
import styles from './PartyPanel.module.css';

export interface PartyPanelProps {
  participants: Participant[];
  selfUsername: string | null;
  loading?: boolean;
  /** Live combat state for in-combat HP overrides (CUI-11). */
  combatState?: CombatState | null;
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
                  {you && <span className={styles.youBadge}>you</span>}
                  {p.is_dm && <span className={styles.dmBadge}>DM</span>}
                  {isDowned && (
                    <span className={styles.downedBadge} aria-label="downed">
                      ↓
                    </span>
                  )}
                </div>
                {c ? (
                  <>
                    <div className={styles.sub}>
                      {c.char_class ?? 'Adventurer'}
                      {c.level != null ? ` · lv ${c.level}` : ''}
                    </div>
                    <div
                      className={styles.hp}
                      role="meter"
                      aria-valuenow={hp ?? undefined}
                      aria-valuemin={0}
                      aria-valuemax={max ?? undefined}
                      aria-valuetext={
                        hp != null && max != null ? `${hp} of ${max} hit points` : undefined
                      }
                      aria-label={`${c.name ?? p.username} hit points`}
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
                <Link href={`/character/${encodeURIComponent(c.character_id)}`} className={styles.link}>
                  {display}
                </Link>
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
