import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import JournalPane from '@/components/JournalPane';
import type { EngineSessionEvent, GroundingData, SessionNote } from '@/lib/api/types';

// DDX-22 Phase 3: notes are server state (GET/PUT /api/dnd/sessions/{id}/notes)
// via src/lib/api/dnd.ts, not localStorage — mock the two note functions at
// the module JournalPane actually imports from. Nothing else in that module
// is used by JournalPane, so a minimal mock is sufficient here (unlike the
// play-page test files, which mock the whole dnd surface).
jest.mock('../../lib/api/dnd', () => ({
  getSessionNotes: jest.fn(),
  putSessionNotes: jest.fn(),
}));

import { getSessionNotes, putSessionNotes } from '@/lib/api/dnd';

const mockGetSessionNotes = getSessionNotes as jest.MockedFunction<typeof getSessionNotes>;
const mockPutSessionNotes = putSessionNotes as jest.MockedFunction<typeof putSessionNotes>;

/** Flush the microtask queue (Promise .then/.catch chains) without touching
 *  fake timers — getSessionNotes/putSessionNotes resolve via plain Promises,
 *  not setTimeout, so this is enough to settle the load effect regardless of
 *  whether a given test also has fake timers active for the debounce. */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const EVENTS: EngineSessionEvent[] = [
  { seq: 1, kind: 'scene_advance', data: { description: 'The party enters the cave.' } },
  { seq: 2, kind: 'narration', data: { text: 'ignored', npcs_introduced: ['Mira'] } },
  { seq: 3, kind: 'recap', data: { text: 'Previously, the party found the cave.', who: 'Suzu' } },
];

const GROUNDING: GroundingData = {
  scene_id: 'cave-mouth',
  scene_name: 'The Cave Mouth',
  objective: 'Reach the cave before the tide rises.',
  npcs_present: [{ name: 'Rainbow Dash' }],
};

beforeEach(() => {
  window.localStorage.clear();
  mockGetSessionNotes.mockReset().mockResolvedValue(null);
  mockPutSessionNotes.mockReset().mockResolvedValue({ body: '', updated_at: '2026-01-01T00:00:00Z' });
});

