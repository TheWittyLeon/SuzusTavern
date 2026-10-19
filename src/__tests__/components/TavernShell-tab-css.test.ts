/**
 * TAV-NAV-ACTIVE-TAB-HOVER-UNREADABLE (+ S-3, disabled tab): `.tab:hover` and `.tabActive:hover` / `.tabDisabled:hover` have equal specificity, so
 * `.tab:hover`'s background and ink win unless the state rule comes LATER (or is heavier). A hover rule that only set `color` let the bare-nav background
 * replace the active gradient (axe 1.23:1), and hovering "Memory (soon)" brightened a tab that is not clickable. Measured in a browser by tools/ui-audit
 * (evidence 2026-10-19-daytime-navhover-*); these pin the rules, their specificity and their source order, whatever the whitespace, selector order,
 * `:is()` spelling or nesting. cssRules throws on an at-rule it cannot reason about (@layer, @scope, @starting-style), so those fail loudly here.
 */
import fs from 'fs';
import path from 'path';
import { compareSpecificity, cssRules, specificity, subjectHasClass, subjectHasHover } from '../../test-utils/cssRules';

const rules = cssRules(fs.readFileSync(path.join(__dirname, '../../components/TavernShell.module.css'), 'utf8'));
const last = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];

/** Every rule selector that styles the hover of a plain `.tab` (not of a state class), in any spelling: `.tab:hover`, `.tab:is(:hover)`, `:is(.tab:hover)`, `.tabs .tab:hover`. */
const tabHovers = (state: string) =>
  rules.flatMap((r) =>
    r.selectors.filter((s) => subjectHasClass(s, 'tab') && subjectHasHover(s) && !subjectHasClass(s, state)).map((s) => ({ s, at: r.at, spec: specificity(s) })),
  );

describe('TavernShell.module.css tab states beat .tab:hover', () => {
  const check = (state: 'tabActive' | 'tabDisabled', look: RegExp[]) => {
    const hovers = tabHovers(state);
    expect(hovers.length).toBeGreaterThan(0); // positive control: the walk finds .tab:hover at all

    // The state's hover rule: heavier than every tab hover, or equal and later than every one it ties with.
    const stateHover = last(rules.filter((r) => r.selectors.some((s) => subjectHasClass(s, state) && subjectHasHover(s))));
    expect(stateHover).toBeDefined();
    const sel = stateHover!.selectors.find((s) => subjectHasClass(s, state) && subjectHasHover(s))!;
    for (const h of hovers) {
      const cmp = compareSpecificity(specificity(sel), h.spec);
      expect({ against: h.s, wins: cmp > 0 || (cmp === 0 && stateHover!.at > h.at) }).toEqual({ against: h.s, wins: true });
    }
    for (const re of look) expect(stateHover!.body).toMatch(re);

    // The state at rest carries the same look: the LAST rule that lists the plain class.
    // (A later rule that only toggles display, e.g. under a media query, does not restyle it, so it is not "the" look.)
    const rest = last(rules.filter((r) => r.selectors.includes(`.${state}`) && /(^|[;\s])(color|background)\s*:/.test(r.body)));
    expect(rest).toBeDefined();
    for (const re of look) expect(rest!.body).toMatch(re);
  };

  it('the active tab keeps its gradient and on-accent text, at rest and on hover', () => {
    check('tabActive', [/background:\s*linear-gradient\(135deg, var\(--accent\), var\(--accent-2\)\)/, /color:\s*var\(--on-accent\)/]);
  });

  it('the disabled tab stays dim and flat, at rest and on hover', () => {
    check('tabDisabled', [/color:\s*var\(--ink-3\)/, /background:\s*transparent/]);
  });

  it('specificity helper: the cases the pin leans on', () => {
    expect(specificity('.tab:hover')).toEqual([0, 2, 0]);
    expect(specificity('.tabs .tab:hover')).toEqual([0, 3, 0]);
    expect(specificity(':is(.tab:hover)')).toEqual([0, 2, 0]);
    expect(specificity('.tab:where(:hover)')).toEqual([0, 1, 0]);
    expect(specificity('a.tab:hover')).toEqual([0, 2, 1]);
  });
});
