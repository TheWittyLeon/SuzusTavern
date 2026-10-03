/**
 * A9d-2 N5 (Kage A9d-1 S6) — every `--play-*` custom property a row DECLARES has a stylesheet that READS it.
 *
 * A row hands numbers to CSS through `vars` and `momentVars` (and the shell's three track lists). The durability rule's red flag is "a
 * field with no reader": a row var nobody reads is dead data that looks like a decision, and (A9d-2's own history) a deleted reader
 * leaves its row literal behind, still pinned by a test that cannot tell it is vestigial. Nine of nine had a reader when Kage counted;
 * this is the count kept.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LAYOUT_ROWS, LAYOUT_ROWS_BY_ID, type LayoutRow } from '@/app/play/[sessionId]/presets';

const SRC = path.resolve(process.cwd(), 'src');

function cssFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? cssFiles(p) : e.name.endsWith('.css') ? [p] : [];
  });
}
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const SHEETS = cssFiles(SRC).map((f) => ({ file: path.relative(SRC, f), text: strip(fs.readFileSync(f, 'utf8')) }));

/** Every string a row hands the cascade: its three track lists and the VALUES of every var it declares (a var's value may read another: `--play-body: calc(8 * var(--play-cell))`). */
const ownStrings = (row: LayoutRow): string[] => [
  ...[row.rows, row.columns, row.areas].flatMap((per) => Object.values(per)),
  ...Object.values(row.vars ?? {}),
  ...Object.values(row.momentVars ?? {}).flatMap((m) => Object.values(m ?? {})),
  ...Object.values(row.factVars ?? {}).flatMap((byValue) => Object.values(byValue ?? {}).flatMap((vars) => Object.values(vars))),
];

/**
 * The readers of `name` FOR THE ROW THAT DECLARES IT: the stylesheets that read it as `var(--name`, and that row's OWN tracks and values. A10 fix round (Kage's Tavern 4, Miko's
 * gap 9): it used to count every row's track lists, so a var declared by one row and read only by ANOTHER row's tracks passed (giving the phone row room values its tracks never
 * read passed all 8,173 tests). The stylesheets are shared by every row, as they must be; a track list is a row's own.
 */
export function readersOf(name: string, row?: LayoutRow): string[] {
  const re = new RegExp(`var\\(\\s*${name.replace(/[-]/g, '\\-')}\\s*[,)]`);
  return [
    ...SHEETS.filter((s) => re.test(s.text)).map((s) => s.file),
    // a row's own track lists and values are readers too: `--play-body` is read by the stage's body TRACK (`minmax(var(--play-body-floor,0px),var(--play-body,0px))`) of the row that declares it
    ...(row && ownStrings(row).some((v) => re.test(v)) ? [`presets.ts (${row.id} tracks and values)`] : []),
  ];
}

/** name -> the rows that declare it (in `vars`, `momentVars` or `factVars`). */
const declared = new Map<string, LayoutRow[]>();
for (const row of LAYOUT_ROWS) {
  // A10 step 11 S2b: `factVars` (the values a row gives a fact the page reports) are declared the same way, and need a reader the same way.
  const factNames = Object.values(row.factVars ?? {}).flatMap((byValue) => Object.values(byValue ?? {}).flatMap((vars) => Object.keys(vars)));
  const names = [...Object.keys(row.vars ?? {}), ...Object.values(row.momentVars ?? {}).flatMap((m) => Object.keys(m ?? {})), ...factNames];
  for (const n of new Set(names)) declared.set(n, [...(declared.get(n) ?? []), row]);
}
const pairs = [...declared].flatMap(([name, rows]) => rows.map((row) => [name, row.id] as const));

describe('every row-declared --play-* var has a reader FOR THE ROW THAT DECLARES IT (Kage S6; A10 fix round: Kage Tavern 4)', () => {
  it('the control: a name nobody reads has no reader, so the check below can fail', () => {
    expect(readersOf('--play-no-such-variable', LAYOUT_ROWS_BY_ID.story)).toEqual([]);
  });

  it('the control that the loosening let through: `--play-body` is read by Story\'s and Table\'s OWN tracks and by no stylesheet, so the PHONE row (whose tracks never read it) has no reader for it', () => {
    expect(readersOf('--play-body', LAYOUT_ROWS_BY_ID.story)).toEqual(['presets.ts (story tracks and values)']);
    expect(readersOf('--play-body', LAYOUT_ROWS_BY_ID.table)).toEqual(['presets.ts (table tracks and values)']);
    expect(readersOf('--play-body', LAYOUT_ROWS_BY_ID.phone)).toEqual([]);
  });

  it('the rows declare something (an empty set is a refused pass)', () => {
    expect(declared.size).toBeGreaterThanOrEqual(5);
    expect(pairs.length).toBeGreaterThanOrEqual(declared.size);
  });

  it.each(pairs)('%s (declared by the %s row) is read by a stylesheet or by that row\'s own tracks', (name, rowId) => {
    expect([name, rowId, readersOf(name, LAYOUT_ROWS_BY_ID[rowId]).length > 0]).toEqual([name, rowId, true]);
  });

  it('and the vars the lever deleted are read by none, declared by none (--play-picture-*, --play-foldable-*)', () => {
    for (const gone of ['--play-picture-dir', '--play-picture-pad', '--play-foldable-min', '--play-foldable-reflow-min']) {
      expect([gone, declared.has(gone), readersOf(gone)]).toEqual([gone, false, []]);
    }
  });
});
