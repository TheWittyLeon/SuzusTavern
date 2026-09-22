'use client';

/**
 * TAV-PLAY-SHELL step 5, hook 2 of ~9 (decomposition plan §2.2) —
 * `useMyCharacter`. Owns plan §1.7: the logged-in user's bound
 * character_id (stringified) and their sheet.
 *
 * Deliberately thin right now, and deliberately takes NO parameters yet
 * (the plan's abridged signature is `useMyCharacter(session, username)`):
 * every setter for this state is still called from page.tsx (the mount
 * effect's character-sheet fetch, the rebind handler, and
 * CastSpellPanel's `onSheetChanged` prop) rather than from an effect
 * inside this hook, so there is nothing here yet that would read
 * session/username. Adding them unused now would be dead parameters
 * (mirror rule) — they land in a later commit alongside whichever piece
 * of the mount effect's sheet-fetch actually migrates into this hook.
 *
 * The B1-4 "no bound character" toast effect (plan's own citation:
 * noCharToastFiredRef + the effect at page.tsx's old 2262–2280) stays in
 * page.tsx, not here — it also reads `combatState?.state` (useCombat's
 * concern, not yet extracted). Same cross-hook-orchestration reasoning as
 * useSessionLifecycle's mount effect; see that effect's own `debt:`
 * comment for the pattern this follows.
 */
import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { CharacterSheet } from '@/lib/api/types';

export interface UseMyCharacterResult {
  myCharacterIdStr: string | null;
  setMyCharacterIdStr: Dispatch<SetStateAction<string | null>>;
  mySheet: CharacterSheet | null;
  setMySheet: Dispatch<SetStateAction<CharacterSheet | null>>;
  noCharToastFiredRef: React.RefObject<boolean>;
}

export function useMyCharacter(): UseMyCharacterResult {
  // B1-4: the logged-in user's bound character_id (stringified) for
  // per-user turn resolution. Populated from the participants endpoint on
  // load + on rebind.
  const [myCharacterIdStr, setMyCharacterIdStr] = useState<string | null>(null);

  // T6 (DDX-12): the bound character's own sheet, needed for
  // CastSpellPanel (is_spellcaster gate + spell_slots for the upcast
  // range / live pips). Populated by the same getCharacterSheet call that
  // already builds quickChecks; refreshed by CastSpellPanel itself after
  // a successful cast (onSheetChanged), mirroring SpellSlotsPanel's
  // onChanged contract.
  const [mySheet, setMySheet] = useState<CharacterSheet | null>(null);

  // B1-4: fire-once "no character bound" toast when combat becomes active.
  const noCharToastFiredRef = useRef(false);

  return { myCharacterIdStr, setMyCharacterIdStr, mySheet, setMySheet, noCharToastFiredRef };
}
