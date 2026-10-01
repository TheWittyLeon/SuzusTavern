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

describe('text controls a player focuses on a phone are at least 16px (no iOS focus zoom)', () => {
  it.each([
    ['the composer textarea', 'src/components/Composer.module.css', '.input'],
    ['the Journal notes textarea', 'src/components/JournalPane.module.css', '.notesTextarea'],
    ['the Cast picker selects', 'src/components/CastSpellPanel.module.css', '.select'],
    ['the DM currency grant select and amount (a DM on a phone)', 'src/components/GrantCurrencyPanel.module.css', '.select,\n.input'],
  ])('%s', (_n, file, selector) => {
    expect(fontPx(block(read(file), selector))).toBeGreaterThanOrEqual(16);
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
