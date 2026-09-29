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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  countLines,
  countCodeLines,
  countCodeLinesNaive,
  evaluateDivergence,
  evaluateRatchet,
  DIVERGENCE_TOLERANCE_PERCENT,
  RATCHET_CEILING,
} from '../../../scripts/check-page-line-ratchet.mjs';

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

  describe('countCodeLines — A8 carry item (a): non-comment, non-blank lines only (the metric the gate actually enforces)', () => {
    it('excludes blank lines, // comments, and /* block */ comments; includes real code, even code sharing a line with a trailing comment', () => {
      const fixture = [
        'const a = 1;', // 1: code
        '',              // 2: blank
        '// a full-line comment',      // 3: comment only
        'const b = 2; // trailing',    // 4: code (comment on the same line doesn't disqualify it)
        '/* a block comment on one line */', // 5: comment only
        '/*',                          // 6-8: multi-line block comment, entirely non-code
        '   spanning three lines',
        '*/',
        '   ',                          // 9: whitespace-only, still blank
        'const c = 3;',                 // 10: code
      ].join('\n');
      expect(countCodeLines(fixture)).toBe(3); // lines 1, 4, 10
    });

    it('excludes a JSX comment `{/* ... */}` even though its own braces are not comment syntax', () => {
      const fixture = [
        '<div>',                    // code
        '  {/* explanatory JSX comment */}', // JSX-comment-only line: excluded
        '  <span>{value}</span>',   // code
        '</div>',                   // code
      ].join('\n');
      expect(countCodeLines(fixture)).toBe(3);
    });

    it('still counts real code that renders alongside a JSX comment on the same line', () => {
      const fixture = '<div>{/* c */}<span/></div>';
      expect(countCodeLines(fixture)).toBe(1);
    });

    it('does not mistake a real, code-only `{}` block (e.g. a bare closing/opening brace pair) for a JSX-comment remnant', () => {
      const fixture = ['function f() {', '  return;', '}', 'const g = () => {};'].join('\n');
      expect(countCodeLines(fixture)).toBe(4);
    });

    it('is 0 for an all-comment, all-blank file', () => {
      expect(countCodeLines('\n// only a comment\n\n/* and a block */\n')).toBe(0);
    });

    it('matches the real page.tsx count the ratchet is currently baselined against', () => {
      // Read-only integration check (same "passes clean today" pattern as
      // the CLI test above) -- proves the baseline in the history chain
      // comment was measured with THIS function, not estimated.
      const raw = readFileSync(
        path.join(process.cwd(), 'src/app/play/[sessionId]/page.tsx'),
        'utf8',
      );
      expect(countCodeLines(raw)).toBe(RATCHET_CEILING);
    });

    describe('A8 fix round, Kage-CR IMPORTANT-1(i) — nested template literals no longer desync the tmpl/code toggle', () => {
      it('a template literal nested inside another template literal\'s ${} is counted correctly (previously 1, now 4 -- reproduced against the pre-fix state machine below)', () => {
        const fixture = [
          'const openMarker = `${`/*`}`;', // 1: code -- the poison shape itself
          'void openMarker;', // 2: code
          'const real1 = 1;', // 3: code
          'const real2 = 2;', // 4: code
        ].join('\n');
        expect(countCodeLines(fixture)).toBe(4);
      });

      it('regression proof: the pre-fix stripComments (no ${} stack) undercounts the same fixture to 1 -- the inner backtick was read as closing the OUTER template, so the following literal "/*" opened a real block comment that swallowed the rest', () => {
        // Byte-for-byte the state machine this file's `countCodeLines`
        // called before scripts/lib/strip-source-comments.mjs's `${}` fix
        // (IMPORTANT-1(i)) -- kept here ONLY to prove the regression this
        // fix closes was real, per Ren-Dev's bug-fix protocol (mutate the
        // fix off, see it fail, then confirm the fixed function above
        // passes the identical input). Not exported, not the file under
        // test -- a frozen copy of the OLD behaviour.
        function stripCommentsPreFix(text: string): string {
          let out = '';
          let i = 0;
          const n = text.length;
          let state = 'code';
          while (i < n) {
            const c = text[i];
            const c2 = i + 1 < n ? text[i + 1] : '';
            if (state === 'code') {
              if (c === '/' && c2 === '/') { state = 'line'; out += '  '; i += 2; continue; }
              if (c === '/' && c2 === '*') { state = 'block'; out += '  '; i += 2; continue; }
              if (c === "'") { state = 'sq'; out += c; i += 1; continue; }
              if (c === '"') { state = 'dq'; out += c; i += 1; continue; }
              if (c === '`') { state = 'tmpl'; out += c; i += 1; continue; }
              out += c; i += 1; continue;
            }
            if (state === 'line') {
              if (c === '\n') { state = 'code'; out += c; i += 1; continue; }
              out += ' '; i += 1; continue;
            }
            if (state === 'block') {
              if (c === '*' && c2 === '/') { state = 'code'; out += '  '; i += 2; continue; }
              out += c === '\n' ? '\n' : ' '; i += 1; continue;
            }
            if (state === 'sq' || state === 'dq') {
              const quote = state === 'sq' ? "'" : '"';
              if (c === '\\') { out += c + c2; i += 2; continue; }
              if (c === quote) { state = 'code'; out += c; i += 1; continue; }
              out += c; i += 1; continue;
            }
            if (c === '\\') { out += c + c2; i += 2; continue; }
            if (c === '`') { state = 'code'; out += c; i += 1; continue; }
            out += c; i += 1; continue;
          }
          return out;
        }
        function countCodeLinesPreFix(text: string): number {
          const stripped = stripCommentsPreFix(text);
          let count = 0;
          for (const line of stripped.split('\n')) if (line.trim() !== '') count += 1;
          return count;
        }
        const fixture = [
          'const openMarker = `${`/*`}`;',
          'void openMarker;',
          'const real1 = 1;',
          'const real2 = 2;',
        ].join('\n');
        expect(countCodeLinesPreFix(fixture)).toBe(1); // red on the old code
        expect(countCodeLines(fixture)).toBe(4); // green on the fixed code
      });
    });

    describe('A8 fix round, Kage-CR IMPORTANT-1 -- the regex-literal hole (Suggestion E fixture coverage)', () => {
      it('a regex literal whose character class contains "/*" still defeats countCodeLines -- accepted, unfixed residual (no cheap lexer fix per Kage-CR); this is exactly what the divergence check below exists to catch instead', () => {
        const fixture = ['const re = /[/*]/;', 'realA();', 'realB();'].join('\n');
        // 3 real lines counted as 1 -- the unterminated "/*" inside the
        // regex opens a real block-comment state that swallows the rest.
        expect(countCodeLines(fixture)).toBe(1);
        // The naive counter has no `/` awareness at all, so it isn't
        // fooled by this particular shape.
        expect(countCodeLinesNaive(fixture)).toBe(3);
      });
    });

    describe('A8 fix round, Kage-CR IMPORTANT-1(ii) -- countCodeLinesNaive is a deliberately different, differently-wrong counter', () => {
      it('agrees exactly with countCodeLines on the same fixtures the smart counter gets right', () => {
        const fixture = [
          'const a = 1;',
          '',
          '// a full-line comment',
          'const b = 2; // trailing',
          '/* a block comment on one line */',
          'const c = 3;',
        ].join('\n');
        expect(countCodeLinesNaive(fixture)).toBe(countCodeLines(fixture));
      });

      it('agrees exactly with countCodeLines on the real page.tsx today (0% divergence, measured directly)', () => {
        const raw = readFileSync(
          path.join(process.cwd(), 'src/app/play/[sessionId]/page.tsx'),
          'utf8',
        );
        expect(countCodeLinesNaive(raw)).toBe(countCodeLines(raw));
      });
    });
  });

  describe('evaluateDivergence -- IMPORTANT-1(ii): fail closed when the two counters disagree past tolerance', () => {
    it('PASSES when the two counters agree exactly', () => {
      expect(evaluateDivergence(946, 946).pass).toBe(true);
    });

    it('PASSES within tolerance', () => {
      const withinTolerance = 946 * (1 + DIVERGENCE_TOLERANCE_PERCENT / 100 - 0.001);
      expect(evaluateDivergence(946, withinTolerance).pass).toBe(true);
    });

    it('FAILS past tolerance and names both counts', () => {
      const { pass, message } = evaluateDivergence(946, 1500);
      expect(pass).toBe(false);
      expect(message).toContain('946');
      expect(message).toContain('1500');
    });

    it('catches the regex-literal hole that countCodeLines alone cannot fix', () => {
      const fixture = ['const re = /[/*]/;', 'realA();', 'realB();'].join('\n');
      const smart = countCodeLines(fixture);
      const naive = countCodeLinesNaive(fixture);
      expect(evaluateDivergence(smart, naive).pass).toBe(false);
    });
  });

  describe('IMPORTANT-1 -- Kage-CR A8 poison reproduction, reproduced against a scratch fixture (never written to the real page.tsx)', () => {
    // Kage-CR A8 IMPORTANT-1: "one line `const openMarker = `${`/*`}`;`
    // plus `void openMarker;` plus 60 real code lines (30
    // `const spareN = N;` + 30 `void spareN;`)". Reproduced verbatim in
    // shape (not spliced into the real 946-line page.tsx -- same
    // pure-function pattern the rest of this suite already uses to keep
    // that file untouched).
    const poisonBlock = [
      'const openMarker = `${`/*`}`;',
      'void openMarker;',
      ...Array.from({ length: 30 }, (_, i) => `const spare${i} = ${i};`),
      ...Array.from({ length: 30 }, (_, i) => `void spare${i};`),
    ];

    it('is exactly 62 lines, all real code', () => {
      expect(poisonBlock).toHaveLength(62);
    });

    it('countCodeLines now counts every one of the 62 poisoned lines correctly (pre-fix, this undercounted by hundreds on the real file)', () => {
      expect(countCodeLines(poisonBlock.join('\n'))).toBe(62);
    });

    it('spliced into a realistic file, the ratchet now correctly FAILS on real growth instead of falsely reporting headroom', () => {
      const base = Array.from({ length: 20 }, (_, i) => `const base${i} = ${i};`).join('\n');
      const fixture = `${base}\n${poisonBlock.join('\n')}\n`;
      const actual = countCodeLines(fixture);
      expect(actual).toBe(82); // 20 base + 62 poison
      // Ceiling one below the true total simulates "no headroom left" --
      // the pre-fix bug would have reported a fictitiously low count here
      // and passed with false headroom instead.
      expect(evaluateRatchet(actual, 81).pass).toBe(false);
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
