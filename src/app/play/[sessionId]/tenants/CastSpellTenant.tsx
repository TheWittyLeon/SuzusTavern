'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import type { CharacterSheet, CombatState } from '@/lib/api/types';
import CastSpellPanel from '@/components/CastSpellPanel';

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
}: CastSpellTenantProps) {
  // A9c-2 D7 (lever 3): folded by default. Open, the panel is ~100px of selects
  // in a content-sized `actionBar` track, which takes that height straight from
  // the story log (44px inner on the worst combat cell, measured at e396625).
  // The controls stay mounted behind the disclosure (CastSpellPanel `disclosure`),
  // so nothing is refetched or lost by folding.
  const [open, setOpen] = useState(false);
  if (
    !(
      (isDmPlayingOwnPc || !isHumanDM) &&
      combatIsActive &&
      combatState &&
      combatId &&
      myCharacterIdStr &&
      mySheet?.is_spellcaster
    )
  ) {
    return null;
  }
  return (
    // Tora MAJOR-1: CastSpellPanel is a "your character" control, grouped
    // the same way as the DM controls, pairs with Composer's own
    // internally-labeled "Your character's actions" rail group.
    <div role="group" aria-label="Your character's controls" data-tenant="castSpellPanel">
      <CastSpellPanel
        combatId={combatId}
        characterId={myCharacterIdStr}
        username={username ?? ''}
        participants={combatState.participants}
        spellSlots={mySheet.spell_slots}
        isPlayerTurn={isPlayerTurn}
        disabled={combatBusy || sessionLocked}
        onCast={onCast}
        onSheetChanged={onSheetChanged}
        onStateRefresh={onStateRefresh}
        onBusyChange={onBusyChange}
        disclosure={{ open, onToggle: () => setOpen((o) => !o) }}
      />
    </div>
  );
}
