'use client';
/**
 * JournalPane — DDX-22 Phase 0.
 *
 * Four read-mostly sections surfaced on /play/[sessionId]: quest log, recap
 * history, NPCs met, and free-form notes. Rendered via a right-edge slide-over
 * drawer on desktop and a 4th mobile tab (see page.tsx + Play.module.css for
 * the breakpoint-conditional wrapper chrome — this component is itself
 * breakpoint-agnostic and owns none of that presentation).
 *
 * Data sources (design doc §2 — no new poll, no new backend for 3 of 4
 * sections):
 *   - Quest log: `grounding.objective` (current goal) + `scene_advance`
 *     events' `data.description` (trail) — src/lib/dnd/journal.ts.
 *   - Recap history: durable `recap`-kind events.
 *   - NPCs met: union of events' `data.npcs_introduced` + current-scene
 *     grounding NPCs (`grounding.npcs_present`).
 *   - Notes: localStorage stopgap, keyed by sessionId (Phase 3 swaps in a
 *     real owner-private `session_notes` API — see `onNotesChange` below for
 *     the seam). Mirrors the safeGet/safeSet private-mode guard already
 *     established by useSuzuNote.ts.
 *
 * `events`/`grounding` are passed down from the play page's OWN existing
 * rehydration + 4s events poll (getSessionEventsRaw) — this component makes
 * zero network calls of its own for those three sections.
 *
 * The close button here is wired by the parent (page.tsx), which owns the
 * open/close state (`journalOpen`) and the dialog semantics on the wrapping
 * `<aside id="play-pane-journal">` (role/aria-modal/focus-trap/Esc — reusing
 * ConfirmDialog's conventions). `closeButtonRef` lets the parent focus this
 * button when the drawer opens (mirrors ConfirmDialog's "focus the
 * least-destructive control on open").
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import Icon from '@/components/Icon';
import { getSessionNotes, putSessionNotes } from '@/lib/api/dnd';
import { deriveNpcsMet, deriveQuestTrail, deriveRecapHistory } from '@/lib/dnd/journal';
import type { EngineSessionEvent, GroundingData } from '@/lib/api/types';
import styles from './JournalPane.module.css';

/**
 * Fixed (not useId-generated) heading id: JournalPane is a singleton on this
 * page (never rendered twice at once), and the WRAPPING `<aside>` in page.tsx
 * needs a stable id to point its `aria-labelledby` at without cross-component
 * id plumbing. Exported so page.tsx can reference it directly.
 */
export const JOURNAL_HEADING_ID = 'journal-pane-heading';

const NOTES_DEBOUNCE_MS = 500;
const SAVED_BADGE_MS = 2000;

/** Lifecycle of the initial GET /notes fetch for the current session. */
type LoadState = 'loading' | 'loaded' | 'error';
/** Autosave badge state for the polite live region. */
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface JournalPaneProps {
  sessionId: string;
  /** Full raw session-event log — same array the play page's rehydration +
   *  4s events poll already fetch. No new poll is triggered by this prop. */
  events: EngineSessionEvent[];
  grounding: GroundingData | null;
  onClose: () => void;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
}

