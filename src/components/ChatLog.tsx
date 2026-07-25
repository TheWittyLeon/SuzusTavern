'use client';
/**
 * ChatLog (ST-019) — the running transcript in the play centre pane.
 *
 * Renders player lines, Suzu narration, system/combat events, and dice rolls.
 * Auto-scrolls to the newest row (respecting reduced-motion). A "thinking" row
 * shows a waveform while Suzu narrates. Roll rows render the shared <Die>.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import Die from '@/components/Die';
import Waveform from '@/components/Waveform';
import type { Participant } from '@/lib/api/types';
import styles from './ChatLog.module.css';

/**
 * DM-NARRATION-MARKDOWN: render inline markdown emphasis in narration prose.
 * Suzu's DM model (gemma-3-27b) emits `**Perception**` (the SYSTEM_CORE
 * "name the skill in bold" check-invite) and `*word*` emphasis; without this
 * they showed as literal asterisks in the story log.
 *
 * XSS-safe by construction: this only ever returns plain strings (which React
 * escapes) wrapped in <strong>/<em> — never raw HTML, never
 * dangerouslySetInnerHTML. Any odd/unmatched marker renders literally. Handles
 * `**bold**` and `*italic*`; no nesting (the DM model doesn't nest).
 */
function renderInlineMarkdown(text: string): ReactNode {
  const re = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<strong key={key++}>{m[1]}</strong>);
    else nodes.push(<em key={key++}>{m[2]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  // No markers matched → return the original string unchanged (cheapest, and
  // keeps existing plain-text assertions/behavior byte-identical).
  return nodes.length === 0 ? text : nodes;
}

export type LogKind =
  | 'player'
  | 'narration'
  | 'system'
  | 'roll'
  | 'dm_narration'
  | 'dm_override'
  /** P1-READALOUD: verbatim authored scene-set block (adventure title + hook +
   *  scene name + boxed_text + objective). Rendered instantly; no typewriter. */
  | 'read_aloud'
  /** P1-READALOUD: one scripted NPC dialogue line in the opening beat. */
  | 'read_aloud_line';

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
  /** T1 (TAV-S1): true while this row is an in-progress DM-narration stream
   *  that is still growing token-by-token. Hides the row from screen readers
   *  (aria-hidden) so every incremental chunk isn't re-announced — the
   *  finalized narration lands as a BRAND-NEW row (fresh id/key, this flag
   *  unset) once streaming completes, so it's announced exactly once. */
  streaming?: boolean;
  /** DDX-20 (flag-ON only): the durable `session_events.seq` this row has
   *  been reconciled to, once the poll observes it. Dedup metadata only —
   *  never read by rendering. Optional/non-breaking: absent on every
   *  flag-OFF row and on any row not yet reconciled. */
  seq?: number;
  /** DDX-20 (flag-ON only): set to the turn_key (or dm_narration's
   *  client_key) on an optimistic row while its durable event is still
   *  in flight — lets the poll's reconciliation ledger find-and-stamp this
   *  row instead of appending a duplicate. Cleared implicitly once the row
   *  is reconciled (the ledger drops its map entry, not this field — a
   *  stale pendingKey on an already-stamped row is harmless, it's simply
   *  never looked up again). Never read by rendering. */
  pendingKey?: string;
}

export interface ChatLogProps {
  rows: LogRow[];
  thinking?: boolean;
  /** DDX-20 §9 — override the thinking row's label. Defaults to 'narrating…'
   *  (today's shipped copy, unchanged when omitted). Used by the play screen
   *  to reuse this SAME waveform row for the "Resuming Suzu's turn…" resume
   *  affordance (flag-ON only) — distinct copy, same aria-live="polite"
   *  announce-once mechanism (the row mounts/unmounts with `thinking`). */
  thinkingLabel?: string;
  /** Session roster (page.tsx's `participants`, the raw `GET .../participants`
   *  join) — used ONLY to resolve a `kind:'player'` row's bound character
   *  name for the "CharacterName (username)" speaker label below. Optional:
   *  omitted/empty degrades gracefully to the bare username (existing
   *  behaviour), so every pre-existing caller/test that doesn't pass it
   *  keeps rendering exactly as before. */
  participants?: Participant[];
}

/** Imperative handle so the play screen can re-pin the log after a mobile
 *  tab switch (display:none resets scrollTop; the rows effect won't re-fire). */
