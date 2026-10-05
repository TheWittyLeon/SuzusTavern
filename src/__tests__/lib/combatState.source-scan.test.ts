/**
 * @jest-environment node
 *
 * TPK-HOLD W1 — a typed (AST) guard: no expression typed `CombatStateValue` is read outside `lib/dnd/combatState.ts`, where the four predicates and ONE exhaustive
 * `Record<CombatStateValue, ...>` classifier live (`isFightLive`, `areTurnsRunning`, `isFightHeld`, `isFightEnded`).
 *
 * Why: `CombatState.state` was a bare string, so a new engine state (`held`) was silently "not 'active'" at every reader that tested for it, and the review found four consequential
 * misses. The first guard was a one-line regex; the second a list of four syntaxes (compare, switch, list lookup, element key) and 16 of 18 further shapes passed it (a regex `.test`, `in`,
 * `Map.get`, a helper taking `s: string`, `startsWith` ...) while it flagged legal code that merely sat beside a `state` name (Kage T-5). A list of SYNTAXES loses to the next syntax, so this one
 * asks the TYPE CHECKER one question and has no shape list: is this expression's type `CombatStateValue`? Reading `cs.state` at all is the violation; passing the whole `CombatState` around is not.
 * The exhaustiveness is the table's: a seventh member of the type is a tsc error in `combatState.ts` until it has a row, and a test below reads both lists and compares them.
 *
 * The scan runs over every non-test source file in one TypeScript program, plus virtual fixtures, so each shape is proven red in the same run that proves the tree clean. Another thing that
 * happens to share a literal (`session.status === 'ended'`, a form's `'idle'`, a fetch `state`) is not typed `CombatStateValue` and stays legal.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const PREDICATES = path.join(SRC, 'lib/dnd/combatState.ts');
const TYPES = path.join(SRC, 'lib/api/types.ts');
const STATES = new Set(['idle', 'rolling_initiative', 'active', 'between_turns', 'held', 'ended']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__' && e.name !== 'node_modules') walk(abs, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(abs);
  }
  return out;
}

/** Shapes injected as virtual files. `bad` must each produce a violation; `fine` none. */
const IMPORT = "import type { CombatState, CombatStateValue } from '@/lib/api/types';\ndeclare const cs: CombatState;\ndeclare const maybe: CombatState | null;\n";
const BAD: Record<string, string> = {
  'single quotes (the one the first regex caught)': "export const a = cs.state === 'ended';",
  'double quotes': 'export const a = cs.state === "ended";',
  'template literal': 'export const a = cs.state === `ended`;',
  'not-equals': "export const a = cs.state !== 'active';",
  'literal on the left': "export const a = 'held' === cs.state;",
  'optional chain': "export const a = maybe?.state === 'idle';",
  'loose equality': "export const a = cs.state == 'between_turns';",
  'a state list: includes': "export const a = ['ended', 'idle'].includes(cs.state);",
  'a state list: a Set': "export const a = new Set(['ended']).has(cs.state);",
  'a destructured state': "const { state } = cs;\nexport const a = state === 'ended';",
  'a named constant': "const ENDED = 'ended' as const;\nexport const a = cs.state === ENDED;",
  'a cast to string': "export const a = (cs.state as string) === 'ended';",
  'a non-null assertion': "export const a = maybe!.state === 'ended';",
  'a switch': "export function f() { switch (cs.state) { case 'ended': return 1; default: return 0; } }",
  'a lookup keyed by state': "const M: Record<string, number> = {};\nexport const a = M[cs.state];",
  'a local copy typed from the field': "const copy = cs.state;\nexport const a = copy !== 'held';",
  'a regex test': "export const a = /^(ended|idle)$/.test(cs.state);",
  'the in operator': "const LIVE = { active: 1, held: 1 } as const;\nexport const a = cs.state in LIVE;",
  'Map.get': "const M = new Map<string, boolean>([['ended', true]]);\nexport const a = M.get(cs.state);",
  'Object.is': "export const a = Object.is(cs.state, 'ended');",
  'startsWith': "export const a = cs.state.startsWith('end');",
  'a helper taking a string': "const isOver = (s: string) => s === 'ended';\nexport const a = isOver(cs.state);",
  'a two-hop copy typed string': "const s: string = cs.state;\nconst t = s;\nexport const a = t === 'ended';",
  'String()': "export const a = String(cs.state) === 'ended';",
  'a template wrap': "export const a = `${cs.state}` === 'ended';",
  'a renamed destructure typed string': "const { state: phase }: { state: string } = cs;\nexport const a = phase === 'ended';",
  'localeCompare': "export const a = cs.state.localeCompare('ended') === 0;",
  'an accessor returning string': "const st = (c: CombatState): string => c.state;\nexport const a = st(cs) === 'ended';",
  'includes.call': "export const a = Array.prototype.includes.call(['ended'], cs.state);",
  'length': "export const a = cs.state.length === 5;",
  'a relational compare': "export const a = cs.state > 'd' && cs.state < 'f';",
  'match()': "export const a = cs.state.match(/held|ended/) !== null;",
  'passed through to a data attribute': "export const a = { 'data-combat-state': cs.state };",
  'a parameter typed CombatStateValue': "const f = (s: CombatStateValue) => s === 'ended';\nexport const a = f(cs.state);",
};
const FINE: Record<string, string> = {
  'a session status': "declare const s: { status: 'active' | 'paused' | 'ended' };\nexport const a = s.status === 'ended';",
  'a form state': "declare const formState: 'idle' | 'busy';\nexport const a = formState === 'idle';",
  'a fetch state named state': "declare const state: 'idle' | 'loading' | 'ok';\nexport const a = state === 'idle';",
  'a useState-like tuple named state': "declare const st: ['idle' | 'busy', (v: 'idle' | 'busy') => void];\nconst [state] = st;\nexport const a = state === 'idle';",
  'another object\'s state compared to active': "declare const sub: { state: string };\nexport const a = sub.state === 'active';",
  'a check state': "declare const c: { state: string };\nexport const a = c.state === 'resolved';",
  'a list of unrelated words and a state-named string': "declare const uiState: string;\nexport const a = ['idle', 'open'].includes(uiState);",
  'the predicates': "import { isFightEnded, areTurnsRunning } from '@/lib/dnd/combatState';\nexport const a = isFightEnded(maybe) || areTurnsRunning(maybe);",
  'the whole CombatState passed through, never read': "declare function show(c: CombatState): void;\nshow(cs);\nexport const a = cs.combat_id;",
};

