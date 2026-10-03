/**
 * A10 step 11 round 4 (Aoi): the fight's round banner is ONE line, so a long turn
 * order never grows the header and never pushes the verbs / X-card down (12px at
 * 1280x650 Story, a monster's turn). The CSS ellipsises; the text stays whole in the
 * DOM (read aloud in full) and in `title`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import NarratorStrip from '@/components/NarratorStrip';

const ORDER = ['Kestrel Ashwood', 'Sable Voss', 'Goblin Skulker', 'Goblin Cutter', 'Hobgoblin Captain'];
const FULL = `Round 2 — Monster turn — Goblin Skulker — Order: ${ORDER.join(', ')}`;

function rule(css: string, cls: string): string {
  const m = css.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no .${cls} rule`);
  return m[1];
}

describe('NarratorStrip combat line', () => {
  it('keeps the FULL text in the DOM, unhidden, and in title', () => {
    render(<NarratorStrip combatActive round={2} turnStatusText="Monster turn — Goblin Skulker" initiativeOrder={ORDER} />);
    const line = screen.getByText(FULL);
    expect(line).toHaveAttribute('title', FULL);
    expect(line).not.toHaveAttribute('aria-hidden');
    expect(line.closest('[aria-hidden="true"]')).toBeNull();
    expect(line.className).toContain('combatLine');
  });

  it('out of combat the scene line takes no combat class and no title', () => {
    render(<NarratorStrip sceneName="The Sooty Chimney" objective="Find the smell." />);
    const line = screen.getByText('The Sooty Chimney — Find the smell.');
    expect(line.className).not.toContain('combatLine');
    expect(line).not.toHaveAttribute('title');
  });

  it('the combat line is one ellipsised line in the stylesheet', () => {
    const css = fs
      .readFileSync(path.resolve(process.cwd(), 'src/components/NarratorStrip.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const r = rule(css, 'combatLine');
    expect(r).toMatch(/white-space:\s*nowrap/);
    expect(r).toMatch(/overflow:\s*hidden/);
    expect(r).toMatch(/text-overflow:\s*ellipsis/);
    expect(r).toMatch(/display:\s*block/);
  });
});
