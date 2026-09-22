#!/usr/bin/env node
/**
 * TAV-PLAY-SHELL-RATCHET-NOT-ENFORCED (P2). Decomposition plan §8 "The
 * concrete rule for R1", item 3: "npm run lint gains one line asserting
 * page.tsx is no longer than the count recorded at the previous step's
 * close. page.tsx may only shrink." This is the gate that makes R14's
 * accepted cost (two tracks touching /play at once, R1 in the risk
 * register) survivable — a concurrent feature PR that adds lines to
 * page.tsx instead of landing in the region/hook that owns them
 * (decomposition plan §8, "The concrete rule for R1", rule 2) fails
 * `npm run lint` immediately, not code review three days later once both
 * branches have moved on.
 *
 * RATCHET_CEILING is a hand-maintained literal — same pattern this repo
 * already uses for SCOPE_GLOBS in check-layout-tokens.mjs and
 * PLAY_PHONE_MAX_WIDTH in breakpoints.ts: whoever lands a commit that
 * shrinks page.tsx lowers this number, in the SAME commit, to the file's
 * new actual line count. Never raise it. If a change genuinely needs to
 * raise it, that need is itself the finding the ratchet exists to catch —
 * extract instead.
 *
 * Line-counting matches `wc -l` (a count of '\n' bytes), the tool every
 * number in the decomposition plan and this task was measured with — NOT
 * `content.split('\n').length`, which overcounts by one on any file ending
 * in a trailing newline (the POSIX norm, and true of page.tsx today).
 *
 * Run: npm run lint:page-ratchet (wired into `npm run lint`)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PAGE_REL = 'src/app/play/[sessionId]/page.tsx';
const PAGE = join(ROOT, PAGE_REL);

// Recorded at TAV-PLAY-SHELL step 4's close (2026-09-21) -- killing the
// aria-hidden Offers duplicate shrank page.tsx from 5861 to 5790. Update
// this value, in the SAME commit, whenever page.tsx's actual line count
// drops below it. Never raise it.
export const RATCHET_CEILING = 5790;

/**
 * Pure: counts lines the way `wc -l` does (newline-byte count). Exported so
 * tests can check the off-by-one behaviour on strings with/without a
 * trailing newline without touching any file on disk.
 */
export function countLines(text) {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') count += 1;
  }
  return count;
}

/**
 * Pure: the ratchet's actual decision, isolated from process.exit / stdio
 * so it can be unit-tested directly (mutation-verification: feed it a
 * count above the ceiling and assert it reports failure, without ever
 * writing to page.tsx — a 5,861-line file imported by the majority of the
 * /play suite, which is exactly the kind of shared-file mutation
 * b8de6ea's maxWorkers cap exists to keep out of the flake budget).
 */
export function evaluateRatchet(actualLines, ceiling = RATCHET_CEILING) {
  if (actualLines > ceiling) {
    return {
      pass: false,
      message:
        `\n✗ page.tsx ratchet: ${actualLines} lines, ceiling is ${ceiling}.\n\n` +
        `${PAGE_REL} grew by ${actualLines - ceiling} line(s).\n` +
        `TAV-PLAY-SHELL's extraction track owns this file; feature work on\n` +
        `/play lands in the region or hook that owns it, never in page.tsx\n` +
        `directly (decomposition plan §8, "The concrete rule for R1", rule 2).\n` +
        `Extract instead of adding here. If this growth is a deliberate,\n` +
        `reviewed part of the extraction itself, raise RATCHET_CEILING in\n` +
        `scripts/check-page-line-ratchet.mjs in the same commit and say why.\n`,
    };
  }
  if (actualLines < ceiling) {
    return {
      pass: true,
      message:
        `✓ page.tsx ratchet: ${actualLines} lines (ceiling ${ceiling}, ` +
        `${ceiling - actualLines} line(s) of headroom). Lower RATCHET_CEILING ` +
        `to ${actualLines} in the commit that earned the shrink so the ratchet holds it.`,
    };
  }
  return { pass: true, message: `✓ page.tsx ratchet: ${actualLines} lines, at ceiling.` };
}

function main() {
  const raw = readFileSync(PAGE, 'utf8');
  const actual = countLines(raw);
  const { pass, message } = evaluateRatchet(actual, RATCHET_CEILING);
  if (pass) {
    console.log(message);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}

// Only run as a script (not when imported by the regression test below).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
