'use client';

import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { CharacterSheet, CombatState } from '@/lib/api/types';
import AnchoredPopover from '@/components/AnchoredPopover';
import CastSpellPanel from '@/components/CastSpellPanel';
import Icon from '@/components/Icon';
import { useAnchoredPopover } from '@/lib/a11y/useAnchoredPopover';
import styles from '@/components/CastSpellPanel.module.css';

/**
 * TAV-PLAY-SHELL step 6b, commit C2 (Amendment B.4, answers S6, build
 * brief §6.7 "carry (a)") — the role="group" wrapper + CastSpellPanel,
 * mount condition copied VERBATIM from page.tsx. `CastSpellPanel` is the
 * second player combat-submit surface (its own `combatBusy` latch exists
 * to stop a Cast+Attack double-spend). Declared tenant of `actionBar` since
 * A9c-2 D6 (Leon's S3 ruling: "ActionBar stays the single place that submits
 * a combat action") — it was a `storyLog` tenant at 6b, and the move was the
 * one-field `REGION_TENANTS` row edit, not a JSX move.
 * `play.castspellpanel-gating.test.tsx` and its three sibling gating suites pin
 * the mount condition and did not move.
 *
 * A9d-2 fix round N8 (Sora lever brief 2.4; Tora 4c): Cast a spell is an anchored POPOVER, the fifth consumer of `useAnchoredPopover`.
 * The in-flow disclosure (A9c-2 D7) opened ~100px of selects in a content-sized bar and pushed the X-card off a 390x844 screen while open
 * (the caster cells have 10-26px of spare). The tenant is now one 44px "Cast a spell" button that shares the safety block's row in the
 * narrow bar (Play.module.css), and the panel opens above it, clamped clear of the X-card (`data-popover-passthrough`). The panel stays
 * MOUNTED while closed (`keepMounted`: a CSS class hides it), so a loaded spell list, a selection, an in-flight cast and the panel's four
 * announcers survive a close and nothing is refetched. A cast that resolves closes it on that result, so the log's line is seen (the
 * popover would cover it), and focus returns to the button; if the button is gone (the fight ended under it) focus falls to the scene head.
 */
export interface CastSpellTenantProps {
  isDmPlayingOwnPc: boolean;
  isHumanDM: boolean;
  combatIsActive: boolean;
  combatState: CombatState | null;
  combatId: string | null;
  myCharacterIdStr: string | null;
  mySheet: CharacterSheet | null;
  username: string | null;
  isPlayerTurn: boolean;
  combatBusy: boolean;
  sessionLocked: boolean;
  onCast: (text: string) => void;
  onSheetChanged: Dispatch<SetStateAction<CharacterSheet | null>>;
  onStateRefresh: () => void;
  onBusyChange: (busy: boolean) => void;
  /** Where focus goes if the Cast button is gone when the popover closes (the scene head): never <body>. */
  fallbackFocus?: () => HTMLElement | null | undefined;
}

/** T6 (DDX-12): cast-in-combat picker — bound caster only, during active
 *  combat. Mirrors DmNarrationPanel's mount gate (same spot in the layout,
 *  mutually exclusive: a human DM sees the monster panel, a caster PC sees
 *  this) — UNLESS the DM also has a bound character (TAV-SOLO-DM-CAST-RAIL's
 *  GM-PC pattern), in which case both mount side by side. */
export default function CastSpellTenant({
  isDmPlayingOwnPc,
  isHumanDM,
  combatIsActive,
  combatState,
  combatId,
  myCharacterIdStr,
  mySheet,
  username,
  isPlayerTurn,
  combatBusy,
  sessionLocked,
  onCast,
  onSheetChanged,
  onStateRefresh,
  onBusyChange,
  fallbackFocus,
}: CastSpellTenantProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const pop = useAnchoredPopover({
    open,
    onClose: () => setOpen(false),
    anchorRef,
    role: 'dialog',
    keepMounted: true,
    fallbackFocus,
  });
  const mounted =
    (isDmPlayingOwnPc || !isHumanDM) &&
    combatIsActive &&
    combatState &&
    combatId &&
    myCharacterIdStr &&
    mySheet?.is_spellcaster;
  // The gate failing (the fight ended, the sheet changed) takes the button; an `open` left behind would show the popover the next time
  // the gate holds. Adjusted during render, React's pattern for state that follows a condition.
  if (!mounted) {
    if (open) setOpen(false);
    return null;
  }
  return (
    // Tora MAJOR-1: CastSpellPanel is a "your character" control, grouped
    // the same way as the DM controls, pairs with Composer's own
    // internally-labeled "Your character's actions" rail group.
    <div role="group" aria-label="Your character's controls" data-tenant="castSpellPanel">
      <button
        ref={anchorRef}
        type="button"
        className={styles.opener}
        onClick={() => setOpen((o) => !o)}
        // Visible "Cast", named "Cast a spell" (the visible text is inside the name: WCAG 2.5.3). The panel in the popover carries the
        // words "Cast a spell" as its own heading, and the three mount-gate suites find the panel by that text alone.
        aria-label="Cast a spell"
        {...pop.anchorProps}
      >
        <Icon name="Sparkle" size={14} aria-hidden /> Cast
      </button>
      <AnchoredPopover pop={pop} role="dialog" label="Cast a spell" keepMounted className={styles.castPopover}>
        <CastSpellPanel
          combatId={combatId}
          characterId={myCharacterIdStr}
          username={username ?? ''}
          participants={combatState.participants}
          spellSlots={mySheet.spell_slots}
          isPlayerTurn={isPlayerTurn}
          disabled={combatBusy || sessionLocked}
          onCast={(message) => {
            onCast(message);
            setOpen(false);
          }}
          onSheetChanged={onSheetChanged}
          onStateRefresh={onStateRefresh}
          onBusyChange={onBusyChange}
        />
      </AnchoredPopover>
    </div>
  );
}
