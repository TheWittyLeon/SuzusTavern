/**
 * A9c C5 — useRovingToolbar (build brief §4.2, Iro IMPORTANT-2).
 * The hook's contract, then DiceTray's three toolbars end to end.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useRovingToolbar, type ToolbarOrientation } from '@/lib/a11y/useRovingToolbar';
import DiceTray from '@/components/DiceTray';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

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

  it('natively disabled items are stepped over by the arrow keys and Home', () => {
    render(<Bar disabled={[1, 2]} />);
    const b = (i: number) => screen.getByRole('button', { name: `b${i}` });
    b(0).focus();
    key(b(0), 'ArrowRight');
    expect(b(3)).toHaveFocus();
    key(b(3), 'Home');
    expect(b(0)).toHaveFocus();
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

  it('orientations: modifier horizontal, quick checks vertical, dice (a 3x2 grid) state none', () => {
    render(<DiceTray onRoll={jest.fn()} quickChecks={CHECKS} onAdvantage={jest.fn()} />);
    expect(screen.getByRole('toolbar', { name: 'Dice' })).not.toHaveAttribute('aria-orientation'); // MINOR-2: a grid has no single axis
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

describe('useRovingToolbar — a 2D grid (`columns`, Iro A9c-1 MINOR-2)', () => {
  function Grid({ disabled = [] as number[] }) {
    const bar = useRovingToolbar({ label: 'Grid', itemCount: 6, columns: 3 });
    return (
      <div {...bar.toolbarProps}>
        {Array.from({ length: 6 }, (_, i) => (
          <button key={i} type="button" {...bar.itemProps(i)} disabled={disabled.includes(i)}>
            g{i}
          </button>
        ))}
      </div>
    );
  }
  const g = (i: number) => screen.getByRole('button', { name: `g${i}` });

  it('states no single orientation: a 2D grid is neither horizontal nor vertical', () => {
    render(<Grid />);
    expect(screen.getByRole('toolbar', { name: 'Grid' })).not.toHaveAttribute('aria-orientation');
  });

  it('ArrowDown/ArrowUp move one ROW (g0 <-> g3, g2 <-> g5) and the tab stop follows', () => {
    render(<Grid />);
    g(0).focus();
    key(g(0), 'ArrowDown');
    expect(g(3)).toHaveFocus();
    expect(stops()).toEqual([g(3)]);
    key(g(3), 'ArrowUp');
    expect(g(0)).toHaveFocus();
    g(2).focus();
    key(g(2), 'ArrowDown');
    expect(g(5)).toHaveFocus();
  });

  it('stops at the first and last row (no wrap), the key is still consumed, and Left/Right still wrap through the items', () => {
    render(<Grid />);
    g(4).focus();
    const down = fireEvent.keyDown(g(4), { key: 'ArrowDown' });
    expect(down).toBe(false); // preventDefault: the page does not scroll
    expect(g(4)).toHaveFocus();
    g(1).focus();
    key(g(1), 'ArrowUp');
    expect(g(1)).toHaveFocus();
    g(5).focus();
    key(g(5), 'ArrowRight');
    expect(g(0)).toHaveFocus();
  });

  it('a natively disabled item in the target row is not entered', () => {
    render(<Grid disabled={[3]} />);
    g(0).focus();
    key(g(0), 'ArrowDown');
    expect(g(0)).toHaveFocus();
  });

  it('a one-axis toolbar still ignores Up/Down (no `columns`, no row step)', () => {
    render(<Bar />);
    const b0 = screen.getByRole('button', { name: 'b0' });
    b0.focus();
    key(b0, 'ArrowDown');
    expect(b0).toHaveFocus();
  });
});

describe('DiceTray — the dice are a 3x2 grid with row keys', () => {
  it('ArrowDown from d4 lands on d10, ArrowUp returns; one source for the column count', () => {
    render(<DiceTray onRoll={() => {}} />);
    const die = (n: number) => screen.getByRole('button', { name: `Roll d${n}` });
    die(4).focus();
    key(die(4), 'ArrowDown');
    expect(die(10)).toHaveFocus();
    key(die(10), 'ArrowUp');
    expect(die(4)).toHaveFocus();
    const grid = screen.getByRole('toolbar', { name: 'Dice' });
    expect(grid.style.getPropertyValue('--dice-columns')).toBe('3');
  });
});

describe('DiceTray — a row that asks for one row of six (A9d-2, Tora A9d-1 MAJOR-1)', () => {
  const realGCS = window.getComputedStyle.bind(window);
  afterEach(() => jest.restoreAllMocks());

  const sixAcross = () =>
    jest.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const cs = realGCS(el, pseudo);
      if (el instanceof HTMLElement && el.getAttribute('role') === 'toolbar' && el.getAttribute('aria-label') === 'Dice') {
        return new Proxy(cs, { get: (t, k) => (k === 'gridTemplateColumns' ? '50px 50px 50px 50px 50px 50px' : Reflect.get(t, k)) });
      }
      return cs;
    });

  it('the keys follow the RESOLVED column count: with six across, ArrowDown has no row to step to (d4 stays), Left/Right still walk', () => {
    sixAcross();
    render(<DiceTray onRoll={() => {}} />);
    const die = (n: number) => screen.getByRole('button', { name: `Roll d${n}` });
    die(4).focus();
    key(die(4), 'ArrowDown');
    expect(die(4)).toHaveFocus(); // at 3 columns this lands on d10
    key(die(4), 'ArrowRight');
    expect(die(6)).toHaveFocus();
    key(die(6), 'End');
    expect(die(20)).toHaveFocus();
  });

  it('control: unresolved (jsdom) keeps three columns, so ArrowDown still steps a row', () => {
    render(<DiceTray onRoll={() => {}} />);
    const die = (n: number) => screen.getByRole('button', { name: `Roll d${n}` });
    die(4).focus();
    key(die(4), 'ArrowDown');
    expect(die(10)).toHaveFocus();
  });

  // A9d-2 N7 (named exception, with play-preset-registry's `--play-dice-columns`): no row sets the dice count any more (the phone's dice are in
  // the Roll popover). The tray reads its own `--dice-columns` (3); the popover sizes itself (six across, three by two at 340px and under).
  it('the stylesheet gives the tray its three columns, the popover six (three by two at 340px and under), and never lets a chip fall under 44px for the gap', () => {
    const css = readFileSync(resolvePath(process.cwd(), 'src/components/DiceTray.module.css'), 'utf8');
    expect(css).toMatch(/--dice-cols:\s*var\(--dice-columns,\s*3\)/);
    expect(css).not.toMatch(/--play-dice-columns\s*[,)]/);
    expect(css).toMatch(/\.diceGridPopover\s*\{\s*--dice-cols:\s*6;[^}]*grid-template-columns:\s*repeat\(var\(--dice-cols\),\s*minmax\(44px,\s*1fr\)\);\s*column-gap:\s*8px;\s*\}/);
    expect(css).toMatch(/@media \(max-width: 340px\)\s*\{\s*\.diceGridPopover\s*\{\s*--dice-cols:\s*3;/);
    expect(css).toMatch(/grid-template-columns:\s*repeat\(var\(--dice-cols\),\s*1fr\)/);
    expect(css).toMatch(/column-gap:\s*clamp\(1px,\s*calc\(\(100% - var\(--dice-cols\) \* 44px\) \/ \(var\(--dice-cols\) - 1\)\),\s*8px\)/);
  });
});
