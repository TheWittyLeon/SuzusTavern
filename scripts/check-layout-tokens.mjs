#!/usr/bin/env node
/**
 * Guards TAV-PLAY-SHELL's geometry tokens the way check-color-tokens.mjs
 * guards color: a reskin/redensify should be a token-value swap, not a
 * file-by-file px hunt.
 *
 * Two rules, both currently scoped to the play-shell's OWN new files, not
 * retrofitted across the other ~70 CSS files in the repo (that would fail
 * `npm run lint` on hundreds of pre-existing, out-of-scope literals — see
 * CLAUDE.md's "explicitly not the design-system rebuild"). SCOPE_GLOBS
 * grows as the decomposition plan's steps land:
 *   step 1 (this commit): mechanism wired into `npm run lint`, scope empty
 *     until there is play-shell-owned CSS to check.
 *   step 2: src/components/Drawer.module.css joins SCOPE_GLOBS.
 *   step 3: src/app/play/[sessionId]/regions/*.module.css joins it.
 *   step 6 (decomposition plan §3.5 Guard 3, deferred there deliberately —
 *     a guard with one preset has one tenant, the mirror-rule failure):
 *     a second rule rejects `grid-template-areas` / `grid-template-columns`
 *     / `position: fixed` inside regions/*.module.css, since a region that
 *     re-decides its own placement is the "never fork a component" rule
 *     (R16) wearing a different hat.
 *
 * Rule 1 — spacing/type token literals. A raw px value in a spacing
 * property (padding/margin/gap/inset) or a font-size/line-height
 * declaration, inside a SCOPE_GLOBS file, that isn't `var(--space-N`)` /
 * `var(--text-*` / `var(--leading-*` and isn't exempted. Same escape
 * mechanism as check-color-tokens.mjs (a `design-token-exempt` comment
 * within 10 lines back) rather than inventing a second one.
 *
 * Rule 2 — breakpoint drift. `src/lib/breakpoints.ts`'s
 * PLAY_PHONE_MAX_WIDTH is the one source of truth for /play's 880px
 * breakpoint; CSS can't read a custom property inside an `@media` feature
 * query, so Play.module.css still carries the literal. This rule fails if
 * that literal ever drifts from breakpoints.ts's own number.
 *
 * Run: npm run lint:layout-tokens
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const EXEMPT = 'design-token-exempt';

// Grows per the header comment above — do not retrofit the whole repo here.
const SCOPE_GLOBS = [
  'src/components/Drawer.module.css',
  "src/app/play/[sessionId]/regions/*.module.css",
];

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * Resolves each SCOPE_GLOBS entry by hand (no glob dependency, no
 * fs.globSync — that's Node 22+ only and CLAUDE.md's stack floor is Node
 * 20; check-color-tokens.mjs's own recursive `walk()` sets the same
 * portable-readdir precedent this mirrors). Single-level `dir/*.ext` only —
 * the only pattern this file needs.
 */
