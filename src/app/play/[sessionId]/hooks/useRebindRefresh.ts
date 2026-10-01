'use client';

/**
 * A9c-2 D1 (page.tsx ratchet) -- the rebind handler, moved verbatim out of
 * page.tsx's `regions.partyStrip` call site. After a "Change character", the
 * roster and the viewer's bound character/sheet must be re-read.
 *
 * Kage T-IMP-1: `session` does not need re-fetching here. The engine reads
 * campaign_members fresh on each combat action, so only the participants list
 * (for the party panel) and myCharacterIdStr (per-user turn resolution) need
 * to be refreshed.
 *
 * Miko additional: mySheet was left stale on rebind -- it is populated once on
 * load and otherwise refreshed only by CastSpellPanel's own onSheetChanged
 * after a cast. Without refetching here, a rebind to a DIFFERENT character
 * out-of-combat leaves mySheet (spell_slots etc.) pointing at the PREVIOUS
 * character until some unrelated mutation refreshes it. It uses the same
 * getCharacterSheet call as the load path.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { getCharacterSheet, getParticipants } from '@/lib/api/dnd';
import type { CharacterSheet, Participant } from '@/lib/api/types';

export interface UseRebindRefreshArgs {
  sessionId: string;
  username: string | null;
  setParticipants: Dispatch<SetStateAction<Participant[]>>;
  setMyCharacterIdStr: Dispatch<SetStateAction<string | null>>;
  setMySheet: Dispatch<SetStateAction<CharacterSheet | null>>;
}

export function useRebindRefresh({
  sessionId,
  username,
  setParticipants,
  setMyCharacterIdStr,
  setMySheet,
}: UseRebindRefreshArgs): () => void {
  return useCallback(() => {
    void (async () => {
      const updated = await getParticipants(sessionId).catch(() => null);
      if (!updated) return;
      setParticipants(updated);
      const self = updated.find((q) => q.username.toLowerCase() === (username ?? '').toLowerCase());
      const newCharId = self?.character?.character_id != null ? String(self.character.character_id) : null;
      setMyCharacterIdStr(newCharId);
      if (newCharId) {
        const sheet = await getCharacterSheet(newCharId, username ?? '').catch(() => null);
        setMySheet(sheet);
      } else {
        setMySheet(null);
      }
    })();
  }, [sessionId, username, setParticipants, setMyCharacterIdStr, setMySheet]);
}
