/**
 * A9d-2 fix round N8 (Sora lever brief 2.4, F-b) -- in the narrow action bar the Cast button and the safety block SHARE one row. Before it, the
 * Cast disclosure took its own 67px row (115 + 16 + 305 > 366) and a caster's bar measured 241-242px at 390x844; after it, 158px (the brief's
 * ceiling is 180). CSS Modules are identity-mocked under jest and jsdom computes no layout, so this pins the RULE's text; the height itself is
 * the harness's `o:casterBar` (a unit control with 242 red, and the run at 1d7c9fc red).
 *
 * Control: delete the `flex: 1 1 0` rule below -> this reds, and `o:casterBar` reds in the browser.
 */
import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(path.resolve(process.cwd(), 'src/app/play/[sessionId]/Play.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the `@container (max-width: 560px)` block (brace-matched). */
function narrowBlock(): string {
  const i = css.indexOf('@container (max-width: 560px)');
  if (i < 0) throw new Error('no narrow @container block');
  let depth = 0;
  for (let j = css.indexOf('{', i); j < css.length; j += 1) {
    if (css[j] === '{') depth += 1;
    if (css[j] === '}' && --depth === 0) return css.slice(css.indexOf('{', i) + 1, j);
  }
  throw new Error('unbalanced');
}

describe('the narrow action bar: Cast and the safety block share a row', () => {
  it('the safety block takes the width the Cast button leaves (a zero basis), only where a Cast tenant exists', () => {
    const rule = narrowBlock().match(/\.slot:has\(> \[data-tenant="castSpellPanel"\]\) > \[data-tenant="safetyControls"\]\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/flex:\s*1 1 0/);
    expect(rule![1]).toMatch(/min-width:\s*0/);
  });

  it('the Cast tenant keeps its content width (it never takes the row)', () => {
    const rule = narrowBlock().match(/\.slot:has\(> \[data-tenant="castSpellPanel"\]\) > \[data-tenant="castSpellPanel"\]\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/flex:\s*0 0 auto/);
  });

  it('the action rail still takes the first row alone (the verbs), so Cast and the safety block are the second', () => {
    expect(narrowBlock()).toMatch(/\.slot:has\(> \[data-tenant="safetyControls"\]\) > :not\(\[data-tenant\]\)\s*\{[^}]*flex:\s*1 0 100%/);
  });
});
