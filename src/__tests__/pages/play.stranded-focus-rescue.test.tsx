/**
 * A9d-2 N1 (Kage I-3, Iro Major-3) — `useStrandedFocusRescue`: the stranded-focus rescue is tied to the COMMIT.
 *
 * Every case drives the hook through a real component with real focus in jsdom. The page-level proof (the real race, with the rescue
 * frame forced before the commit) is in play.checks-and-fork and play.intent-fastpath; these pin each branch of the decision.
 */
import { useEffect, useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { STRANDED_FOCUS_WATCH_MS, useStrandedFocusRescue } from '@/app/play/[sessionId]/hooks/useStrandedFocusRescue';

let rescue: (had: boolean) => void = () => {};

function Harness() {
  const headRef = useRef<HTMLDivElement>(null);
  const [showCheck, setShowCheck] = useState(true);
  const [, setTick] = useState(0);
  const rescueFn = useStrandedFocusRescue(headRef);
  useEffect(() => {
    rescue = rescueFn;
  }, [rescueFn]);
  return (
    <div>
      <div ref={headRef} tabIndex={-1} aria-label="Scene head">head</div>
      {showCheck && <button type="button">Attempt Stealth</button>}
      <button type="button" onClick={() => setShowCheck(false)}>Resolve</button>
      <button type="button">Elsewhere</button>
      <button type="button" onClick={() => setTick((t) => t + 1)}>Tick</button>
    </div>
  );
}

const head = () => screen.getByLabelText('Scene head');
const check = () => screen.getByRole('button', { name: 'Attempt Stealth' });

afterEach(() => {
  jest.useRealTimers();
});

describe('useStrandedFocusRescue', () => {
  it('the call arrives BEFORE the commit that removes the focused control: the commit lands focus on the head, no frame involved', () => {
    const raf = jest.spyOn(window, 'requestAnimationFrame');
    render(<Harness />);
    act(() => check().focus());
    act(() => rescue(true)); // armed while the control is still mounted
    expect(check()).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' })); // the update that unmounts it
    expect(screen.queryByRole('button', { name: 'Attempt Stealth' })).toBeNull();
    expect(head()).toHaveFocus();
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });

  it('the commit ran FIRST (focus is already on <body> when the call arrives): the head takes focus at once', () => {
    render(<Harness />);
    act(() => check().focus());
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(document.body).toHaveFocus();
    act(() => rescue(true));
    expect(head()).toHaveFocus();
  });

  it('never yanks focus the user already moved: onto another control before the commit, the head does not take it', () => {
    render(<Harness />);
    act(() => check().focus());
    act(() => rescue(true));
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.getByRole('button', { name: 'Elsewhere' }).ownerDocument.activeElement).not.toBe(head());
    expect(document.activeElement).not.toBe(head());
  });

  it('a control that is STAYING disarms the watch once focus leaves it (to <body> on purpose): a later removal does not rescue', () => {
    render(<Harness />);
    act(() => check().focus());
    act(() => rescue(true));
    act(() => (document.activeElement as HTMLElement).blur()); // the user clicked on empty space
    fireEvent.click(screen.getByRole('button', { name: 'Tick' })); // the next commit (a poll, any render): the control is still here, focus is not
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' })); // a later, unrelated commit removes the control
    expect(head()).not.toHaveFocus();
  });

  it('without hadFocusInGroup the call arms nothing: a removal strands nothing it is responsible for', () => {
    render(<Harness />);
    act(() => check().focus());
    act(() => rescue(false));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(head()).not.toHaveFocus();
  });

  it('is bounded: a watch armed on a control that stays disarms after STRANDED_FOCUS_WATCH_MS, and a removal after that is left alone', () => {
    jest.useFakeTimers();
    render(<Harness />);
    act(() => check().focus());
    act(() => rescue(true));
    act(() => { jest.advanceTimersByTime(STRANDED_FOCUS_WATCH_MS + 1); });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(head()).not.toHaveFocus();
  });

  it('a removal INSIDE the window still rescues (the bound is not shorter than the commit it waits for)', () => {
    jest.useFakeTimers();
    render(<Harness />);
    act(() => check().focus());
    act(() => rescue(true));
    act(() => { jest.advanceTimersByTime(STRANDED_FOCUS_WATCH_MS - 100); });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(head()).toHaveFocus();
  });

  it('unmounting clears the pending watch (no timer left behind)', () => {
    jest.useFakeTimers();
    const { unmount } = render(<Harness />);
    act(() => check().focus());
    act(() => rescue(true));
    expect(jest.getTimerCount()).toBe(1);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
