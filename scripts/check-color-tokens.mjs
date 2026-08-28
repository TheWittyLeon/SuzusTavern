#!/usr/bin/env node
/**
 * Guards the CLAUDE.md rule: "Never hardcode color values — always use
 * var(--token-name)".
 *
 * Literal colors in a *.module.css file silently opt that element out of
 * palette switching, and the failure is invisible until someone loads a vibe
 * the author never looked at. That is exactly how `color: #fff` survived on
 * four elements at 1.96–2.46:1 contrast (see globals.css --on-fill).
 *
 * Allowed, and why:
 *   - var(--token, #fallback)  the token wins whenever it is defined; the
 *                              literal is dead weight, not a theme escape.
 *   - anything inside a comment
 *   - a line preceded (within 10 lines) by a comment containing
 *     `design-token-exempt` — for the genuinely fixed colors: palette preview
 *     swatches and the environment banner.
 *
 * Run: npm run lint:tokens
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const EXEMPT = 'design-token-exempt';
const HEX = /#[0-9a-fA-F]{3,8}\b/;

/** Blank out comment bodies but keep line count and column positions stable. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.module.css')) out.push(full);
  }
  return out;
}

const offenders = [];

for (const file of walk(SRC)) {
  const raw = readFileSync(file, 'utf8');
  const rawLines = raw.split('\n');
  const codeLines = stripComments(raw).split('\n');

  codeLines.forEach((line, i) => {
    if (!HEX.test(line)) return;

    // A literal that only ever appears as a var() fallback is not a theme escape.
    const withoutFallbacks = line.replace(/var\(\s*--[^,)]+,[^)]*\)/g, '');
    if (!HEX.test(withoutFallbacks)) return;

    // Look back through the ORIGINAL lines so the marker can live in a comment.
    const context = rawLines.slice(Math.max(0, i - 10), i + 1).join('\n');
    if (context.includes(EXEMPT)) return;

    offenders.push({
      file: relative(ROOT, file),
      line: i + 1,
      text: rawLines[i].trim(),
    });
  });
}

if (offenders.length === 0) {
  console.log('✓ color tokens: no un-exempted literal colors in *.module.css');
  process.exit(0);
}

console.error(
  `\n✗ color tokens: ${offenders.length} literal color(s) bypassing the palette system:\n`,
);
for (const o of offenders) {
  console.error(`  ${o.file}:${o.line}\n      ${o.text}`);
}
console.error(
  `\nUse a semantic token (--on-fill for ink on a filled surface, --ink/--ink-2\n` +
    `for body text, --good/--bad/--warn… for status). If the color genuinely must\n` +
    `stay fixed across every palette, add a comment above it containing\n` +
    `"${EXEMPT}" explaining why.\n`,
);
process.exit(1);
