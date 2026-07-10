/**
 * CSS-source regression tests for src/app/codex/Codex.module.css.
 *
 * Follows the raw-text-assertion pattern established by
 * src/__tests__/globals-css.test.ts — CSS Modules are identity-mocked under
 * Jest and jsdom does not compute real layout/cascade, so neither the sticky
 * rail's actual background paint nor its actual `flex-direction` at a given
 * viewport width is observable from a component test.
 *
 * History: DDX21-2 (fix pass 2) made the rail's background opaque
 * (--card-solid) and fixed a cascade-order bug so a ≤860px override could
 * actually apply. Fix pass 3 (Aoi-UI live-browser re-verify, 2026-07-05) then
 * REVERTED that ≤860px override entirely: at ~800px it wrapped the per-kind
 * subfilter control onto the same visual row as the last tab ("Conditions"),
 * and its `position: static` made the rail non-sticky — self-defeating the
 * DDX21-2 opaque/sticky fix. The rail is now vertical + sticky + opaque at
 * ALL widths; this suite guards that "vertical-always" contract instead of
 * the old cascade-order one.
 */
import fs from 'fs';
import path from 'path';

describe('Codex.module.css — .rail is vertical + sticky + opaque at ALL widths (DDX21-1 fix pass 3 revert)', () => {
  let cssContent: string;

  beforeAll(() => {
    cssContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/codex/Codex.module.css'),
      'utf8',
    );
  });

  /** The base (unconditional) `.rail { ... }` rule block, as raw text. */
  function baseRailBlock(): string {
    const start = cssContent.indexOf('.rail {');
    expect(start).toBeGreaterThan(-1);
    const end = cssContent.indexOf('\n}', start);
    return cssContent.slice(start, end);
  }

  it('the base .rail rule is sticky, a column flex container, and opaque (--card-solid) — unconditionally, not inside any @media block', () => {
    const railBlock = baseRailBlock();
    expect(railBlock).toContain('position: sticky');
    expect(railBlock).toContain('flex-direction: column');
    expect(railBlock).toContain('background: var(--card-solid)');
  });

  it('never reflows .rail to horizontal/non-sticky at any breakpoint', () => {
    // Regression guard for the fix-pass-3 revert: a ≤860px override used to
    // flip .rail to `flex-direction: row` + `position: static`, which (a)
    // wrapped the subfilter control onto the tab row and (b) made the rail
    // non-sticky, defeating DDX21-2's own fix. Neither declaration should
    // exist anywhere in the stylesheet as actual CSS now (matched with the
    // trailing `;` so this doesn't false-positive on the prose explaining the
    // revert in the comment above, which mentions both phrases without one).
    expect(cssContent).not.toContain('flex-direction: row;');
    expect(cssContent).not.toContain('position: static;');
  });

  it('the ≤860px .body grid collapse (unrelated to rail orientation — stacks the 3-column grid to 1) is untouched', () => {
    const bodyMediaIdx = cssContent.indexOf('@media (max-width: 860px)');
    expect(bodyMediaIdx).toBeGreaterThan(-1);
    const block = cssContent.slice(bodyMediaIdx, cssContent.indexOf('\n}', bodyMediaIdx) + 2);
    expect(block).toContain('.body');
    expect(block).toContain('grid-template-columns: 1fr');
    // And that block must NOT also be the (now-removed) .rail override.
    expect(block).not.toContain('.rail');
  });
});

describe('Codex.module.css — .drawer hidden below 1280px, override AFTER base rule (Aoi re-verify #2 orphan-drawer fix)', () => {
  let cssContent: string;

  beforeAll(() => {
    cssContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/codex/Codex.module.css'),
      'utf8',
    );
  });

  it('base .drawer is a sticky flex container (the wide-viewport detail surface)', () => {
    const idx = cssContent.indexOf('.drawer {');
    expect(idx).toBeGreaterThan(-1);
    const block = cssContent.slice(idx, cssContent.indexOf('\n}', idx));
    expect(block).toContain('display: flex');
    expect(block).toContain('position: sticky');
  });

  it('hides .drawer at <=1280px via an override declared AFTER the base rule so display:none wins the cascade', () => {
    // Orphan-drawer bug (Aoi re-verify #2): the hide override was declared
    // BEFORE the base `.drawer { display: flex }` rule, so at equal specificity
    // the base rule won and an empty drawer rendered below the list at <=1280px
    // (the reachable narrow-width detail surface is CodexDetailModal). The
    // override must come AFTER the base rule — same cascade-order class as .rail.
    const baseIdx = cssContent.indexOf('.drawer {');
    const hideIdx = cssContent.indexOf('display: none', baseIdx);
    expect(hideIdx).toBeGreaterThan(baseIdx);
    const mediaIdx = cssContent.lastIndexOf('@media (max-width: 1280px)', hideIdx);
    expect(mediaIdx).toBeGreaterThan(baseIdx);
  });
});

describe('Codex.module.css — .rows is a bounded internal scroll region, not the window (UIR2-TAV-6)', () => {
  // Before this fix .list/.rows had no height cap at all: a ~319-row catalog
  // (spells) grew the whole center column to 20,000-36,000px, which also grew
  // the CSS Grid row track .drawer's sticky containing block sits in, so the
  // drawer only stayed pinned for a fraction of the page's scroll. Real
  // layout/scroll geometry (which element actually receives scrollIntoView,
  // whether the drawer stays pinned) is not observable in jsdom — see this
  // file's header comment — so this guards the CSS *shape* the live-browser
  // verify already confirmed produces the right runtime behavior, the same
  // pattern the two describe blocks above use for the .rail/.drawer fixes.
  let cssContent: string;

  beforeAll(() => {
    cssContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/codex/Codex.module.css'),
      'utf8',
    );
  });

  function ruleBlock(selector: string): string {
    const start = cssContent.indexOf(`${selector} {`);
    expect(start).toBeGreaterThan(-1);
    const end = cssContent.indexOf('\n}', start);
    return cssContent.slice(start, end);
  }

  it('.list caps its own height and clips — the same viewport-relative budget .drawer already uses, which keeps the shared CSS Grid row track (and therefore .drawer\'s sticky containing block) bounded', () => {
    const block = ruleBlock('.list');
    expect(block).toContain('max-height: calc(100vh - 140px)');
    expect(block).toContain('overflow: hidden');
  });

  it('.listHead never shrinks, so the result count stays pinned above the scrolling rows', () => {
    expect(ruleBlock('.listHead')).toContain('flex-shrink: 0');
  });

  it('.rows (the role="listbox" element scrollRowIntoView targets) is the actual bounded scroll region — not .list itself, which must stay non-scrolling to avoid nested/duplicate scrollbars for the same content', () => {
    const rows = ruleBlock('.rows');
    expect(rows).toContain('flex: 1');
    expect(rows).toContain('min-height: 0');
    expect(rows).toContain('overflow-y: auto');
    const list = ruleBlock('.list');
    expect(list).not.toContain('overflow-y: auto');
    expect(list).not.toContain('overflow: auto');
  });

  it('.row uses content-visibility:auto with a remembered-size ("auto <length>") placeholder, not a bare fixed size that would freeze wrapped multi-chip rows at the wrong height', () => {
    const block = ruleBlock('.row');
    expect(block).toContain('content-visibility: auto');
    expect(block).toMatch(/contain-intrinsic-size:\s*auto\s+\d+px/);
  });
});
