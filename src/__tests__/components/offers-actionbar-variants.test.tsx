/**
 * A9c-2 D2 (build brief 6) -- `offers` consumes `chips` / `list` and `actionBar`
 * consumes `chips` / `bar`. A presentational pair each: same elements, same
 * accessible names, same live regions; only the layout class and `data-variant`
 * differ. The real-geometry half is the harness (story·exploring offers row,
 * story·combat bar row).
 */
import { createRef } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import Offers, { type OffersProps } from '@/app/play/[sessionId]/regions/Offers';
import ActionBar, { type ActionBarProps } from '@/app/play/[sessionId]/regions/ActionBar';
import { LAYOUT_ROWS_BY_ID, variantFor } from '@/app/play/[sessionId]/presets';
import { deathSaveTally } from '@/app/play/[sessionId]/format';
import type { SceneCheck, SceneTransition } from '@/lib/api/types';

const checks = [
  { skill: 'perception', dc: 13, state: 'available' },
  { skill: 'investigation', dc: 15, state: 'locked', lock_reason: 'nat1' },
] as unknown as SceneCheck[];
const transitions = [{ to: 'stair', label: 'Descend the broken stair' }] as unknown as SceneTransition[];

const offersProps = (over: Partial<OffersProps> = {}): OffersProps => ({
  availableChecks: checks,
  offeredCheckSkill: 'perception',
  checkBusy: false,
  talking: false,
  sessionLocked: false,
  onAttemptCheck: jest.fn(),
  checkWrapRef: createRef<HTMLDivElement>(),
  freeformOfferedCheck: 'stealth',
  freeformCheckRef: createRef<HTMLDivElement>(),
  rollBusy: false,
  combatBusy: false,
  onRoll: jest.fn(),
  availableTransitions: transitions,
  adventureComplete: false,
  transitionWrapRef: createRef<HTMLDivElement>(),
  sceneAdvanceBusy: false,
  onMoveOn: jest.fn(),
  ...over,
});

const barProps = (over: Partial<ActionBarProps> = {}): ActionBarProps => ({
  targets: [{ id: 'm1', name: 'Goblin Skulker' }],
  onAction: jest.fn(),
  isPlayerTurn: true,
  ...over,
});

