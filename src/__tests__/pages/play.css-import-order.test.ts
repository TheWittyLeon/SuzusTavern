/**
 * TPK-HOLD W3 follow-up — CSS modules are ordered by who imports them FIRST, so a refactor that only moves code between files can move a stylesheet in the cascade.
 * It did once: extracting the status pills from page.tsx made `statusPills.tsx` the first importer of Play.module.css, ahead of PartyStrip and the popovers, and the DM's
 * Session popover painted 378px wide instead of 320 (found by the harness's flag-off pair, `compare-runs.mjs`; the DOM digests of every region were identical).
 *
 * Pinned here, as source facts the jsdom suites cannot see:
 *   - the modules page.tsx pulls in above its own stylesheet import import NO stylesheet (`statusPills.tsx`, `overrideDialog.tsx`, `format.ts`);
 *   - page.tsx imports Play.module.css after the regions, as it did before;
 *   - the override host is imported before TableControls, so DmOverrideModal's sheet stays ahead of DmNarrationPanel's, as when the panel imported it.
 */
import fs from 'node:fs';
import path from 'node:path';

const PLAY = path.resolve(__dirname, '../../app/play/[sessionId]');
const read = (f: string) => fs.readFileSync(path.join(PLAY, f), 'utf8');
const importLines = (src: string) => src.split('\n').filter((l) => /^import\b/.test(l));
const indexOfImport = (lines: string[], needle: string) => lines.findIndex((l) => l.includes(needle));

describe('stylesheet order is not moved by a code move', () => {
  it.each(['statusPills.tsx', 'overrideDialog.tsx', 'format.ts'])('%s imports no stylesheet', (file) => {
    const css = importLines(read(file)).filter((l) => /\.css['"]/.test(l));
    expect(css).toEqual([]);
  });

  it('page.tsx imports its own sheet AFTER the regions that carry the popovers', () => {
    const lines = importLines(read('page.tsx'));
    const own = indexOfImport(lines, "'./Play.module.css'");
    expect(own).toBeGreaterThan(-1);
    for (const region of ["'./regions/PartyStrip'", "'./regions/SceneStage'", "'./regions/TableControls'"]) {
      const at = indexOfImport(lines, region);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(own);
    }
  });

  it('the override host is imported before TableControls (DmOverrideModal\'s sheet keeps its place ahead of DmNarrationPanel\'s)', () => {
    const lines = importLines(read('page.tsx'));
    expect(indexOfImport(lines, "'./overrideDialog'")).toBeGreaterThan(-1);
    expect(indexOfImport(lines, "'./overrideDialog'")).toBeLessThan(indexOfImport(lines, "'./regions/TableControls'"));
  });

  it('the Session popover\'s width does not depend on the order: the base `.popover` box is `:where(.popover)` (zero specificity), so one class from any sheet beats it', () => {
    const play = fs.readFileSync(path.join(PLAY, 'Play.module.css'), 'utf8');
    expect(play).toMatch(/^\.sessionPopover\s*\{[^}]*width:\s*320px/m);
    const base = fs.readFileSync(path.join(PLAY, '../../../components/AnchoredPopover.module.css'), 'utf8');
    expect(base).toMatch(/^:where\(\.popover\)\s*\{[^}]*width:\s*max-content/m);
    expect(base).not.toMatch(/^\.popover\s*\{[^}]*width:/m);
  });
});
