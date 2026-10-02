'use client';

import { useRef, useState, type ReactNode } from 'react';
import type { CombatState, Participant } from '@/lib/api/types';
import AnchoredPopover from '@/components/AnchoredPopover';
import Icon from '@/components/Icon';
import PartyPanel from '@/components/PartyPanel';
import InitiativeTracker from '@/components/InitiativeTracker';
import RebindCharacterButton from '@/components/RebindCharacterButton';
import { useAnchoredPopover } from '@/lib/a11y/useAnchoredPopover';
import type { RegionVariant } from '../variants';
import styles from '../Play.module.css';

/**
 * TAV-PLAY-SHELL step 3 — pure region extraction. PartyPanel + the rebind
 * affordances + InitiativeTracker, moved verbatim (decomposition plan
 * §2.3: "survives as-is: PartyPanel + InitiativeTracker composed"). Does
 * NOT own the `<aside id="play-pane-party" aria-label="Party and
 * initiative">` landmark itself — that wrapper (and the session-head
 * content above it, TopBar's eventual home) stays in page.tsx for now,
 * since no single region owns the whole landmark yet; this is the party
 * roster's own content, placed inside it.
 *
 * A9c-2 D1 (build brief 6): consumes its `variant` (the registry's union, not
 * a hand-written copy). `rail` and `strip` are two presentations of the same
 * children, which stay mounted either way (InitiativeTracker holds two
 * live regions, R3).
 *
 * A9d-2 fix round N9 (Sora lever brief 2.4; Tora MAJOR-3, C4; Iro Major-2): the roster's non-tile controls sit in a TRAILING column
 * beside the tile row (PartyPanel `trailing`), never inside the row that scrolls sideways:
 *   - a player's own "Change character" button, so exploring party content is the one tile row (91px) and nothing sits below the band's edge;
 *   - the DM's "Session" button (label and icon, a 44px target). It opens an anchored popover (`keepMounted`: Pause / End session / Award XP,
 *     gold, the campaign floor keep their state while closed) that holds the Session card (`session`, handed in by the page: it owns the
 *     lifecycle state) AND the rebind rows for every member, which used to stack in the band ahead of the tiles. The Session card was a
 *     542px block before the tiles in a 91px scroller (DM tiles at y 646 under a band that ended at 180). On every row, desktop too.
 * A dialog the card opens (End session's confirm, the campaign floor's) needs nothing from this band: the popover primitive treats an open modal
 * layer as owning the press and the focus (useAnchoredPopover), so the popover simply stays open under it.
 */
export interface PartyStripProps {
  participants: Participant[];
  selfUsername: string | null;
  combatState: CombatState | null;
  onSelectMember: (p: Participant) => void;
  isDm: boolean;
  sessionId: string;
  combatIsActive: boolean;
  sessionLocked: boolean;
  /** The session has ENDED (not merely paused): an open Session popover closes on that edge, with nothing in it left to press (A9d-2 round 5, Iro MINOR-1). */
  sessionEnded?: boolean;
  onRebindChanged: () => void;
  round: number | null;
  selfPcId: string | null;
  variant?: RegionVariant<'partyStrip'>;
  /** The DM's Session card (the page owns the lifecycle state it drives). Given only to the DM, who is what shows the Session button. */
  session?: () => ReactNode;
  /** Where focus goes if the Session button is gone when its popover closes (the scene head): never <body>. */
  fallbackFocus?: () => HTMLElement | null | undefined;
}

/** The Session popover is no taller than this (px). */
const SESSION_POPOVER_MAX_PX = 360;