describe('Offers consumes its variant', () => {
  it('stamps data-variant; chips and list render different markup', () => {
    const list = render(<Offers {...offersProps()} variant="list" />);
    expect(list.container.firstElementChild).toHaveAttribute('data-variant', 'list');
    const listHtml = list.container.innerHTML;
    list.unmount();
    const chips = render(<Offers {...offersProps()} variant="chips" />);
    expect(chips.container.firstElementChild).toHaveAttribute('data-variant', 'chips');
    expect(chips.container.innerHTML).not.toBe(listHtml);
  });

  it('chips carries the layout class (and only chips); the class has a rule', () => {
    const chips = render(<Offers {...offersProps()} variant="chips" />);
    expect(chips.container.firstElementChild).toHaveClass('offersChips');
    chips.unmount();
    const list = render(<Offers {...offersProps()} variant="list" />);
    expect(list.container.firstElementChild).not.toHaveClass('offersChips');
    // jsdom ignores CSS Modules: a class with no rule would pass every DOM test and style nothing
    expect(readFileSync(join(process.cwd(), 'src/app/play/[sessionId]/Play.module.css'), 'utf8')).toMatch(/^\.offersChips \{/m);
  });

  it('rows is chips plus the scrolling-row layer; both classes have a rule, and the scroll is fit-class only (A9d-1 lever 1)', () => {
    const rows = render(<Offers {...offersProps()} variant="rows" />);
    expect(rows.container.firstElementChild).toHaveAttribute('data-variant', 'rows');
    expect(rows.container.firstElementChild).toHaveClass('offersChips', 'offersRows');
    // the same groups and every chip, in the same DOM order as chips: a scroll container changes where a chip
    // is painted, never whether it is a tab stop
    const names = (el: Element) => Array.from(el.querySelectorAll('button')).map((b) => b.textContent);
    const rowNames = names(rows.container);
    rows.unmount();
    const chips = render(<Offers {...offersProps()} variant="chips" />);
    expect(chips.container.firstElementChild).not.toHaveClass('offersRows');
    expect(names(chips.container)).toEqual(rowNames);
    const css = readFileSync(join(process.cwd(), 'src/app/play/[sessionId]/Play.module.css'), 'utf8');
    const block = css.slice(css.indexOf('@media (min-width: 321px) {\n  .offersRows'));
    // 1.4.10: the scrolling row exists ONLY above 320px of width (a 400% zoom of a 1280px page keeps the wrapped chips and scrolls the
    // page, never a row of its own). A9d-2 N5 (named exception): it was gated on `min-height: 701px`, the harness's fit/reflow line, which
    // has nothing to do with two-way scroll; its own reason is width.
    expect(block.startsWith('@media (min-width: 321px) {')).toBe(true);
    expect(css).not.toMatch(/@media \(min-height: 701px\) \{\n  \.offersRows/);
    expect(block).toMatch(/\.offersRows \.checkWrap,\n\s+\.offersRows \.moveOnWrap \{[^}]*overflow-x: auto;/);
    expect(block).toMatch(/mask-image: linear-gradient\(to right/);
    // the clipping row leaves the focus ring its room and pays for it with an equal negative margin
    expect(block).toMatch(/margin-block: calc\(-1 \* var\(--focus-ring-clearance\)\)/);
    expect(block).toMatch(/min-width: 0/);
  });

  it('defaults to list, the markup the region always rendered', () => {
    const { container } = render(<Offers {...offersProps()} />);
    expect(container.firstElementChild).toHaveAttribute('data-variant', 'list');
  });

  it.each(['chips', 'list', 'rows'] as const)('%s: the same groups and buttons are present by accessible name (A13)', (variant) => {
    render(<Offers {...offersProps()} variant={variant} />);
    // two "Skill check" groups (authored + the freeform offer, told apart by suffix) and one transition group
    expect(screen.getByRole('group', { name: 'Skill check' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Skill check: Stealth' })).toBeInTheDocument();
    const move = screen.getByRole('group', { name: 'Scene transition' });
    expect(within(move).getByRole('button', { name: /Descend the broken stair/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Attempt Perception, DC 13/ })).toBeInTheDocument();
    // the locked check stays Tab-reachable (aria-disabled, not native disabled) with its reason
    const locked = screen.getByRole('button', { name: /Investigation, DC 15 — closed/ });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(locked).not.toBeDisabled();
  });
});

describe('ActionBar consumes its variant', () => {
  it('stamps data-variant; chips and bar render different markup', () => {
    const bar = render(<ActionBar {...barProps()} variant="bar" />);
    expect(bar.container.firstElementChild).toHaveAttribute('data-variant', 'bar');
    const barHtml = bar.container.innerHTML;
    bar.unmount();
    const chips = render(<ActionBar {...barProps()} variant="chips" />);
    expect(chips.container.firstElementChild).toHaveAttribute('data-variant', 'chips');
    expect(chips.container.innerHTML).not.toBe(barHtml);
  });

  it('chips carries the layout class (and only chips); the class has a rule', () => {
    const chips = render(<ActionBar {...barProps()} variant="chips" />);
    expect(chips.container.firstElementChild).toHaveClass('railChips');
    chips.unmount();
    const bar = render(<ActionBar {...barProps()} variant="bar" />);
    expect(bar.container.firstElementChild).not.toHaveClass('railChips');
    expect(readFileSync(join(process.cwd(), 'src/components/Composer.module.css'), 'utf8')).toMatch(/^\.railChips \{/m);
  });

  it('defaults to bar', () => {
    const { container } = render(<ActionBar {...barProps()} />);
    expect(container.firstElementChild).toHaveAttribute('data-variant', 'bar');
  });

  it.each(['chips', 'bar'] as const)('%s: the group name, four actions and the turn live region are all still there (R3)', (variant) => {
    const { container } = render(<ActionBar {...barProps({ isPlayerTurn: false })} variant={variant} />);
    expect(screen.getByRole('group', { name: /Your character.s actions/ })).toBeInTheDocument();
    for (const n of [/^Attack/, /^Dodge/, /^Dash/, /^End turn/]) {
      expect(screen.getByRole('button', { name: n })).toBeInTheDocument();
    }
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByText('Waiting for your turn…')).toBeInTheDocument();
  });
});

describe('the rows place offers and actionBar as chips or list/bar (what page.tsx reads through variantFor)', () => {
  it('story: chips for both; table: list + bar; phone: offers rows + bar', () => {
    const { story, table, phone } = LAYOUT_ROWS_BY_ID;
    expect(variantFor(story, 'offers', 'exploring')).toBe('chips');
    expect(variantFor(story, 'actionBar', 'combat')).toBe('chips');
    expect(variantFor(table, 'offers', 'exploring')).toBe('list');
    expect(variantFor(table, 'actionBar', 'combat')).toBe('bar');
    expect(variantFor(phone, 'offers', 'exploring')).toBe('rows');
    expect(variantFor(phone, 'actionBar', 'combat')).toBe('bar');
  });
});

describe('deathSaveTally (the page.tsx mapping, moved to format.ts to pay the ratchet)', () => {
  it('maps the tally and is null without one', () => {
    expect(deathSaveTally({ death_saves: { successes: 2, failures: 1, is_downed: true, is_dying: true, is_stable: false, is_dead: false } })).toEqual({ successes: 2, failures: 1 });
    expect(deathSaveTally({})).toBeNull();
    expect(deathSaveTally(null)).toBeNull();
    expect(deathSaveTally(undefined)).toBeNull();
  });
});
