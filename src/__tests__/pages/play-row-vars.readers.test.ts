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
import { LAYOUT_ROWS } from '@/app/play/[sessionId]/presets';

const SRC = path.resolve(process.cwd(), 'src');

function cssFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? cssFiles(p) : e.name.endsWith('.css') ? [p] : [];
  });
}
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const SHEETS = cssFiles(SRC).map((f) => ({ file: path.relative(SRC, f), text: strip(fs.readFileSync(f, 'utf8')) }));

/** The stylesheets that read `name` as `var(--name`, in a position that is not its own declaration. */
export function readersOf(name: string): string[] {
  const re = new RegExp(`var\\(\\s*${name.replace(/[-]/g, '\\-')}\\s*[,)]`);
  return [
    ...SHEETS.filter((s) => re.test(s.text)).map((s) => s.file),
    // A10 step 11 S2b: a row's own track lists are readers too: `--play-body` is read by the stage's body TRACK (`minmax(0,var(--play-body,0px))`),
    // and a row var a row's own `rows` / `columns` / `areas` read is not dead data.
    ...LAYOUT_ROWS.flatMap((row) => [row.rows, row.columns, row.areas].flatMap((per) => Object.values(per)).some((v) => re.test(v)) ? [`presets.ts (${row.id} tracks)`] : []),
  ];
}

const declared = new Map<string, string[]>();
for (const row of LAYOUT_ROWS) {
  // A10 step 11 S2b: `factVars` (the values a row gives a fact the page reports) are declared the same way, and need a reader the same way.
  const factNames = Object.values(row.factVars ?? {}).flatMap((byValue) => Object.values(byValue ?? {}).flatMap((vars) => Object.keys(vars)));
  const names = [...Object.keys(row.vars ?? {}), ...Object.values(row.momentVars ?? {}).flatMap((m) => Object.keys(m ?? {})), ...factNames];
  for (const n of names) declared.set(n, [...(declared.get(n) ?? []), row.id]);
}

describe('every row-declared --play-* var has a stylesheet reader (Kage S6)', () => {
  it('the control: a name nobody reads has no reader, so the check below can fail', () => {
    expect(readersOf('--play-no-such-variable')).toEqual([]);
  });

  it('the rows declare something (an empty set is a refused pass)', () => {
    expect(declared.size).toBeGreaterThanOrEqual(5);
  });

  it.each([...declared.keys()])('%s is read by a stylesheet', (name) => {
    expect([name, readersOf(name).length > 0]).toEqual([name, true]);
  });

  it('and the vars the lever deleted are read by none, declared by none (--play-picture-*, --play-foldable-*)', () => {
    for (const gone of ['--play-picture-dir', '--play-picture-pad', '--play-foldable-min', '--play-foldable-reflow-min']) {
      expect([gone, declared.has(gone), readersOf(gone)]).toEqual([gone, false, []]);
    }
  });
});
