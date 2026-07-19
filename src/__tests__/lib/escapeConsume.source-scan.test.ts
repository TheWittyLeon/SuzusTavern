/**
 * TAV-A11Y-USE-ESCAPE-CONSUME-HOOK — mechanized source-scan guard.
 *
 * Hand-rolling `if (e.key === 'Escape') { e.stopPropagation(); if (!busy) {
 * close(); } }` per overlay is exactly how UIR2-TAV-11 leaked FOUR extra
 * times after the r1 fix (Miko-QA's r2 re-gate) — copy-pasting an old
 * (pre-fix) example, or just forgetting the "stopPropagation is
 * unconditional" part, silently reintroduces the cross-close leak. This test
 * reads the /play page + its 5 overlay components on disk (ConfirmDialog was
 * a 5th /play overlay originally left out of both the r2 migration and this
 * scan — Kage-CR IMPORTANT finding, folded in here) and fails if any raw
 * `e.key === 'Escape'` / `e.key !== 'Escape'` comparison appears that ISN'T
 * routed through a REAL `consumeEscape(...)` call in the SAME enclosing
 * brace-block — so a new overlay added under /play is FORCED to use the
 * helper (or the test fails), rather than relying on enumeration or code
 * review to catch it.
 *
 * SCOPE-AWARE, not proximity-based (Miko-QA P2 — a plain "is there a
 * `consumeEscape(` string within N lines" check passes if that string only
 * appears in a nearby COMMENT, or in a sibling branch's call, without the
 * matched `if` actually routing through it): for every raw Escape
 * comparison this finds the `if`'s own `{ ... }` block by brace-depth
 * matching and requires the `consumeEscape(` call to be textually INSIDE
 * that same block. Line/block comments are stripped from the source before
 * ANY matching happens (both for finding the Escape comparisons — a
 * commented-out example shouldn't count — and for finding `consumeEscape(`
 * — a commented MENTION of it must not satisfy the guard), so
 * `// ...consumeEscape(...)` inside the block is correctly rejected. The
 * comment-derived "document-level fallback" marker text is the one
 * exception matched against the RAW (unstripped) source, since that marker
 * is deliberately documented in a comment.
 */
import fs from 'node:fs';
import path from 'node:path';

const SCANNED_FILES = [
  'src/app/play/[sessionId]/page.tsx',
  'src/components/DmNarrationPanel.tsx',
  'src/components/RebindCharacterButton.tsx',
  'src/components/Composer.tsx',
  'src/components/DmOverrideModal.tsx',
  'src/components/ConfirmDialog.tsx',
];

const ESCAPE_COMPARISON_RE = /key\s*(===|!==)\s*'Escape'/g;

function readRaw(relPath: string): string {
  const abs = path.join(process.cwd(), relPath);
  return fs.readFileSync(abs, 'utf8');
}

/**
 * Strips `//` line comments and slash-star block comments from TS/TSX source,
 * replacing removed characters with spaces (never removing newlines) so
 * every remaining character keeps its original line number. Tracks string/
 * template-literal state so a `//` or `/*` INSIDE a string literal is never
 * mistaken for the start of a comment. Not a full parser (`${...}`
 * interpolations inside template literals are treated as opaque string
 * content, not re-entered as code) — good enough for the narrow purpose
 * here: none of the scanned files have Escape-handling logic nested inside
 * a template-literal interpolation.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  type State = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tmpl';
  let state: State = 'code';
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : '';
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
    // state === 'tmpl'
    if (c === '\\') { out += c + c2; i += 2; continue; }
    if (c === '`') { state = 'code'; out += c; i += 1; continue; }
    out += c; i += 1; continue;
  }
  return out;
}

function lineNumberAt(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

/** Finds the `{ ... }` block immediately following `matchEnd` (the `if
 *  (e.key === 'Escape')`'s own block) by brace-depth matching, and returns
 *  its inner text (exclusive of the braces themselves), or null if no block
 *  is found (e.g. a braceless `if` — not used anywhere in these files). */
function enclosingBlockAfter(stripped: string, matchEnd: number): string | null {
  const openIdx = stripped.indexOf('{', matchEnd);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') {
      depth--;
      if (depth === 0) return stripped.slice(openIdx + 1, i);
    }
  }
  return null;
}

describe('TAV-A11Y-USE-ESCAPE-CONSUME-HOOK — no raw Escape handler bypasses the helper', () => {
  for (const relPath of SCANNED_FILES) {
    it(`${relPath}: every raw Escape comparison routes through a REAL consumeEscape() call in its own enclosing block (or is the documented document-level fallback)`, () => {
      const raw = readRaw(relPath);
      const stripped = stripComments(raw);
      const violations: string[] = [];

      let m: RegExpExecArray | null;
      const re = new RegExp(ESCAPE_COMPARISON_RE);
      while ((m = re.exec(stripped)) !== null) {
        const matchText = m[0];
        const lineNo = lineNumberAt(stripped, m.index);
        const isNegated = matchText.includes('!==');

        if (isNegated) {
          // The only allowed raw form is the documented document-level
          // fallback — verified against the RAW source (the marker text is
          // deliberately inside a comment), by proximity rather than a
          // hardcoded line number so it survives normal prose edits.
          const rawLines = raw.split('\n');
          const backStart = Math.max(0, lineNo - 1 - 60);
          const context = rawLines.slice(backStart, lineNo).join('\n');
          const isDocumentedFallback =
            relPath.endsWith('page.tsx') &&
            /document-level listener is the fallback/.test(context) &&
            /Award-XP/.test(context);
          if (!isDocumentedFallback) {
            violations.push(
              `line ${lineNo}: raw "key !== 'Escape'" not recognized as the documented document-level fallback`,
            );
          }
          continue;
        }

        // "===" form: the enclosing `{ ... }` block must contain a REAL
        // (non-commented) consumeEscape( call — scope-aware, not just
        // "somewhere nearby".
        const block = enclosingBlockAfter(stripped, m.index + matchText.length);
        if (block === null || !/consumeEscape\(/.test(block)) {
          violations.push(
            `line ${lineNo}: raw "key === 'Escape'" — its enclosing block does not contain a real consumeEscape() call`,
          );
        }
      }

      expect(violations).toEqual([]);
    });
  }

  it('every scanned file actually calls consumeEscape at least once, as REAL code not just a comment (the suite above would pass vacuously if a call site were deleted instead of refactored)', () => {
    for (const relPath of SCANNED_FILES) {
      const stripped = stripComments(readRaw(relPath));
      expect(stripped).toMatch(/consumeEscape\(/);
    }
  });
});
