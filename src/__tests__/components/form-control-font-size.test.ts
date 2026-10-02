/**
 * A9d-2 (Tora A9d-1 MAJOR-3): iOS Safari zooms the page when a focused text control's computed font-size is under
 * 16px, and never zooms back on its own. The controls a player focuses on the phone path are the composer's
 * textarea, the Journal's notes textarea and the Cast picker's selects. The fix is the control's own size, never
 * `maximum-scale` / `user-scalable=no` (WCAG 1.4.4). The browser half is capture-play's (r) check, which measures
 * every rendered control's computed size.
 */
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declaration block of the FIRST rule whose selector is exactly `selector`. */
function block(css: string, selector: string): string {
  const m = css.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no ${selector} rule`);
  return m[1];
}

/** The LAST font-size in a block, in px (rem = 16px). */
function fontPx(decls: string): number {
  const all = [...decls.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)];
  if (all.length === 0) throw new Error('no font-size');
  const [, n, unit] = all[all.length - 1];
  return Number(n) * (unit === 'rem' ? 16 : 1);
}

/** The `{...}` body of the first `@media` block whose prelude is exactly `prelude`, brace-matched. */
function mediaBody(css: string, prelude: string): string {
  const i = css.indexOf(`@media ${prelude}`);
  if (i < 0) throw new Error(`no @media ${prelude}`);
  const open = css.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < css.length; j += 1) {
    if (css[j] === '{') depth += 1;
    if (css[j] === '}' && --depth === 0) return css.slice(open + 1, j);
  }
  throw new Error('unbalanced');
}

/**
 * A9d-2 fix round N9 (Kage I-5, Tora MINOR-2): this was a LIST of four sites (the composer, the Journal notes, the Cast and Grant selects),
 * each with its own 16px literal, and the next control a DM or player focused (ConditionsPanel, CampaignFloorPanel, DmNarrationPanel,
 * DmOverrideModal, the global .input, 13-14px) was not on it. The invariant is now a RULE at the control layer in globals.css, and this
 * pins the rule: every text control (an input that is not a checkbox, radio, range, colour, file or button; a select; a textarea) is 16px under
 * the phone / touch query, `!important` so it floors single-class site rules. The named exception of the brief (section 6, N9): the four
 * `it.each` rows are gone with the list they were. What pins the invariant now: this rule, and the harness's (r) check on a DM shot that renders
 * every DM panel (`y-dm-all-panels`), red at 1d7c9fc.
 *
 * Control: delete the rule (or its `!important`) -> the first case reds; narrow its selector to `.input` -> the second reds.
 */
describe('every text control is at least 16px on a phone or a touch screen (no iOS focus zoom), by one rule at the control layer', () => {
  const globals = read('src/app/globals.css');
  const body = () => mediaBody(globals, '(max-width: 880px), (pointer: coarse)');
  const floor = () => {
    const m = body().match(/([^{}]*)\{([^}]*font-size:\s*16px\s*!important[^}]*)\}/);
    if (!m) throw new Error('no 16px !important rule under the phone / touch query');
    return { selector: m[1], decls: m[2] };
  };

  it('globals.css has the rule, under the phone width OR a coarse pointer, and it is `!important`', () => {
    expect(floor().decls).toMatch(/font-size:\s*16px\s*!important/);
  });

  it('it names every text control by element, not by a class a site could forget: input (minus the non-text types), select, textarea', () => {
    const sel = floor().selector;
    expect(sel).toMatch(/\binput:not\(/);
    for (const t of ['checkbox', 'radio', 'range', 'color', 'file', 'submit', 'button', 'hidden']) expect(sel).toContain(`[type='${t}']`);
    expect(sel).toMatch(/\bselect\b/);
    expect(sel).toMatch(/\btextarea\b/);
    expect(sel).not.toMatch(/\.[A-Za-z]/); // no class in it: a list of sites is the defect this replaced
  });

  it('a single-line native select is also 44px TALL under that query, `!important`: WebKit ignores min-height on a select and every site wrote height: 38px (the WebKit pass saw ConditionsPanel at 175x38)', () => {
    const m = body().match(/(select:not\([^)]*\))\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/\[multiple\]/);
    expect(m![1]).toMatch(/\[size\]/);
    expect(m![2]).toMatch(/height:\s*44px\s*!important/);
  });

  it('the composer textarea, the Journal notes and the Cast and Grant selects keep their own 16px as well (the desktop: the rule is a phone / touch floor)', () => {
    for (const [file, selector] of [
      ['src/components/Composer.module.css', '.input'],
      ['src/components/JournalPane.module.css', '.notesTextarea'],
      ['src/components/CastSpellPanel.module.css', '.select'],
      ['src/components/GrantCurrencyPanel.module.css', '.select,\n.input'],
    ] as const) {
      expect(fontPx(block(read(file), selector))).toBeGreaterThanOrEqual(16);
    }
  });

  it('control: the parser reads a 14px rule as 14 (the 711b77c composer) and a 0.8125rem one as 13', () => {
    expect(fontPx('font: inherit; font-size: 14px; line-height: 1.4;')).toBe(14);
    expect(fontPx('font-size: 0.8125rem;')).toBe(13);
  });

  it('the page never blocks pinch-zoom: no maximum-scale / user-scalable=no / maximumScale in the app', () => {
    const root = path.resolve(process.cwd(), 'src');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
        if (!/\.(tsx?|css|html)$/.test(e.name)) continue;
        if (/maximum-scale|maximumScale|user-scalable\s*=\s*no|userScalable:\s*false/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p));
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
