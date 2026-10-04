import type { ReactNode } from 'react';
import Pill from '@/components/Pill';
import styles from './Play.module.css';

/**
 * The play page's two combat/exploring pills (moved out of page.tsx, TPK-HOLD W3, to pay for the override dialog's host: the ratchet only shrinks).
 *
 * `statusPill` says the round; `narratorStatusPill` is the NarratorStrip's own slot, which already states "Round N" in its combat line, so
 * repeating the round there read it twice (Iro-A11y CRITICAL, review pass). Scoped to ONLY the NarratorStrip prop: the aiOffStatus
 * fallback (ai_assist_level='off', no NarratorStrip) still uses the full `statusPill`, whose round is `aria-hidden` (A9d-2, Iro A9d-1
 * MINOR-5: the initiative tracker in the party strip is the one polite region that says it, in every row).
 */
export function statusPills(combatIsActive: boolean, round: number | null): { statusPill: ReactNode; narratorStatusPill: ReactNode } {
  const statusPill = combatIsActive ? (
    <Pill tone="lav" dot><span className={styles.pillRound} aria-hidden>round {round ?? 1} · </span>combat</Pill>
  ) : (
    <Pill tone="muted" dot>
      exploring
    </Pill>
  );
  const narratorStatusPill = combatIsActive ? (
    <Pill tone="lav" dot>
      combat
    </Pill>
  ) : statusPill;
  return { statusPill, narratorStatusPill };
}
