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
import { buildRecap, isStoryEvent, lastStoredRecap, type RecapResult } from '@/lib/dnd/recap';
import { sessionTitle } from '@/lib/format';
import Icon from '@/components/Icon';
import type { Session } from '@/lib/api/types';
import styles from './SessionRecap.module.css';

export interface SessionRecapProps {
  session: Session;
  username?: string | null;
  /** 'card' = dashboard (open); 'strip' = play top (collapsible + dismissible). */
  variant?: 'card' | 'strip';
  /** Steps the rendered strip aside WITHOUT unmounting it: the fetch, the AI latch, `open` and
   *  `dismissed` all live in this component, so unmounting would refetch and forget a dismissal.
   *  The play shell sets it while combat is active (the recap stays in the Journal). */
  hidden?: boolean;
}

export default function SessionRecap({ session, username, variant = 'card', hidden }: SessionRecapProps) {
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
  // R37 (TAV-RECAP-ROW-PER-PAGE-OPEN): the last stored `recap` row of the events read below, set
  // before `recap` so the narration effect sees it. A new "previously on" is requested only when
  // the log has events past it; otherwise the stored text is shown.
  const storedRef = useRef<ReturnType<typeof lastStoredRecap>>(null);

  // Deterministic digest — zero LLM, always runs. Depends on the STABLE
  // session_id, not the whole `session` object: a poll-driven identity change
  // with no real content change must not re-fetch session_events on every
  // tick, while a genuinely new session (new id) still recomputes it.
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      // FIX-4: getSessionEvents now returns null on error (engine unreachable).
      // Fall back to [] so the recap keeps its resilient empty-state behavior.
      const read = await getSessionEvents(session.session_id, ctrl.signal);
      const events = read ?? [];
      if (ctrl.signal.aborted) return;
      const stored = lastStoredRecap(events);
      storedRef.current = stored;
      const hasStory = events.some(isStoryEvent);
      // Nothing has happened (R51 F2): no story row and no stored recap. Shown as a log with no events: the card's
      // metadata digest, and nothing in the strip (it needs real play history). When no recap row is stored, a digest
      // made only of bookkeeping lines is never shown, whatever the read's completeness; a stored recap still shows
      // (R37). A read that stopped early sees a prefix: the same rule, nothing sent, nothing latched.
      // The narration effect needs no second check: with nothing happened the digest is built from [] and is not
      // `fromEvents`, so it returns at the gate on `recap.fromEvents`.
      const nothingHappened = !stored && !hasStory;
      const built = buildRecap(session, nothingHappened ? [] : events);
      // The stored text goes in with the digest, in one render (the effect below would swap it in a render later:
      // a flash of the digest and a layout shift). Same conditions as that effect's stored branch.
      const level = session.ai_assist_level;
      if (stored && !stored.newerEvents && stored.text && built.fromEvents && (level === 'full' || level === 'assist')) {
        setAiText(stored.text);
      }
      setRecap(built);
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
    if (requestedForRef.current === session.session_id) return;
    const stored = storedRef.current;
    if (stored && !stored.newerEvents) {
      // Nothing happened since the last recap: show it, send nothing (R37).
      requestedForRef.current = session.session_id;
      if (stored.text) setAiText(stored.text);
      return;
    }
    if (!username) return;
    requestedForRef.current = session.session_id;
    // debt: two openings inside the generation window (two tabs; the dashboard card then Resume in one tab) both see "newer events" and both generate. ceiling: one extra recap row per race.
    // until: a server-side guard on kind=recap (Backlog TAV-RECAP-ROW-PER-PAGE-OPEN). The card (dashboard) and the strip (play) share no shipped page; two mounted together is a test-only case.
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
      hidden={hidden}
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
            onClick={(e) => {
              // The button unmounts with the strip, and focus on an unmounted node falls to <body> (Iro A9d-1 MINOR-4,
              // 2.4.3). It goes to the landmark the strip sits in (the play page's `main`, a programmatic target,
              // `tabindex="-1"`), taken from the DOM so this component names no page.
              const home = e.currentTarget.closest<HTMLElement>('main, [tabindex="-1"]');
              setDismissed(true);
              requestAnimationFrame(() => home?.focus({ preventScroll: true }));
            }}
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