const VIRTUAL = new Map<string, string>();
const virtualName = (kind: 'bad' | 'fine', i: number) => path.join(SRC, `__scan_fixtures__/${kind}-${i}.ts`);
Object.values(BAD).forEach((src, i) => VIRTUAL.set(virtualName('bad', i), IMPORT + src));
Object.values(FINE).forEach((src, i) => VIRTUAL.set(virtualName('fine', i), IMPORT + src));

function buildProgram(): ts.Program {
  const cfg = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined, plugins: undefined, skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  const realGet = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, ...rest) => (VIRTUAL.has(path.resolve(name)) ? ts.createSourceFile(name, VIRTUAL.get(path.resolve(name))!, lang, true) : realGet(name, lang, ...rest));
  const realExists = host.fileExists.bind(host);
  host.fileExists = (n) => VIRTUAL.has(path.resolve(n)) || realExists(n);
  const realRead = host.readFile.bind(host);
  host.readFile = (n) => VIRTUAL.get(path.resolve(n)) ?? realRead(n);
  return ts.createProgram({ rootNames: [...walk(SRC).filter((f) => !f.includes('__scan_fixtures__')), ...VIRTUAL.keys()], options, host });
}

function violationsIn(program: ts.Program, file: ts.SourceFile): string[] {
  const checker = program.getTypeChecker();
  const out: string[] = [];
  const isStateType = (t: ts.Type): boolean => {
    if (t.aliasSymbol?.name === 'CombatStateValue') return true;
    if (!t.isUnion()) return false;
    const members = t.types.filter((m) => !(m.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)));
    if (members.length === 1) return isStateType(members[0]);
    // a union of the engine's own literals, however it was spelled (an inline copy of the type has no alias)
    return members.length >= 2 && members.every((m) => m.isStringLiteral() && STATES.has(m.value)) && members.some((m) => m.isStringLiteral() && ['held', 'between_turns', 'rolling_initiative'].includes(m.value));
  };
  /** A name being DECLARED (a property signature, a binding, a parameter, a type reference) is not a read. */
  const isDeclarationName = (n: ts.Identifier) => {
    const p = n.parent;
    return !!p && ((ts.isPropertyAccessExpression(p) && p.name === n) || ts.isPropertySignature(p) || (ts.isPropertyAssignment(p) && p.name === n) || ts.isBindingElement(p) || ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isTypeReferenceNode(p) || ts.isImportSpecifier(p) || ts.isTypeAliasDeclaration(p));
  };
  const visit = (n: ts.Node) => {
    // `const { state: phase }: { state: string } = cs`: the pattern reads the field though no expression in it is typed CombatStateValue (the declared type was loosened).
    if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent) && ts.isVariableDeclaration(n.parent.parent) && n.parent.parent.initializer) {
      const field = n.propertyName ?? n.name;
      const prop = ts.isIdentifier(field) ? checker.getTypeAtLocation(n.parent.parent.initializer).getProperty(field.text) : undefined;
      if (prop && isStateType(checker.getTypeOfSymbolAtLocation(prop, n))) {
        const { line } = file.getLineAndCharacterOfPosition(n.getStart());
        out.push(`${path.relative(ROOT, file.fileName)}:${line + 1}: destructures a fight state: ${n.getText().slice(0, 90)}`);
      }
    }
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) || (ts.isIdentifier(n) && !isDeclarationName(n))) {
      let t: ts.Type | undefined;
      try { t = checker.getTypeAtLocation(n); } catch { t = undefined; }
      if (t && isStateType(t)) {
        const { line } = file.getLineAndCharacterOfPosition(n.getStart());
        out.push(`${path.relative(ROOT, file.fileName)}:${line + 1}: reads a fight state: ${n.parent.getText().replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return out;
}

describe('no reader reads a fight state outside the predicates (AST, typed)', () => {
  let program: ts.Program;
  let byFile: (f: string) => string[];
  beforeAll(() => {
    program = buildProgram();
    byFile = (f) => {
      const sf = program.getSourceFile(f);
      if (!sf) throw new Error(`the program has no ${f}`);
      return violationsIn(program, sf);
    };
  }, 120_000);

  it('scans a real tree (not vacuous), and the predicates\' own reads are what it would flag', () => {
    const real = walk(SRC).filter((f) => !f.includes('__scan_fixtures__'));
    expect(real.length).toBeGreaterThan(100);
    expect(byFile(PREDICATES).length).toBeGreaterThan(0);
  });

  it('every other source file is clean', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      if (f === PREDICATES || f.includes('__scan_fixtures__')) continue;
      offenders.push(...byFile(f));
    }
    expect(offenders).toEqual([]);
  }, 120_000);

  it.each(Object.keys(BAD).map((k, i) => [k, i] as const))('RED: %s', (_name, i) => {
    expect(byFile(virtualName('bad', i)).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(FINE).map((k, i) => [k, i] as const))('legal: %s', (_name, i) => {
    expect(byFile(virtualName('fine', i))).toEqual([]);
  });

  it('the classifier has one row per member of CombatStateValue (a seventh member is a tsc error there; this reads both lists)', () => {
    const typesFile = program.getSourceFile(TYPES)!;
    const members: string[] = [];
    typesFile.forEachChild((n) => {
      if (ts.isTypeAliasDeclaration(n) && n.name.text === 'CombatStateValue' && ts.isUnionTypeNode(n.type)) {
        for (const m of n.type.types) if (ts.isLiteralTypeNode(m) && ts.isStringLiteral(m.literal)) members.push(m.literal.text);
      }
    });
    const rows: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'KINDS' && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
        for (const p of n.initializer.properties) if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) rows.push(p.name.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(program.getSourceFile(PREDICATES)!);
    expect(members.length).toBeGreaterThanOrEqual(6);
    expect([...rows].sort()).toEqual([...members].sort());
  });

  describe('components/ and lib/ take no VALUE import from app/ (the dependency points down: Kage T-8, N-6)', () => {
    /** The app/ modules a file takes a value from: static imports and re-exports that are not type-only, dynamic `import()` and `require()`, in any spelling (`@/app/..`, relative). */
    const appValueImports = (file: string, text: string): string[] => {
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const found: string[] = [];
      const fromApp = (spec: string) => {
        const resolved = spec.startsWith('@/') ? path.join(SRC, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : '';
        return !!resolved && (resolved === path.join(SRC, 'app') || resolved.startsWith(path.join(SRC, 'app') + path.sep));
      };
      const visit = (n: ts.Node) => {
        if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
          const c = n.importClause;
          const typeOnly = !!c && (c.isTypeOnly || (!c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((e) => e.isTypeOnly)));
          if (!typeOnly && fromApp(n.moduleSpecifier.text)) found.push(n.moduleSpecifier.text);
        } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && !n.isTypeOnly && fromApp(n.moduleSpecifier.text)) {
          found.push(n.moduleSpecifier.text);
        } else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require')) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && fromApp(n.arguments[0].text)) {
          found.push(n.arguments[0].text);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return found;
    };
    /** The ONE exemption: a value import this file carries a `debt:` marker for. */
    const EXEMPT = new Map([['components/DmNarrationPanel.tsx', '@/app/play/[sessionId]/overrideDialog']]);
    const offenders = () => {
      const out: string[] = [];
      for (const dir of ['components', 'lib']) {
        for (const f of walk(path.join(SRC, dir))) {
          const rel = path.relative(SRC, f).split(path.sep).join('/');
          const text = fs.readFileSync(f, 'utf8');
          for (const spec of appValueImports(f, text)) {
            if (EXEMPT.get(rel) === spec && /\/\/ debt: [^\n]*until: /.test(text)) continue;
            out.push(`${rel} imports ${spec}`);
          }
        }
      }
      return out;
    };
    it('the tree is clean but for the one marked exemption', () => {
      expect(offenders()).toEqual([]);
    });
    it('the exemption is real (it is there, with its debt: marker and an until: trigger)', () => {
      const text = fs.readFileSync(path.join(SRC, 'components/DmNarrationPanel.tsx'), 'utf8');
      expect(appValueImports(path.join(SRC, 'components/DmNarrationPanel.tsx'), text)).toEqual(['@/app/play/[sessionId]/overrideDialog']);
      expect(text).toMatch(/\/\/ debt: [^\n]*until: /);
    });
    const BAD_IMPORTS: Record<string, string> = {
      'the route\'s format module': "import { isFightHeld } from '@/app/play/[sessionId]/format';",
      'another route module': "import { statusPills } from '@/app/play/[sessionId]/statusPills';",
      'a route hook': "import { useBoard } from '@/app/play/[sessionId]/hooks/useBoard';",
      'a relative spelling': "import { isFightHeld } from '../app/play/[sessionId]/format';",
      'a dynamic import': "export const load = () => import('@/app/play/[sessionId]/format');",
      'require': "export const m = require('@/app/play/[sessionId]/format');",
      'a re-export': "export { isFightHeld } from '@/app/play/[sessionId]/format';",
      'a mixed import (one value specifier)': "import { type RegionVariant, useOverrideDialog } from '@/app/play/[sessionId]/overrideDialog';",
    };
    const FINE_IMPORTS: Record<string, string> = {
      'a type-only import': "import type { RegionVariant } from '@/app/play/[sessionId]/variants';",
      'an inline type-only import': "import { type RegionVariant } from '@/app/play/[sessionId]/variants';",
      'lib': "import { isFightHeld } from '@/lib/dnd/combatState';",
      'a type-only re-export': "export type { RegionVariant } from '@/app/play/[sessionId]/variants';",
    };
    it.each(Object.entries(BAD_IMPORTS))('RED: %s', (_n, src) => {
      expect(appValueImports(path.join(SRC, 'components/X.tsx'), src).length).toBeGreaterThan(0);
    });
    it.each(Object.entries(FINE_IMPORTS))('legal: %s', (_n, src) => {
      expect(appValueImports(path.join(SRC, 'components/X.tsx'), src)).toEqual([]);
    });
  });
});