export interface ChatLogHandle {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

const ChatLog = forwardRef<ChatLogHandle, ChatLogProps>(function ChatLog(
  { rows, thinking = false, thinkingLabel = 'narrating…', participants = [] },
  handleRef,
) {
  const ref = useRef<HTMLDivElement>(null);
  // True when the user is scrolled to (near) the bottom. We only auto-pin when
  // they are — so scrolling UP to re-read history isn't yanked back down by a
  // new line / narration completing (Tora S3.3 MAJOR-1).
  const atBottom = useRef(true);

  // Character-label lookup (username -> bound character name), lower-cased
  // key so a rehydrated row's `who` (server casing) matches the roster's
  // username regardless of case. Rebuilt only when the roster identity
  // changes (page.tsx refetches participants on load/rebind, not every
  // poll tick), NOT per row/render.
  const characterNameByUsername = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of participants) {
      if (p.character?.name) map.set(p.username.toLowerCase(), p.character.name);
    }
    return map;
  }, [participants]);

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
      aria-label="Story log"
      // TAV-19: focusable so keyboard users (no pointer) can scroll the
      // transcript — it previously had a scroll ref but no tab stop at all.
      // Focus ring is the :focus-visible rule in ChatLog.module.css below.
      tabIndex={0}
    >
      {rows.map((r) => {
        // P1-READALOUD: verbatim scene-set block. Rendered without typewriter
        // animation — authored text appears instantly at the player's own pace.
        if (r.kind === 'read_aloud') {
          return (
            <div key={r.id} className={`${styles.row} ${styles.read_aloud}`}>
              <div className={styles.readAloudLabel} aria-label="Read aloud">
                READ ALOUD
              </div>
              <div className={styles.what}>{r.text}</div>
              <div className={styles.ts}>{r.ts}</div>
            </div>
          );
        }

        // P1-READALOUD: one scripted NPC line in the opening beat.
        if (r.kind === 'read_aloud_line') {
          return (
            <div key={r.id} className={`${styles.row} ${styles.read_aloud_line}`}>
              <div className={styles.who}>
                <span className={styles.readAloudSpeaker}>{r.who}</span>
                <span className={styles.ts}>{r.ts}</span>
              </div>
              <div className={styles.readAloudDialogue}>{r.text}</div>
            </div>
          );
        }

        // ST-CHARLABEL: player-kind rows only — `who` is polymorphic for every
        // OTHER kind ('Suzu', 'Scene', a human `DM (username)` label, 'Table',
        // read_aloud/read_aloud_line speakers) and must stay literal. A player
        // row with no bound character (map miss) falls back to the bare
        // username, unchanged from today.
        const speakerLabel =
          r.kind === 'player'
            ? (() => {
                const charName = characterNameByUsername.get(r.who.toLowerCase());
                return charName ? `${charName} (${r.who})` : r.who;
              })()
            : r.who;

        return (
          <div
            key={r.id}
            className={`${styles.row} ${styles[r.kind]}`}
            // T1 (TAV-S1): a growing in-progress stream row is hidden from
            // screen readers — announcing every token-by-token delta floods
            // the AT. The finalized row (a fresh id, `streaming` unset)
            // replaces this one and IS announced, exactly once.
            aria-hidden={r.streaming ? 'true' : undefined}
          >
            <div className={styles.who} style={r.color ? { color: r.color } : undefined}>
              <span>
                {speakerLabel}
                {r.kind === 'dm_override' && (
                  <span className="sr-only"> — DM ruling</span>
                )}
              </span>
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
              <div className={styles.what}>
                {/* DM-NARRATION-MARKDOWN: render inline emphasis for the prose
                    DM kinds (Suzu AI narration + human-DM narration + DM
                    overrides). Player/system/roll and verbatim read_aloud rows
                    stay literal so user-typed and authored text is never
                    reinterpreted. */}
                {r.kind === 'narration' ||
                r.kind === 'dm_narration' ||
                r.kind === 'dm_override'
                  ? renderInlineMarkdown(r.text)
                  : r.text}
              </div>
            )}
          </div>
        );
      })}

      {thinking && (
        <div className={`${styles.row} ${styles.narration}`} style={{ opacity: 0.7 }}>
          <div className={styles.who}>
            <span>Suzu</span>
          </div>
          <div className={styles.thinking}>
            <Waveform bars={14} height={14} />
            <span className={styles.thinkingLabel}>{thinkingLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
});

export default ChatLog;
