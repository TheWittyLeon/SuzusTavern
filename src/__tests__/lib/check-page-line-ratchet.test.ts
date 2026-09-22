/**
 * Regression coverage for scripts/check-page-line-ratchet.mjs
 * (TAV-PLAY-SHELL-RATCHET-NOT-ENFORCED). Decomposition plan §8's concrete
 * rule for R1, item 3: page.tsx may only shrink; `npm run lint` must fail
 * the instant it grows past the ceiling recorded at the previous step's
 * close.
 *
 * Unlike check-layout-tokens.test.ts's precedent (which mutates a REAL
 * scanned file on disk), this suite mutation-verifies the ratchet's
 * decision logic through the script's exported pure functions
 * (`countLines`, `evaluateRatchet`) instead of writing to the real
 * page.tsx. That file is imported by the large majority of the /play
 * suite and jest runs with maxWorkers capped at 50% (b8de6ea) specifically
 * to keep parallel-worker contention out of the flake budget — briefly
 * mutating a 5,861-line file every other test file transforms, while other
 * workers may be mid-import of that exact file, reintroduces the class of
 * flake that cap exists to avoid. A pure-function test exercises the exact
 * same branch (`actualLines > ceiling`) with zero filesystem risk.
 *
 * The one integration test below is READ-ONLY against the real repo (the
 * same "passes clean today" baseline pattern check-layout-tokens.test.ts
 * uses) — it proves the CLI wiring (path resolution, process.exit code,
 * npm script) actually works, without ever writing to page.tsx.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { countLines, evaluateRatchet, RATCHET_CEILING } from '../../../scripts/check-page-line-ratchet.mjs';

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, 'scripts/check-page-line-ratchet.mjs');

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

describe('check-page-line-ratchet.mjs', () => {
  it('passes clean on the real repo today (baseline, read-only — page.tsx is never written by this suite)', () => {
    const { status, output } = runScript();
    expect(status).toBe(0);
    expect(output).toContain('page.tsx ratchet');
  });

  describe('countLines — matches `wc -l` (a newline-byte count), not String.split(\'\\n\').length', () => {
    it('counts a trailing-newline-terminated file the same as wc -l', () => {
      expect(countLines('a\nb\nc\n')).toBe(3);
    });

    it('does not overcount a file with no trailing newline', () => {
      // split('\n').length would report 3 here ('a','b','c') even though
      // wc -l — the tool every number in the decomposition plan was
      // measured with — reports 2 (it counts '\n' bytes, and there are
      // only two).
      expect(countLines('a\nb\nc')).toBe(2);
    });

    it('is 0 for an empty string', () => {
      expect(countLines('')).toBe(0);
    });
  });

  describe('evaluateRatchet — mutation-verified: fails when the file grows, passes at or below ceiling', () => {
    it('FAILS when actual lines exceed the ceiling, naming the file and the overage', () => {
      const { pass, message } = evaluateRatchet(5866, 5861);
      expect(pass).toBe(false);
      expect(message).toContain('5866 lines, ceiling is 5861');
      expect(message).toContain('grew by 5 line(s)');
      expect(message).toContain('page.tsx');
    });

    it('PASSES at exactly the ceiling', () => {
      expect(evaluateRatchet(5861, 5861).pass).toBe(true);
    });

    it('PASSES below the ceiling and names the exact value to lower RATCHET_CEILING to', () => {
      const { pass, message } = evaluateRatchet(5800, 5861);
      expect(pass).toBe(true);
      expect(message).toContain('61 line(s) of headroom');
      expect(message).toContain('Lower RATCHET_CEILING to 5800');
    });

    it('defaults to the exported RATCHET_CEILING when no ceiling argument is given', () => {
      expect(evaluateRatchet(RATCHET_CEILING).pass).toBe(true);
      expect(evaluateRatchet(RATCHET_CEILING + 1).pass).toBe(false);
    });
  });
});
