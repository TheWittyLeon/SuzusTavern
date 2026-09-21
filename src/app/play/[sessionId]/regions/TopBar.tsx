'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import Icon from '@/components/Icon';
import NarratorStrip from '@/components/NarratorStrip';
import styles from '../Play.module.css';

/**
 * TAV-PLAY-SHELL step 3 — pure region extraction (decomposition plan §2.3:
 * "TopBar | wraps NarratorStrip minus its Suzu slot"). Two named exports,
 * not one component, same reason as TableControls: today's DOM has the
 * session title/back-link/journal-toggle as a direct child of the party
 * `<aside>` and NarratorStrip as a direct child of the story `<main>` —
 * different parents. The plan's TopBar prop list (`title`, `onLeave`,
 * `scene`, `combat`, `statusPill`) covers BOTH pieces because step 6's real
 * TopBar is a single top-of-grid region that will own both; until then
 * this file is where both live, called from their existing positions.
 *
 * SuzuPresence (this step's other named region, "wraps SuzuDM") is NOT
 * created here: `/play` does not render `<SuzuDM>` anywhere today (grep
 * confirmed) — the plan's own description ("minus its Suzu slot") already
 * says NarratorStrip has no Suzu content to extract either. There is no
 * existing JSX to move, and inventing an empty wrapper around a component
 * `/play` never renders would be new code, not a move, and a component
 * with zero current callers — flag for whoever adds Suzu's presence to
 * `/play` (step 9, "Suzu's moods", or earlier).
 */

export interface SessionHeadProps {
  title: string;
  journalOpen: boolean;
  onToggleJournal: () => void;
}

/** Back-to-lobby link + session title + journal-drawer toggle. Renders as a
 *  direct child of the party `<aside>`, exactly where it lives today. */
export function SessionHead({ title, journalOpen, onToggleJournal }: SessionHeadProps) {
  return (
    <div className={styles.sessionHead} data-region="topBar">
      <Link href="/lobby" className={styles.back} aria-label="Leave session">
        <Icon name="Chevron" size={14} style={{ transform: 'rotate(180deg)' }} />
      </Link>
      <div>
        <div className={styles.kicker}>Session</div>
        <div className={styles.sessionTitle}>{title}</div>
      </div>
      {/* DDX-22: Journal drawer toggle — visible to every seat (not
          isDm-gated like .sessionControls below; the journal is a
          per-player surface, not a DM tool). Desktop-only in practice: the
          drawer chrome it opens is media-gated to >880px, so this button
          simply has no visual effect at mobile widths (the 4th mobile tab
          is how the journal is reached there). */}
      <button
        type="button"
        className={styles.journalToggleBtn}
        onClick={onToggleJournal}
        aria-haspopup="dialog"
        aria-expanded={journalOpen}
        aria-controls="play-pane-journal"
        aria-label="Open journal"
      >
        <Icon name="Lantern" size={16} aria-hidden />
      </button>
    </div>
  );
}

export interface TopBarProps {
  showSuzuPanel: boolean;
  talking: boolean;
  sceneName: string | null;
  objective: string | null;
  combatActive: boolean;
  round: number | null;
  turnStatusText: string | null;
  initiativeOrder: string[];
  status: ReactNode;
  statusPill: ReactNode;
}

/** S5.5: NarratorStrip (a scene/combat status banner) hidden when
 *  ai_assist_level='off'; the combat status pill surfaces inline instead so
 *  turn/round info remains visible. Renders as a direct child of the story
 *  `<main>`, exactly where it lives today. */
export function TopBar({
  showSuzuPanel,
  talking,
  sceneName,
  objective,
  combatActive,
  round,
  turnStatusText,
  initiativeOrder,
  status,
  statusPill,
}: TopBarProps) {
  return showSuzuPanel ? (
    <NarratorStrip
      talking={talking}
      sceneName={sceneName}
      objective={objective}
      combatActive={combatActive}
      round={round}
      turnStatusText={turnStatusText}
      initiativeOrder={initiativeOrder}
      status={status}
    />
  ) : (
    <div className={styles.aiOffStatus} role="status" aria-live="polite" data-region="topBar">
      {statusPill}
    </div>
  );
}
