/**
 * Guard 2 (decomposition plan §3.5 + Amendment C, A9c-2 D4): a region or a
 * tenant never knows which layout it is in. Presets PLACE regions; a region
 * that asks "am I in story, or table, or phone?" is the fork (R16) wearing a
 * different hat, and the tenth region would then need a code edit in nine
 * other files instead of a row edit in one.
 *
 * Under `regions/` and `tenants/`, no file may:
 *   - import `presets` (any specifier ending `/presets`, `./`, `../` or `@/`),
 *   - import or call `useTheme` / `usePlayLayout` / `resolveLayout`,
 *   - contain the string literals 'story' / 'table' / 'phone'.
 * `../variants` is the sanctioned vocabulary (`variants.ts` holds no preset id).
 *
 * Comment-stripped via the shared `scripts/lib/strip-source-comments.mjs`, the
 * same stripper the Escape and ratchet guards use, so a comment that NAMES a
 * forbidden thing (this repo's regions' headers do) is not a finding.
 * The files are DERIVED from the directories: a new region is scanned the
 * moment it exists, with no list to edit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../../scripts/lib/strip-source-comments.mjs';

const PLAY_DIR = path.join(process.cwd(), 'src/app/play/[sessionId]');
const SCANNED_DIRS = ['regions', 'tenants'] as const;

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)(['"])([^'"]+)\1/g;
const PRESETS_SPECIFIER = /(^|\/)presets(\.ts)?$/;
const FORBIDDEN_NAMES = /\b(useTheme|usePlayLayout|resolveLayout)\b/g;
const PRESET_ID_LITERAL = /(['"`])(story|table|phone)\1/g;

/** The guard itself: pure, so the controls below call the real thing. */
export function scanRegionSource(source: string): string[] {
  const src = stripComments(source);
  const out: string[] = [];
  for (const m of src.matchAll(IMPORT_SPECIFIER)) {
    if (PRESETS_SPECIFIER.test(m[2])) out.push(`imports presets ('${m[2]}')`);
  }
  for (const m of src.matchAll(FORBIDDEN_NAMES)) out.push(`uses ${m[1]}`);
  for (const m of src.matchAll(PRESET_ID_LITERAL)) out.push(`contains the preset id literal ${m[0]}`);
  return out;
}

function scannedFiles(): string[] {
  return SCANNED_DIRS.flatMap((dir) =>
    fs
      .readdirSync(path.join(PLAY_DIR, dir))
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => path.join(dir, f)),
  );
}

describe('Guard 2: regions and tenants never know the layout', () => {
  const files = scannedFiles();

  it('is not vacuous: it scans every region and tenant on disk', () => {
    expect(files).toEqual(
      expect.arrayContaining(['regions/TopBar.tsx', 'regions/ActionBar.tsx', 'tenants/CastSpellTenant.tsx']),
    );
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  it.each(files)('%s names no preset, layout hook or preset id', (rel) => {
    expect(scanRegionSource(fs.readFileSync(path.join(PLAY_DIR, rel), 'utf8'))).toEqual([]);
  });

  describe('controls: one of each is red, through the same function', () => {
    it.each([
      ['import ./presets', `import { LAYOUT_ROWS } from './presets';`, /imports presets/],
      ['import ../presets', `import { x } from "../presets";`, /imports presets/],
      ['import @/ presets', `import { x } from '@/app/play/[sessionId]/presets';`, /imports presets/],
      ['useTheme', `import { useTheme } from '@/lib/theme/ThemeProvider';`, /uses useTheme/],
      ['usePlayLayout', `const l = usePlayLayout();`, /uses usePlayLayout/],
      ['resolveLayout', `const r = resolveLayout(a, b, c);`, /uses resolveLayout/],
      ["'story' literal", `const v = layout === 'story' ? 1 : 2;`, /'story'/],
      ['"table" literal', `const v = "table";`, /"table"/],
      ['`phone` literal', 'const v = `phone`;', /`phone`/],
    ])('%s', (_name, src, expected) => {
      expect(scanRegionSource(src).join('\n')).toMatch(expected);
    });

    it('the sanctioned vocabulary and comments are clean', () => {
      expect(scanRegionSource(`import type { RegionVariant } from '../variants';`)).toEqual([]);
      expect(scanRegionSource(`// a 'story' row from presets, useTheme and resolveLayout\n/* 'table' */ const a = 1;`)).toEqual([]);
      // a longer word is not the preset id
      expect(scanRegionSource(`const k = 'tablet'; const j = 'storyboard';`)).toEqual([]);
    });
  });
});
