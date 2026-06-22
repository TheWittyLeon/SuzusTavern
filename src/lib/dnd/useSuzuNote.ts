'use client';
/**
 * Suzu's note for the character sheet (S3.7 / ST-080).
 *
 * Returns a short, clearly-attributed note about the character. Behavior:
 *  - A persisted note (once generated) is read back and shown unchanged — stable
 *    across reloads, never regenerated (AC#2). Persisted Tavern-side today; the
 *    PREFERRED home is the character record once the engine exposes a write
 *    (FLAGGED — no such endpoint yet).
 *  - When `aiAssistLevel` is positively 'full'/'assist' and no note is stored,
 *    Suzu generates one ONCE via the companion narration path, then persists it.
 *  - When `aiAssistLevel` is 'off' / undefined (or generation fails), a neutral
 *    DETERMINISTIC placeholder is shown and NO LLM call is made (AC#3/#4).
 */
import { useEffect, useState } from 'react';
import { streamNarration } from '@/lib/stream';
import type { CharacterSheet } from '@/lib/api/types';

export type SuzuNoteSource = 'placeholder' | 'persisted' | 'ai';

function storeKey(id: string): string {
  return `suzu.note.${id}`;
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode — note just won't persist */
  }
}

/** Deterministic, zero-LLM placeholder derived from the sheet. */
export function placeholderNote(sheet: Pick<CharacterSheet, 'race' | 'char_class' | 'background'>): string {
  const race = (sheet.race || 'wanderer').toLowerCase();
  const cls = (sheet.char_class || 'adventurer').toLowerCase();
  const bg = (sheet.background || 'mysterious').toLowerCase();
  return `A ${race} ${cls} with a ${bg} past. I’ve seen how this story tends to go — bring a coat.`;
}

export function useSuzuNote(
  sheet: CharacterSheet | null,
  aiAssistLevel?: 'full' | 'assist' | 'off',
): { note: string; source: SuzuNoteSource } {
  const [note, setNote] = useState(() => (sheet ? placeholderNote(sheet) : ''));
  const [source, setSource] = useState<SuzuNoteSource>('placeholder');

  useEffect(() => {
    if (!sheet) return;
    // 1. Already persisted → show it verbatim, no regeneration, no LLM call.
    const stored = safeGet(storeKey(sheet.character_id));
    if (stored && stored.trim()) {
      setNote(stored);
      setSource('persisted');
      return;
    }
    // Reset to the deterministic placeholder for this character.
    setNote(placeholderNote(sheet));
    setSource('placeholder');

    // 2. Generate once — HARD-GATED: only when assist is positively on.
    if (aiAssistLevel !== 'full' && aiAssistLevel !== 'assist') return;
    if (!sheet.owner_username) return;

    const ctrl = new AbortController();
    (async () => {
      let full = '';
      let errored = false;
      try {
        for await (const ev of streamNarration(
          {
            username: sheet.owner_username,
            channel: `char-${sheet.character_id}`,
            message:
              `In one or two sentences, in character, give a flavorful note about ` +
              `${sheet.name}, a level ${sheet.level} ${sheet.race} ${sheet.char_class} ` +
              `with a ${sheet.background} background. No mechanics.`,
          },
          { signal: ctrl.signal },
        )) {
          if (ev.kind === 'chunk') full = ev.text;
          else if (ev.kind === 'error') errored = true;
        }
      } catch {
        errored = true; // keep the deterministic placeholder
      }
      // Don't persist a truncated half-sentence from a mid-stream drop (Kage).
      if (!ctrl.signal.aborted && !errored && full.trim()) {
        setNote(full.trim());
        setSource('ai');
        // TODO(engine): persist to the character record once the engine exposes a
        // write (PATCH /characters/:id/suzu_note); localStorage is the interim home.
        safeSet(storeKey(sheet.character_id), full.trim()); // persist once
      }
    })();
    return () => ctrl.abort();
  }, [sheet, aiAssistLevel]);

  return { note, source };
}
