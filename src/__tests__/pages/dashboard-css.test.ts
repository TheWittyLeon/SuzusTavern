/**
 * CSS-source regression tests for src/app/dashboard/Dashboard.module.css.
 *
 * Follows the raw-text-assertion pattern established by
 * src/__tests__/pages/codex-css.test.ts / src/__tests__/globals-css.test.ts —
 * CSS Modules are identity-mocked under Jest and jsdom does not compute real
 * layout/cascade, so a component test can't observe how many lines
 * `.campaignName` actually renders at a given viewport width.
 *
 * UIR2-TAV-15: the base `.campaignName` rule forces a single-line ellipsis
 * (`white-space: nowrap` + `text-overflow: ellipsis`) unconditionally. At
 * 390px that track is squeezed by the Open + delete buttons to the point
 * where only ~14 characters render before the ellipsis, so two
 * similarly-prefixed campaign titles ("The Sunken Bell" / "The Sunken
 * Cauldron") are indistinguishable. Fix relaxes truncation to a 2-line
 * clamp inside the existing `@media (max-width: 480px)` phone block only —
 * desktop/tablet rows are untouched.
 */
import fs from 'fs';
import path from 'path';

describe('Dashboard.module.css — .campaignName relaxes to a 2-line clamp at <=480px (UIR2-TAV-15)', () => {
  let cssContent: string;

  beforeAll(() => {
    cssContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/dashboard/Dashboard.module.css'),
      'utf8',
    );
  });

  function ruleBlock(selector: string, fromIndex = 0): string {
    const start = cssContent.indexOf(`${selector} {`, fromIndex);
    expect(start).toBeGreaterThan(-1);
    const end = cssContent.indexOf('\n}', start);
    return cssContent.slice(start, end);
  }

  it('the base .campaignName rule still single-line-truncates (desktop/tablet unchanged)', () => {
    const base = ruleBlock('.campaignName');
    expect(base).toContain('white-space: nowrap');
    expect(base).toContain('text-overflow: ellipsis');
  });

  it('the <=480px phone block overrides .campaignName to wrap onto up to 2 lines instead of one', () => {
    const mediaIdx = cssContent.indexOf('@media (max-width: 480px)');
    expect(mediaIdx).toBeGreaterThan(-1);
    const mediaEnd = cssContent.lastIndexOf('\n}'); // stylesheet's final closing brace
    expect(mediaEnd).toBeGreaterThan(mediaIdx);

    // The override must be declared textually AFTER the base rule so it
    // actually wins the cascade at equal specificity (same class as the
    // Codex.module.css .rail/.drawer regressions this pattern guards against).
    const baseIdx = cssContent.indexOf('.campaignName {');
    const overrideIdx = cssContent.indexOf('.campaignName {', mediaIdx);
    expect(overrideIdx).toBeGreaterThan(baseIdx);
    expect(overrideIdx).toBeGreaterThan(mediaIdx);
    expect(overrideIdx).toBeLessThan(mediaEnd);

    const overrideBlock = ruleBlock('.campaignName', mediaIdx);
    expect(overrideBlock).toContain('white-space: normal');
    expect(overrideBlock).toContain('-webkit-line-clamp: 2');
  });

  it('Miko-QA gate: the phone-block clamp keeps an ellipsis affordance, not a hard `clip` cut (UIR2-TAV-15 regression)', () => {
    const mediaIdx = cssContent.indexOf('@media (max-width: 480px)');
    const overrideBlock = ruleBlock('.campaignName', mediaIdx);
    expect(overrideBlock).toContain('text-overflow: ellipsis');
    expect(overrideBlock).not.toContain('text-overflow: clip');
  });
});
