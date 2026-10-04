/**
 * B8c-4 P1b (Sora's phone-mount brief 6.4; the Coordinator addendum, binding) — the action bar's DESCRIBED form. A row that sets `barTurnLine` hands the bar the story's own turn line
 * (`turnLine`): the verbs are then locked with `aria-disabled` and NEVER native `disabled` (a native one is not focusable, so its reason could never be reached), they stay focusable, an activation
 * is swallowed by a guard, and while anything is locked for the turn or for a downed PC they are described by a visually hidden node holding that text, the same variable the story shows.
 * Every other row passes nothing and the bar is what it was: native disabled, no description, no node.
 *
 * Controls: lock() returns the native pair for a described bar -> the "never native" cases red; drop the guard -> the "swallowed" cases red; hasWhy true on your own turn -> the "describes nothing" case reds;
 * the legacy branch described -> the "other rows" cases red.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActionBar, { type ActionBarProps } from '@/app/play/[sessionId]/regions/ActionBar';
import { LAYOUT_ROWS } from '@/app/play/[sessionId]/presets';
import { expectLocked } from '@/test-utils/locked';

const LINE = 'Monster turn — Goblin Skulker';
const move = { pressed: false, disabled: true, onToggle: jest.fn() } as unknown as ActionBarProps['move'];
const props = (over: Partial<ActionBarProps> = {}): ActionBarProps => ({ targets: [{ id: 'm1', name: 'Goblin' }], onAction: jest.fn(), isPlayerTurn: false, ...over });
const VERBS = [/^Attack/, /^Dodge/, /^Dash/, /^End turn/];

describe('the described form: aria-disabled, focusable, described by the story\'s turn line', () => {
  it.each(VERBS)('%s is locked with aria-disabled only, never native, and is described by the turn line', (name) => {
    render(<ActionBar {...props({ turnLine: LINE })} variant="bar" />);
    const btn = screen.getByRole('button', { name });
    expectLocked(btn);
    expect(btn).toHaveAccessibleDescription(LINE);
  });

  it('Move is locked the same way, and described', () => {
    render(<ActionBar {...props({ turnLine: LINE, move })} variant="bar" />);
    const btn = screen.getByRole('button', { name: 'Move' });
    expectLocked(btn);
    expect(btn).toHaveAccessibleDescription(LINE);
  });

  it('a locked verb takes focus (the reason is reachable) and keeps it; the activation is swallowed', () => {
    const onAction = jest.fn();
    render(<ActionBar {...props({ turnLine: LINE, onAction })} variant="bar" />);
    for (const name of VERBS) {
      const btn = screen.getByRole('button', { name });
      btn.focus();
      expect(btn).toHaveFocus();
      fireEvent.click(btn);
    }
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Move is swallowed too: a locked Move never calls onToggle', () => {
    const onToggle = jest.fn();
    render(<ActionBar {...props({ turnLine: LINE, move: { pressed: false, disabled: true, onToggle } as unknown as ActionBarProps['move'] })} variant="bar" />);
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('the description is ONE node with the exact text, visually hidden, not live and not a role', () => {
    const { container } = render(<ActionBar {...props({ turnLine: LINE })} variant="bar" />);
    const nodes = Array.from(container.querySelectorAll('span')).filter((n) => n.textContent === LINE);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].className).toMatch(/srOnly/);
    expect(nodes[0].closest('[aria-live]')).toBeNull();
    expect(nodes[0]).not.toHaveAttribute('role');
    expect(screen.getAllByRole('button').every((b) => b.getAttribute('aria-describedby') === nodes[0].id || !b.getAttribute('aria-describedby'))).toBe(true);
  });

  it('on your own turn the text describes nothing: no node, no describedby, nothing locked', () => {
    const { container } = render(<ActionBar {...props({ turnLine: 'Your turn!', isPlayerTurn: true })} variant="bar" />);
    expect(container.querySelector('[id$="-why"]')).toBeNull();
    for (const name of VERBS) {
      const btn = screen.getByRole('button', { name });
      expect(btn).not.toHaveAttribute('aria-describedby');
      expect(btn).not.toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('a downed PC: Attack, Dodge and Dash are locked and described by the turn line (End turn is not locked)', () => {
    const dying = 'Your turn — you are down. Roll a death save.';
    render(<ActionBar {...props({ turnLine: dying, isPlayerTurn: true, isDying: true, deathSaves: { successes: 0, failures: 0 } })} variant="bar" />);
    for (const name of [/^Attack/, /^Dodge/, /^Dash/]) {
      expectLocked(screen.getByRole('button', { name }));
      expect(screen.getByRole('button', { name })).toHaveAccessibleDescription(dying);
    }
    expect(screen.getByRole('button', { name: /^End turn/ })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('no one acting (turnLine null) still locks by aria-disabled, with nothing to describe it', () => {
    const { container } = render(<ActionBar {...props({ turnLine: null })} variant="bar" />);
    expectLocked(screen.getByRole('button', { name: /^Dodge/ }));
    expect(container.querySelector('[id$="-why"]')).toBeNull();
    expect(screen.getByRole('button', { name: /^Dodge/ })).not.toHaveAttribute('aria-describedby');
  });

  it('an unlocked verb acts through the guard (the positive control: a green table above is not a bar that cannot click)', () => {
    const onAction = jest.fn();
    render(<ActionBar {...props({ turnLine: 'Your turn!', isPlayerTurn: true, onAction })} variant="bar" />);
    fireEvent.click(screen.getByRole('button', { name: /^Dodge/ }));
    fireEvent.click(screen.getByRole('button', { name: /^End turn/ }));
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(['dodge', 'endturn']);
  });
});

describe('every other row: the bar is what it was (no turnLine)', () => {
  it.each(VERBS)('%s is natively disabled with aria-disabled, no description', (name) => {
    const { container } = render(<ActionBar {...props()} variant="bar" />);
    const btn = screen.getByRole('button', { name });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toHaveAttribute('aria-describedby');
    expect(container.querySelector('[id$="-why"]')).toBeNull();
  });
});

describe('the row says it: only the phone row has the described bar', () => {
  it('barTurnLine is the phone row\'s and no other\'s', () => {
    expect(LAYOUT_ROWS.filter((r) => r.barTurnLine === true).map((r) => r.id)).toEqual(['phone']);
  });
});
