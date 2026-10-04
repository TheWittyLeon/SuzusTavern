/**
 * TPK-HOLD W1 — mechanized source-scan guard: nothing compares a fight's `state` against a state string except the four predicates in
 * `app/play/[sessionId]/format.ts` (`isFightLive`, `areTurnsRunning`, `isFightHeld`, `isFightEnded`).
 *
 * Why: `CombatState.state` was a bare string, so a new engine state (`held`) was silently "not 'active'" at every reader that tested for it, and the review
 * found four consequential misses (the action bar, Move on, the rebind button, a contradictory status line). The closed type makes the compiler find a `switch`;
 * this test finds a COMPARISON, which the compiler cannot. The tenth state is classified once, in the predicates, or this fails.
 *
 * Comments are stripped before matching, so prose that mentions `state === 'active'` is fine. A match in a test file is not scanned (tests compare wire values on purpose).
 */
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../../scripts/lib/strip-source-comments.mjs';

const SRC = path.resolve(__dirname, '../..');
const PREDICATES = path.join(SRC, 'app/play/[sessionId]/format.ts');
const STATES = '(?:idle|rolling_initiative|active|between_turns|held|ended)';
// `<anything>.state === 'ended'`, `!== 'active'`, either order, and `.state` in a `switch`/`case 'held':` is covered by the type, not here.
const COMPARE = new RegExp(`\\.state\\s*[!=]==?\\s*'${STATES}'|'${STATES}'\\s*[!=]==?\\s*[\\w.?]*\\.state\\b`);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__' && e.name !== 'node_modules') walk(abs, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(abs);
  }
  return out;
}

describe('no reader compares a fight state against a string outside the predicates', () => {
  const files = walk(SRC);

  it('scans a real tree (not vacuous) and finds the predicates\' own comparisons in format.ts', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(COMPARE.test(stripComments(fs.readFileSync(PREDICATES, 'utf8')))).toBe(true);
  });

  it('every other source file is clean', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f === PREDICATES) continue;
      const text = stripComments(fs.readFileSync(f, 'utf8'));
      text.split('\n').forEach((line, i) => {
        if (COMPARE.test(line)) offenders.push(`${path.relative(SRC, f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the pattern catches the shapes it is for (both orders, both operators)', () => {
    for (const bad of [
      "if (combatState?.state === 'active') {",
      "x.state !== 'ended'",
      "return cs.state == 'held';",
      "if ('ended' === st.state) return;",
    ]) expect(COMPARE.test(bad)).toBe(true);
    for (const fine of [
      "if (formState === 'idle')",
      "const isResolved = c.state === 'resolved';",
      "session.status === 'active'",
      "setState('active')",
    ]) expect(COMPARE.test(fine)).toBe(false);
  });
});
