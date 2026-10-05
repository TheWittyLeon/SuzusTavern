/**
 * TPK-HOLD, the bar and the turn line while the fight is held (Iro M-1/M-3, Tora M-5/M-7, Kage T-4):
 *  - the four verbs are named "(fight on hold)", not "(not your turn)", and the described form's reason is the held words;
 *  - the rail carries `data-held` beside `data-waiting` (the stylesheet's 11px sentence-case notice hangs on it);
 *  - the Attack menu closes when the turn goes (a tap on it would reach the engine, which refuses);
 *  - the phone's turn line keeps its node, its role and its height while held: the held note is an aria-hidden span INSIDE it.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActionBar from '@/app/play/[sessionId]/regions/ActionBar';
import { TurnStatusTenant } from '@/app/play/[sessionId]/tenants/StatusAnnouncers';

const targets = [{ id: 'g1', name: 'Goblin', hp: 7, maxHp: 7 }] as never;
const bar = (over: Record<string, unknown> = {}) => (
  <ActionBar targets={targets} onAction={jest.fn()} busy={false} isPlayerTurn={false} turnLine={null} {...over} />
);
const VERBS = ['Attack', 'Dodge', 'Dash', 'End turn'];

describe('the four verbs while held', () => {
  it.each(VERBS)('%s: named "(fight on hold)", never "(not your turn)"; its description is the held words', (verb) => {
    render(bar({ held: true }));
    const btn = screen.getByRole('button', { name: new RegExp(`^${verb}`) });
    expect(btn).toHaveAccessibleName(`${verb} (fight on hold)`);
    const why = btn.getAttribute('aria-describedby');
    expect(why).toBeTruthy();
    expect(document.getElementById(why!)).toHaveTextContent('The fight is on hold.');
  });

  it.each(VERBS)('control, a monster\'s turn: %s keeps "(not your turn)"', (verb) => {
    render(bar({ held: false, turnLine: 'Monster turn — Goblin' }));
    expect(screen.getByRole('button', { name: new RegExp(`^${verb}`) })).toHaveAccessibleName(`${verb} (not your turn)`);
  });

  it('the rail is data-held beside data-waiting; a monster\'s turn is data-waiting alone', () => {
    const { rerender } = render(bar({ held: true }));
    const rail = screen.getByRole('group', { name: /your character.s actions/i });
    expect(rail).toHaveAttribute('data-held', 'true');
    expect(rail).toHaveAttribute('data-waiting', 'true');
    rerender(bar({ held: false }));
    expect(rail).not.toHaveAttribute('data-held');
    expect(rail).toHaveAttribute('data-waiting', 'true');
  });

  it('the stylesheet: the held notice is 11px, sentence case, no tracking, and out-ranks nothing it should not (the wait notice keeps its 9px uppercase)', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../components/Composer.module.css'), 'utf8');
    const held = css.match(/\.rail\[data-held='true'\] \.notYourTurn\s*\{[^}]*\}/)?.[0] ?? '';
    expect(held).toMatch(/font-size:\s*11px/);
    expect(held).toMatch(/letter-spacing:\s*0/);
    expect(held).toMatch(/text-transform:\s*none/);
    const wait = css.match(/\.rail\[data-waiting='true'\] \.notYourTurn\s*\{[^}]*\}/)?.[0] ?? '';
    expect(wait).toMatch(/font-size:\s*9px/);
    expect(wait).toMatch(/text-transform:\s*uppercase/);
    // in a narrow bar the wait notice is 11px at the INHERITED leading, so the held notice takes the inherited leading there too (Story 881x700 was 74.5 waiting, 71.5 held: Kage N-3)
    const q = css.slice(css.indexOf('@container (max-width: 560px)'));
    expect(q.match(/\.rail\[data-held='true'\] \.notYourTurn\s*\{[^}]*\}/)?.[0] ?? '').toMatch(/line-height:\s*inherit/);
    // later in the sheet, so equal specificity goes to the held rule
    expect(css.indexOf(".rail[data-held='true'] .notYourTurn")).toBeGreaterThan(css.indexOf(".rail[data-waiting='true'] .notYourTurn {"));
  });
});

describe('the Attack menu goes with the turn (Tora M-5)', () => {
  it('open on your turn; the fight turns held; the menu is gone', () => {
    const { rerender } = render(bar({ isPlayerTurn: true }));
    fireEvent.click(screen.getByRole('button', { name: /^Attack/ }));
    expect(screen.getByRole('menu', { name: /pick a target/i })).toBeInTheDocument();
    rerender(bar({ isPlayerTurn: false, held: true }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('and when the turn simply passes to a monster', () => {
    const { rerender } = render(bar({ isPlayerTurn: true }));
    fireEvent.click(screen.getByRole('button', { name: /^Attack/ }));
    rerender(bar({ isPlayerTurn: false }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('control: it stays open on your own turn', () => {
    const { rerender } = render(bar({ isPlayerTurn: true }));
    fireEvent.click(screen.getByRole('button', { name: /^Attack/ }));
    rerender(bar({ isPlayerTurn: true, busy: false }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});

describe('the phone\'s turn line while held (Tora M-7)', () => {
  const tenant = (over: Record<string, unknown> = {}) => (
    <TurnStatusTenant combatIsActive activeIsMine={false} turnStatusText={null} {...over} />
  );
  it('the held note is an aria-hidden span inside the live node: the line has an element child (so it keeps its height) and announces nothing', () => {
    render(tenant({ held: true }));
    const line = screen.getByRole('status');
    expect(line).toHaveAttribute('aria-live', 'polite');
    const span = line.querySelector('span');
    expect(span).toHaveAttribute('aria-hidden', 'true');
    expect(span).toHaveTextContent('The fight is on hold.');
    expect(line).not.toBeEmptyDOMElement();
    expect(line).not.toHaveAttribute('aria-hidden');
    expect(line).toHaveTextContent('The fight is on hold.'); // painted
    expect(line.textContent).toBe('The fight is on hold.');
  });

  it('the live node is the SAME node, with the same role and attributes, across a monster\'s turn, held, and back', () => {
    const { rerender } = render(tenant({ turnStatusText: 'Monster turn — Goblin' }));
    const line = screen.getByRole('status');
    const attrs = () => [line.getAttribute('role'), line.getAttribute('aria-live'), line.getAttribute('aria-atomic')];
    const before = attrs();
    rerender(tenant({ held: true }));
    expect(screen.getByRole('status')).toBe(line);
    expect(attrs()).toEqual(before);
    rerender(tenant({ turnStatusText: 'Monster turn — Goblin' }));
    expect(screen.getByRole('status')).toBe(line);
    expect(line).toHaveTextContent('Monster turn — Goblin');
    expect(line.querySelector('[aria-hidden]')).toBeNull();
  });

  it('control: not held and no turn text, the node is empty (collapsed by the stylesheet), as before', async () => {
    render(tenant());
    await act(async () => {});
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
