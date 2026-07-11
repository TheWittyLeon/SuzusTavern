import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import JournalPane from '@/components/JournalPane';
import type { EngineSessionEvent, GroundingData } from '@/lib/api/types';

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
});

describe('JournalPane — section derivation from a mock events array', () => {
  it('renders all four section headings', () => {
    render(
      <JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />,
    );
    expect(screen.getByRole('heading', { name: 'Quest log' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recap history' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'NPCs met' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
  });

  it('quest log: shows the current objective and the scene_advance trail', () => {
    render(
      <JournalPane sessionId="s1" events={EVENTS} grounding={GROUNDING} onClose={jest.fn()} />,
    );
    expect(screen.getByText('Reach the cave before the tide rises.')).toBeInTheDocument();
    expect(screen.getByText('The party enters the cave.')).toBeInTheDocument();
  });

  it('quest log: shows an empty state when there is no objective', () => {
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
    expect(screen.getByText('No current objective.')).toBeInTheDocument();
  });

  it('recap history: renders recap-kind events and their who/text', () => {
    render(
      <JournalPane sessionId="s1" events={EVENTS} grounding={null} onClose={jest.fn()} />,
    );
    expect(screen.getByText(/Previously, the party found the cave\./)).toBeInTheDocument();
  });

  it('recap history: shows an empty state when there are no recap events', () => {
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
    expect(screen.getByText('No recaps yet.')).toBeInTheDocument();
  });

  it('NPCs met: unions event-sourced npcs_introduced with grounding NPCs', () => {
    render(
      <JournalPane sessionId="s1" events={EVENTS} grounding={GROUNDING} onClose={jest.fn()} />,
    );
    expect(screen.getByText('Mira')).toBeInTheDocument();
    expect(screen.getByText('Rainbow Dash')).toBeInTheDocument();
  });

  it('NPCs met: shows "No NPCs met yet." when nothing has been introduced', () => {
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
    expect(screen.getByText('No NPCs met yet.')).toBeInTheDocument();
  });
});

describe('JournalPane — close button', () => {
  it('calls onClose when the close button is clicked', () => {
    const onClose = jest.fn();
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close journal' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('JournalPane — notes (localStorage stopgap)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runAllTimers();
    });
    jest.useRealTimers();
  });

  it('loads any note already stored for this session on mount', () => {
    window.localStorage.setItem('suzu.journal.notes.s1', 'Remember the goblin ambush.');
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
    expect(screen.getByLabelText('Your notes for this session')).toHaveValue(
      'Remember the goblin ambush.',
    );
  });

  it('shows the sync-affordance hint text', () => {
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
    expect(screen.getByText('Notes sync across devices in a later update.')).toBeInTheDocument();
  });

  it('debounces the localStorage write and announces "Saving…" then "Saved" without stealing focus', () => {
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
    const textarea = screen.getByLabelText('Your notes for this session');
    textarea.focus();
    fireEvent.change(textarea, { target: { value: 'A new note.' } });

    // Not written yet — still debouncing. MINOR-1: the status region
    // announces "Saving…" synchronously, before the debounce timer fires.
    expect(window.localStorage.getItem('suzu.journal.notes.s1')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(window.localStorage.getItem('suzu.journal.notes.s1')).toBe('A new note.');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    // Typing never moves focus away from the textarea.
    expect(textarea).toHaveFocus();

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('flushes a pending debounced write on unmount instead of dropping it (Miko #4)', () => {
    const { unmount } = render(
      <JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />,
    );
    const textarea = screen.getByLabelText('Your notes for this session');
    fireEvent.change(textarea, { target: { value: 'Unsaved when unmounted.' } });

    // Still within the 500ms debounce window — nothing written yet.
    expect(window.localStorage.getItem('suzu.journal.notes.s1')).toBeNull();

    // SPA-nav-away case: the component unmounts before the debounce fires.
    unmount();

    expect(window.localStorage.getItem('suzu.journal.notes.s1')).toBe(
      'Unsaved when unmounted.',
    );
  });

  it('does not re-flush after a normal debounced save already completed', () => {
    const { unmount } = render(
      <JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />,
    );
    const textarea = screen.getByLabelText('Your notes for this session');
    fireEvent.change(textarea, { target: { value: 'Already saved.' } });

    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(window.localStorage.getItem('suzu.journal.notes.s1')).toBe('Already saved.');

    // A later, unrelated unmount must not re-write (pendingSaveRef was
    // cleared the instant the debounced write landed above).
    window.localStorage.setItem('suzu.journal.notes.s1', 'Changed elsewhere.');
    unmount();
    expect(window.localStorage.getItem('suzu.journal.notes.s1')).toBe('Changed elsewhere.');
  });

  it('degrades gracefully when localStorage throws (private mode)', () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    render(<JournalPane sessionId="s1" events={[]} grounding={null} onClose={jest.fn()} />);
    const textarea = screen.getByLabelText('Your notes for this session');
    expect(() => {
      fireEvent.change(textarea, { target: { value: 'still typeable' } });
      act(() => {
        jest.advanceTimersByTime(500);
      });
    }).not.toThrow();
    window.localStorage.setItem = original;
  });
});
