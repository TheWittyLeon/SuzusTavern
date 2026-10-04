/**
 * @jest-environment node
 *
 * TPK-HOLD W1 — a typed (AST) guard: nothing compares a fight's `state` against a state, in any spelling, except the four predicates in
 * `app/play/[sessionId]/format.ts` (`isFightLive`, `areTurnsRunning`, `isFightHeld`, `isFightEnded`).
 *
 * Why: `CombatState.state` was a bare string, so a new engine state (`held`) was silently "not 'active'" at every reader that tested for it, and the review found four
 * consequential misses. The closed type makes the compiler find a `switch`; this finds a COMPARISON, which the compiler cannot. The first version was a one-line regex and
 * caught `.state === 'x'` with single quotes on one line; QA injected five shapes past it. This one asks the TYPE CHECKER, not the text:
 *
 *   an expression is a "fight state" when its type is `CombatStateValue` (declared, so a destructured `state` and a named constant compared against it are caught, and a cast
 *   to `string` is looked through), or when it is a state literal beside something named `state`. It may not be:
 *     - an operand of `===` `!==` `==` `!=`;
 *     - the subject of a `switch`;
 *     - the argument of `includes` / `indexOf` / `has` / `some` ... (a state list);
 *     - the key of an element access (`MAP[cs.state]`, classification by omission).
 *
 * The scan runs over every non-test source file in one TypeScript program, plus virtual fixtures (the shapes below), so each shape is proven red in the same run that proves
 * the tree clean. Comparisons of OTHER things that happen to share a literal (`session.status === 'ended'`, a form's `'idle'`, a check's `state === 'resolved'`) are not fight states and stay legal.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const PREDICATES = path.join(SRC, 'app/play/[sessionId]/format.ts');
const STATES = new Set(['idle', 'rolling_initiative', 'active', 'between_turns', 'held', 'ended']);
const COMPARE = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);
const LIST_METHODS = new Set(['includes', 'indexOf', 'lastIndexOf', 'has', 'some', 'every', 'find', 'findIndex', 'filter']);

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
const IMPORT = "import type { CombatState } from '@/lib/api/types';\ndeclare const cs: CombatState;\ndeclare const maybe: CombatState | null;\n";
const BAD: Record<string, string> = {
  'single quotes (the one the regex caught)': "export const a = cs.state === 'ended';",
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
  'a constant on the left, on one line apart': "const ENDED = 'ended';\nexport const a =\n  ENDED\n    === cs.state;",
  'a cast to string': "export const a = (cs.state as string) === 'ended';",
  'a non-null assertion': "export const a = maybe!.state === 'ended';",
  'a switch': "export function f() { switch (cs.state) { case 'ended': return 1; default: return 0; } }",
  'a lookup keyed by state': "const M: Record<string, number> = {};\nexport const a = M[cs.state];",
  'a raw (any) payload beside a state literal': "declare const raw: any;\nexport const a = raw.state === 'held';",
  'a local copy typed from the field': "const copy = cs.state;\nexport const a = copy !== 'held';",
};
const FINE: Record<string, string> = {
  'a session status': "declare const s: { status: 'active' | 'paused' | 'ended' };\nexport const a = s.status === 'ended';",
  'a form state': "declare const formState: 'idle' | 'busy';\nexport const a = formState === 'idle';",
  'a check state': "declare const c: { state: string };\nexport const a = c.state === 'resolved';",
  'a string called state that is not a state literal': "declare const c: { state: string };\nexport const a = c.state === 'locked';",
  'the predicates': "import { isFightEnded, areTurnsRunning } from '@/app/play/[sessionId]/format';\nexport const a = isFightEnded(maybe) || areTurnsRunning(maybe);",
  'a state passed through, never compared': "export const a: string = cs.state;",
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
  const unwrap = (n: ts.Node): ts.Node => {
    let cur = n;
    for (;;) {
      if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isTypeAssertionExpression(cur)) cur = cur.expression;
      else return cur;
    }
  };
  const isStateType = (t: ts.Type): boolean => {
    if (t.aliasSymbol?.name === 'CombatStateValue') return true;
    if (!t.isUnion()) return false;
    const members = t.types.filter((m) => !(m.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)));
    if (members.length === 1) return isStateType(members[0]);
    return members.length >= 2 && members.every((m) => m.isStringLiteral() && STATES.has(m.value)) && members.some((m) => m.isStringLiteral() && ['held', 'between_turns', 'rolling_initiative'].includes(m.value));
  };
  const isStateExpr = (raw: ts.Node): boolean => {
    const n = unwrap(raw);
    if (isStateType(checker.getTypeAtLocation(n))) return true;
    const target = ts.isPropertyAccessExpression(n) ? n.name : n;
    const sym = checker.getSymbolAtLocation(target);
    if (sym && isStateType(checker.getTypeOfSymbol(sym))) return true;
    // a local copied from the field keeps no alias after narrowing; follow a `const x = <state expr>` initializer once
    const decl = sym?.valueDeclaration;
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer && !ts.isIdentifier(unwrap(decl.initializer))) return isStateType(checker.getTypeAtLocation(unwrap(decl.initializer)));
    return false;
  };
  const isStateLiteral = (raw: ts.Node): boolean => {
    const n = unwrap(raw);
    return (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && STATES.has(n.text);
  };
  const namedState = (raw: ts.Node) => /\bstate\b/i.test(unwrap(raw).getText());
  const report = (n: ts.Node, why: string) => {
    const { line } = file.getLineAndCharacterOfPosition(n.getStart());
    out.push(`${path.relative(ROOT, file.fileName)}:${line + 1}: ${why}: ${n.getText().replace(/\s+/g, ' ').slice(0, 90)}`);
  };
  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n) && COMPARE.has(n.operatorToken.kind)) {
      const sides = [n.left, n.right];
      if (sides.some(isStateExpr) || (sides.some(isStateLiteral) && sides.some(namedState))) report(n, 'compares a fight state');
    } else if (ts.isSwitchStatement(n) && isStateExpr(n.expression)) {
      report(n, 'switches on a fight state');
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && LIST_METHODS.has(n.expression.name.text)) {
      const list = unwrap(n.expression.expression);
      const stateList = ts.isArrayLiteralExpression(list) && list.elements.some(isStateLiteral);
      if (n.arguments.some(isStateExpr) || (stateList && n.arguments.some(namedState))) report(n, 'looks a fight state up in a list');
    } else if (ts.isElementAccessExpression(n) && isStateExpr(n.argumentExpression)) {
      report(n, 'keys a lookup by a fight state');
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return out;
}

describe('no reader compares a fight state outside the predicates (AST, typed)', () => {
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

  it('scans a real tree (not vacuous), and the predicates\' own comparisons are what it would flag', () => {
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
});
