/**
 * Same shape as the nav tab: `.filter:hover { color: var(--ink) }` ties `.filterOn` on specificity and comes first, so hovering the selected chip put
 * --ink on the accent gradient (1.23-2.35:1; sticks after a tap on touch). The selected state restates its ink on hover and wins the cascade.
 */
import fs from 'fs';
import path from 'path';
import { compareSpecificity, cssRules, specificity, subjectHasClass, subjectHasHover } from '../../test-utils/cssRules';

const rules = cssRules(fs.readFileSync(path.join(__dirname, '../../app/lobby/Lobby.module.css'), 'utf8'));
const last = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];
const LOOK = [/background:\s*linear-gradient\(135deg, var\(--accent\), var\(--accent-2\)\)/, /color:\s*var\(--on-accent\)/, /border-color:\s*transparent/];

describe('Lobby.module.css selected filter chip', () => {
  it('keeps gradient, on-accent text and a transparent border at rest and on hover, and wins against every .filter hover rule', () => {
    const hovers = rules.flatMap((r) =>
      r.selectors.filter((s) => subjectHasClass(s, 'filter') && subjectHasHover(s) && !subjectHasClass(s, 'filterOn')).map((s) => ({ s, at: r.at, spec: specificity(s) })),
    );
    expect(hovers.length).toBeGreaterThan(0);
    const on = last(rules.filter((r) => r.selectors.some((s) => subjectHasClass(s, 'filterOn') && subjectHasHover(s))));
    expect(on).toBeDefined();
    const sel = on!.selectors.find((s) => subjectHasClass(s, 'filterOn') && subjectHasHover(s))!;
    for (const h of hovers) {
      const cmp = compareSpecificity(specificity(sel), h.spec);
      expect({ against: h.s, wins: cmp > 0 || (cmp === 0 && on!.at > h.at) }).toEqual({ against: h.s, wins: true });
    }
    for (const re of LOOK) expect(on!.body).toMatch(re);
    const rest = last(rules.filter((r) => r.selectors.includes('.filterOn')));
    expect(rest).toBeDefined();
    for (const re of LOOK) expect(rest!.body).toMatch(re);
  });
});
