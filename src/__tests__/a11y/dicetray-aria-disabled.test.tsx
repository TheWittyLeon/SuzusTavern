/**
 * A9c-2 Iro IMPORTANT-1 — the DiceTray is `aria-disabled`, never natively
 * `disabled`. Native disabled blurred the focused die on every roll
 * (activeElement -> <body>) and left the roving toolbar with no tab stop until
 * the roll settled. Same pattern as the X-card (A9c-1 C1).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useRovingToolbar } from '@/lib/a11y/useRovingToolbar';
import DiceTray from '@/components/DiceTray';

const CHECKS = [
  { name: 'Perception', skill: 'perception', mod: 3 },
  { name: 'Stealth', skill: 'stealth', mod: 5 },
];
const key = (el: HTMLElement, k: string) => fireEvent.keyDown(el, { key: k });
const tray = (disabled: boolean, onRoll = jest.fn()) => (
  <DiceTray onRoll={onRoll} quickChecks={CHECKS} onAdvantage={jest.fn()} disabled={disabled} />
);

describe('DiceTray disabled model (Iro A9c-1 IMPORTANT-1)', () => {
  it('a disabled tray is aria-disabled and NOT natively disabled; dice and checks keep one tab stop each', () => {
    render(tray(true));
    for (const b of [
      screen.getByRole('button', { name: 'Roll d4' }),
      screen.getByRole('button', { name: /Roll Perception check/ }),
    ]) {
      expect(b).toHaveAttribute('aria-disabled', 'true');
      expect(b).not.toHaveAttribute('disabled');
    }
    const stops = screen.getAllByRole('button').filter((b) => b.getAttribute('tabindex') === '0');
    expect(stops.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Roll d4',
      'Roll Perception check, modifier +3',
      'advantage',
    ]);
  });

  it('a click on an aria-disabled die or check is swallowed (nothing rolls)', () => {
    const onRoll = jest.fn();
    render(tray(true, onRoll));
    fireEvent.click(screen.getByRole('button', { name: 'Roll d20' }));
    fireEvent.click(screen.getByRole('button', { name: /Roll Stealth check/ }));
    expect(onRoll).not.toHaveBeenCalled();
  });

  it('the tray going disabled while a die is focused keeps focus on it', () => {
    const { rerender } = render(tray(false));
    const d8 = screen.getByRole('button', { name: 'Roll d8' });
    d8.focus();
    expect(d8).toHaveFocus();
    rerender(tray(true));
    expect(screen.getByRole('button', { name: 'Roll d8' })).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('an enabled tray has no aria-disabled and still rolls', () => {
    const onRoll = jest.fn();
    render(tray(false, onRoll));
    const d6 = screen.getByRole('button', { name: 'Roll d6' });
    expect(d6).not.toHaveAttribute('aria-disabled');
    fireEvent.click(d6);
    expect(onRoll).toHaveBeenCalledWith({ kind: 'die', sides: 6 });
  });

  it('arrows still walk aria-disabled dice (only native :disabled is skipped)', () => {
    render(tray(true));
    const d4 = screen.getByRole('button', { name: 'Roll d4' });
    d4.focus();
    key(d4, 'ArrowRight');
    expect(screen.getByRole('button', { name: 'Roll d6' })).toHaveFocus();
  });
});

describe('useRovingToolbar keeps aria-disabled items reachable', () => {
  function Bar() {
    const bar = useRovingToolbar({ label: 'Bar', itemCount: 3 });
    return (
      <div {...bar.toolbarProps}>
        {[0, 1, 2].map((i) => (
          <button key={i} type="button" {...bar.itemProps(i)} aria-disabled={i === 1 || undefined}>
            b{i}
          </button>
        ))}
      </div>
    );
  }
  it('ArrowRight lands on the aria-disabled middle item', () => {
    render(<Bar />);
    const b0 = screen.getByRole('button', { name: 'b0' });
    b0.focus();
    key(b0, 'ArrowRight');
    expect(screen.getByRole('button', { name: 'b1' })).toHaveFocus();
  });
});
