/**
 * A10 step 11 round 4 (TAV-STORY-BAR-MONSTER-TURN, Aoi): the action bar is ONE HEIGHT on both turns. On a monster's turn the wait notice REPLACES the kicker's text in the kicker's own
 * place and adds no row (it was a line of its own: +25px in Table, +120px in Story at 1280 wide, where the verbs wrapped too). jsdom has no layout: this pins the structure and the stylesheet;
 * the geometry is the harness's `m:barHeight` (the bar within 1px across the two turns, every desktop size).
 *
 * Controls: render the notice outside the bar group -> the "inside the group" case reds; drop `data-waiting` -> the attribute case reds; delete the kicker's display:none rule -> the CSS case reds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActionBar, { type ActionBarProps } from '@/app/play/[sessionId]/regions/ActionBar';

const props = (over: Partial<ActionBarProps> = {}): ActionBarProps => ({ targets: [{ id: 'm1', name: 'Goblin' }], onAction: jest.fn(), isPlayerTurn: true, ...over });

describe('the monster\'s turn takes no height', () => {
  it.each(['chips', 'bar'] as const)('%s: the bar says it is waiting (the stylesheet swaps the kicker for the notice), the group keeps its name, and the notice is a polite live region INSIDE the group', (variant) => {
    const { container } = render(<ActionBar {...props({ isPlayerTurn: false })} variant={variant} />);
    const rail = container.firstElementChild as HTMLElement;
    expect(rail).toHaveAttribute('data-waiting', 'true');
    expect(screen.getByRole('group', { name: /Your character.s actions/ })).toBe(rail);
    const notice = screen.getByText('Waiting for your turn…');
    expect(rail).toContainElement(notice);
    expect(notice).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText(/Your character.s actions/)).toBeInTheDocument(); // still in the tree: it names the group
  });

  it('on the player\'s own turn there is no notice and no waiting mark', () => {
    const { container } = render(<ActionBar {...props()} variant="chips" />);
    expect(container.firstElementChild).not.toHaveAttribute('data-waiting');
    expect(screen.queryByText('Waiting for your turn…')).toBeNull();
  });
});

describe('Composer.module.css: the notice takes the kicker\'s place in a wide slot and keeps its own line in a narrow one', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Composer.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel: string, from = 0) => {
    const at = css.indexOf(`${sel} {`, from);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };
  it('wide: the kicker steps aside (display: none) and the notice takes its typography with no padding and no extra margin', () => {
    expect(rule(".rail[data-waiting='true'] .railLabel")).toMatch(/display:\s*none/);
    const n = rule(".rail[data-waiting='true'] .notYourTurn");
    expect(n).toMatch(/font-size:\s*9px/);
    expect(n).toMatch(/text-transform:\s*uppercase/);
    expect(n).toMatch(/padding:\s*0;/);
  });

  // B8c-4 P1b (named exception: the two narrow cases below were "the notice is the line it always was" and "every property the wide rule sets is set back"): in the narrow form the notice is NOT A ROW
  // (Sora's phone-mount brief 6.4). It was a 24.5px line that made the phone's bar taller on a monster's turn. It stays in the tree, visually hidden. What pins it now: this case, the next, and the
  // harness's p:barHeight (the bar's height equal across the two turns at every phone size).
  it('narrow (a container query): the kicker is back (it is clipped by its own rule there) and, in the DESCRIBED form only, the notice is visually hidden: out of flow, 1px, clipped, NOT a row', () => {
    const from = css.indexOf('@container (max-width: 560px)');
    expect(from).toBeGreaterThan(0);
    expect(rule(".rail[data-waiting='true'] .railLabel", from)).toMatch(/display:\s*block/);
    const n = rule(".rail[data-waiting='true'][data-described='true'] .notYourTurn", from);
    expect(n).toMatch(/position:\s*absolute/);
    expect(n).toMatch(/width:\s*1px/);
    expect(n).toMatch(/height:\s*1px/);
    expect(n).toMatch(/clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
    expect(n).toMatch(/overflow:\s*hidden/);
    expect(n).toMatch(/flex:\s*none/);
    // the hiding rule is keyed by the row's flag: no rule hides the notice by width alone
    const plain = rule(".rail[data-waiting='true'] .notYourTurn", from);
    expect(plain).not.toMatch(/position:\s*absolute/);
    expect(plain).not.toMatch(/clip:/);
  });

  it('a locked (aria-disabled) verb takes no iOS tap highlight: a native disabled button never flashed, an aria-disabled one does (Tora MINOR-5)', () => {
    expect(css).toMatch(/\.action\[aria-disabled='true'\]\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent/);
  });

  it('narrow, NOT described (Story between 881 and 920px; every row but the phone\'s): the notice keeps its own line, as before the phone mount (Kage I-2)', () => {
    const from = css.indexOf('@container (max-width: 560px)');
    const plain = rule(".rail[data-waiting='true'] .notYourTurn", from);
    expect(plain).toMatch(/font-size:\s*11px/);
    expect(plain).toMatch(/padding:\s*2px 0 6px/);
    expect(plain).toMatch(/flex:\s*1 0 100%/);
  });

  it('the rail is marked `data-described` exactly when the row gives the bar a turn line; a bar with none has no such attribute (every other row\'s markup is what it was)', () => {
    const described = render(<ActionBar {...props({ isPlayerTurn: false, turnLine: 'Monster turn — Goblin' })} variant="bar" />);
    expect(described.container.firstElementChild).toHaveAttribute('data-described', 'true');
    described.unmount();
    const plain = render(<ActionBar {...props({ isPlayerTurn: false })} variant="bar" />);
    expect(plain.container.firstElementChild).not.toHaveAttribute('data-described');
  });

  it('narrow: the notice is in the DOM and still a polite live region (visually hidden, not removed), so it keeps announcing and stays the verbs\' description in the tree', () => {
    render(<ActionBar {...props({ isPlayerTurn: false })} variant="bar" />);
    const notice = screen.getByText('Waiting for your turn…');
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveAttribute('aria-live', 'polite');
  });
});
