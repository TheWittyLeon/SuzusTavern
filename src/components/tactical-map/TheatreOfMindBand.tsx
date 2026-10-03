'use client';
// src/components/tactical-map/TheatreOfMindBand.tsx
//
// The combat-without-a-board fallback (Aoi-UI design §3, §5 "Show 5"):
// "Theatre of mind is the absence of a field, not a mode." Renders whenever
// an active combat's encounter authored no `space` — same participant
// fields already on the wire today, no grid to draw, no engine branch to
// maintain (design §5). Reuses ConditionChipList (existing DS component —
// design §2's own note: "No new top-level component needed outside
// TacticalBoard itself") rather than inventing a second condition renderer.
import type { CombatParticipantState } from '@/lib/api/types';
import ConditionChipList from '@/components/ConditionChipList';
import styles from './TacticalMap.module.css';

export interface TheatreOfMindBandProps {
  participants: CombatParticipantState[];
  className?: string;
}

export default function TheatreOfMindBand({ participants, className }: TheatreOfMindBandProps) {
  return (
    <div
      className={[styles.tomBand, className].filter(Boolean).join(' ')}
      role="list"
      aria-label="Combatants"
      // B8c-3 run 2 (Iro): the band SCROLLS in a short room (six chips do not fit three rows), and a scroller with no tab stop cannot be scrolled by keyboard where the browser does not make it
      // one (WebKit does not; Chromium happens to). `tabIndex={0}` makes it one in every engine, keeping its name; the ring is `.tomBand:focus-visible`.
      tabIndex={0}
    >
      {participants.map((p) => (
        <div
          key={p.participant_id}
          role="listitem"
          className={[styles.tomToken, p.is_active_turn && styles.tomTokenActive]
            .filter(Boolean)
            .join(' ')}
        >
          <span className={styles.tomName}>{p.name}</span>
          <span className={styles.tomHp}>
            {p.hp_current}/{p.hp_max}
          </span>
          <ConditionChipList
            conditions={p.conditions}
            durations={p.condition_durations}
            combatantName={p.name}
          />
        </div>
      ))}
    </div>
  );
}
