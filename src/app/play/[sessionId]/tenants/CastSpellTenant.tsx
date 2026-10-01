'use client';

import type { Dispatch, SetStateAction } from 'react';
import type { CharacterSheet, CombatState } from '@/lib/api/types';
import CastSpellPanel from '@/components/CastSpellPanel';

/**
 * TAV-PLAY-SHELL step 6b, commit C2 (Amendment B.4, answers S6, build
 * brief §6.7 "carry (a)") — the role="group" wrapper + CastSpellPanel,
 * mount condition copied VERBATIM from page.tsx. `CastSpellPanel` is the
 * second player combat-submit surface (its own `combatBusy` latch exists
 * to stop a Cast+Attack double-spend); at 6b it is a declared tenant of
 * `storyLog` (where it renders today). Its `host` changes to `actionBar`
 * at A9c per Leon's S3 ruling ("ActionBar stays the single place that
 * submits a combat action") — a one-field `REGION_TENANTS` row edit, not
 * a JSX move. Do not move it at 6b: `play.castspellpanel-gating.test.tsx`
 * and its three sibling gating suites pin this mount condition.
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
      />
    </div>
  );
}
