/**
 * A9c C5 — useRovingToolbar (build brief §4.2, Iro IMPORTANT-2).
 * The hook's contract, then DiceTray's three toolbars end to end.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useRovingToolbar, type ToolbarOrientation } from '@/lib/a11y/useRovingToolbar';
import DiceTray from '@/components/DiceTray';

function Bar({
  orientation,
  disabled = [],
  count = 4,
}: {
  orientation?: ToolbarOrientation;
  disabled?: number[];
  count?: number;
}) {
  const bar = useRovingToolbar({
    label: 'Bar',
    orientation,
    itemCount: count,
    isDisabled: (i) => disabled.includes(i),
  });
  return (
    <div {...bar.toolbarProps}>
      {Array.from({ length: count }, (_, i) => (
        <button key={i} type="button" {...bar.itemProps(i)} disabled={disabled.includes(i)}>
          b{i}
        </button>
      ))}
    </div>
  );
}

const stops = () => screen.getAllByRole('button').filter((b) => b.getAttribute('tabindex') === '0');
const key = (el: HTMLElement, k: string, mods: object = {}) => fireEvent.keyDown(el, { key: k, ...mods });

describe('useRovingToolbar — the contract', () => {
  it('is a labelled toolbar with its orientation, and exactly one tab stop (the first item)', () => {
    render(<Bar />);
    const tb = screen.getByRole('toolbar', { name: 'Bar' });
    expect(tb).toHaveAttribute('aria-orientation', 'horizontal');
    expect(stops().map((b) => b.textContent)).toEqual(['b0']);
  });

  it('ArrowRight / ArrowLeft move focus and the tab stop, wrapping at both ends', () => {
    render(<Bar />);
    const b = (i: number) => screen.getByRole('button', { name: `b${i}` });
    b(0).focus();
    key(b(0), 'ArrowRight');
    expect(b(1)).toHaveFocus();
    expect(stops()).toEqual([b(1)]);
    key(b(1), 'ArrowLeft');
    key(b(0), 'ArrowLeft'); // wraps to the last
    expect(b(3)).toHaveFocus();
    key(b(3), 'ArrowRight'); // wraps to the first
    expect(b(0)).toHaveFocus();
  });

  it('Home and End jump to the ends', () => {
    render(<Bar />);
    const b = (i: number) => screen.getByRole('button', { name: `b${i}` });
    b(1).focus();
    key(b(1), 'End');
    expect(b(3)).toHaveFocus();
    key(b(3), 'Home');
    expect(b(0)).toHaveFocus();
  });

  it('a horizontal toolbar ignores Up/Down; a vertical one uses them and ignores Left/Right', () => {
    const { unmount } = render(<Bar />);
    const b0 = screen.getByRole('button', { name: 'b0' });
    b0.focus();
    key(b0, 'ArrowDown');
    expect(b0).toHaveFocus();
    unmount();

    render(<Bar orientation="vertical" />);
    const v0 = screen.getByRole('button', { name: 'b0' });
    expect(screen.getByRole('toolbar')).toHaveAttribute('aria-orientation', 'vertical');
    v0.focus();
    key(v0, 'ArrowRight');
    expect(v0).toHaveFocus();
    key(v0, 'ArrowDown');
    expect(screen.getByRole('button', { name: 'b1' })).toHaveFocus();
  });

  it('prevents the default of a key it handles, and leaves other keys and modified arrows alone', () => {
    render(<Bar />);
    const b0 = screen.getByRole('button', { name: 'b0' });
    b0.focus();
    expect(fireEvent.keyDown(b0, { key: 'ArrowRight' })).toBe(false); // preventDefault called
    b0.focus();
    expect(fireEvent.keyDown(b0, { key: 'a' })).toBe(true);
    expect(fireEvent.keyDown(b0, { key: 'ArrowRight', altKey: true })).toBe(true);
    expect(fireEvent.keyDown(b0, { key: 'ArrowRight', shiftKey: true })).toBe(true);
    expect(b0).toHaveFocus();
  });

  it('natively disabled items are stepped over and are never the tab stop', () => {
    render(<Bar disabled={[1, 2]} />);
    const b = (i: number) => screen.getByRole('button', { name: `b${i}` });
    b(0).focus();
    key(b(0), 'ArrowRight');
    expect(b(3)).toHaveFocus();
    key(b(3), 'Home');
    expect(b(0)).toHaveFocus();
  });

  it('when the active item is disabled the first enabled item is the tab stop; all disabled = no stop', () => {
    const { rerender } = render(<Bar disabled={[0]} />);
    expect(stops().map((b) => b.textContent)).toEqual(['b1']);
    rerender(<Bar disabled={[0, 1, 2, 3]} />);
    expect(stops()).toEqual([]);
  });

  it('focus and click on an item make it the tab stop (Safari does not focus a clicked button)', () => {
    render(<Bar />);
    const b = (i: number) => screen.getByRole('button', { name: `b${i}` });
    fireEvent.focus(b(2));
    expect(stops()).toEqual([b(2)]);
    fireEvent.click(b(3));
    expect(stops()).toEqual([b(3)]);
  });

  it('the tab stop survives the item count shrinking under it', () => {
    const { rerender } = render(<Bar count={4} />);
    fireEvent.click(screen.getByRole('button', { name: 'b3' }));
    rerender(<Bar count={2} />);
    expect(stops().map((b) => b.textContent)).toEqual(['b1']);
  });
});

describe('DiceTray — three toolbars, three tab stops (Iro IMPORTANT-2)', () => {
  const CHECKS = [
    { name: 'Perception', skill: 'perception', mod: 3 },
    { name: 'Stealth', skill: 'stealth', mod: -1 },
    { name: 'Sleight of Hand', skill: 'sleight_of_hand', mod: 4 },
  ];

  it('dice + quick checks + advantage = exactly 3 tab stops (was 6 + N + 3)', () => {
    render(<DiceTray onRoll={jest.fn()} quickChecks={CHECKS} onAdvantage={jest.fn()} />);
    expect(screen.getAllByRole('toolbar').map((t) => t.getAttribute('aria-label'))).toEqual([
      'Dice',
      'Quick checks',
      'Roll modifier',
    ]);
    expect(stops()).toHaveLength(3);
  });

  it('orientations: dice and modifier horizontal, quick checks vertical', () => {
    render(<DiceTray onRoll={jest.fn()} quickChecks={CHECKS} onAdvantage={jest.fn()} />);
    expect(screen.getByRole('toolbar', { name: 'Dice' })).toHaveAttribute('aria-orientation', 'horizontal');
    expect(screen.getByRole('toolbar', { name: 'Quick checks' })).toHaveAttribute('aria-orientation', 'vertical');
    expect(screen.getByRole('toolbar', { name: 'Roll modifier' })).toHaveAttribute('aria-orientation', 'horizontal');
  });

  it('arrows walk the dice and a press still rolls what was focused', () => {
    const onRoll = jest.fn();
    render(<DiceTray onRoll={onRoll} onAdvantage={jest.fn()} />);
    const d4 = screen.getByRole('button', { name: 'Roll d4' });
    d4.focus();
    key(d4, 'ArrowRight');
    const d6 = screen.getByRole('button', { name: 'Roll d6' });
    expect(d6).toHaveFocus();
    fireEvent.click(d6);
    expect(onRoll).toHaveBeenCalledWith({ kind: 'die', sides: 6 });
  });

  it('quick checks walk with Up/Down; the advantage pills keep aria-pressed through a roving move', () => {
    const onAdvantage = jest.fn();
    render(<DiceTray onRoll={jest.fn()} quickChecks={CHECKS} advantage="adv" onAdvantage={onAdvantage} />);
    const first = screen.getByRole('button', { name: /Roll Perception check/ });
    first.focus();
    key(first, 'ArrowDown');
    expect(screen.getByRole('button', { name: /Roll Stealth check/ })).toHaveFocus();

    expect(screen.getByRole('button', { name: 'advantage' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'straight' })).toHaveAttribute('aria-pressed', 'false');
    const adv = screen.getByRole('button', { name: 'advantage' });
    adv.focus();
    key(adv, 'ArrowRight');
    expect(screen.getByRole('button', { name: 'straight' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'disadvantage' }));
    expect(onAdvantage).toHaveBeenCalledWith('dis');
  });

  it('disabled tray: the modifier pills still have their tab stop', () => {
    // A9c-2 Iro IMPORTANT-1 moved the dice/checks from native `disabled` to
    // `aria-disabled` (they now keep a tab stop); this pin holds either way.
    render(<DiceTray onRoll={jest.fn()} quickChecks={CHECKS} onAdvantage={jest.fn()} disabled />);
    expect(stops().map((b) => b.getAttribute('aria-label'))).toContain('advantage');
  });
});
