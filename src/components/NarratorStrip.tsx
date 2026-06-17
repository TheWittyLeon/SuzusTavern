'use client';
/**
 * NarratorStrip (ST-018 / ST-071) — sticky top strip in the play centre pane that
 * shows Suzu (the DM) and her current narration line.
 *
 * Presentational only: the play screen owns the SSE stream and feeds the
 * already-accumulated `text` plus the `talking` flag. While `talking` with no
 * text yet, a waveform + "narrating…" placeholder shows. The engine owns
 * mechanical truth; this only displays Suzu's prose.
 */
import type { ReactNode } from 'react';
import SuzuDM from '@/components/SuzuDM';
import Waveform from '@/components/Waveform';
import styles from './NarratorStrip.module.css';

export interface NarratorStripProps {
  /** Narration text to show (accumulated as it streams in). */
  text: string;
  /** True while a narration stream is active — drives the SuzuDM talking state. */
  talking?: boolean;
  /** Right-aligned status pill(s), e.g. round/combat indicator. */
  status?: ReactNode;
}

export default function NarratorStrip({ text, talking = false, status }: NarratorStripProps) {
  const empty = !text.trim();
  return (
    // role=status announces only the once-per-beat narrating/idle state. The
    // word-by-word reveal text is aria-hidden so it doesn't flood AT every 26ms —
    // the full narration is announced once by the ChatLog (role="log") on completion.
    <div className={styles.strip} role="status" aria-live="polite" aria-atomic="true">
      <SuzuDM size={56} glow={false} talking={talking} />
      <div className={styles.dialog}>
        {empty && talking ? (
          <span className={styles.thinking}>
            <Waveform bars={14} height={14} aria-hidden />
            <span className={styles.thinkingLabel}>Suzu is narrating…</span>
          </span>
        ) : empty ? (
          <span className={styles.idle}>Suzu is listening. Say or do something.</span>
        ) : (
          <span className={styles.text} aria-hidden="true">
            {text}
          </span>
        )}
      </div>
      {status ? <div className={styles.status}>{status}</div> : null}
    </div>
  );
}
