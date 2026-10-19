/**
 * TAV-NAV-ACTIVE-TAB-HOVER-UNREADABLE: `.tab:hover` and `.tabActive:hover` have equal specificity, so a hover rule that only set `color` let
 * `.tab:hover`'s background replace the active gradient and left --on-accent text on the bare nav (axe 1.23:1). The active tab must restate
 * the gradient on hover. Measured in a browser by tools/ui-audit (evidence 2026-10-19-daytime-navhover-*); this pins the rule.
 */
import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(path.join(__dirname, '../../components/TavernShell.module.css'), 'utf8');

describe('TavernShell.module.css active tab', () => {
  it('keeps its gradient and on-accent text on hover', () => {
    const m = css.match(/\.tabActive,\s*\.tabActive:hover\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/background:\s*linear-gradient\(135deg, var\(--accent\), var\(--accent-2\)\)/);
    expect(m![1]).toMatch(/color:\s*var\(--on-accent\)/);
  });

  it('is declared after .tab:hover (equal specificity: source order is the whole fix)', () => {
    const hover = css.indexOf('.tab:hover {');
    const active = css.search(/\.tabActive,\s*\.tabActive:hover\s*\{/);
    expect(hover).toBeGreaterThan(-1);
    expect(active).toBeGreaterThan(hover);
  });
});
