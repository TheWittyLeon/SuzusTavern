/**
 * CSS-source regression tests for src/app/codex/Codex.module.css.
 *
 * Follows the raw-text-assertion pattern established by
 * src/__tests__/globals-css.test.ts — CSS Modules are identity-mocked under
 * Jest and jsdom does not compute real layout/cascade, so neither the sticky
 * rail's actual background paint nor its actual `flex-direction` at a given
 * viewport width is observable from a component test. The geometry itself is
 * measured live by tools/ui-audit's probes (slab, ink-clip), which run on
 * every capture.
 *
 * History: DDX21-2 made the rail opaque (--card-solid) so list content could
 * not bleed through it once sticky. Fix pass 3 (2026-07-05) reverted a ≤860px
 * horizontal reflow that wrapped the subfilter onto the tab row, and kept the
 * rail vertical + sticky + opaque at all widths. CODEX-RAIL-SLAB (2026-09-18)
 * removed the fill: it painted a lighter slab over the aurora in every
 * palette and occluded nothing (multi-column never sticks; single column's
 * content-visibility rows paint over the rail regardless). Sticky is now
 * guarded by min-width (order-independent, like CharacterCreate's rail), so
 * the single-column rail scrolls away instead of pinning 550px of a phone
 * screen. It stays vertical at all widths; that is the part of fix pass 3
 * this suite still guards.
 */
import fs from 'fs';
import path from 'path';

describe('Codex.module.css — .rail is vertical everywhere, sticky only in multi-column (min-width guard), never an opaque slab (CODEX-RAIL-SLAB)', () => {
  let cssContent: string;

  beforeAll(() => {
    cssContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/codex/Codex.module.css'),
      'utf8',
    );
  });

  /** Every `.rail { ... }` rule block (base + @media overrides), as raw text. */
  function railBlocks(): { idx: number; text: string }[] {
    const out: { idx: number; text: string }[] = [];
    for (let i = cssContent.indexOf('.rail {'); i !== -1; i = cssContent.indexOf('.rail {', i + 1)) {
      out.push({ idx: i, text: cssContent.slice(i, cssContent.indexOf('}', i)) });
    }
    return out;
  }

  it('the base .rail rule is a column flex container and sets no position (so no source-order override is needed below 861px)', () => {
    const [base] = railBlocks();
    expect(base.text).toContain('flex-direction: column');
    expect(base.text).not.toMatch(/position\s*:/);
  });

  it('no .rail rule paints a background at any width (the design system .comp-rail has none; the plane shows through)', () => {
    for (const { text } of railBlocks()) {
      expect(text).not.toMatch(/background(-color)?\s*:/);
    }
  });

  it('never reflows .rail to horizontal at any breakpoint (fix pass 3 guard)', () => {
    // A ≤860px override once flipped .rail to `flex-direction: row`, which
    // wrapped the subfilter control onto the tab row. Matched with the
    // trailing `;` so prose in comments cannot false-positive.
    expect(cssContent).not.toContain('flex-direction: row;');
  });

  it('sticky lives ONLY inside @media (min-width: 861px) — mutually exclusive with the ≤860px single-column layout, so source order cannot matter', () => {
    const sticky = railBlocks().filter((b) => b.text.includes('position: sticky'));
    expect(sticky).toHaveLength(1);
    const mediaIdx = cssContent.lastIndexOf('@media', sticky[0].idx);
    expect(cssContent.slice(mediaIdx, sticky[0].idx)).toContain('@media (min-width: 861px)');
    // No max-width override un-sticking it (the order-dependent shape).
    expect(cssContent).not.toContain('position: static;');
  });

  it('the ≤860px .body grid collapse (stacks the 3-column grid to 1) is untouched and contains no .rail rule', () => {
    const bodyMediaIdx = cssContent.indexOf('@media (max-width: 860px)');
    expect(bodyMediaIdx).toBeGreaterThan(-1);
    const block = cssContent.slice(bodyMediaIdx, cssContent.indexOf('\n}', bodyMediaIdx) + 2);
    expect(block).toContain('.body');
    expect(block).toContain('grid-template-columns: 1fr');
    expect(block).not.toContain('.rail');
  });
});

describe('Codex.module.css — row rings are never clipped by the list scroller (CODEX-RING-CLIP)', () => {
  let cssContent: string;
  let globals: string;

  beforeAll(() => {
    cssContent = fs.readFileSync(path.resolve(process.cwd(), 'src/app/codex/Codex.module.css'), 'utf8');
    globals = fs.readFileSync(path.resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
  });

  function ruleBlock(selector: string): string {
    const start = cssContent.indexOf(`${selector} {`);
    expect(start).toBeGreaterThan(-1);
    return cssContent.slice(start, cssContent.indexOf('\n}', start));
  }

  it('the clearance token is DERIVED from ring width + offset, never a hand-summed literal', () => {
    expect(globals).toMatch(/--focus-ring-clearance:\s*calc\(var\(--focus-ring-width\) \+ var\(--focus-ring-offset\)\)/);
  });

  it('.rows reserves the full ring extent on all four sides, and as scroll-padding for scrollIntoView', () => {
    const rows = ruleBlock('.rows');
    expect(rows).toMatch(/\n\s*padding: var\(--focus-ring-clearance\);/);
    expect(rows).toContain('scroll-padding-block: var(--focus-ring-clearance)');
  });

  it('the virtual-focus ring draws only while the listbox has focus (no ring on row 0 at rest), gated on :focus not :focus-visible', () => {
    expect(cssContent).not.toMatch(/(^|\n)\.rowFocused \{/);
    // :focus-visible stays false in Firefox after a mouse click even while the
    // user arrows through the list, so gating on it hides the only indicator.
    expect(cssContent).not.toContain('.rows:focus-visible .rowFocused');
    const gated = ruleBlock('.rows:focus .rowFocused');
    expect(gated).toContain('outline: var(--focus-ring-width) solid var(--accent)');
    expect(gated).toContain('outline-offset: var(--focus-ring-offset)');
  });

  it('the listbox container draws no ring of its own (it would be clipped by .list and double the row ring)', () => {
    expect(ruleBlock('.rows:focus-visible')).toContain('outline: none');
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
