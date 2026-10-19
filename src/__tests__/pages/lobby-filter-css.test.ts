/**
 * Same shape as the nav tab: `.filter:hover { color: var(--ink) }` ties `.filterOn` on specificity and comes first, so hovering the selected chip put
 * --ink on the accent gradient (1.23-2.35:1; sticks after a tap on touch). The selected state restates its ink on hover and comes later.
 */
import fs from 'fs';
import path from 'path';
import { cssRules } from '../../test-utils/cssRules';

const rules = cssRules(fs.readFileSync(path.join(__dirname, '../../app/lobby/Lobby.module.css'), 'utf8'));

describe('Lobby.module.css selected filter chip', () => {
  it('keeps gradient, on-accent text and a transparent border on hover, after the LAST .filter:hover', () => {
    const hover = [...rules].reverse().find((r) => r.selectors.includes('.filter:hover'));
    const on = [...rules].reverse().find((r) => r.selectors.includes('.filterOn:hover') && r.selectors.includes('.filterOn'));
    expect(hover).toBeDefined();
    expect(on).toBeDefined();
    expect(on!.at).toBeGreaterThan(hover!.at);
    expect(on!.body).toMatch(/background:\s*linear-gradient\(135deg, var\(--accent\), var\(--accent-2\)\)/);
    expect(on!.body).toMatch(/color:\s*var\(--on-accent\)/);
    expect(on!.body).toMatch(/border-color:\s*transparent/);
  });
});
