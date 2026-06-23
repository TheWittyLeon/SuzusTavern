'use client';
/**
 * InitiativeTracker (ST-020 / CUI-11) — turn order during combat, left pane.
 *
 * ADV-7/8 upgrade: now accepts CombatParticipantState[] directly from the
 * engine's structured CombatState rather than the client-built InitEntry[] shim.
 * The old InitEntry interface is retained for backward-compat with existing tests
 * that haven't migrated yet; both prop shapes are accepted via union prop types.
 *
 * Accessibility:
 *   - aria-current="true" on the active-turn row (A11Y D3 req).
 *   - aria-live="polite" on the round indicator so turn changes are announced.
 *   - Downed PC shows a distinct "downed" indicator with aria-label.
 *   - Dead / untargetable entries rendered at reduced opacity with role="note".
 */
import type { CombatParticipantState } from '@/lib/api/types';
import styles from './InitiativeTracker.module.css';

// ── Legacy shim (kept for existing tests) ───────────────────────────────────
export interface InitEntry {
  id: string;
  name: string;
  initiative: number | null;
  kind: 'pc' | 'monster';
  isYou?: boolean;
}

// ── Structured props (engine-driven, CUI-11) ─────────────────────────────────
export interface InitiativeTrackerStructuredProps {
  /** Engine-authoritative participant list. */
  participants: CombatParticipantState[];
  round: number | null;
  /** participant_id of the viewing user's PC (to show "you" badge). */
  selfParticipantId?: string | null;
  // Discriminant so TypeScript resolves the union unambiguously.
  entries?: never;
}

// ── Legacy props (client-built shim) ─────────────────────────────────────────
export interface InitiativeTrackerLegacyProps {
  entries: InitEntry[];
  round: number | null;
  /** Index of the entry whose turn it is, or null if unknown. */
  currentIndex?: number | null;
  participants?: never;
}

export type InitiativeTrackerProps =
  | InitiativeTrackerStructuredProps
  | InitiativeTrackerLegacyProps;

// ── HP bar ────────────────────────────────────────────────────────────────────
function hpColor(ratio: number): string {
  if (ratio > 0.5) return 'var(--good)';
  if (ratio > 0.25) return 'var(--warn)';
  return 'var(--bad)';
}

// ── Structured renderer ───────────────────────────────────────────────────────
function StructuredTracker({
  participants,
  round,
  selfParticipantId,
}: InitiativeTrackerStructuredProps) {
  if (participants.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label} id="initiative-label">
          Initiative
        </span>
        {round != null && (
          <span
            className={styles.round}
            aria-live="polite"
            aria-atomic="true"
          >
            round {round}
          </span>
        )}
      </div>
      <ol className={styles.list} aria-labelledby="initiative-label">
        {participants.map((p) => {
          const isYou = selfParticipantId != null && p.participant_id === selfParticipantId;
          const isDead = !p.is_alive;
          const isDowned = p.death_saves?.is_downed ?? false;
          const hpRatio =
            p.hp_max > 0 ? Math.max(0, p.hp_current) / p.hp_max : 0;

          return (
            <li
              key={p.participant_id}
              className={[
                styles.entry,
                p.is_active_turn ? styles.current : '',
                isDead ? styles.dead : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-current={p.is_active_turn ? true : undefined}
            >
              <span
                className={styles.dot}
                style={{
                  background: isDead
                    ? 'var(--ink-3)'
                    : p.is_pc
                      ? 'var(--accent)'
                      : 'var(--bad)',
                }}
                aria-hidden
              />
              <span className={styles.nameBlock}>
                <span className={styles.name}>
                  {p.name}
                  {isYou && <span className={styles.you}>you</span>}
                  {isDowned && (
                    <span
                      className={styles.downed}
                      aria-label={`${p.name} is downed — making death saves: ${p.death_saves?.successes ?? 0} success, ${p.death_saves?.failures ?? 0} failure`}
                    >
                      ↓
                    </span>
                  )}
                  {isDead && !isDowned && (
                    <span className={styles.deadLabel} aria-label={`${p.name} is dead`}>
                      ✕
                    </span>
                  )}
                </span>
                {/* HP bar — shown for all combatants when hp_max > 0 */}
                {p.hp_max > 0 && (
                  <div
                    className={styles.hpBar}
                    role="meter"
                    aria-valuenow={p.hp_current}
                    aria-valuemin={0}
                    aria-valuemax={p.hp_max}
                    aria-valuetext={`${p.hp_current} of ${p.hp_max} HP`}
                    aria-label={`${p.name} HP`}
                  >
                    <div
                      className={styles.hpFill}
                      style={{
                        width: `${hpRatio * 100}%`,
                        background: isDead ? 'var(--ink-3)' : hpColor(hpRatio),
                      }}
                    />
                  </div>
                )}
              </span>
              <div className={styles.rightCol}>
                {p.ac > 0 && (
                  <span className={styles.ac} aria-label={`AC ${p.ac}`}>
                    {p.ac}
                  </span>
                )}
                <span className={styles.init}>{p.initiative}</span>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Death-save live region: announced assertively when a PC is downed. */}
      {participants
        .filter((p) => p.is_pc && p.death_saves?.is_downed)
        .map((p) => (
          <div
            key={`ds-${p.participant_id}`}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className={styles.deathAlert}
          >
            {p.name} is down — making death saves:{' '}
            {p.death_saves!.successes} success,{' '}
            {p.death_saves!.failures} failure
          </div>
        ))}
    </div>
  );
}

// ── Legacy renderer (client-built shim) ──────────────────────────────────────
function LegacyTracker({
  entries,
  round,
  currentIndex = null,
}: InitiativeTrackerLegacyProps) {
  if (entries.length === 0) return null;
  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label} id="initiative-label">
          Initiative
        </span>
        {round != null && <span className={styles.round}>round {round}</span>}
      </div>
      <ol className={styles.list} aria-labelledby="initiative-label">
        {entries.map((e, i) => {
          const current = currentIndex === i;
          return (
            <li
              key={e.id}
              className={current ? `${styles.entry} ${styles.current}` : styles.entry}
              aria-current={current ? true : undefined}
            >
              <span
                className={styles.dot}
                style={{
                  background: e.kind === 'monster' ? 'var(--bad)' : 'var(--accent)',
                }}
                aria-hidden
              />
              <span className={styles.nameBlock}>
                <span className={styles.name}>
                  {e.name}
                  {e.isYou && <span className={styles.you}>you</span>}
                </span>
              </span>
              <div className={styles.rightCol}>
                <span className={styles.init}>{e.initiative ?? '—'}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── Entry point ───────────────────────────────────────────────────────────────
export default function InitiativeTracker(props: InitiativeTrackerProps) {
  if ('participants' in props && props.participants !== undefined) {
    return <StructuredTracker {...(props as InitiativeTrackerStructuredProps)} />;
  }
  return <LegacyTracker {...(props as InitiativeTrackerLegacyProps)} />;
}