function scopeFiles() {
  const out = [];
  for (const pattern of SCOPE_GLOBS) {
    const dir = join(ROOT, dirname(pattern));
    const base = basename(pattern);
    if (!base.includes('*')) {
      if (existsSync(join(ROOT, pattern))) out.push(join(ROOT, pattern));
      continue;
    }
    if (!existsSync(dir)) continue; // step 2/3's directory doesn't exist yet
    const re = new RegExp(`^${base.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    for (const entry of readdirSync(dir)) {
      if (re.test(entry)) out.push(join(dir, entry));
    }
  }
  return out;
}

const SPACING_PROP_LINE = /^\s*(padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left|gap|row-gap|column-gap|top|right|bottom|left|inset)\s*:\s*([^;]+);/;
const TYPE_PROP_LINE = /^\s*(font-size|line-height)\s*:\s*([^;]+);/;
const PXNUM = /(-?\d+(?:\.\d+)?)px/g;
const ALLOWED_VAR = /var\(\s*--(space-\d|text-(xs|sm|base|lg|xl|2xl)|leading-(tight|normal))\b/;

const offenders = [];

for (const file of scopeFiles()) {
  const raw = readFileSync(file, 'utf8');
  const rawLines = raw.split('\n');
  const codeLines = stripComments(raw).split('\n');

  codeLines.forEach((line, i) => {
    const spacing = SPACING_PROP_LINE.exec(line);
    const type = TYPE_PROP_LINE.exec(line);
    const decl = spacing || type;
    if (!decl) return;

    const value = decl[2];
    // A literal that only ever appears as a var() fallback is not a token escape.
    const withoutFallbacks = value.replace(/var\(\s*--[^,)]+,[^)]*\)/g, '');
    if (!PXNUM.test(withoutFallbacks)) return;
    if (ALLOWED_VAR.test(value)) return; // already token-driven, with a raw fallback only

    const context = rawLines.slice(Math.max(0, i - 10), i + 1).join('\n');
    if (context.includes(EXEMPT)) return;

    offenders.push({
      file: relative(ROOT, file),
      line: i + 1,
      text: rawLines[i].trim(),
      kind: spacing ? 'spacing' : 'type',
    });
  });
}

// Rule 2 — breakpoint drift, independent of SCOPE_GLOBS (breakpoints.ts and
// Play.module.css both already exist; this is a drift check, not a
// retrofit-discipline check, so it is safe to run unconditionally).
const drift = [];
const breakpointsSrc = readFileSync(join(ROOT, 'src/lib/breakpoints.ts'), 'utf8');
const constMatch = /PLAY_PHONE_MAX_WIDTH\s*=\s*(\d+)/.exec(breakpointsSrc);
if (!constMatch) {
  drift.push({ file: 'src/lib/breakpoints.ts', issue: 'PLAY_PHONE_MAX_WIDTH constant not found — did it get renamed?' });
} else {
  const expected = constMatch[1];
  const playCssPath = join(ROOT, "src/app/play/[sessionId]/Play.module.css");
  if (existsSync(playCssPath)) {
    const playCss = readFileSync(playCssPath, 'utf8');
    const mediaWidths = [...playCss.matchAll(/@media\s*\(\s*(?:min|max)-width:\s*(\d+)px\s*\)/g)]
      .map((m) => m[1])
      .filter((w) => Number(w) === Number(expected) || Math.abs(Number(w) - Number(expected)) === 1); // 880/881 pair
    if (mediaWidths.length === 0) {
      drift.push({
        file: 'Play.module.css',
        issue: `no @media rule near ${expected}px found — breakpoints.ts says PLAY_PHONE_MAX_WIDTH=${expected} but Play.module.css's own literal has drifted (or been removed)`,
      });
    }
  }
}

if (offenders.length === 0 && drift.length === 0) {
  console.log('✓ layout tokens: no un-exempted spacing/type literals in scope, no breakpoint drift');
  process.exit(0);
}

if (offenders.length > 0) {
  console.error(`\n✗ layout tokens: ${offenders.length} raw ${offenders.some(o => o.kind === 'type') ? 'spacing/type' : 'spacing'} literal(s) bypassing the scale:\n`);
  for (const o of offenders) console.error(`  ${o.file}:${o.line} [${o.kind}]\n      ${o.text}`);
  console.error(
    `\nUse the scale (--space-1..8 for spacing, --text-xs..2xl / --leading-tight` +
      `/--leading-normal for type — see globals.css). If a value genuinely can't` +
      ` fit the scale, add a comment above it containing "${EXEMPT}" explaining why.\n`,
  );
}
if (drift.length > 0) {
  console.error(`\n✗ layout tokens: breakpoint drift:\n`);
  for (const d of drift) console.error(`  ${d.file}: ${d.issue}`);
}
process.exit(1);
