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
import { useEffect, useId, useState } from 'react';
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

  // Deterministic digest — zero LLM, always runs.
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
  }, [session]);

  // Optional AI summary — HARD-GATED: only fires when assist is positively on.
  // 'off'/undefined ⇒ no narration request at all (the interlock guarantee).
  useEffect(() => {
    const level = session.ai_assist_level;
    if (!recap || recap.empty || !recap.facts) return;
    if (level !== 'full' && level !== 'assist') return;
    if (!username) return;
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
  }, [recap, session, username]);

  if (dismissed || !recap) return null;

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
