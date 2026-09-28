'use client';

/**
 * TAV-PLAY-SHELL step 5, hook 4 of ~9 (decomposition plan §2.2, amended by
 * Amendment A §A.2 row 4) — `useTranscript`. Owns plan §1.2: the chat
 * transcript itself (`log`/`appendLog`), the durable-events poll's own
 * bookkeeping (`lastEventSeqRef`/`renderedSeqsRef`/`pendingByKeyRef`), and
 * the DM-STREAM live-narration row writers (`upsertStreamNarration`/
 * `clearStreamNarration`/`finalizeStreamNarration` + `streamRowIdRef`).
 * Also `idRef` (the monotone row-id counter every writer shares) and
 * `chatLogRef` (the `<ChatLog>` imperative handle — its only reader is the
 * tab-return scroll-repin effect and its only writer is the JSX `ref` prop,
 * neither of which is this hook's own concern; both stay in page.tsx,
 * reading this hook's returned ref object).
 *
 * Composed at row 4, ABOVE `useCombatState` (row 5) and `useScene` (row 6)
 * — Amendment A §A.2's amended order, moved up from the original plan's
 * abridged position (hook 6, "Derived from: —"). `useScene` still takes
 * `appendLog`/`renderedSeqsRef` exactly as before this split: both were
 * already plain downward parameters on that hook's signature (Amendment A
 * §A.3 edges R3/R4, both resolved as "reorder only" — the values just come
 * from this hook's return now instead of a page.tsx-local
 * `useState`/`useRef`). No call site anywhere else changes shape.
 *
 * Signature deviation from §2.2's abridged `useTranscript(sessionId)`: this
 * hook takes NO parameters. Nothing it owns reads `sessionId` — `appendLog`
 * is a pure `setLog` + `idRef` bump, the stream-row writers only touch
 * `streamRowIdRef`/`idRef`/`setLog`, and the three ledgers
 * (`lastEventSeqRef`/`renderedSeqsRef`/`pendingByKeyRef`) are plain mutable
 * state that the CALLER's poll effect (`useSessionEvents`, Amendment A row
 * 11, A4) reads/writes by identity, not by session, taking them as plain
 * `handlers` fields. Same kind of documented deviation as
 * `useMyCharacter`'s own header (deliberately thin, no dead parameters).
 *
 * Deliberately does NOT own: `narrationAbort`/`revealRef` (useNarration
 * territory, A5 — they read/write streaming state this hook doesn't touch),
 * `journalEvents`/`journalSeenSeqsRef` (the journal drawer's OWN, separate
 * ledger — see that ref's own comment in page.tsx on why it can't reuse
 * `renderedSeqsRef`), and the mount effect (still in page.tsx) / unified
 * durable events poll (`useSessionEvents.ts`, A4) that call into this
 * hook's setters — see the mount effect's own `debt:` marker.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import { type ChatLogHandle, type LogRow } from '@/components/ChatLog';
import type { PendingTurnEntry } from '@/lib/dnd/reconcileEvents';
import { nowStamp } from '../format';

export interface UseTranscriptResult {
  log: LogRow[];
  setLog: Dispatch<SetStateAction<LogRow[]>>;
  appendLog: (row: Omit<LogRow, 'id' | 'ts'>) => void;
  idRef: MutableRefObject<number>;
  logRef: MutableRefObject<LogRow[]>;
  lastEventSeqRef: MutableRefObject<number>;
  renderedSeqsRef: MutableRefObject<Set<number>>;
  pendingByKeyRef: MutableRefObject<Map<string, PendingTurnEntry>>;
  chatLogRef: RefObject<ChatLogHandle | null>;
  streamRowIdRef: MutableRefObject<string | null>;
  upsertStreamNarration: (text: string) => void;
  clearStreamNarration: (removeRow: boolean) => void;
  finalizeStreamNarration: (text: string) => void;
}

export function useTranscript(): UseTranscriptResult {
  const [log, setLog] = useState<LogRow[]>([]);

  const idRef = useRef(0);
  const chatLogRef = useRef<ChatLogHandle>(null);

  // DDX-08 / T3: highest session-event `seq` already rendered into the log
  // (set once by rehydration, then advanced by the dice-roll events poll
  // below). Lets the poll fetch the full event list every tick (the engine
  // has no "since seq" filter) while only ever appending NEW rows.
  const lastEventSeqRef = useRef(0);

  // DDX-20 (flag-ON only, DURABLE_GENERATION_ENABLED) — the reconciliation
  // ledger (Client Integration Design §3.1). Both refs, poll-safe: mutated
  // in place by reconcileDurableEvents inside the flag-ON poll branch below;
  // never touched on the flag-OFF path. renderedSeqsRef = every durable seq
  // already reflected in the log; pendingByKeyRef = turn_key (or a human-DM
  // beat's client_key) -> the in-flight optimistic row ids waiting to
  // reconcile. Populated by the Pass-2 durable turn path (onSend/narrate);
  // empty in this pass, so every poll tick falls to "append" (the reload /
  // cross-client branch) — correct and already covered by the reload-
  // reconstruction test in reconcileEvents.test.ts.
  const renderedSeqsRef = useRef<Set<number>>(new Set());
  const pendingByKeyRef = useRef<Map<string, PendingTurnEntry>>(new Map());

  // Latest-log ref so narrate() can read recent transcript without re-creating
  // itself on every log change. Synced in an effect (never written during render).
  const logRef = useRef<LogRow[]>([]);
  useEffect(() => {
    logRef.current = log;
  }, [log]);

  const appendLog = useCallback((row: Omit<LogRow, 'id' | 'ts'>) => {
    setLog((prev) => [...prev, { id: `r${(idRef.current += 1)}`, ts: nowStamp(), ...row }]);
  }, []);

  // DM-STREAM: while a narration streams, mirror it into a LIVE bottom-of-chat
  // row that grows token-by-token (so the reader sees Suzu narrate inline in the
  // conversation, not just in the top strip). The row is created on the first
  // chunk and updated in place; finalized (or removed on error) after the beat.
  //
  // T1 (TAV-S1) — screen-reader flood fix: the in-progress row is marked
  // `streaming: true` so ChatLog renders it `aria-hidden` (every token-by-
  // token delta re-announcing the growing text floods a screen reader).
  // `finalizeStreamNarration` below does NOT just flip that flag on the same
  // node — it swaps in a brand-new row (fresh id/key) carrying the complete
  // text, so React mounts a new, non-hidden DOM node and the finished
  // narration is announced exactly once, rather than being the very node
  // that was aria-hidden a moment ago (some AT/browser combos don't
  // re-announce a node whose aria-hidden merely flips off in place).
  const streamRowIdRef = useRef<string | null>(null);
  const upsertStreamNarration = useCallback((text: string) => {
    // Decide create-vs-update and mutate the id/ref OUTSIDE the state updater —
    // setLog's updater must stay pure (React/StrictMode may re-invoke it).
    const existingId = streamRowIdRef.current;
    if (existingId) {
      setLog((prev) => prev.map((r) => (r.id === existingId ? { ...r, text } : r)));
    } else {
      const id = `r${(idRef.current += 1)}`;
      const ts = nowStamp();
      streamRowIdRef.current = id;
      setLog((prev) => [
        ...prev,
        { id, who: 'Suzu', kind: 'narration' as const, text, ts, streaming: true },
      ]);
    }
  }, []);
  const clearStreamNarration = useCallback((removeRow: boolean) => {
    const id = streamRowIdRef.current;
    streamRowIdRef.current = null;
    if (removeRow && id) setLog((prev) => prev.filter((r) => r.id !== id));
  }, []);
  /** T1 (TAV-S1) — finalize a completed stream beat by REMOUNTING a fresh,
   *  non-hidden row in place of the aria-hidden streaming one (same position
   *  in the log, new id) rather than mutating the streaming row's text in
   *  place. See the streamRowIdRef comment above for why a fresh node matters
   *  for SR announcement. No-ops (and clears the ref) if the streaming row
   *  was somehow already removed from the log. */
  const finalizeStreamNarration = useCallback((text: string) => {
    const id = streamRowIdRef.current;
    streamRowIdRef.current = null;
    if (!id) return;
    const newId = `r${(idRef.current += 1)}`;
    setLog((prev) => {
      const idx = prev.findIndex((r) => r.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], id: newId, text, streaming: false };
      return next;
    });
  }, []);

  return {
    log,
    setLog,
    appendLog,
    idRef,
    logRef,
    lastEventSeqRef,
    renderedSeqsRef,
    pendingByKeyRef,
    chatLogRef,
    streamRowIdRef,
    upsertStreamNarration,
    clearStreamNarration,
    finalizeStreamNarration,
  };
}