export default function PartyStrip({
  participants,
  selfUsername,
  combatState,
  onSelectMember,
  isDm,
  sessionId,
  combatIsActive,
  sessionLocked,
  sessionEnded = false,
  onRebindChanged,
  round,
  selfPcId,
  variant = 'rail',
  session,
  fallbackFocus,
}: PartyStripProps) {
  const [sessionOpen, setSessionOpen] = useState(false);
  const sessionBtnRef = useRef<HTMLButtonElement>(null);
  const pop = useAnchoredPopover({
    open: sessionOpen,
    onClose: () => setSessionOpen(false),
    anchorRef: sessionBtnRef,
    role: 'dialog',
    keepMounted: true,
    fallbackFocus,
    // 540px of card in a popover that opens under the party band would run over the composer and the verbs: it stops short of them and
    // scrolls inside (the scroll cue), so a press outside it can still land on a verb (Tora C1's leg) and the log stays in view.
    maxHeight: SESSION_POPOVER_MAX_PX,
  });
  // The DM seat is what shows the button (and holds every member's rebind row); `session` is the page's Session card, absent in a bare render.
  const showSession = isDm;
  // The seat losing the DM role takes the button; an `open` left behind must not show the popover the next time it holds.
  if (!showSession && sessionOpen) setSessionOpen(false);
  // The session ENDING closes an open Session popover: every control in it is then disabled, so focus would fall to <body> (the confirm's own restore
  // lands on a disabled End session) and Escape would do nothing. On the rising edge only (a DM may open it on an ended table to look), by state, not per
  // dialog; the primitive's close rule then puts focus on the Session opener (the scene head if it is gone).
  const [wasEnded, setWasEnded] = useState(sessionEnded);
  if (wasEnded !== sessionEnded) {
    setWasEnded(sessionEnded);
    if (sessionEnded && sessionOpen) setSessionOpen(false);
  }

  // B2-4: rebind affordances — one "Change character" button per party row. Self sees their own row's button always; the DM sees every row.
  const rebindRow = (p: Participant) => (
    <div key={p.username} className={styles.rebindRow}>
      <span className={variant === 'strip' && !isDm ? 'sr-only' : styles.rebindName}>{p.character?.name ?? p.username}</span>
      <RebindCharacterButton
        sessionId={sessionId}
        targetUsername={p.username}
        selfUsername={selfUsername ?? ''}
        isDm={isDm}
        combatActive={combatIsActive && combatState?.state === 'active'}
        // DDX-25 R2 (D2-D4): a paused/ended session must not allow a rebind either — mirrors every other player-action gate
        // (Composer, combat rail, skill check, Move on, DiceTray) which all extend `sessionLocked`.
        sessionLocked={sessionLocked}
        onChanged={onRebindChanged}
      />
    </div>
  );
  const selfRow = participants.find((p) => p.username.toLowerCase() === (selfUsername ?? '').toLowerCase());

  const trailing = showSession ? (
    <button
      ref={sessionBtnRef}
      type="button"
      className={styles.sessionOpen}
      onClick={() => setSessionOpen((o) => !o)}
      {...pop.anchorProps}
    >
      <Icon name="Sliders" size={14} aria-hidden /> Session
    </button>
  ) : selfRow ? (
    <div className={styles.rebindSection}>{rebindRow(selfRow)}</div>
  ) : null;

  return (
    <div data-region="partyStrip" data-toast-clear="" data-variant={variant}>
      <PartyPanel
        variant={variant}
        participants={participants}
        selfUsername={selfUsername}
        combatState={combatState}
        onSelectMember={onSelectMember}
        trailing={trailing}
      />
      {showSession && (
        <AnchoredPopover pop={pop} role="dialog" label="Session controls" keepMounted className={styles.sessionPopover}>
          {session?.()}
          {participants.length > 0 && (
            <div className={styles.rebindSection} role="group" aria-label="Change a member's character">
              <div className={styles.sessionControlsLabel}>Characters</div>
              {participants.map(rebindRow)}
            </div>
          )}
        </AnchoredPopover>
      )}
      {/* ADV-7/8: structured tracker when combatState available; legacy shim otherwise. */}
      {combatState && combatState.participants.length > 0 ? (
        <InitiativeTracker
          participants={combatState.participants}
          round={round}
          selfParticipantId={selfPcId}
          variant={variant}
        />
      ) : null}
    </div>
  );
}
