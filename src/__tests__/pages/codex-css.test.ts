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
