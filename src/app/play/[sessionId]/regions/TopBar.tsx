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
 * created here. Correction to this comment's own earlier claim (caught
 * while wiring the I4 data-region fix below): NarratorStrip DOES render
 * `<SuzuDM size={56} glow={false} talking={talking} />` internally
 * (NarratorStrip.tsx:116) — "/play does not render <SuzuDM> anywhere
 * today" was wrong as a claim about the RENDERED TREE, even though it was
 * true of page.tsx's own JSX (grep only checked page.tsx directly). The
 * decision stands for the right reason instead: the plan explicitly
 * categorizes NarratorStrip as "wrapped, not edited" and SuzuDM as
 * "as-is (no edit) ... until step 9" (§2.3) — pulling SuzuDM out of
 * NarratorStrip to give SuzuPresence something of its own to wrap would
 * mean EDITING NarratorStrip's internals, which is out of step 3's scope
 * regardless of the Suzu-presence question. "Minus its Suzu slot" is
 * TopBar's own future responsibility split (Suzu becomes NarratorStrip's
 * neighbor, not TopBar's concern), not an instruction to act now — flagged
 * for step 9 or whoever designs the extraction.
 *
 * I4 (Kage-CR/Miko-QA, 2026-09-21 review): SessionHead and TopBar used to
 * share ONE `data-region="topBar"` value across two DOM nodes — inert
 * today, but Miko's sharper read: step 6's Guard 2 ("the same set of
 * data-region ids is mounted every time"), if implemented as a naive id
 * Set, cannot distinguish "both present" from "one vanished" when two
 * unrelated nodes share an id. Split into `topBarSession` /
 * `topBarStatus` — distinct, independently trackable.
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
    <div className={styles.sessionHead} data-region="topBarSession">
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
      data-region="topBarStatus"
    />
  ) : (
    <div className={styles.aiOffStatus} role="status" aria-live="polite" data-region="topBarStatus">
      {statusPill}
    </div>
  );
}
