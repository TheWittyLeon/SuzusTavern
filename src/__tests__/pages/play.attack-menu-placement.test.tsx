/**
 * TAV-PLAY-SHELL A9c-1 C2 (build brief §1, Amendment C.7) — the Attack target
 * menu escapes the actionBar slot.
 *
 * `.slot` clips (`overflow-y:auto`), and the menu was `position:absolute;
 * bottom:calc(100% + 6px)`: it landed in negative overflow and was invisible
 * in every combat cell since A9b (measured by harness check (g) at f2168da:
 * popup 220x102, visible 220x0). The browser harness is the real pin; jsdom
 * has no layout, so this file pins the two halves it CAN see:
 *   1. the stylesheet: `.pop` is `position:fixed`, never `absolute`;
 *   2. the component: the menu is placed from the Attack button's rect
 *      (inline left/bottom/maxHeight), re-placed on resize, clamped into the
 *      viewport, and stays INSIDE the rail in the DOM (focus/Escape pins).
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActionBar from '@/app/play/[sessionId]/regions/ActionBar';

const TARGETS = [{ id: 'g1', name: 'Goblin', hp: 7, maxHp: 7 }];

function stubRect(el: Element, rect: Partial<DOMRect>) {
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {}, ...rect }) as DOMRect;
}

function setViewport(w: number, h: number) {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: w });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: h });
}

afterEach(() => {
  // jsdom defaults: 0 -- drop the overrides so other suites in this worker are unaffected.
  delete (document.documentElement as unknown as Record<string, unknown>).clientWidth;
  delete (document.documentElement as unknown as Record<string, unknown>).clientHeight;
});

describe('A9c C2 — .pop stylesheet', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Composer.module.css'), 'utf8');
  const start = css.indexOf('\n.pop {');
  const rule = css.slice(start, css.indexOf('}', start));

  it('.pop is position:fixed (escapes the clipping slot), never absolute', () => {
    expect(start).toBeGreaterThan(-1);
    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).not.toMatch(/position:\s*absolute/);
  });

  it('.pop no longer anchors itself with bottom/left (the component places it)', () => {
    expect(rule).not.toMatch(/\bbottom:\s*calc/);
  });
});

describe('A9c C2 — ActionBar places the menu from the Attack button rect', () => {
  function open(rect: Partial<DOMRect>) {
    setViewport(1440, 900);
    render(<ActionBar targets={TARGETS} onAction={jest.fn()} isPlayerTurn />);
    const attack = screen.getByRole('button', { name: 'Attack' });
    stubRect(attack, rect);
    fireEvent.click(attack);
    return { attack, menu: screen.getByRole('menu') };
  }

  it('opens upward: bottom = viewport height - button top + gap; left = button left', () => {
    const { menu } = open({ top: 837, left: 183 });
    expect(menu.style.bottom).toBe('69px'); // 900 - 837 + 6
    expect(menu.style.left).toBe('183px');
    expect(menu.style.maxHeight).toBe('825px'); // 837 - 12
  });

  it('stays inside the rail in the DOM (focus, Escape and arrow-key pins hold)', () => {
    const { menu } = open({ top: 837, left: 183 });
    expect(menu.closest('[data-region="actionBar"]')).not.toBeNull();
  });

  it('clamps into the viewport when the button sits against the right edge', () => {
    setViewport(400, 900);
    render(<ActionBar targets={TARGETS} onAction={jest.fn()} isPlayerTurn />);
    const attack = screen.getByRole('button', { name: 'Attack' });
    stubRect(attack, { top: 800, left: 390 });
    fireEvent.click(attack);
    const menu = screen.getByRole('menu');
    stubRect(menu, {});
    Object.defineProperty(menu, 'offsetWidth', { configurable: true, value: 220 });
    // Re-place now that the menu has a measurable width.
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(menu.style.left).toBe('174px'); // 400 - 220 - 6
  });

  it('re-places on resize', () => {
    const { attack, menu } = open({ top: 837, left: 183 });
    stubRect(attack, { top: 500, left: 183 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(menu.style.bottom).toBe('406px'); // 900 - 500 + 6
  });
});
