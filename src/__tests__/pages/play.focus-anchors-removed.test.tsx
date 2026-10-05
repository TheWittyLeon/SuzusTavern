/**
 * A9d-2 fix round 4 (Kage whole-branch I-C) — the three rescues in `useFocusAnchors` that used to wait an animation frame and ask "is focus on <body>?"
 * (the death-save row's falling edge, the begin-encounter button's, and the layout change) now ask "was the control focus was on REMOVED?" in a layout
 * effect (`useRemovedFocus`). "<body>" is also what a cold load looks like: the layout rescue put a ring on the scene heading in 6 of 8 cold loads (Table
 * preference, motion allowed). The browser pin is the harness's cold-load-focus-* legs (red 12 of 16 at c52da04); these are each branch of the decision,
 * and "no frame is involved" (a spy on requestAnimationFrame).
 *
 * Controls (seen red): rescue on "<body>" alone (the old rule) -> the cold-load cases red; drop the `inert` test from `focusable` -> the inert case reds;
 * keep `lastRef` across a pointer press -> the pointer case reds; put the rescue back behind requestAnimationFrame -> the no-frame case reds.
 */
import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useFocusAnchors } from '@/app/play/[sessionId]/hooks/useFocusAnchors';
import type { LayoutId } from '@/app/play/[sessionId]/presets';

jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

interface Props {
  layoutId?: LayoutId;
  isDying?: boolean;
  sceneHasEncounter?: boolean;
  combatIsActive?: boolean;
  /** the focused control is under `inert` (a layout that parks it in a closed drawer) rather than unmounted */
  inert?: boolean;
  /** ...or under a `hidden` attribute */
  hiddenAttr?: boolean;
  showControl?: boolean;
  /** ...or natively `disabled` (a browser drops focus from it, and nothing can be done on it) */
  disabledBtn?: boolean;
}

function Harness({ layoutId = 'table', isDying = false, sceneHasEncounter = false, combatIsActive = false, inert = false, hiddenAttr = false, showControl = true, disabledBtn = false }: Props) {
  const headRef = useRef<HTMLDivElement>(null);
  const { composerRailAnchorRef } = useFocusAnchors(isDying, sceneHasEncounter, null, headRef, combatIsActive, layoutId);
  return (
    <div>
      <div ref={headRef} tabIndex={-1} data-testid="head">head</div>
      <div ref={composerRailAnchorRef} tabIndex={-1} data-testid="rail">rail</div>
      <div data-testid="empty-space" />
      <button type="button">Elsewhere</button>
      <div {...(inert ? { inert: true } : {})} {...(hiddenAttr ? { hidden: true } : {})}>{showControl && <button type="button" disabled={disabledBtn}>Docked sheet</button>}</div>
    </div>
  );
}

const sheet = () => screen.getByRole('button', { name: 'Docked sheet' });
const head = () => screen.getByTestId('head');

