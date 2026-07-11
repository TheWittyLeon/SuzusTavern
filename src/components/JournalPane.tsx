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

function notesStorageKey(sessionId: string): string {
  return `suzu.journal.notes.${sessionId}`;
}

/** Mirrors useSuzuNote.ts's safeGet/safeSet — private-mode / storage-disabled
 *  browsers must degrade to "notes just don't persist", never throw. */
function safeGetNotes(sessionId: string): string {
  try {
    return window.localStorage.getItem(notesStorageKey(sessionId)) ?? '';
  } catch {
    return '';
  }
}

function safeSetNotes(sessionId: string, value: string): void {
  try {
    window.localStorage.setItem(notesStorageKey(sessionId), value);
  } catch {
    /* private mode / storage disabled — notes just won't persist */
  }
}

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

  const [notes, setNotes] = useState(() => safeGetNotes(sessionId));
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Miko #4: mirrors whichever (sessionId, value) pair is currently waiting
  // on the debounce timer above. The unmount cleanup below reads this to
  // flush a still-pending write synchronously instead of silently dropping
  // it; cleared the instant the debounced write actually lands.
  const pendingSaveRef = useRef<{ sessionId: string; value: string } | null>(null);

  // Re-load notes when `sessionId` changes without a remount (e.g. a
  // client-side nav between two /play/[sessionId] routes). This is React's
  // documented "adjust state during render" pattern — a conditional setState
  // call in the render body, not an effect — which both sidesteps the
  // react-hooks/set-state-in-effect lint rule and (more importantly) avoids
  // the one-tick flash of the PREVIOUS session's notes an effect-based reset
  // would otherwise paint first. The lazy useState initializer above already
  // covers the first mount.
  const [loadedForSessionId, setLoadedForSessionId] = useState(sessionId);
  if (sessionId !== loadedForSessionId) {
    setLoadedForSessionId(sessionId);
    setNotes(safeGetNotes(sessionId));
    setSaveStatus('idle');
  }

  // Debounced localStorage write. Phase 3 swaps the body of this callback for
  // a real PUT /sessions/{id}/notes (owner-private, RLS-scoped) — the
  // textarea's onChange contract and the "Saved" live region stay identical,
  // which is the clean seam the design doc asks for.
  const onNotesChange = useCallback(
    (value: string) => {
      setNotes(value);
      // MINOR-1: announce the in-flight save synchronously — the type used
      // to be 'idle' | 'saved' only, so "Saving…" could never actually fire.
      setSaveStatus('saving');
      pendingSaveRef.current = { sessionId, value };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        pendingSaveRef.current = null;
        safeSetNotes(sessionId, value);
        setSaveStatus('saved');
        if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current);
        savedBadgeTimerRef.current = setTimeout(() => setSaveStatus('idle'), SAVED_BADGE_MS);
      }, NOTES_DEBOUNCE_MS);
    },
    [sessionId],
  );

  // Flush a still-pending debounced write on unmount instead of silently
  // dropping it (Miko #4): the comment here used to say "Flush" but the code
  // only ever cancelled the timer — typing then navigating away (SPA nav,
  // e.g. clicking "Leave session") within the 500ms debounce window lost
  // the tail of whatever was typed. Uses the ref (not props) since this
  // effect's own `[]` dep means its cleanup closure is fixed at mount time.
  // A raw browser tab-close still needs `beforeunload` — that's out of scope
  // here, this only covers in-app navigation.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        if (pendingSaveRef.current) {
          safeSetNotes(pendingSaveRef.current.sessionId, pendingSaveRef.current.value);
        }
        clearTimeout(saveTimerRef.current);
      }
      if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current);
    };
  }, []);

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
          className={`input ${styles.notesTextarea}`}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          aria-describedby="journal-notes-hint"
          rows={5}
        />
        <p id="journal-notes-hint" className={styles.notesHint}>
          Notes sync across devices in a later update.
        </p>
        {/* Iro MINOR-1/MINOR-2: does not steal focus on save — a plain
            polite live region, not a toast/dialog. Announces the
            "saving"→"saved" transition (not every keystroke; SAVED_BADGE_MS
            resets it back to idle after a pause). VISIBLE text, not
            sr-only — mirrors LevelUpButton's `.result` convention exactly
            ("always mounted... visible text too, never color-only") so
            low-vision non-AT users get the same save feedback AT users get
            from role="status"/aria-live. */}
        <p role="status" aria-live="polite" className={styles.saveStatus}>
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : ''}
        </p>
      </section>
    </div>
  );
}