export default function JournalPane({
  sessionId,
  events,
  grounding,
  onClose,
  closeButtonRef,
}: JournalPaneProps) {
  const questTrail = deriveQuestTrail(events);
  const recapHistory = deriveRecapHistory(events);
  const npcsMet = deriveNpcsMet(events, grounding?.npcs_present);

  // DDX-22 Phase 3: notes are now owner-private, RLS-scoped SERVER state
  // (GET/PUT /api/dnd/sessions/{id}/notes) — the Phase-0 localStorage stopgap
  // is gone. The textarea onChange contract + the polite "Saved" live region
  // are unchanged from Phase 0 (the clean seam the design doc asked for); only
  // the persistence backing swapped from localStorage to a debounced PUT.
  const [notes, setNotes] = useState('');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [saveStatus, setSaveStatus] = useState<SaveState>('idle');
  // Bumped to re-run the load effect on a manual retry after a load failure.
  // We refuse to present an editable empty note on load error — that would let
  // an autosave clobber a real server note the user could not read.
  const [reloadNonce, setReloadNonce] = useState(0);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The (sessionId, value) awaiting the debounce timer / an in-flight PUT.
  // Carries the sessionId so the flush on unmount or session-switch targets the
  // correct session's row even mid-nav.
  const pendingSaveRef = useRef<{ sessionId: string; value: string } | null>(null);
  // Iro CRITICAL-1: the Retry button unmounts itself the instant it's clicked
  // (loadState error→loading flips it out of the DOM), which would eject focus
  // to <body>, OUTSIDE the aria-modal drawer. When a retry is in flight we
  // re-anchor focus once the reload resolves: to the now-editable textarea on
  // success, or back to the freshly-remounted Retry button on repeat failure —
  // either way focus stays inside the dialog. This is a user-initiated action,
  // so moving focus is correct (unlike the ambient autosave, which must NOT).
  const notesTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const retryBtnRef = useRef<HTMLButtonElement | null>(null);
  const retryFocusPendingRef = useRef(false);

  // The single note writer. `markStatus` is false for best-effort flushes fired
  // from effect cleanup (a post-unmount setState is a no-op) — those just push
  // the bytes. PUT is an idempotent upsert, so a duplicated flush is harmless.
  // The pendingSaveRef equality guard means a stale save that a newer keystroke
  // has already superseded neither flips the badge to "Saved" nor an old error.
  const doSave = useCallback(
    async (sid: string, value: string, markStatus: boolean) => {
      try {
        await putSessionNotes(sid, value);
        if (
          markStatus &&
          pendingSaveRef.current?.sessionId === sid &&
          pendingSaveRef.current?.value === value
        ) {
          pendingSaveRef.current = null;
          setSaveStatus('saved');
          if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current);
          savedBadgeTimerRef.current = setTimeout(() => setSaveStatus('idle'), SAVED_BADGE_MS);
        }
      } catch {
        if (
          markStatus &&
          pendingSaveRef.current?.sessionId === sid &&
          pendingSaveRef.current?.value === value
        ) {
          setSaveStatus('error');
        }
      }
    },
    [],
  );

  // Render-time reset when the session changes or a retry is requested —
  // React's documented "adjust state during render" pattern (a synchronous
  // reset in the render body, NOT an effect). This both satisfies the repo-wide
  // set-state-in-effect lint and sidesteps the one-tick flash of the previous
  // session's notes an effect-based reset would paint first. Timers and the
  // pending-flush are intentionally left to the load effect's cleanup below so
  // a mid-type session switch still flushes the note for the session being
  // left — this reset runs BEFORE that cleanup, so it must NOT null
  // pendingSaveRef (the cleanup still needs the old value to flush it).
  const resetKey = `${sessionId}#${reloadNonce}`;
  const [loadedResetKey, setLoadedResetKey] = useState<string | null>(null);
  if (resetKey !== loadedResetKey) {
    setLoadedResetKey(resetKey);
    setNotes('');
    setLoadState('loading');
    setSaveStatus('idle');
  }

  // Load the caller's OWN note on mount, on a session switch without a remount
  // (client-side nav between two /play routes), and on a manual retry. Only the
  // async .then/.catch touch state (the synchronous reset lives in the render
  // block above). The cleanup aborts the in-flight GET, clears timers, and
  // best-effort flushes a still-pending debounced write for the session being
  // left — covering both unmount (e.g. "Leave session") and a session switch
  // mid-type. A raw browser tab-close still needs `beforeunload`, out of scope
  // here (in-app nav only).
  useEffect(() => {
    const ctrl = new AbortController();
    getSessionNotes(sessionId, ctrl.signal)
      .then((note) => {
        // Guard the SUCCESS path too, not just .catch (Kage IMPORTANT):
        // ctrl.abort() only rejects an in-flight fetch. A GET that already
        // fully settled at the instant of a session switch has its .then
        // continuation queued and would otherwise run after cleanup —
        // applying the PREVIOUS session's note (and flipping loadState to
        // 'loaded', re-enabling the textarea) under the NEW sessionId, which
        // an autosave could then PUT into the wrong session's row. After
        // cleanup's abort(), signal.aborted is true → this becomes a no-op.
        if (ctrl.signal.aborted) return;
        setNotes(note?.body ?? '');
        setLoadState('loaded');
        if (retryFocusPendingRef.current) {
          retryFocusPendingRef.current = false;
          // The textarea's readOnly clears in this same commit; focus after a
          // frame so it lands on the now-editable field.
          requestAnimationFrame(() => notesTextareaRef.current?.focus());
        }
      })
      .catch(() => {
        // Aborted loads (session switch / unmount) are expected — ignore.
        if (ctrl.signal.aborted) return;
        setLoadState('error');
        if (retryFocusPendingRef.current) {
          retryFocusPendingRef.current = false;
          // Repeat failure: return focus to the re-mounted Retry button so a
          // keyboard/AT user is never stranded on <body> outside the dialog.
          requestAnimationFrame(() => retryBtnRef.current?.focus());
        }
      });
    return () => {
      ctrl.abort();
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (savedBadgeTimerRef.current) {
        clearTimeout(savedBadgeTimerRef.current);
        savedBadgeTimerRef.current = null;
      }
      const pending = pendingSaveRef.current;
      if (pending) void doSave(pending.sessionId, pending.value, false);
      pendingSaveRef.current = null;
    };
  }, [sessionId, reloadNonce, doSave]);

  // Debounced autosave. Only reachable once loadState==='loaded' (the textarea
  // is readOnly otherwise), so we never PUT an empty placeholder over a note we
  // failed to read. onChange contract + the "Saving…"/"Saved" live region are
  // byte-identical to Phase 0 — only the persistence target changed.
  const onNotesChange = useCallback(
    (value: string) => {
      // Miko finding (defense-in-depth for the owner-private no-clobber
      // invariant): refuse to schedule a write while the caller's own note
      // hasn't loaded, INDEPENDENT of the readOnly attribute. In a real
      // browser readOnly already blocks the onChange, so this is redundant —
      // but it closes the gap if readOnly is ever dropped/raced in a refactor,
      // or if some non-browser event source (AT, automation, a stray
      // programmatic .value set) reaches onChange. The invariant is now
      // enforced in logic, not only by a JSX prop.
      if (loadState !== 'loaded') return;
      setNotes(value);
      setSaveStatus('saving');
      // Kage IMPORTANT: cancel any pending "Saved"→idle badge timer from the
      // PREVIOUS save. Left running, it would fire 2s later and stomp this
      // in-flight 'saving' (or, worse, silently erase a 'Couldn't save' caption
      // from a failed newer save) — a wrong signal on a flaky link.
      if (savedBadgeTimerRef.current) {
        clearTimeout(savedBadgeTimerRef.current);
        savedBadgeTimerRef.current = null;
      }
      pendingSaveRef.current = { sessionId, value };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void doSave(sessionId, value, true);
      }, NOTES_DEBOUNCE_MS);
    },
    [sessionId, loadState, doSave],
  );

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <h2 id={JOURNAL_HEADING_ID} className={styles.heading}>
          <Icon name="Lantern" size={16} aria-hidden /> Journal
        </h2>
        <button
          type="button"
          ref={closeButtonRef}
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close journal"
        >
          <Icon name="Close" size={14} aria-hidden />
        </button>
      </div>

      <section aria-labelledby="journal-quest-heading" className={styles.section}>
        <h3 id="journal-quest-heading" className={styles.sectionHeading}>
          Quest log
        </h3>
        {grounding?.objective ? (
          <p className={styles.objective}>{grounding.objective}</p>
        ) : (
          <p className={styles.empty}>No current objective.</p>
        )}
        {questTrail.length > 0 && (
          <ul className={styles.list}>
            {questTrail.map((entry) => (
              <li key={entry.id}>{entry.text}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="journal-recap-heading" className={styles.section}>
        <h3 id="journal-recap-heading" className={styles.sectionHeading}>
          Recap history
        </h3>
        {recapHistory.length > 0 ? (
          <ul className={styles.list}>
            {recapHistory.map((entry) => (
              <li key={entry.id}>
                <span className={styles.who}>{entry.who}</span> {entry.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>No recaps yet.</p>
        )}
      </section>

      <section aria-labelledby="journal-npcs-heading" className={styles.section}>
        <h3 id="journal-npcs-heading" className={styles.sectionHeading}>
          NPCs met
        </h3>
        {npcsMet.length > 0 ? (
          <ul className={styles.list}>
            {npcsMet.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>No NPCs met yet.</p>
        )}
      </section>

      <section aria-labelledby="journal-notes-heading" className={styles.section}>
        <h3 id="journal-notes-heading" className={styles.sectionHeading}>
          Notes
        </h3>
        <label className={`label ${styles.notesLabel}`} htmlFor="journal-notes-textarea">
          Your notes for this session
        </label>
        <textarea
          id="journal-notes-textarea"
          ref={notesTextareaRef}
          className={`input ${styles.notesTextarea}`}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          // Iro MAJOR-1: readOnly (not disabled) until the caller's own note has
          // loaded. readOnly blocks every keystroke just as effectively — so an
          // autosave still can never PUT an empty placeholder over a note we
          // haven't read yet — but keeps the field FOCUSABLE and in the tab
          // order and keeps aria-describedby/aria-busy announced on focus,
          // which `disabled` (long-lived in the error state) strips away.
          readOnly={loadState !== 'loaded'}
          aria-disabled={loadState !== 'loaded' ? true : undefined}
          placeholder={loadState === 'loading' ? 'Loading your notes…' : undefined}
          aria-describedby="journal-notes-hint"
          aria-busy={loadState === 'loading'}
          rows={5}
        />
        {loadState === 'error' ? (
          <>
            <p id="journal-notes-hint" className={styles.notesError} role="alert">
              Couldn’t load your notes. They’re still saved — retry to edit them.
            </p>
            <button
              type="button"
              ref={retryBtnRef}
              className={`btn ${styles.retryBtn}`}
              aria-label="Retry loading notes"
              onClick={() => {
                retryFocusPendingRef.current = true;
                setReloadNonce((n) => n + 1);
              }}
            >
              Retry
            </button>
          </>
        ) : loadState === 'loading' ? (
          <p id="journal-notes-hint" className={styles.notesHint}>
            Loading your notes…
          </p>
        ) : (
          <p id="journal-notes-hint" className={styles.notesHint}>
            Only you can see these notes — they sync across your devices.
          </p>
        )}
        {/* Iro MINOR-1/MINOR-2: does not steal focus on save — a plain
            polite live region, not a toast/dialog. Announces the
            "saving"→"saved" transition (not every keystroke; SAVED_BADGE_MS
            resets it back to idle after a pause). VISIBLE text, not
            sr-only — mirrors LevelUpButton's `.result` convention exactly
            ("always mounted... visible text too, never color-only") so
            low-vision non-AT users get the same save feedback AT users get
            from role="status"/aria-live. The save-FAILED case switches to the
            danger-ink caption but keeps explicit text (never color-only). */}
        <p
          role="status"
          aria-live="polite"
          className={saveStatus === 'error' ? styles.saveStatusError : styles.saveStatus}
        >
          {saveStatus === 'saving'
            ? 'Saving…'
            : saveStatus === 'saved'
              ? 'Saved'
              : saveStatus === 'error'
                ? 'Couldn’t save — keep typing to retry.'
                : ''}
        </p>
      </section>
    </div>
  );
}
