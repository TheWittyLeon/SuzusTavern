/**
 * Regression coverage for scripts/check-layout-tokens.mjs, added after
 * Kage-CR/Miko-QA (2026-09-21 review round) found the script's first
 * version reported "mutation-verified" while actually missing about half
 * of a 4-literal injection: the shared PXNUM regex carried the `/g` flag
 * into repeated `.test()` calls on the SAME RegExp object, so `lastIndex`
 * from one line's match silently broke detection on the next, shorter
 * line; separately, the per-line `^`-anchored property regex missed any
 * declaration sharing a line with its selector.
 *
 * This is an integration test (spawns the real script as a child process
 * against a real fixture file inside the script's own SCOPE_GLOBS, rather
 * than importing an extracted unit) because the script has no exported
 * functions to unit-test directly — matching check-color-tokens.mjs's own
 * precedent (also untested at the unit level). The fixture writes to a
 * REAL scanned location (regions/) so this exercises scopeFiles() too, not
 * just the detection regex in isolation.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REGIONS_DIR = path.join(ROOT, 'src/app/play/[sessionId]/regions');
const FIXTURE = path.join(REGIONS_DIR, 'zzz-check-layout-tokens-fixture.module.css');
const SCRIPT = path.join(ROOT, 'scripts/check-layout-tokens.mjs');

function runScript(): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT], {
      encoding: 'utf8',
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { status: err.status, output: `${err.stdout}${err.stderr}` };
  }
}

describe('check-layout-tokens.mjs', () => {
  const regionsDirPreexisted = existsSync(REGIONS_DIR);

  afterEach(() => {
    rmSync(FIXTURE, { force: true });
    if (!regionsDirPreexisted) rmSync(REGIONS_DIR, { recursive: true, force: true });
  });

  it('passes clean on the real repo today (baseline — must be true before the fixture tests below mean anything)', () => {
    expect(runScript().status).toBe(0);
  });

  it('catches every violation in a 4-literal injection that broke the pre-fix /g + .test() regex, INCLUDING a declaration sharing a line with its selector', () => {
    mkdirSync(REGIONS_DIR, { recursive: true });
    writeFileSync(
      FIXTURE,
      [
        '.a {',
        '  padding: 17px;',
        '  margin-top: 8px;',
        '  font-size: 13px;',
        '}',
        '.b { padding: 19px; }',
      ].join('\n'),
    );
    const { status, output } = runScript();
    expect(status).toBe(1);
    expect(output).toContain('4 raw spacing/type literal(s)');
    expect(output).toMatch(/zzz-check-layout-tokens-fixture\.module\.css:2 \[spacing\]/);
    expect(output).toMatch(/zzz-check-layout-tokens-fixture\.module\.css:3 \[spacing\]/);
    expect(output).toMatch(/zzz-check-layout-tokens-fixture\.module\.css:4 \[type\]/);
    expect(output).toMatch(/zzz-check-layout-tokens-fixture\.module\.css:6 \[spacing\]/);
  });

  it('does not flag a token-driven value or a var() fallback-only px', () => {
    mkdirSync(REGIONS_DIR, { recursive: true });
    writeFileSync(
      FIXTURE,
      ['.c {', '  padding: var(--space-4);', '  gap: var(--env-banner-h, 0px);', '}'].join('\n'),
    );
    const { status } = runScript();
    expect(status).toBe(0);
  });

  it('honors the design-token-exempt escape comment', () => {
    mkdirSync(REGIONS_DIR, { recursive: true });
    writeFileSync(
      FIXTURE,
      ['/* design-token-exempt: intentional one-off */', '.d {', '  padding: 21px;', '}'].join('\n'),
    );
    const { status } = runScript();
    expect(status).toBe(0);
  });
});
