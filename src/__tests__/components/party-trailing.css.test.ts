/**
 * A9d-2 fix round N9 (Sora lever brief 2.4; Tora C4, Iro 3) -- the party strip's layout RULES, as text (CSS Modules are identity-mocked under
 * jest and jsdom computes no layout). The measured half is the harness's `u:partyTiles` (the first tile row whole and the trailing controls
 * 44x44 and whole at 5, 6 and 8 members), `w:nestedScroll:party` and `v:scrollCue`.
 *
 * Control: take `overflow-x: auto` off the row -> the scroller case reds (and `u:partyTiles` reds at 8 members: the tiles run under the
 * Session button); put `trailing` in the row's own grid area -> the trailing case reds.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(process.cwd(), 'src/components/PartyPanel.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel: string) => css.match(new RegExp(`(?:^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('the strip: one row of tiles that scrolls sideways, and a trailing column beside it that does not', () => {
  it('the strip is a two-column grid: the row and the label share the first, the trailing controls take the second', () => {
    const r = rule('.strip');
    expect(r).toMatch(/display:\s*grid/);
    expect(r).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/);
    expect(r).toMatch(/grid-template-areas:\s*'main trailing'/);
    expect(rule('.strip > .trailing')).toMatch(/grid-area:\s*trailing/);
    expect(rule('.strip .list')).toMatch(/grid-area:\s*main/);
  });

  it('the tile row is ONE row that scrolls sideways, with an edge fade and no scrollbar', () => {
    const r = rule('.strip .list');
    expect(r).toMatch(/flex-wrap:\s*nowrap/);
    expect(r).toMatch(/overflow-x:\s*auto/);
    expect(r).toMatch(/mask-image:\s*linear-gradient/);
    expect(r).toMatch(/scrollbar-width:\s*none/);
  });

  it('the row is the containing block of the tiles\' visually-hidden words: left to the slot they widen it (scrollWidth 452 in 390 at 8 members) and scroll the band sideways', () => {
    expect(rule('.strip .list')).toMatch(/position:\s*relative/);
  });

  it('the row\'s top padding is the label\'s own height, so a focus caption (above its tile, in the label\'s row) is not clipped by the scroller', () => {
    expect(css).toMatch(/--party-label-h:\s*22px/);
    expect(rule('.strip .list')).toMatch(/padding:\s*var\(--party-label-h\)/);
    expect(rule('.strip > .label')).toMatch(/height:\s*var\(--party-label-h\)/);
  });

  it('the tile\'s focus ring is drawn INSIDE the tile in the strip: a scroller clips an outward ring', () => {
    expect(rule('.strip .link:focus-visible')).toMatch(/outline-offset:\s*calc\(-1 \* var\(--focus-ring-width\)\)/);
  });

  it('at 320px wide and under (a 400% zoom) the row wraps again: WCAG 1.4.10 wants no two-way scroll', () => {
    const i = css.indexOf('@media (max-width: 320px)');
    expect(i).toBeGreaterThan(-1);
    const block = css.slice(i, css.indexOf('}\n}', i) + 2);
    expect(block).toMatch(/\.strip \.list\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(block).toMatch(/overflow:\s*visible/);
    expect(block).toMatch(/mask-image:\s*none/);
  });

  it('and the trailing controls go to the TOP of the cell there: wrapped, a second tile row pushes the bottom below the band\'s 91px edge (320x256: 44x0 of 44x44)', () => {
    const i = css.indexOf('@media (max-width: 320px)');
    const block = css.slice(i, css.indexOf('}\n}', i) + 2);
    expect(block).toMatch(/\.strip > \.trailing\s*\{[^}]*align-self:\s*start/);
    expect(rule('.strip > .trailing')).toMatch(/align-self:\s*end/); // the default, above 320px, stays beside the one row
  });

  it('a rail puts the trailing controls under the roster', () => {
    expect(rule('.rail > .trailing')).toMatch(/margin-top:\s*10px/);
  });
});

// A9d-2 fix round 2 (Tora MINOR-1, Iro Minor-2): the wrapped band at 320px sizes to its content, not to the registry's 91px minimum.
describe('Play.module.css: the party band at 320px and under', () => {
  const play = readFileSync(join(process.cwd(), 'src/app/play/[sessionId]/Play.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('sets --play-party-min to max-content inside the 320px query, so the wrapped rows are not clipped at 91px', () => {
    const i = play.indexOf('@media (max-width: 320px)');
    expect(i).toBeGreaterThan(-1);
    const block = play.slice(i, play.indexOf('\n}\n', i));
    expect(block).toMatch(/\.grid\s*\{[^}]*--play-party-min:\s*max-content/);
  });
  it('and nothing sets it above 320px: the one-row minimum (91px, the registry default) holds for the sideways row', () => {
    const outside = play.replace(/@media \(max-width: 320px\)[\s\S]*?\n\}\n/, '');
    expect(outside).not.toMatch(/--play-party-min/);
  });
});
