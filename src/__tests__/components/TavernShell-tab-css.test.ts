/**
 * TAV-NAV-ACTIVE-TAB-HOVER-UNREADABLE (+ S-3, disabled tab): `.tab:hover` and `.tabActive:hover` / `.tabDisabled:hover` have equal specificity, so
 * `.tab:hover`'s background and ink win unless the state rule comes LATER. A hover rule that only set `color` let the bare-nav background replace the
 * active gradient (axe 1.23:1), and hovering "Memory (soon)" brightened a tab that is not clickable. Measured in a browser by tools/ui-audit
 * (evidence 2026-10-19-daytime-navhover-*); these pin the rules and their source order, whatever the whitespace, selector order or nesting.
 */
import fs from 'fs';
import path from 'path';
import { cssRules } from '../../test-utils/cssRules';

const rules = cssRules(fs.readFileSync(path.join(__dirname, '../../components/TavernShell.module.css'), 'utf8'));
const lastWith = (sel: string) => [...rules].reverse().find((r) => r.selectors.includes(sel));
const stateRule = (hover: string) => [...rules].reverse().find((r) => r.selectors.includes(hover));

describe('TavernShell.module.css tab states beat .tab:hover', () => {
  const ranks = (state: string) => {
    const lastTabHover = lastWith('.tab:hover');
    expect(lastTabHover).toBeDefined();
    const withHover = stateRule(`${state}:hover`); // the hover state's own rule must carry the whole look, wherever the base rule sits
    expect(withHover).toBeDefined();
    expect(withHover!.at).toBeGreaterThan(lastTabHover!.at); // equal specificity: source order is the whole fix
    return withHover!;
  };

  it('the active tab keeps its gradient and on-accent text on hover, after the LAST .tab:hover at any depth', () => {
    const r = ranks('.tabActive');
    expect(r.body).toMatch(/background:\s*linear-gradient\(135deg, var\(--accent\), var\(--accent-2\)\)/);
    expect(r.body).toMatch(/color:\s*var\(--on-accent\)/);
  });

  it('the disabled tab stays dim and flat on hover, after the LAST .tab:hover at any depth', () => {
    const r = ranks('.tabDisabled');
    expect(r.body).toMatch(/color:\s*var\(--ink-3\)/);
    expect(r.body).toMatch(/background:\s*transparent/);
  });
});
