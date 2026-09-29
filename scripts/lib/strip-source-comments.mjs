/**
 * Shared string/template-literal-aware comment stripper for TS/TSX source.
 *
 * A8 fix round, Kage-CR IMPORTANT-1 (2026-09-28): this exact state machine
 * used to be duplicated byte-for-byte (apart from TS type annotations and a
 * `text`/`src` parameter-name difference) in
 * `scripts/check-page-line-ratchet.mjs` and
 * `src/__tests__/lib/escapeConsume.source-scan.test.ts`. Both now import
 * this one copy so a fix — like the `${}` stack below — reaches both call
 * sites instead of needing to be applied twice. `check-page-line-ratchet.
 * test.ts` already imported `check-page-line-ratchet.mjs` by relative path
 * with an explicit `.mjs` extension before this change, so this module is
 * importable from a `.ts` test the same way, with no new build machinery.
 *
 * `${}` stack (IMPORTANT-1(i)): while inside a template literal (`tmpl`),
 * seeing `${` pushes the interpolation depth and switches to `code` state
 * — the interpolation's contents are real code, not string text — and
 * while in `code` with a non-empty depth, a `}` pops one level and
 * switches back to `tmpl`. Without this, a template literal nested inside
 * another template literal's `${...}` desyncs the tmpl/code toggle: the
 * inner backtick is read as CLOSING the outer template rather than opening
 * a nested one, so anything textually resembling a block-comment opener
 * inside that inner template (e.g. `` `${`/*`}` ``) is misread as real
 * code that starts an actual `/* ... *\/` block comment, silently
 * swallowing every real line up to the next stray `*\/` anywhere later in
 * the file — TAV-RATCHET-NESTED-TEMPLATE-MISCOUNT (Miko-QA A8 review),
 * confirmed exploitable by Kage-CR A8 IMPORTANT-1 (measured -1 to -537
 * lines across seven insertion points in the real page.tsx). This fix
 * uses a single integer depth counter, not a full context stack: because
 * this module only tracks two states (`code`/`tmpl`) regardless of how
 * deep any nesting goes, every `}` seen at depth > 0 always means "an
 * interpolation just closed, return to string/template mode" — which
 * `tmpl` state IS, at whatever nesting level — so the counter only needs
 * to gate that one transition, not remember which level it is.
 *
 * Known, accepted imprecision (same class of caveat this module's callers
 * already state for themselves: "not a full parser"): a `{`/`}` pair
 * INSIDE an interpolation's own code (e.g. an object literal —
 * `` `${fn({a:1})}` ``) is not depth-tracked separately from the
 * interpolation's own closing brace, so a nested `{...}` there can pop the
 * counter early. Not exploited by any known file today; the mirror rule's
 * "no new dependency for what already works" applies here too — Kage-CR
 * measured that swapping in TypeScript's own scanner
 * (`ts.createScanner`) does not actually fix this class of gap either (it
 * under-strips JSX-embedded comments and still misreads the regex-literal
 * hole below), so a better lexer is not the answer; the divergence check
 * in `check-page-line-ratchet.mjs` (IMPORTANT-1(ii)) is the fail-closed
 * backstop for whatever this lexer still misses.
 *
 * A second, DIFFERENT known gap this fix does not touch: a regex literal
 * whose character class contains `/*` (e.g. `const re = /[/*]/;`) is
 * misread as opening a real block comment, because this module has no
 * concept of a regex-literal context at all (only `'`, `"`, `` ` ``). This
 * is not a template-nesting problem and has no cheap lexer fix (per
 * Kage-CR A8 IMPORTANT-1) — it is exactly the class of thing the
 * divergence check exists to catch instead of trying to parse correctly.
 */
export function stripComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  let state = 'code';
  let tmplInterpDepth = 0;
  while (i < n) {
    const c = text[i];
    const c2 = i + 1 < n ? text[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { state = 'sq'; out += c; i += 1; continue; }
      if (c === '"') { state = 'dq'; out += c; i += 1; continue; }
      if (c === '`') { state = 'tmpl'; out += c; i += 1; continue; }
      if (c === '}' && tmplInterpDepth > 0) { tmplInterpDepth -= 1; state = 'tmpl'; out += c; i += 1; continue; }
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
    if (c === '$' && c2 === '{') { tmplInterpDepth += 1; state = 'code'; out += c + c2; i += 2; continue; }
    out += c; i += 1; continue;
  }
  return out;
}
