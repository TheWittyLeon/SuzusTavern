'use client';
/**
 * SessionRecap — "previously on…" (S3.6 / ST-079).
 *
 * Shows a recap of the last session on the dashboard (a card) and at the top of
 * the play screen (a collapsible, dismissible strip). The DETERMINISTIC digest
 * (buildRecap, zero LLM) is the load-bearing path — it renders regardless. When
 * `session.ai_assist_level` is positively 'full'/'assist', an optional AI
 * "previously on" is streamed over the existing narration path, grounded in the
 * deterministic facts, and replaces the digest text; ANY failure falls back to
 * the digest. When assist is 'off' or unknown, NO narration request is issued —
 * honoring the S2.5 interlock.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { getSessionEvents } from '@/lib/api/dnd';
import { streamDmNarration } from '@/lib/stream';
import { buildRecap, type RecapResult } from '@/lib/dnd/recap';
import { sessionTitle } from '@/lib/format';
import Icon from '@/components/Icon';
import type { Session } from '@/lib/api/types';
import styles from './SessionRecap.module.css';

export interface SessionRecapProps {
  session: Session;
  username?: string | null;
  /** 'card' = dashboard (open); 'strip' = play top (collapsible + dismissible). */
  variant?: 'card' | 'strip';
}

export default function SessionRecap({ session, username, variant = 'card' }: SessionRecapProps) {
  const [recap, setRecap] = useState<RecapResult | null>(null);
  const [aiText, setAiText] = useState<string | null>(null);
  const [open, setOpen] = useState(variant === 'card');
  const [dismissed, setDismissed] = useState(false);
  const uid = useId();
  // DDX-25 R3: latch so the LLM "previously on" recap request fires at most
  // ONCE per session, no matter how many times the `session` prop is later
  // replaced with a new-but-equivalent object (the play page's session-status
  // poll does exactly this every ~4s — see that poll's own comment). Keyed by
  // session_id rather than a plain boolean so a genuinely NEW session — both
  // callers already remount this component under `key={session.session_id}`,
  // which would reset this ref anyway, but keying by id is defense-in-depth
  // if a future caller omits the key — still recaps exactly once.
  const requestedForRef = useRef<string | null>(null);

  // Deterministic digest — zero LLM, always runs. Depends on the STABLE
  // session_id, not the whole `session` object: a poll-driven identity change
  // with no real content change must not re-fetch session_events on every
  // tick, while a genuinely new session (new id) still recomputes it.
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      // FIX-4: getSessionEvents now returns null on error (engine unreachable).
      // Fall back to [] so the recap keeps its resilient empty-state behavior.
      const events = (await getSessionEvents(session.session_id, ctrl.signal)) ?? [];
      if (ctrl.signal.aborted) return;
      setRecap(buildRecap(session, events));
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.session_id]);

  // Optional AI summary — HARD-GATED: only fires when assist is positively on.
  // 'off'/undefined ⇒ no narration request at all (the interlock guarantee).
  // DDX-25 R3: dependency changed from the whole `session` object to the
  // stable `session.session_id`, PLUS the requestedForRef latch above (belt
  // and suspenders). Without this, a session-status poll tick that handed
  // back a content-equal-but-new-identity session object re-ran this effect
  // and re-issued a REAL LLM-backed "previously on" narration call every ~4s,
  // indefinitely (live-observed: 20+ repeated recap requests per viewer). A
  // pause/resume/status/xp change must NOT re-trigger this — only a
  // genuinely new session does.
  useEffect(() => {
    const level = session.ai_assist_level;
    // Gate on fromEvents: never narrate a "previously on" from metadata alone —
    // a fresh session has no past, and the LLM would fabricate one.
    if (!recap || recap.empty || !recap.facts || !recap.fromEvents) return;
    if (level !== 'full' && level !== 'assist') return;
    if (!username) return;
    if (requestedForRef.current === session.session_id) return;
    requestedForRef.current = session.session_id;
    const ctrl = new AbortController();
    (async () => {
      let full = '';
      try {
        for await (const ev of streamDmNarration(
          {
            username,
            channel: session.channel,
            message: 'Give a short "previously on" recap of our last session.',
            mechanics: recap.facts, // ground the prose in the deterministic facts
            mode: 'act',
            session_id: session.session_id,
            // TAV-7: without this, the server has no way to distinguish this
            // internal recap-request prompt from a real player line — it was
            // being persisted (and, on rehydration, rendered in ChatLog) as
            // an ordinary USER chat row. kind:'recap' tells the server this
            // is a system-authored meta-action, same treatment as 'opening':
            // the prompt itself is never persisted as a player_action event.
            kind: 'recap',
          },
          { signal: ctrl.signal },
        )) {
          if (ev.kind === 'chunk') full = ev.text;
        }
      } catch {
        /* keep the deterministic digest */
      }
      if (!ctrl.signal.aborted && full.trim()) setAiText(full.trim());
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recap, session.session_id, username]);

  if (dismissed || !recap) return null;
  // Play-screen strip: only show when there's REAL play history. A fresh session
  // (metadata-only) shows nothing here — the scene's read-aloud opening is the
  // player's starting point, not a "where you left off" strip. The dashboard
  // `card` variant still surfaces the metadata digest.
  if (variant === 'strip' && !recap.fromEvents) return null;

  const headId = `${uid}-head`;
  const bodyId = `${uid}-body`;
  const title = sessionTitle(session);

  const body = recap.empty ? (
    <p className={styles.empty}>
      No beats yet — your story starts here. Make the first move and Suzu will
      remember it.
    </p>
  ) : aiText ? (
    <p className={styles.ai}>
      <span className={styles.attribution}>Suzu</span> {aiText}
    </p>
  ) : (
    <ul className={styles.lines}>
      {recap.lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );

  return (
    <section
      className={variant === 'strip' ? styles.strip : styles.card}
      aria-labelledby={headId}
    >
      <div className={styles.head}>
        {variant === 'strip' ? (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name="History" size={14} aria-hidden />
            <span id={headId} className={styles.title}>
              {recap.headline}
              <span className={styles.sub}> · {title}</span>
            </span>
            <Icon name="Chevron" size={12} aria-hidden className={open ? styles.chevOpen : styles.chev} />
          </button>
        ) : (
          <h3 id={headId} className={styles.title}>
            <Icon name="History" size={15} aria-hidden /> {recap.headline}
          </h3>
        )}
        {variant === 'strip' && (
          <button
            type="button"
            className={styles.dismiss}
            aria-label="Dismiss recap"
            onClick={() => setDismissed(true)}
          >
            <Icon name="Close" size={14} aria-hidden />
          </button>
        )}
      </div>
      {(variant === 'card' || open) && (
        <div id={bodyId} className={styles.body}>
          {body}
        </div>
      )}
    </section>
  );
}
