/**
 * A9d-2 N6 (Sora lever brief 2.4) — the phone composer's pad and gap are a ROW'S to set.
 *
 * `--play-composer-pad` / `--play-composer-gap` are read by Composer.module.css with today's density tokens as the fallback (absent =
 * every desktop row unchanged). jsdom applies no CSS, so this pins the stylesheet text; the number is the harness's (the composer is
 * 145px at 390 wide before, 121 after: z:modeRow, and the budget at every phone cell).
 */
import fs from 'node:fs';
import path from 'node:path';
import { LAYOUT_ROWS_BY_ID } from '@/app/play/[sessionId]/presets';

const css = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Composer.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel: string) => {
  const at = css.indexOf(`\n${sel} {`);
  expect(at).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

describe('Composer.module.css reads the row\'s composer density, with the density tokens as the fallback', () => {
  it('.composer: padding-top is --play-composer-pad, falling back to --density-pad', () => {
    expect(rule('.composer')).toMatch(/padding-top:\s*var\(--play-composer-pad,\s*var\(--density-pad\)\)/);
  });

  it('.row: gap is --play-composer-gap, falling back to --density-gap', () => {
    expect(rule('.row')).toMatch(/\n\s*gap:\s*var\(--play-composer-gap,\s*var\(--density-gap\)\)/);
  });

  it('only the phone row sets them; the desktop rows declare no composer density (so the fallback is what they get)', () => {
    expect(LAYOUT_ROWS_BY_ID.phone.vars).toMatchObject({ '--play-composer-pad': 'var(--space-3)', '--play-composer-gap': 'var(--space-4)' });
    for (const id of ['story', 'table'] as const) {
      const vars = LAYOUT_ROWS_BY_ID[id].vars ?? {};
      expect(Object.keys(vars).filter((k) => k.startsWith('--play-composer'))).toEqual([]);
    }
  });

  it('the targets are untouched: .mode and .input keep their 44px floors', () => {
    expect(css).toMatch(/\.mode\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.input\s*\{[^}]*min-height:\s*44px/);
  });
});
