/**
 * Minimal CSS rule walker for pins on cascade ORDER, SPECIFICITY and on which declarations a rule carries. Comments are stripped, nesting at any depth
 * (@media, @supports, @container) is flattened in source order, and a selector list is parsed into its members, so a pin does not care about
 * whitespace, selector order or comments.
 *
 * It THROWS on any at-rule block it does not understand (@layer, @scope, @starting-style, ...): those change what wins the cascade, so a pin that
 * silently skipped them would pass vacuously. Teach the walker the new at-rule (and what it does to the cascade) instead of loosening a test.
 */
export interface CssRule {
  selectors: string[];
  body: string;
  /** Position of the rule's opening `{` in the comment-stripped text: compare for source order. */
  at: number;
}

const FLATTENED_AT_RULES = /^@(media|supports|container)\b/; // conditional only: the rules inside cascade as if written at top level
const OPAQUE_AT_RULES = /^@(keyframes|-webkit-keyframes|font-face|property|counter-style)\b/; // their blocks hold no selectors that style elements

export function cssRules(source: string): CssRule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let prelude = '';
  const stack: Array<{ prelude: string; at: number; body: string; opaque: boolean }> = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const top = stack[stack.length - 1];
    if (c === '{') {
      const p = prelude.trim();
      const opaque = (top?.opaque ?? false) || OPAQUE_AT_RULES.test(p);
      if (p.startsWith('@') && !FLATTENED_AT_RULES.test(p) && !OPAQUE_AT_RULES.test(p) && !top?.opaque) {
        throw new Error(`cssRules: unsupported at-rule "${p.slice(0, 60)}": teach cssRules what it does to the cascade before pinning around it`);
      }
      stack.push({ prelude: p, at: i, body: '', opaque });
      prelude = '';
    } else if (c === '}') {
      const t = stack.pop();
      if (t && !t.opaque && !t.prelude.startsWith('@')) rules.push({ selectors: splitSelectorList(t.prelude), body: t.body, at: t.at });
      prelude = '';
    } else if (c === ';' && stack.length === 0) {
      if (/^@layer\b/.test(prelude.trim())) throw new Error('cssRules: unsupported "@layer" statement: layer order changes what wins the cascade');
      prelude = '';
    } else if (top && !top.opaque && !top.prelude.startsWith('@')) {
      top.body += c;
    } else {
      prelude += c;
    }
  }
  return rules;
}

export function splitSelectorList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of list) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  return [...out, cur].map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Removes `:name(...)` groups (balanced) from a selector; `keep` names stay. */
function dropFunctional(sel: string, names: string[]): string {
  let out = '';
  for (let i = 0; i < sel.length; ) {
    const m = sel.slice(i).match(new RegExp(`^:(${names.join('|')})\\(`));
    if (!m) {
      out += sel[i++];
      continue;
    }
    let depth = 0;
    let j = i + m[0].length - 1;
    for (; j < sel.length; j++) {
      if (sel[j] === '(') depth++;
      else if (sel[j] === ')' && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

/**
 * The compound the rule styles: the text after the last top-level combinator. `:has()` / `:not()` arguments are dropped (they constrain the subject, they
 * do not name it); `:is()` / `:where()` arguments are KEPT, so `:is(.slot)` is still the slot.
 */
export function subjectOf(sel: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && /[\s>+~]/.test(c)) start = i + 1;
  }
  return dropFunctional(sel.slice(start), ['has', 'not']);
}

/** True when the subject carries class `.name` (exactly: `.tab` is not `.tabs` or `.tabActive`). */
export const subjectHasClass = (sel: string, name: string): boolean => new RegExp(`\\.${name}(?![\\w-])`).test(subjectOf(sel));
export const subjectHasHover = (sel: string): boolean => /:hover(?![\w-])/.test(subjectOf(sel));

/** [ids, classes/attributes/pseudo-classes, elements] of one selector; `:where()` is 0, `:is()/:not()/:has()` count their heaviest argument. */
export function specificity(sel: string): [number, number, number] {
  let s = sel;
  const total: [number, number, number] = [0, 0, 0];
  const add = (x: [number, number, number]) => {
    total[0] += x[0];
    total[1] += x[1];
    total[2] += x[2];
  };
  for (;;) {
    const m = s.match(/:(is|not|has|where)\(/);
    if (!m || m.index === undefined) break;
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < s.length; j++) {
      if (s[j] === '(') depth++;
      else if (s[j] === ')' && --depth === 0) break;
    }
    const inner = s.slice(m.index + m[0].length, j);
    if (m[1] !== 'where') {
      const parts = splitSelectorList(inner).map(specificity);
      parts.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      if (parts.length) add(parts[parts.length - 1]);
    }
    s = s.slice(0, m.index) + s.slice(j + 1);
  }
  total[0] += (s.match(/#[\w-]+/g) ?? []).length;
  total[1] += (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  total[2] += (s.replace(/\[[^\]]*\]/g, '').match(/(^|[\s>+~])[a-zA-Z][\w-]*|::[\w-]+/g) ?? []).length;
  return total;
}

/** Negative when a < b, 0 when equal, positive when a > b. */
export const compareSpecificity = (a: [number, number, number], b: [number, number, number]): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
