/**
 * CSS-source regression test for the Review step's stat row
 * (src/app/character/new/CharacterCreate.module.css .reviewStats — UIA-0919-002).
 *
 * History: the original bug was `repeat(5, 1fr)` forcing 5 equal tracks
 * regardless of content, so at ~390px a nowrap+ellipsis value truncated to
 * one glyph ("18" -> "1.", "30 ft." -> "3."). A first fix attempt used
 * `repeat(auto-fit, minmax(min-content, 1fr))`, which LOOKS like a fix but is
 * invalid CSS — an auto-repeat track count must be resolvable from a fixed
 * minimum, and `min-content`/`max-content` are intrinsic (content-dependent),
 * so the whole declaration is silently dropped by the browser
 * (`CSS.supports(...)` returns false, verified in headless Chromium) and it
 * falls back to whatever unconditional rule precedes it — jsdom has no
 * `CSS.supports`, so nothing in this stack catches that without an explicit
 * source-text guard. That's the one thing kept here.
 *
 * Kage-CR round 2 (real-Chrome, 21 widths x 4 speed-kind harness) found the
 * fix attempt built on top of that (a 480px flex/grid split, flex-shrink:0,
 * an ellipsis-ban check) was mutation-blind — every one of those assertions
 * stayed green on CSS that measurably overflowed or truncated in a real
 * browser. They were deleted rather than kept as false confidence; the real
 * check is tools/ui-audit against the deployed page. This file's only job is
 * the one thing a real browser can't help jsdom catch anyway: silently-
 * invalid CSS syntax.
 */
import fs from 'fs';
import path from 'path';

describe('CharacterCreate.module.css — never regresses to invalid auto-repeat CSS (UIA-0919-002)', () => {
  it('never uses an intrinsic size (min-content/max-content) as the minimum of an auto-repeat track — CSS.supports() rejects it and the browser silently drops the whole declaration', () => {
    const cssContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/character/new/CharacterCreate.module.css'),
      'utf8',
    );
    // Comments stripped: this file's own history comments quote the invalid
    // pattern in prose (documenting why it doesn't work), which would
    // false-positive against the raw source if matched directly.
    const codeOnly = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
    // Cheap guard against the exact class of bug: `repeat(auto-fit|auto-fill,
    // minmax(min-content|max-content, ...))` is invalid per the CSS Grid spec
    // (an auto-repeat track count must be resolvable from a FIXED minimum).
    // Checked against the whole file, not just one selector — the bug class
    // isn't specific to a single rule.
    expect(codeOnly).not.toMatch(/repeat\(\s*auto-(fit|fill)\s*,\s*minmax\(\s*(min|max)-content/);
  });
});
