'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import Icon from '@/components/Icon';
import NarratorStrip from '@/components/NarratorStrip';
import styles from '../Play.module.css';
import type { RegionVariant } from '../variants';

/**
 * TAV-PLAY-SHELL step 6b, commit C4 (build brief §6.8) — `TopBar` becomes
 * the single top-of-grid region, retiring the `SessionHead`/`TopBar`
 * two-named-export split from step 3 (`debt:` marker, `until: step 6
 * lands — TopBar becomes the single top-of-grid region and owns both
 * pieces` — that trigger fires in this commit). ONE component, ONE root,
 * `data-region="topBar"`: the row gives `topBar` one area, so the two
 * pieces that used to live in different DOM parents (the party aside's
 * session head, the story main's status strip) now render side by side
 * inside that one area.
 *
 * I4's old regression pins (`play-data-region-contract.test.ts`) asserted
 * the exact two-id shape this merge retires — rewritten in the SAME
 * commit to assert the merged shape (the brief's one named exception to
 * "never edit a pinning test in the commit that pins it": those pins were
 * pinning a transitional state whose own `until:` has fired).
 *
 * `SuzuPresence` (this step's other extraction, "wraps SuzuDM") is NOT
 * here — `NarratorStrip` no longer renders `<SuzuDM>` internally either
 * (deleted in this same commit); `regions/SuzuPresence.tsx` is its own
 * region with its own grid area now.
 */
export interface TopBarProps {
  title: string;
  journalOpen: boolean;
  onToggleJournal: () => void;
  /** Kage-CR A7 IMPORTANT-5: reads useJournalDrawer's own `id` instead of a
   *  hand-typed copy of 'play-pane-journal'. */
  paneId: string;
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
  /** The row's `variant` (`REGION_VARIANTS.topBar`): `full` is the two-row
   *  header (Story); `compact` is the one-line form (Table over the stage, and
   *  the phone's header). Unset renders `full`. */
  variant?: RegionVariant<'topBar'>;
  /** A9c-2 D3 (R23): the page's Appearance trigger (`<TweaksPanel />`), rendered
   *  AFTER the journal toggle so the exit stays the first tab stop. `/play` is
   *  outside `TavernShell`, so this is the only place the layout picker can be
   *  reached mid-session. The region never imports theme code: it is a node. */
  settings?: ReactNode;
}

/** S5.5: NarratorStrip (a scene/combat status banner) hidden when
 *  ai_assist_level='off'; the combat status pill surfaces inline instead so
 *  turn/round info remains visible. */
export default function TopBar({
  title,
  journalOpen,
  onToggleJournal,
  paneId,
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
  variant = 'full',
  settings,
}: TopBarProps) {
  const compact = variant === 'compact';
  const narrator = showSuzuPanel ? (
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
  ) : null;
  const aiOff = (
    <div className={styles.aiOffStatus} role="status" aria-live="polite">
      {statusPill}
    </div>
  );

  return (
    <div
      data-region="topBar"
      data-toast-clear=""
      data-variant={variant}
      className={compact ? styles.topBarCompact : undefined}
    >
      <div className={styles.sessionHead}>
        <Link href="/lobby" className={styles.back} aria-label="Leave session">
          <Icon name="Chevron" size={14} style={{ transform: 'rotate(180deg)' }} />
        </Link>
        <div className={styles.sessionTitleWrap}>
          {compact ? null : <div className={styles.kicker}>Session</div>}
          <div className={styles.sessionTitle}>{title}</div>
          {/* compact: the visible pill, inside the title's wrapper so a narrow header
              can stack it UNDER the title with one flex-direction (A9d E5b). `aria-hidden`
              because NarratorStrip (in the `sr-only` wrapper below) already carries it —
              one announcer per fact (A4). */}
          {compact && showSuzuPanel ? (
            <span aria-hidden="true" className={styles.sessionPill}>
              {status}
            </span>
          ) : null}
          {/* AI off has no NarratorStrip, so its pill is the announcer, and it sits in the
              SAME wrapper as the AI-on pill (A9d-1 lever 4: the same two-line left column,
              so the header is the same height either way). ONE tree position in both
              variants (Kage A9c-2 IMPORTANT-5): the AI-off pill is a live region, and a node
              that moves between a full and a compact position is destroyed and recreated by
              React, so every Story <-> Table switch re-announced it. Pinned on the real page
              by play.render-matrix.real-page.test.tsx. */}
          {showSuzuPanel ? null : aiOff}
        </div>
        {/* DDX-22: Journal drawer toggle — visible to every seat (not
            isDm-gated; the journal is a per-player surface, not a DM tool). */}
        <button
          type="button"
          className={styles.journalToggleBtn}
          onClick={onToggleJournal}
          aria-haspopup="dialog"
          aria-expanded={journalOpen}
          aria-controls={paneId}
          aria-label="Open journal"
        >
          <Icon name="Lantern" size={16} aria-hidden />
        </button>
        {settings && <div className={styles.settingsSlot}>{settings}</div>}
      </div>
      {/* compact: NarratorStrip stays MOUNTED so topBar still announces (R3); it
          is redundant on screen (the stage shows the scene, suzuPresence shows
          `talking`, turnStatus announces the turn). The wrapper is rendered in
          BOTH variants and only its class toggles, so an Auto switch never
          remounts NarratorStrip (a remount re-announces the scene). */}
      {narrator && <div className={compact ? 'sr-only' : undefined}>{narrator}</div>}
    </div>
  );
}
