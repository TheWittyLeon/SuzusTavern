'use client';
/**
 * Live Suzu commentary for the character-creation wizard (S3.8 / ST-053).
 *
 * Replaces the hardcoded commentary stub with real SSE narration, reusing the
 * shared `streamNarration` plumbing (the same code path as the play screen —
 * no second, drifting SSE implementation). HARD-GATED on `aiAssistLevel`: when
 * it's 'off' (or unset), `enabled` is false and NO narration request is issued —
 * the caller renders the panel ABSENT (not an empty shell). When on, the panel
 * shows the streamed text (the caller falls back to a deterministic line while
 * waiting or on error — AC#3 graceful handling, no spinner-forever).
 *
 * Re-streams when `commentaryKey` changes (step / selection); aborts the prior
 * stream on change + unmount so a mid-flow AI-off toggle leaves no orphan stream.
 */
import { useEffect, useRef, useState } from 'react';
import { streamNarration } from '@/lib/stream';

export interface WizardCommentary {
  /** Whether the commentary panel should render at all (false ⇒ absent). */
  enabled: boolean;
  /** Streamed text so far ('' until the first chunk / when disabled). */
  text: string;
  /** True while a stream is in flight (drives the waveform). */
  streaming: boolean;
}

export function useWizardCommentary(opts: {
  aiAssistLevel?: 'full' | 'assist' | 'off';
  username?: string | null;
  commentaryKey: string;
  prompt: string;
}): WizardCommentary {
  const { aiAssistLevel, username, commentaryKey, prompt } = opts;
  const enabled = aiAssistLevel === 'full' || aiAssistLevel === 'assist';
  const [text, setText] = useState('');
  const [streaming, setStreaming] = useState(false);

  // Read the prompt via a ref so it is NOT an effect dep — otherwise the
  // step-3 prompt (which interpolates the name) would re-stream on every
  // keystroke. `commentaryKey` is the deliberate re-stream trigger (Kage #3).
  const promptRef = useRef(prompt);
  promptRef.current = prompt;

  useEffect(() => {
    if (!enabled || !username) return; // OFF / unset ⇒ no request at all
    const ctrl = new AbortController();
    setText('');
    setStreaming(true);
    (async () => {
      let full = '';
      try {
        for await (const ev of streamNarration(
          { username, channel: 'character-creation', message: promptRef.current },
          { signal: ctrl.signal },
        )) {
          if (ev.kind === 'chunk') {
            full = ev.text;
            if (!ctrl.signal.aborted) setText(full);
          } else if (ev.kind === 'error') {
            // Observability — the caller falls back to its deterministic line.
            console.warn('[wizard-commentary] narration stream error:', ev.error);
          }
        }
      } catch {
        /* graceful — the caller falls back to its deterministic line */
      }
      if (!ctrl.signal.aborted) setStreaming(false);
    })();
    return () => ctrl.abort();
    // prompt intentionally read via ref (see above); re-stream only on key change.
     
  }, [enabled, username, commentaryKey]);

  return { enabled, text, streaming };
}