// Every JournalPane render kicks off a getSessionNotes() GET (even in the
// section-derivation tests below, which don't await it). Settle it after
// every test so its .then's setState doesn't land un-act()-wrapped after the
// test has already moved on to the next one.
afterEach(async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe('JournalPane — section derivation from a mock events array', () => {
  // Every render kicks off a getSessionNotes() GET regardless of what these
  // tests actually assert on — flush it (act-wrapped) before each test ends,
  // so its .then's setState doesn't land un-act()-wrapped in the gap between
  // this (synchronous-bodied) test returning and the next hook running.
  it('renders all four section headings', async () => {
    render(
      <JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />,
    );
    expect(screen.getByRole('heading', { name: 'Quest log' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recap history' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'NPCs met' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    await flushMicrotasks();
  });

  it('quest log: shows the current objective and the scene_advance trail', async () => {
    render(
      <JournalPane sessionId="s1" events={EVENTS} grounding={GROUNDING} onClose={jest.fn()} />,
    );
    expect(screen.getByText('Reach the cave before the tide rises.')).toBeInTheDocument();
    expect(screen.getByText('The party enters the cave.')).toBeInTheDocument();
    await flushMicrotasks();
  });

  it('quest log: shows an empty state when there is no objective', async () => {
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
    expect(screen.getByText('No current objective.')).toBeInTheDocument();
    await flushMicrotasks();
  });

  it('recap history: renders recap-kind events and their who/text', async () => {
    render(
      <JournalPane sessionId="s1" events={EVENTS} grounding={null} onClose={jest.fn()} />,
    );
    expect(screen.getByText(/Previously, the party found the cave\./)).toBeInTheDocument();
    await flushMicrotasks();
  });

  it('recap history: shows an empty state when there are no recap events', async () => {
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
    expect(screen.getByText('No recaps yet.')).toBeInTheDocument();
    await flushMicrotasks();
  });

  it('NPCs met: unions event-sourced npcs_introduced with grounding NPCs', async () => {
    render(
      <JournalPane sessionId="s1" events={EVENTS} grounding={GROUNDING} onClose={jest.fn()} />,
    );
    expect(screen.getByText('Mira')).toBeInTheDocument();
    expect(screen.getByText('Rainbow Dash')).toBeInTheDocument();
    await flushMicrotasks();
  });

  it('NPCs met: shows "No NPCs met yet." when nothing has been introduced', async () => {
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
    expect(screen.getByText('No NPCs met yet.')).toBeInTheDocument();
    await flushMicrotasks();
  });
});

describe('JournalPane — close button', () => {
  it('calls onClose when the close button is clicked', async () => {
    const onClose = jest.fn();
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close journal' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
  });
});

describe('JournalPane — notes (owner-private session-notes API, DDX-22 Phase 3)', () => {
  it('shows a read-only, busy textarea + loading hint until the GET resolves, then the loaded body', async () => {
    const note: SessionNote = { body: 'Remember the goblin ambush.', updated_at: '2026-01-01T00:00:00Z' };
    let resolveLoad!: (v: SessionNote | null) => void;
    mockGetSessionNotes.mockReturnValue(
      new Promise((res) => {
        resolveLoad = res;
      }),
    );
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);

    // Iro MAJOR-1: readOnly (not disabled) while loading — every keystroke is
    // still blocked (so autosave still can't clobber an unread note), but the
    // field stays focusable/in the tab order, unlike `disabled`.
    const textarea = screen.getByLabelText('Your notes for this session');
    expect(textarea).toHaveAttribute('readonly');
    expect(textarea).toHaveAttribute('aria-disabled', 'true');
    expect(textarea).toHaveAttribute('placeholder', 'Loading your notes…');
    expect(textarea).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading your notes…', { selector: 'p' })).toBeInTheDocument();
    expect(mockGetSessionNotes).toHaveBeenCalledWith('s1', expect.any(AbortSignal));

    await act(async () => {
      resolveLoad(note);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(textarea).not.toHaveAttribute('readonly');
    expect(textarea).not.toHaveAttribute('aria-disabled');
    expect(textarea).toHaveAttribute('aria-busy', 'false');
    expect(textarea).toHaveValue('Remember the goblin ambush.');
  });

  it('null note (nothing saved yet) loads into an empty, editable textarea', async () => {
    mockGetSessionNotes.mockResolvedValue(null);
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
    await flushMicrotasks();

    const textarea = screen.getByLabelText('Your notes for this session');
    expect(textarea).not.toHaveAttribute('readonly');
    expect(textarea).toHaveValue('');
  });

  it('shows the owner-private sync hint once loaded', async () => {
    mockGetSessionNotes.mockResolvedValue(null);
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
    await flushMicrotasks();
    expect(
      screen.getByText('Only you can see these notes — they sync across your devices.'),
    ).toBeInTheDocument();
  });

  it('debounces the autosave PUT, announces "Saving…" then "Saved", and does not steal focus', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionNotes.mockResolvedValue(null);
      mockPutSessionNotes.mockResolvedValue({ body: 'A new note.', updated_at: '2026-01-01T00:00:01Z' });
      render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const textarea = screen.getByLabelText('Your notes for this session');
      textarea.focus();
      fireEvent.change(textarea, { target: { value: 'A new note.' } });

      // Not sent yet — still debouncing. The status region announces
      // "Saving…" synchronously, before the debounce timer fires.
      expect(mockPutSessionNotes).not.toHaveBeenCalled();
      expect(screen.getByRole('status')).toHaveTextContent('Saving…');

      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Called with (sessionId, body) only — no username (identity is the
      // cookie actor, per the API contract).
      expect(mockPutSessionNotes).toHaveBeenCalledTimes(1);
      expect(mockPutSessionNotes).toHaveBeenCalledWith('s1', 'A new note.');
      expect(screen.getByRole('status')).toHaveTextContent('Saved');
      // Typing/saving never moves focus away from the textarea.
      expect(textarea).toHaveFocus();

      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      expect(screen.getByRole('status')).toHaveTextContent('');
    } finally {
      jest.useRealTimers();
    }
  });

  it('a stale "Saved"→idle badge timer from an earlier save must not stomp a later Saving/error status (Kage fix)', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionNotes.mockResolvedValue(null);
      mockPutSessionNotes.mockResolvedValueOnce({ body: 'A', updated_at: 'x' });
      render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const textarea = screen.getByLabelText('Your notes for this session');
      const status = screen.getByRole('status');

      // Save A completes -> "Saved", which arms a 2s idle-reset timer.
      fireEvent.change(textarea, { target: { value: 'A' } });
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(status).toHaveTextContent('Saved');

      // Before that 2s idle timer fires, the user types again (save B). This
      // must cancel A's stale idle-reset timer — otherwise it would later
      // blank out B's own "Saving…"/"Saved" status out from under it.
      mockPutSessionNotes.mockImplementationOnce(() => new Promise(() => {})); // never resolves
      fireEvent.change(textarea, { target: { value: 'AB' } });
      expect(status).toHaveTextContent('Saving…');

      // Advance past where A's idle timer WOULD have fired (2s from A's
      // save-landing), while B's own save is still in flight (debounce not
      // even elapsed yet at 500ms, let alone B's PUT resolving).
      await act(async () => {
        jest.advanceTimersByTime(1500); // 500 (B's debounce) + 1000 more
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // B's PUT never resolves in this test, so the live region should still
      // read "Saving…" — NOT blanked to '' by A's stale idle-reset timer.
      expect(status).toHaveTextContent('Saving…');
    } finally {
      jest.useRealTimers();
    }
  });

  it('no-clobber invariant (UI layer): the textarea stays read-only until the load resolves, so a real user cannot type into it', async () => {
    let resolveLoad!: (v: SessionNote | null) => void;
    mockGetSessionNotes.mockReturnValue(
      new Promise((res) => {
        resolveLoad = res;
      }),
    );
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);

    const textarea = screen.getByLabelText('Your notes for this session');
    expect(textarea).toHaveAttribute('readonly');

    await act(async () => {
      resolveLoad({ body: 'Real note from server.', updated_at: 'x' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(textarea).not.toHaveAttribute('readonly');
    expect(textarea).toHaveValue('Real note from server.');
  });

  // --- Adversarial / break-it -----------------------------------------
  //
  // FIXED (DDX-22-P3-NOCLOBBER-GUARD, coordinator pass): the DOM `readOnly`
  // attribute stops a real user from typing while unloaded, and onNotesChange
  // now ALSO has a redundant `if (loadState !== 'loaded') return;` logic guard.
  // Proven here by bypassing `readOnly` the way `fireEvent.change` does (jsdom,
  // unlike a real browser, still delivers a programmatically dispatched change
  // event to React's onChange on a read-only control): even with the attribute
  // bypassed, the handler itself refuses to schedule the write, so the
  // owner-private no-clobber invariant is enforced in logic, not only by a JSX
  // prop. Was `it.failing` (documented gap) before the guard landed.
  it(
    'no-clobber invariant (logic layer): onNotesChange refuses to schedule a save while loadState !== "loaded", independent of the readOnly attribute (DDX-22 finding, FIXED)',
    async () => {
      jest.useFakeTimers();
      try {
        let resolveLoad!: (v: SessionNote | null) => void;
        mockGetSessionNotes.mockReturnValue(
          new Promise((res) => {
            resolveLoad = res;
          }),
        );
        render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);

        const textarea = screen.getByLabelText('Your notes for this session');
        expect(textarea).toHaveAttribute('readonly');

        // Bypass the readOnly attribute the way a non-browser event source
        // would (this is exactly what fireEvent does under the hood).
        fireEvent.change(textarea, { target: { value: 'sneaky' } });
        await act(async () => {
          jest.advanceTimersByTime(600);
        });

        // Desired: even if onChange is somehow reached while unloaded, the
        // handler itself refuses to schedule/send a write.
        expect(mockPutSessionNotes).not.toHaveBeenCalled();

        await act(async () => {
          resolveLoad({ body: 'Real note from server.', updated_at: 'x' });
          await Promise.resolve();
          await Promise.resolve();
        });
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('load error: shows role="alert" + Retry, keeps the textarea read-only, never PUTs; Retry re-fetches and recovers', async () => {
    mockGetSessionNotes.mockRejectedValueOnce(new Error('boom'));
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
    await flushMicrotasks();

    const textarea = screen.getByLabelText('Your notes for this session');
    expect(textarea).toHaveAttribute('readonly');
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn.t load your notes/);
    expect(mockPutSessionNotes).not.toHaveBeenCalled();

    mockGetSessionNotes.mockResolvedValueOnce({ body: 'Recovered note.', updated_at: 'x' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading notes' }));
    await flushMicrotasks();
    // Drain the retry-focus rAF the component schedules on a successful
    // reload (Iro CRITICAL-1) so it doesn't leak an act() warning into a
    // later test.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(mockGetSessionNotes).toHaveBeenCalledTimes(2);
    expect(textarea).not.toHaveAttribute('readonly');
    expect(textarea).toHaveValue('Recovered note.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('load error → Retry → still fails: focus returns to the re-mounted Retry button, never stranded on <body> (Iro CRITICAL-1)', async () => {
    mockGetSessionNotes.mockRejectedValueOnce(new Error('boom'));
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
    await flushMicrotasks();

    mockGetSessionNotes.mockRejectedValueOnce(new Error('boom again'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading notes' }));
    await flushMicrotasks();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry loading notes' })).toHaveFocus();
  });

  it('session switch: a late-resolving GET for the OLD session must not apply its note under the NEW session (Kage Q1 abort guard)', async () => {
    let resolveOld!: (v: SessionNote | null) => void;
    mockGetSessionNotes.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveOld = res;
        }),
    );
    const { rerender } = render(
      <JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />,
    );
    expect(mockGetSessionNotes).toHaveBeenNthCalledWith(1, 's1', expect.any(AbortSignal));

    // Switch sessions (client-side nav between two /play routes — no
    // remount). The new session's own GET resolves quickly with ITS note.
    mockGetSessionNotes.mockResolvedValueOnce({ body: 'Session 2 note.', updated_at: 'y' });
    rerender(<JournalPane sessionId="s2" events={[]} grounding={null} onClose={jest.fn()} />);
    await flushMicrotasks();

    const textarea = screen.getByLabelText('Your notes for this session');
    expect(textarea).toHaveValue('Session 2 note.');
    expect(textarea).not.toHaveAttribute('readonly');

    // The s1 GET now settles late (after the switch already committed cleanup
    // -> ctrl.abort()). Its .then must be a no-op, not overwrite s2's
    // already-loaded note with stale s1 content.
    await act(async () => {
      resolveOld({ body: 'Session 1 note (STALE).', updated_at: 'x' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(textarea).toHaveValue('Session 2 note.');
  });

  it('save error: shows the danger-ink status caption, and a later successful save clears it', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionNotes.mockResolvedValue({ body: '', updated_at: 'x' });
      mockPutSessionNotes.mockRejectedValueOnce(new Error('network'));
      render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const textarea = screen.getByLabelText('Your notes for this session');
      fireEvent.change(textarea, { target: { value: 'will fail' } });
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('Couldn’t save — keep typing to retry.');

      mockPutSessionNotes.mockResolvedValueOnce({ body: 'will succeed', updated_at: 'x' });
      fireEvent.change(textarea, { target: { value: 'will succeed' } });
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(status).toHaveTextContent('Saved');
    } finally {
      jest.useRealTimers();
    }
  });

  it('flushes a still-pending debounced write on unmount instead of dropping it (best-effort PUT)', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionNotes.mockResolvedValue({ body: '', updated_at: 'x' });
      const { unmount } = render(
        <JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />,
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const textarea = screen.getByLabelText('Your notes for this session');
      fireEvent.change(textarea, { target: { value: 'Unsaved when unmounted.' } });

      // Still within the 500ms debounce window — nothing sent yet.
      expect(mockPutSessionNotes).not.toHaveBeenCalled();

      // SPA-nav-away case: the component unmounts before the debounce fires.
      unmount();

      expect(mockPutSessionNotes).toHaveBeenCalledWith('s1', 'Unsaved when unmounted.');
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not re-flush on unmount after a normal debounced save already completed', async () => {
    jest.useFakeTimers();
    try {
      mockGetSessionNotes.mockResolvedValue({ body: '', updated_at: 'x' });
      mockPutSessionNotes.mockResolvedValue({ body: 'Already saved.', updated_at: 'x' });
      const { unmount } = render(
        <JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />,
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const textarea = screen.getByLabelText('Your notes for this session');
      fireEvent.change(textarea, { target: { value: 'Already saved.' } });

      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockPutSessionNotes).toHaveBeenCalledTimes(1);

      // A later, unrelated unmount must not re-send (pendingSaveRef was
      // cleared the instant the debounced write landed above).
      unmount();
      expect(mockPutSessionNotes).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // --- Adversarial / break-it -----------------------------------------
  //
  // it.failing: this asserts the DESIRED behavior, which the component does
  // NOT currently implement — see the QA report's "stale-save race" finding.
  // If a future fix makes this pass, Jest will fail the suite (test.failing
  // requires the body to keep throwing) as a signal to drop `.failing`.
  it.failing(
    'stale-save race: an older in-flight PUT must not be allowed to overlap a newer autosave for the same note (DDX-22 finding)',
    async () => {
      jest.useFakeTimers();
      try {
        mockGetSessionNotes.mockResolvedValue({ body: '', updated_at: 'x' });
        let resolveFirstPut!: (v: SessionNote) => void;
        mockPutSessionNotes.mockImplementationOnce(
          () =>
            new Promise((res) => {
              resolveFirstPut = res;
            }),
        );
        render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });

        const textarea = screen.getByLabelText('Your notes for this session');

        // First debounce window fires a PUT that stalls (simulates slow /
        // reordered network) — it never resolves within this test.
        fireEvent.change(textarea, { target: { value: 'first' } });
        await act(async () => {
          jest.advanceTimersByTime(500);
        });
        expect(mockPutSessionNotes).toHaveBeenCalledTimes(1);

        // The user keeps typing; a second debounce window elapses and fires
        // a SECOND PUT while the first is still in flight.
        fireEvent.change(textarea, { target: { value: 'second' } });
        await act(async () => {
          jest.advanceTimersByTime(500);
        });

        // Desired: the component never has two writes for the same note
        // racing on the wire — either the stale PUT is aborted before the
        // newer one fires, or the two are serialized. Today it fires both
        // unconditionally (no AbortController/signal is even passed to
        // putSessionNotes), so on a network that delivers "first" to the
        // server AFTER "second", the server silently reverts to stale
        // content with no error surfaced to the user.
        expect(mockPutSessionNotes).toHaveBeenCalledTimes(1);

        resolveFirstPut({ body: 'first', updated_at: 'x' });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
      } finally {
        jest.useRealTimers();
      }
    },
  );
});
