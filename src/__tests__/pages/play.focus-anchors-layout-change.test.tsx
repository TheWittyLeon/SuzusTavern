/**
 * A9d-2 F2 (build brief 5, Iro A9d-1 MINOR-2): a layout change that strands focus on <body> (Table's docked sheet
 * becoming the closed, inert phone drawer; the stage's fold handle going inert at desktop width) is rescued onto the
 * scene head, with the same stranding gate as every other rescue in `useFocusAnchors`: never when focus is somewhere
 * real, never when nothing changed. The browser half is the harness's t2-breakpoint-rescue.
 */
import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useFocusAnchors } from '@/app/play/[sessionId]/hooks/useFocusAnchors';
import type { LayoutId } from '@/app/play/[sessionId]/presets';

jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

function Harness({ layoutId, withHandle = true, combatIsActive = false }: { layoutId: LayoutId; withHandle?: boolean; combatIsActive?: boolean }) {
  const headRef = useRef<HTMLDivElement>(null);
  useFocusAnchors(false, false, null, headRef, combatIsActive, layoutId);
  return (
    <div>
      <div ref={headRef} tabIndex={-1} aria-label="Scene head" />
      {withHandle ? <button>Fold handle</button> : null}
      <input aria-label="elsewhere" />
    </div>
  );
}

describe('useFocusAnchors: the layout-change rescue', () => {
  let raf: jest.SpyInstance;
  beforeEach(() => {
    raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => { cb(0); return 0; });
  });
  afterEach(() => raf.mockRestore());

  it('a layout id change that stranded focus on <body> lands on the scene head', () => {
    const { rerender } = render(<Harness layoutId="phone" />);
    screen.getByRole('button', { name: 'Fold handle' }).focus();
    // phone -> story: the fold handle goes inert (unmounts), focus drops to <body>
    rerender(<Harness layoutId="story" withHandle={false} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Scene head'));
  });

  it('focus that is still on a real control is NOT stolen', () => {
    const { rerender } = render(<Harness layoutId="table" />);
    screen.getByLabelText('elsewhere').focus();
    rerender(<Harness layoutId="phone" />);
    expect(screen.getByLabelText('elsewhere')).toHaveFocus();
  });

  it('a layout change that IS the moment flipping (Auto: story -> table when a fight starts) is not this rescue\'s: <body> stays <body> (the moment-flip rescues own it, scoped to a local cause)', () => {
    const { rerender } = render(<Harness layoutId="story" />);
    expect(document.activeElement).toBe(document.body);
    rerender(<Harness layoutId="table" combatIsActive />);
    expect(document.activeElement).toBe(document.body);
  });

  it('no layout change, no rescue: focus on <body> stays on <body> across an unrelated re-render', () => {
    const { rerender } = render(<Harness layoutId="story" />);
    expect(document.activeElement).toBe(document.body);
    rerender(<Harness layoutId="story" />);
    expect(document.activeElement).toBe(document.body);
  });

  it('the first render is not a change (a page that loads on <body> is not "rescued")', () => {
    render(<Harness layoutId="phone" />);
    expect(document.activeElement).toBe(document.body);
  });
});