describe('layout-change rescue: only when the focused control was removed', () => {
  it('COLD LOAD: nothing was ever focused, the layout id resolves (story -> table) and focus stays on <body> (the I-C ring)', () => {
    const { rerender } = render(<Harness layoutId="story" />);
    expect(document.body).toHaveFocus();
    rerender(<Harness layoutId="table" />);
    expect(document.body).toHaveFocus();
    expect(head()).not.toHaveFocus();
  });

  it('the control focus was on goes under `inert` with the layout change: the scene head takes focus', () => {
    const { rerender } = render(<Harness layoutId="table" />);
    act(() => sheet().focus());
    rerender(<Harness layoutId="phone" inert />);
    expect(head()).toHaveFocus();
  });

  it('the control focus was on is unmounted with the layout change: the scene head takes focus', () => {
    const { rerender } = render(<Harness layoutId="table" />);
    act(() => sheet().focus());
    rerender(<Harness layoutId="phone" showControl={false} />);
    expect(head()).toHaveFocus();
  });

  it('the control focus was on goes under a `hidden` ancestor (the other half of "removed" besides inert): the scene head takes focus', () => {
    const { rerender } = render(<Harness layoutId="table" />);
    act(() => sheet().focus());
    rerender(<Harness layoutId="phone" hiddenAttr />);
    expect(head()).toHaveFocus();
  });

  it('the control focus was on goes natively `disabled` (a verb locked under focus): counted as taken away, the scene head takes focus (Kage T-1: without this the held-arrives-player leg reds)', () => {
    const { rerender } = render(<Harness layoutId="table" />);
    act(() => sheet().focus());
    rerender(<Harness layoutId="phone" disabledBtn />);
    expect(head()).toHaveFocus();
  });

  it('the begin-encounter rescue focuses the head WITHOUT scrolling the page, like the other two (Iro round-4 MINOR-5)', () => {
    const focus = jest.spyOn(HTMLElement.prototype, 'focus');
    try {
      const { rerender } = render(<Harness sceneHasEncounter showControl />);
      act(() => sheet().focus());
      focus.mockClear();
      rerender(<Harness sceneHasEncounter={false} showControl={false} />);
      const onHead = focus.mock.calls.map((c, i) => ({ opts: c[0], target: focus.mock.contexts[i] })).filter((c) => (c.target as HTMLElement).dataset?.testid === 'head');
      expect(onHead).toHaveLength(1);
      expect(onHead[0].opts).toEqual({ preventScroll: true });
    } finally {
      focus.mockRestore();
    }
  });

  it('a control that is still focusable keeps focus through the layout change (the node is moved, not removed)', () => {
    const { rerender } = render(<Harness layoutId="table" />);
    act(() => sheet().focus());
    rerender(<Harness layoutId="phone" />);
    expect(sheet()).toHaveFocus();
  });

  it('focus the user moved on to is never yanked: the old control is gone but focus is on another control', () => {
    const { rerender } = render(<Harness layoutId="table" />);
    act(() => sheet().focus());
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());
    rerender(<Harness layoutId="phone" showControl={false} />);
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });

  it('a click on empty space forgets the control (the user moved on to nothing on purpose): its later removal is not a loss', () => {
    const { rerender } = render(<Harness layoutId="table" />);
    act(() => sheet().focus());
    fireEvent.pointerDown(screen.getByTestId('empty-space'));
    act(() => sheet().blur());
    rerender(<Harness layoutId="phone" showControl={false} />);
    expect(document.body).toHaveFocus();
  });

  it('a layout change that is the MOMENT changing (combat starting) is still not this rescue\'s (Iro CRITICAL-1 provenance): focus on a removed control stays unrescued here', () => {
    const { rerender } = render(<Harness layoutId="story" combatIsActive={false} />);
    act(() => sheet().focus());
    rerender(<Harness layoutId="table" combatIsActive showControl={false} />);
    expect(head()).not.toHaveFocus();
  });
});

describe('the two falling-edge rescues: the focused control was removed', () => {
  it('begin-encounter: the button the user was on goes away (the scene moved on): the scene head takes focus; with nothing focused it does not', () => {
    const { rerender } = render(<Harness sceneHasEncounter showControl />);
    act(() => sheet().focus());
    rerender(<Harness sceneHasEncounter={false} showControl={false} />);
    expect(head()).toHaveFocus();
    // the same edge on a page where nothing was focused: nothing was lost
    const second = render(<Harness sceneHasEncounter />);
    second.rerender(<Harness sceneHasEncounter={false} />);
    expect(screen.getAllByTestId('head')[1]).not.toHaveFocus();
  });

  it('death save: the row the user pressed unmounts as isDying falls: the composer rail takes focus; with nothing focused it does not', () => {
    const { rerender } = render(<Harness isDying />);
    act(() => sheet().focus());
    rerender(<Harness isDying={false} showControl={false} />);
    expect(screen.getByTestId('rail')).toHaveFocus();
    const second = render(<Harness isDying />);
    second.rerender(<Harness isDying={false} />);
    expect(screen.getAllByTestId('rail')[1]).not.toHaveFocus();
  });
});

describe('no animation frame is involved (the commit decides, so there is no order of frame and commit to get wrong)', () => {
  it('none of the rescues asks for a frame', () => {
    const raf = jest.spyOn(window, 'requestAnimationFrame');
    try {
      const { rerender } = render(<Harness layoutId="table" sceneHasEncounter />);
      act(() => sheet().focus());
      rerender(<Harness layoutId="phone" sceneHasEncounter={false} showControl={false} />); // two edges in one commit: the first registered (begin-encounter) wins the tie
      expect(head()).toHaveFocus();
      expect(raf).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
    }
  });
});
