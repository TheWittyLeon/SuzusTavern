'use client';
/**
 * ChatLog (ST-019) — the running transcript in the play centre pane.
 *
 * Renders player lines, Suzu narration, system/combat events, and dice rolls.
 * Auto-scrolls to the newest row (respecting reduced-motion). A "thinking" row
 * shows a waveform while Suzu narrates. Roll rows render the shared <Die>.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import Die from '@/components/Die';
import Waveform from '@/components/Waveform';
import styles from './ChatLog.module.css';

export type LogKind = 'player' | 'narration' | 'system' | 'roll' | 'dm_narration' | 'dm_override';

export interface RollResult {
  sides: number;
  value: number;
  modifier: number;
  crit: boolean;
  fumble: boolean;
  label: string;
}

export interface LogRow {
  id: string;
  who: string;
  kind: LogKind;
  text: string;
  ts: string;
  /** Accent colour for the author label (player rows). */
  color?: string;
  /** Present on roll rows — renders the Die + breakdown. */
  roll?: RollResult;
}

export interface ChatLogProps {
  rows: LogRow[];
  thinking?: boolean;
}

/** Imperative handle so the play screen can re-pin the log after a mobile
 *  tab switch (display:none resets scrollTop; the rows effect won't re-fire). */
export interface ChatLogHandle {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

const ChatLog = forwardRef<ChatLogHandle, ChatLogProps>(function ChatLog(
  { rows, thinking = false },
  handleRef,
) {
  const ref = useRef<HTMLDivElement>(null);
  // True when the user is scrolled to (near) the bottom. We only auto-pin when
  // they are — so scrolling UP to re-read history isn't yanked back down by a
  // new line / narration completing (Tora S3.3 MAJOR-1).
  const atBottom = useRef(true);

  const pin = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = ref.current;
    if (!el) return;
    // scrollTo is the smooth/instant-capable path; fall back to scrollTop for
    // environments without it (jsdom).
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior });
    else el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useImperativeHandle(handleRef, () => ({ scrollToBottom: pin }), [pin]);

  useEffect(() => {
    if (atBottom.current) pin();
  }, [rows, thinking, pin]);

  return (
    <div
      className={styles.log}
      ref={ref}
      onScroll={onScroll}
      role="log"
      aria-live="polite"
    >
      {rows.map((r) => (
        <div key={r.id} className={`${styles.row} ${styles[r.kind]}`}>
          <div className={styles.who} style={r.color ? { color: r.color } : undefined}>
            <span>{r.who}</span>
            <span className={styles.ts}>{r.ts}</span>
          </div>
          {r.roll ? (
            <div className={styles.rollBody}>
              <Die
                size={48}
                sides={r.roll.sides}
                value={r.roll.value}
                crit={r.roll.crit}
                fumble={r.roll.fumble}
              />
              <div>
                <div className={styles.rollTotal}>
                  {r.roll.value}
                  {r.roll.modifier !== 0 && (
                    <span className={styles.rollMod}>
                      {' '}
                      {r.roll.modifier >= 0 ? `+ ${r.roll.modifier}` : `- ${Math.abs(r.roll.modifier)}`}{' '}
                      = {r.roll.value + r.roll.modifier}
                    </span>
                  )}
                </div>
                <div className={styles.rollLabel}>{r.text}</div>
              </div>
            </div>
          ) : (
            <div className={styles.what}>{r.text}</div>
          )}
        </div>
      ))}

      {thinking && (
        <div className={`${styles.row} ${styles.narration}`} style={{ opacity: 0.7 }}>
          <div className={styles.who}>
            <span>Suzu</span>
          </div>
          <div className={styles.thinking}>
            <Waveform bars={14} height={14} />
            <span className={styles.thinkingLabel}>narrating…</span>
          </div>
        </div>
      )}
    </div>
  );
});

export default ChatLog;
