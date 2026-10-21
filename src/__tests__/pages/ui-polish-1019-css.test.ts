/**
 * CSS-source pins for TAV-UI-POLISH-1019 (the non-design items). jsdom applies no layout, so these pin the
 * declarations; the geometry itself (heights, wrapping, ring clearance) was measured in Chromium, see the
 * work notes. Each pin names the rule that has to carry the declaration, not a line number.
 */
import fs from 'fs';
import path from 'path';
import { cssRules } from '@/test-utils/cssRules';

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

/** Every declaration block of the rules whose selector list contains exactly `selector`, joined in source order. */
function declsOf(rel: string, selector: string): string {
  return cssRules(read(rel))
    .filter((r) => r.selectors.includes(selector))
    .map((r) => r.body)
    .join(';');
}

describe('TAV-UI-POLISH-1019 AC-8: dashboard character cards', () => {
  const css = 'src/app/dashboard/Dashboard.module.css';
  it('a wrapped name and sub-line stay centred like the one-line name', () => {
    expect(declsOf(css, '.charName')).toMatch(/text-align:\s*center/);
    expect(declsOf(css, '.charSub')).toMatch(/text-align:\s*center/);
  });
  it('the wrapped card fills its grid cell, so a row of cards is one height', () => {
    expect(declsOf(css, '.charCardWrap > .charCard')).toMatch(/height:\s*100%/);
  });
});

describe('TAV-UI-POLISH-1019 AC-9: Codex detail dialog is opaque', () => {
  it('.mobileDetailDialog paints --bg-2 (the dialog surface), never the translucent --card', () => {
    const body = declsOf('src/app/codex/Codex.module.css', '.mobileDetailDialog');
    expect(body).toMatch(/background:\s*var\(--bg-2\)/);
    expect(body).not.toMatch(/background:\s*var\(--card\)/);
  });
});

describe('TAV-UI-POLISH-1019 AC-10: "round N" never wraps in the initiative header', () => {
  it('.round is nowrap and does not shrink', () => {
    const body = declsOf('src/components/InitiativeTracker.module.css', '.round');
    expect(body).toMatch(/white-space:\s*nowrap/);
    expect(body).toMatch(/flex-shrink:\s*0/);
  });
});

describe('TAV-UI-POLISH-1019 AC-11: the page keeps a ring of room at the viewport bottom', () => {
  it('html carries scroll-padding-bottom from the ring-clearance token', () => {
    expect(declsOf('src/app/globals.css', 'html')).toMatch(/scroll-padding-bottom:\s*var\(--focus-ring-clearance\)/);
  });
});
