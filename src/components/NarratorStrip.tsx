'use client';
/**
 * NarratorStrip (ST-018 / ST-071) — sticky top strip in the play centre pane.
 *
 * TAV-NARRATION-DECOUPLE (2026-07-25): this strip used to show Suzu's
 * live-streaming narration text. Narration now lives SOLELY in the chat log
 * (ChatLog's `upsertStreamNarration` / `finalizeStreamNarration` growing row)
 * — see page.tsx's `subscribeToJob`/`narrate()`. This strip is repurposed to
 * a persistent SCENE / COMBAT STATUS banner instead:
 *   - out of combat: the current scene name + objective
 *     (`grounding.scene_name` / `grounding.objective`).
 *   - in combat: round + whose-turn + (when available) initiative order.
 *
 * Presentational only: the play screen derives every string from
 * `grounding`/`combatState` and passes it down — this component does no
 * fetching/polling of its own. `talking` still drives the SuzuDM avatar's
 * talking animation (Suzu is still "live" while a beat generates, even
 * though her prose no longer streams here).
 *
 * Iro-A11y CRITICAL (review pass) — during combat, the pre-existing "Iro
 * MEDIUM-2" persistent turn-status live region elsewhere on the page
 * (page.tsx, near the composer) is the SOLE announcer of whose-turn-it-is;
 * this strip's own `aria-live` is forced to `'off'` while `combatActive` so
 * the same text isn't announced TWICE per turn. The combat line stays fully
 * VISIBLE (sighted users still see it here, no scroll needed) — only the SR
 * auto-announcement is suppressed. Out of combat there is no competing
 * announcer, so the scene/objective banner stays `polite`.
 */
import type { ReactNode } from 'react';
import SuzuDM from '@/components/SuzuDM';
import styles from './NarratorStrip.module.css';

export interface NarratorStripProps {
  /** True while a narration beat is generating — drives the SuzuDM talking state. */
  talking?: boolean;
  /** Current scene name (`grounding.scene_name`). Shown out of combat. */
  sceneName?: string | null;
  /** Current scene objective (`grounding.objective`). Shown out of combat,
   *  alongside `sceneName`. */
  objective?: string | null;
  /** True while combat is active — switches the middle text region to
   *  combat status (round / whose-turn / initiative order). */
  combatActive?: boolean;
  /** Current combat round (`combatState.round`). Only read when `combatActive`. */
  round?: number | null;
  /** Whose-turn label, e.g. "Your turn!" / "Waiting on X's turn..." /
   *  "Monster turn — X". Only read when `combatActive`. */
  turnStatusText?: string | null;
  /** Ordered combatant names (`combatState.initiative` mapped to names) — an
   *  "if easy" glance at turn order. Omit/empty to hide. Only read when
   *  `combatActive`. */
  initiativeOrder?: string[];
  /** Right-aligned status pill(s), e.g. round/exploring indicator. */
  status?: ReactNode;
}

export default function NarratorStrip({
  talking = false,
  sceneName,
  objective,
  combatActive = false,
  round,
  turnStatusText,
  initiativeOrder,
  status,
}: NarratorStripProps) {
  const combatParts = combatActive
    ? [
        round != null ? `Round ${round}` : null,
        turnStatusText,
        initiativeOrder && initiativeOrder.length > 0
          ? `Order: ${initiativeOrder.join(', ')}`
          : null,
      ].filter((part): part is string => !!part)
    : [];
  const combatLine = combatParts.join(' — ');
  const sceneLine = !combatActive
    ? [sceneName, objective].filter((part): part is string => !!part).join(' — ')
    : '';
  const line = combatActive ? combatLine : sceneLine;
  const empty = combatActive ? combatParts.length === 0 : !sceneLine.trim();

  return (
    // role=status stays regardless (it's still a live-region CONTAINER, just
    // muted during combat — see the module doc comment above). Out of
    // combat, aria-live=polite announces the scene/objective banner on real
    // change only — the text below is DERIVED from grounding/combatState, so
    // a poll tick that doesn't change either only re-renders the same DOM
    // text (no mutation => no re-announcement); it never fires on a timer.
    <div
      className={styles.strip}
      role="status"
      aria-live={combatActive ? 'off' : 'polite'}
      aria-atomic="true"
    >
      <SuzuDM size={56} glow={false} talking={talking} />
      <div className={styles.dialog}>
        {empty ? (
          <span className={styles.idle}>
            {combatActive ? 'Combat is underway.' : 'Suzu is setting the scene…'}
          </span>
        ) : (
          <span className={styles.text}>{line}</span>
        )}
      </div>
      {status ? <div className={styles.status}>{status}</div> : null}
    </div>
  );
}
